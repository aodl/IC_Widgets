#[allow(dead_code)]
mod support;

use std::collections::BTreeSet;

use candid::{CandidType, Principal, decode_one, encode_args, encode_one};
use nexus_review_engine::{
    FindingCode, MembershipState, ProposalEvidence, Record, ReviewError, StepOutcome,
};
use nexus_reviewer::{
    DetailKeys, DetailRecords, LiveError, LiveResponse, LiveReview, LiveSubnetActivity,
    LiveSubnetSnapshot, PolicySnapshot, Sources,
};
use pocket_ic::{PocketIc, PocketIcBuilder, Time};
use serde::de::DeserializeOwned;
use serde_json::Value;

fn call<T: CandidType + DeserializeOwned>(
    pic: &PocketIc,
    id: Principal,
    controller: Principal,
    method: &str,
    args: Vec<u8>,
) -> T {
    let reply = pic.update_call(id, controller, method, args).unwrap();
    decode_one(&reply).unwrap()
}

fn set(members: &[Principal]) -> BTreeSet<String> {
    members.iter().map(Principal::to_text).collect()
}

fn expected_ids(json: &Value) -> BTreeSet<String> {
    json.as_array()
        .expect("expected membership list")
        .iter()
        .map(|id| {
            let text = id.as_str().unwrap();
            assert_eq!(Principal::from_text(text).unwrap().to_text(), text);
            text.to_owned()
        })
        .collect()
}

fn verify_state(actual: &MembershipState, expected: &Value) {
    for (name, members) in [
        ("members", &actual.members),
        ("added", &actual.added),
        ("removed", &actual.removed),
        ("retained", &actual.retained),
    ] {
        assert_eq!(set(members), expected_ids(&expected[name]), "{name}");
        assert_eq!(
            set(members).len(),
            members.len(),
            "{name} contains duplicates"
        );
    }
}

#[test]
#[ignore = "built and explicitly selected by scripts/test-m0.sh"]
fn committed_replays_resolve_exact_subnet_and_boundary_cases() {
    assert!(
        support::enabled(),
        "run scripts/test-m0.sh to prepare the fixture Wasms"
    );
    let metadata: Value = serde_json::from_str(include_str!(
        "../../../tests/source-fixture/data/historical/replays.json"
    ))
    .unwrap();
    let expected: Value = serde_json::from_str(include_str!(
        "../../../tests/source-fixture/data/historical/expected.json"
    ))
    .unwrap();
    let cases = metadata["replays"].as_array().unwrap();
    let clock = |row: &Value| {
        let seconds: u64 = row["replay_clock_unix_seconds"]
            .as_str()
            .unwrap()
            .parse()
            .unwrap();
        Time::from_nanos_since_unix_epoch(seconds * 1_000_000_000)
    };
    let pic = PocketIcBuilder::new()
        .with_nns_subnet()
        .with_application_subnet()
        .with_initial_time(clock(&cases[0]))
        .build();
    let controller = Principal::from_slice(&[91, 2]);
    let fixture =
        pic.create_canister_on_subnet(Some(controller), None, pic.topology().get_nns().unwrap());
    let app = pic.topology().get_app_subnets()[0];
    let reviewer = pic.create_canister_on_subnet(Some(controller), None, app);
    let production = pic.create_canister_on_subnet(Some(controller), None, app);
    let source = encode_one(Some(Sources {
        governance: fixture,
        registry: fixture,
    }))
    .unwrap();
    let rejected = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        pic.install_canister(
            production,
            support::wasm(".local/reviewer-production.wasm.gz"),
            source.clone(),
            Some(controller),
        )
    }))
    .expect_err("production installation accepted fixture sources");
    assert!(
        rejected
            .downcast_ref::<String>()
            .unwrap()
            .contains("source overrides require a fixture build")
    );
    pic.install_canister(
        fixture,
        support::wasm("target/wasm32-unknown-unknown/release/nexus_source_fixture.wasm"),
        encode_args(()).unwrap(),
        Some(controller),
    );
    pic.install_canister(
        reviewer,
        support::wasm(".local/reviewer-fixture.wasm"),
        source,
        Some(controller),
    );
    let checkpoint = |method| {
        pic.update_call(reviewer, controller, method, encode_args(()).unwrap())
            .unwrap()
    };
    // Reading the Registry status initializes its stable indexes in a fresh
    // canister. Sample the collector's page count after that read.
    let registry = checkpoint("registry_status");
    let collector = checkpoint("collection_status");
    let mut completed = BTreeSet::new();

    for row in cases {
        let name = row["id"].as_str().unwrap();
        if pic.get_time() < clock(row) {
            pic.set_time(clock(row));
        }
        call::<()>(
            &pic,
            fixture,
            controller,
            "load_review_case",
            encode_one(name).unwrap(),
        );
        let ids: Vec<u64> = row["proposal_ids"]
            .as_array()
            .unwrap()
            .iter()
            .map(|id| id.as_str().unwrap().parse().unwrap())
            .collect();
        let pinned: u64 = row["registry"]["version"]
            .as_str()
            .unwrap()
            .parse()
            .unwrap();
        let before = pic.cycle_balance(reviewer);
        let reply: LiveResponse<LiveReview> = call::<Result<_, String>>(
            &pic,
            reviewer,
            controller,
            "begin_membership_review",
            encode_one(&ids).unwrap(),
        )
        .unwrap();
        println!(
            "{name}: {} reads, {} source bytes, {} instructions, {} PocketIC cycles",
            reply.usage.calls,
            reply.usage.source_bytes,
            reply.usage.instructions,
            before - pic.cycle_balance(reviewer)
        );
        assert_eq!(reply.receipts.len(), reply.usage.calls as usize);
        assert!(reply.usage.calls <= 24);
        assert!((1..=160 * 1024).contains(&reply.usage.source_bytes));
        assert!((1..=120_000_000).contains(&reply.usage.instructions));
        if name == "boundary-software-144909" {
            assert!(matches!(
                reply.outcome,
                Err(LiveError::InvalidEvidence(ReviewError::UnsupportedAction {
                    id: 144909,
                    function: Some(47),
                    ..
                }))
            ));
            continue;
        }
        assert_eq!(reply.registry_version, Some(pinned), "{name}");
        if name == "untargeted-incomplete" {
            assert!(
                matches!(
                    reply.outcome,
                    Err(LiveError::InvalidEvidence(ReviewError::UnavailableRecord(
                        _
                    )))
                ),
                "{:?}",
                reply.outcome.err()
            );
            assert!(reply.receipts.iter().any(|row| {
                row.reject
                    .as_deref()
                    .is_some_and(|v| v.contains("uncaptured Registry key"))
            }));
            completed.insert(name);
            continue;
        }
        let live = reply
            .outcome
            .unwrap_or_else(|error| panic!("{name}: {error:?}"));
        assert_eq!(live.report.manifest.registry_version, pinned);
        if pinned == 66013 {
            assert_eq!(
                (live.listed_subnets, live.total_listed_subnets),
                (1, Some(96))
            );
        }
        if name.starts_with("review-checks-") {
            let checks = live
                .review_checks
                .as_ref()
                .expect("replicated integrity checks");
            let discovery: LiveResponse<LiveSubnetActivity> = call::<Result<_, String>>(
                &pic,
                reviewer,
                controller,
                "subnet_activity",
                encode_one(&ids).unwrap(),
            )
            .unwrap();
            assert_eq!(discovery.registry_version, None);
            assert!(
                discovery
                    .receipts
                    .iter()
                    .all(|receipt| receipt.source == fixture
                        && matches!(
                            receipt.method.as_str(),
                            "list_proposals" | "get_proposal_info"
                        ))
            );
            let activity = discovery.outcome.unwrap();
            match name {
                "review-checks-three-replacements" => {
                    assert_eq!(
                        checks[0].transitions[0].margin.as_ref().unwrap().remaining,
                        1
                    );
                    assert!(activity.complete);
                    let matches: BTreeSet<_> =
                        activity.matches.iter().map(|item| item.other).collect();
                    assert_eq!(
                        matches,
                        [990002, 990003, 990005, 990006].into_iter().collect()
                    );
                    assert_eq!(activity.coverage.hydrated, 1);
                    assert_eq!(activity.coverage.adopted_listed, 2);
                }
                "review-checks-four-replacements" => {
                    assert_eq!(
                        checks[0].transitions[0].margin.as_ref().unwrap().remaining,
                        0
                    );
                    assert!(activity.coverage.pagination_complete);
                    assert_eq!(activity.coverage.missing_payloads, 1);
                    assert!(!activity.complete);
                }
                "review-checks-combined" => {
                    assert!(checks.iter().any(|step| step.add_duplicates.len() == 1
                        && step.remove_duplicates.len() == 1
                        && step.overlap.len() == 1));
                    assert!(
                        checks
                            .iter()
                            .flat_map(|step| step.transitions.iter())
                            .any(|item| item
                                .margin
                                .as_ref()
                                .is_some_and(|margin| margin.remaining < 0))
                    );
                }
                _ => unreachable!(),
            }
        }
        let oracle = &expected["cases"][name];
        if !oracle.is_null() {
            for scenario in &live.report.scenarios {
                let steps = oracle["scenarios"][format!("{:?}", scenario.id)]
                    .as_array()
                    .unwrap();
                let scope: BTreeSet<_> = scenario.subnets.keys().map(Principal::to_text).collect();
                if name == "untargeted-no-matches" {
                    assert!(scope.is_empty());
                } else {
                    let baselines = oracle["baselines"].as_object().unwrap();
                    assert_eq!(scope, baselines.keys().cloned().collect());
                }
                for (id, view) in &scenario.subnets {
                    let subnet = id.to_text();
                    assert_eq!(
                        set(&view.baseline.members),
                        expected_ids(&oracle["baselines"][&subnet]),
                        "{name}"
                    );
                    for (state, reference) in view.after_steps.iter().zip(steps) {
                        match state {
                            Some(state) => verify_state(state, &reference[&subnet]),
                            None => assert!(reference.is_null(), "{name} lost a valid step"),
                        }
                    }
                    assert_eq!(view.after_steps.len(), steps.len());
                }
                if name == "untargeted-no-matches" {
                    assert!(
                        matches!(&scenario.steps[0].outcome, StepOutcome::Applied { writes } if writes.is_empty())
                    );
                }
                if name == "invalid-140988" {
                    assert!(
                        scenario.steps[0]
                            .findings
                            .iter()
                            .any(|f| f.code == FindingCode::RemovalOutsideTarget)
                    );
                }
                if name == "separate-add-remove" {
                    assert!(scenario.completed);
                    assert!(
                        scenario
                            .steps
                            .iter()
                            .all(|step| matches!(step.outcome, StepOutcome::Applied { .. }))
                    );
                }
            }
            completed.insert(name);
        }

        let status = match row["lifecycle"].as_str().unwrap() {
            "indexed-executed" => 4,
            "indexed-rejected" => 2,
            "indexed-failed" => 5,
            "constructed-adopted" => 3,
            _ => 1,
        };
        assert!(
            live.report
                .manifest
                .proposals
                .iter()
                .all(|proposal| proposal.lifecycle_status == status)
        );
        if matches!(status, 2 | 4 | 5) {
            assert!(
                live.report
                    .scenarios
                    .iter()
                    .all(|scenario| !scenario.completed)
            );
        }
        let Some(token) = live.review_context else {
            continue;
        };
        if name == "nns-144954-recorded-open" {
            let policy: LiveResponse<PolicySnapshot> = call::<Result<_, String>>(
                &pic,
                reviewer,
                controller,
                "membership_target_topology",
                encode_args((token, Some(143_190u64))).unwrap(),
            )
            .unwrap();
            assert_eq!(policy.usage.calls, 2);
            let policy = policy.outcome.unwrap();
            assert_eq!(policy.motion.unwrap().id, 143190);
            assert_eq!(policy.nns_mutation_version, Some(66013));
        }
        if matches!(
            name,
            "nns-144954-open-then-executed" | "nns-144954-final-governance-failure"
        ) {
            call::<()>(
                &pic,
                fixture,
                controller,
                "trigger_review_fault",
                encode_args(()).unwrap(),
            );
            let final_reply: LiveResponse<Vec<ProposalEvidence>> = call::<Result<_, String>>(
                &pic,
                reviewer,
                controller,
                "finalize_membership_review",
                encode_one(token).unwrap(),
            )
            .unwrap();
            if name.ends_with("executed") {
                assert!(matches!(
                    final_reply.outcome,
                    Err(LiveError::ProposalChanged { id: 144954, .. })
                ));
            } else {
                assert!(matches!(final_reply.outcome, Err(LiveError::Source { .. })));
            }
        }
        if matches!(
            name,
            "three-added-chunked-location" | "three-added-corrupt-chunk"
        ) {
            let args = encode_args((
                pinned,
                DetailKeys::DataCenters(vec!["fixture-0".into(), "uncaptured".into()]),
            ))
            .unwrap();
            let detail: LiveResponse<DetailRecords> = call::<Result<_, String>>(
                &pic,
                reviewer,
                controller,
                "membership_detail_page",
                args,
            )
            .unwrap();
            let DetailRecords::DataCenters(records) = detail.outcome.unwrap() else {
                panic!()
            };
            assert!(
                matches!(&records[1], Record::Unavailable { reason, .. } if reason.contains("uncaptured Registry key"))
            );
            if name.ends_with("corrupt-chunk") {
                assert!(
                    matches!(&records[0], Record::Unavailable { reason, .. } if reason.contains("SHA-256") || reason.contains("hash"))
                );
                assert!(detail.usage.calls <= 6);
            } else {
                assert!(
                    matches!(&records[0], Record::Present { stamp, .. } if stamp.mutation_version == 99 && !stamp.chunk_observations.is_empty())
                );
                assert_eq!(detail.usage.calls - 2, 3);
            }
        }
    }
    assert_eq!(
        completed.len(),
        expected["cases"].as_object().unwrap().len()
    );
    let recorded = "nns-144954-recorded-open";
    call::<()>(
        &pic,
        fixture,
        controller,
        "load_review_case",
        encode_one(recorded).unwrap(),
    );
    let baseline = expected["cases"][recorded]["baselines"]
        .as_object()
        .unwrap();
    let (subnet_id, node_ids) = baseline.iter().next().unwrap();
    let subnet = Principal::from_text(subnet_id).unwrap();
    let read = |id, caller| {
        call::<Result<LiveResponse<LiveSubnetSnapshot>, String>>(
            &pic,
            reviewer,
            caller,
            "subnet_snapshot_on_demand",
            encode_one(id).unwrap(),
        )
    };
    let response = read(subnet, Principal::anonymous()).unwrap();
    assert_eq!(response.registry_version, Some(66013));
    assert_eq!(response.receipts.len(), response.usage.calls as usize);
    assert!(response.receipts.iter().all(|row| row.source == fixture
        && matches!(
            row.method.as_str(),
            "get_latest_version" | "get_value" | "get_chunk"
        )));
    assert_eq!(response.receipts[0].method, "get_latest_version");
    assert_eq!(
        response
            .receipts
            .iter()
            .filter(|row| row.item.starts_with("subnet_record_"))
            .count(),
        1
    );
    let records: BTreeSet<_> = response
        .receipts
        .iter()
        .map(|row| (&row.method, &row.item))
        .collect();
    assert_eq!(records.len(), response.receipts.len());
    let snapshot = response.outcome.unwrap();
    assert_eq!(snapshot.subnet, subnet);
    assert_eq!(
        set(&snapshot.membership.value().unwrap().members),
        expected_ids(node_ids)
    );
    assert_eq!(
        set(&snapshot.nodes.keys().copied().collect::<Vec<_>>()),
        expected_ids(node_ids)
    );
    let center = snapshot.data_centers["sh1"].value().unwrap();
    assert!(center.registered_region.contains("Stockholm") && center.coordinates.is_some());
    let nonexistent = Principal::from_slice(&[25, 2]);
    let missing = read(nonexistent, Principal::anonymous()).unwrap();
    assert_eq!(missing.usage.calls, 2);
    assert!(matches!(missing.outcome, Err(LiveError::InvalidEvidence(
        ReviewError::UnavailableRecord(nexus_review_engine::RegistryKey::Subnet(id))
    )) if id == nonexistent));
    assert!(read(Principal::anonymous(), Principal::anonymous()).is_err());
    assert_eq!(checkpoint("collection_status"), collector);
    assert_eq!(checkpoint("registry_status"), registry);
}
