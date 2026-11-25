mod support;

use std::{
    collections::BTreeSet,
    time::{Duration, Instant},
};

use candid::{CandidType, Principal, decode_one, encode_args, encode_one};
use nexus_domain::{MembershipAction, sha256};
use nexus_ic_sources::{
    decode_candid,
    governance::{self, ProposalInfo},
    registry::{
        value_request_for_name,
        wire::registry::{
            api_boundary_node::v1::ApiBoundaryNodeRecord,
            node::v1::NodeRecord,
            subnet::v1::{SubnetListRecord, SubnetRecord},
        },
    },
};
use nexus_review_engine::{FindingCode, RegistryKey, ReviewError, ScenarioId, StepOutcome};
use nexus_reviewer::{CandidateAssignment, LiveError, LiveResponse, LiveReview, Sources};
use pocket_ic::{PocketIc, PocketIcBuilder};
use prost::Message;
use serde::de::DeserializeOwned;

use support::{advance, enabled, wasm};

type Reply = Result<LiveResponse<LiveReview>, String>;

fn id(kind: u8, index: u16) -> Principal {
    let mut bytes = [kind; 29];
    bytes[..2].copy_from_slice(&index.to_be_bytes());
    bytes[28] = 2;
    Principal::from_slice(&bytes)
}

fn call<T: CandidType + DeserializeOwned>(
    pic: &PocketIc,
    canister: Principal,
    caller: Principal,
    method: &str,
    args: Vec<u8>,
) -> T {
    decode_one(&pic.update_call(canister, caller, method, args).unwrap()).unwrap()
}

fn review(
    pic: &PocketIc,
    canister: Principal,
    caller: Principal,
    ids: &[u64],
) -> LiveResponse<LiveReview> {
    let wall = Instant::now();
    let balance = pic.cycle_balance(canister);
    let raw = pic
        .update_call(
            canister,
            caller,
            "review_on_demand",
            encode_one(ids).unwrap(),
        )
        .unwrap();
    let response = decode_one::<Reply>(&raw).unwrap().unwrap();
    let usage = &response.usage;
    println!(
        "on-demand {ids:?}: {} calls, {} source bytes, {} Candid bytes, {} ms wall, {} instructions, {} settled cycles, {} peak batch reservation",
        usage.calls,
        usage.source_bytes,
        raw.len(),
        wall.elapsed().as_millis(),
        usage.instructions,
        balance - pic.cycle_balance(canister),
        usage.peak_batch_reservation,
    );
    assert_eq!(
        usize::try_from(usage.calls).unwrap(),
        response.receipts.len()
    );
    assert_eq!(
        usage.source_bytes,
        response
            .receipts
            .iter()
            .map(|row| row.reply_bytes)
            .sum::<u64>()
    );
    assert!(usage.finished_at >= usage.started_at);
    if usage.calls > 0 {
        assert!(usage.instructions > 0);
    }
    response
}

#[test]
#[ignore = "run through scripts/test-m0.sh to build Wasms and start PocketIC"]
fn on_demand_previews_resolve_pinned_membership_and_bound_evidence() {
    assert!(enabled());
    let pic = PocketIcBuilder::new()
        .with_nns_subnet()
        .with_application_subnet()
        .build();
    let topology = pic.topology();
    let controller = id(90, 1);
    let browser = id(90, 2);
    let fixture = pic.create_canister_on_subnet(None, None, topology.get_nns().unwrap());
    let reviewer =
        pic.create_canister_on_subnet(Some(controller), None, topology.get_app_subnets()[0]);
    pic.install_canister(
        fixture,
        wasm("target/wasm32-unknown-unknown/release/nexus_source_fixture.wasm"),
        encode_args(()).unwrap(),
        None,
    );
    pic.install_canister(
        reviewer,
        wasm(".local/reviewer-fixture.wasm"),
        encode_one(Some(Sources {
            registry: fixture,
            governance: fixture,
        }))
        .unwrap(),
        Some(controller),
    );
    let fixture_call = |method, args| support::call::<()>(&pic, fixture, method, args);
    fixture_call("set_registry_mode", encode_one(1u8).unwrap());
    fixture_call("prepare_direct_registry", encode_args(()).unwrap());
    fixture_call("enable_proposal_fixture", encode_args(()).unwrap());
    let set = |key: String, value: Option<Vec<u8>>| {
        fixture_call(
            "set_direct_registry_record",
            encode_args((key, value)).unwrap(),
        )
    };

    let try_review = |caller, ids: Vec<u64>| {
        call::<Reply>(
            &pic,
            reviewer,
            caller,
            "review_on_demand",
            encode_one(ids).unwrap(),
        )
    };
    assert!(try_review(Principal::anonymous(), vec![93]).is_err());
    assert!(try_review(browser, vec![93]).is_err());
    call::<Result<(), String>>(
        &pic,
        reviewer,
        controller,
        "set_on_demand_caller",
        encode_one(Some(browser)).unwrap(),
    )
    .unwrap();
    assert!(try_review(browser, vec![93, 93]).is_err());
    let storage = || {
        pic.canister_status(reviewer, Some(controller))
            .unwrap()
            .memory_metrics
            .stable_memory_size
    };
    let before = storage();

    let single = review(&pic, reviewer, browser, &[93]);
    assert_eq!(single.registry_version, Some(5));
    assert_eq!(single.usage.calls, 7);
    let row = single.outcome.unwrap();
    assert_eq!(row.listed_subnets, 1);
    assert_eq!(row.total_listed_subnets, Some(24));
    assert_eq!(
        row.assignments,
        vec![(
            id(21, 1201),
            CandidateAssignment::UnknownOutsideListedSubnets
        )]
    );
    assert_eq!(row.scopes[0].nodes.len(), 51);
    assert!(row.report.scenarios[0].completed);
    assert!(
        !row.report.scenarios[0].steps[0]
            .findings
            .iter()
            .any(|row| row.code == FindingCode::PreviouslyUnassigned)
    );
    assert!(
        row.report.scenarios[0].subnets[&id(22, 0)]
            .baseline
            .distributions
            .is_empty()
    );
    assert!(
        !row.report
            .manifest
            .registry
            .keys()
            .any(|key| matches!(key, RegistryKey::Operator(_) | RegistryKey::DataCenter(_)))
    );
    assert!(
        !row.report
            .manifest
            .registry
            .contains_key(&RegistryKey::Node(id(21, 2)))
    );

    let pair = review(&pic, reviewer, browser, &[93, 92]);
    assert_eq!(pair.registry_version, Some(5));
    for method in ["get_value", "get_chunk"] {
        let keys: Vec<_> = pair
            .receipts
            .iter()
            .filter(|row| row.method == method)
            .map(|row| &row.item)
            .collect();
        assert_eq!(keys.len(), keys.iter().collect::<BTreeSet<_>>().len());
    }
    assert_eq!(
        pair.receipts
            .iter()
            .filter(|row| row.method == "get_latest_version")
            .count(),
        1
    );
    assert_eq!(
        pair.receipts
            .iter()
            .filter(|row| row.method == "get_proposal_info")
            .count(),
        4
    );
    assert_eq!(pair.usage.calls, 34);
    let pair = pair.outcome.unwrap();
    assert_eq!(
        (pair.listed_subnets, pair.total_listed_subnets),
        (24, Some(24))
    );
    assert_eq!(pair.report.scenarios.len(), 4);
    let counts = |scenario| {
        let row = pair
            .report
            .scenarios
            .iter()
            .find(|row| row.id == scenario)
            .unwrap();
        assert!(row.completed);
        row.subnets[&id(22, 0)]
            .after_steps
            .iter()
            .map(|state| state.as_ref().unwrap().member_count)
            .collect::<Vec<_>>()
    };
    assert_eq!(counts(ScenarioId::AThenB), vec![51, 50]);
    assert_eq!(counts(ScenarioId::BThenA), vec![49, 50]);

    let removal = review(&pic, reviewer, browser, &[91]).outcome.unwrap();
    let scenario = &removal.report.scenarios[0];
    assert_eq!(scenario.subnets.len(), 2);
    let StepOutcome::Applied { writes } = &scenario.steps[0].outcome else {
        panic!("expected changes to both affected subnets");
    };
    assert!(writes.values().all(|members| members.len() == 49));

    set(
        format!("subnet_record_{}", id(22, 2)),
        Some(
            SubnetRecord {
                membership: vec![id(21, 1201).as_slice().to_vec()],
                subnet_type: 1,
                ..Default::default()
            }
            .encode_to_vec(),
        ),
    );
    let scoped = review(&pic, reviewer, browser, &[93]).outcome.unwrap();
    assert!(scoped.report.scenarios[0].completed);
    assert_eq!(
        scoped.assignments[0].1,
        CandidateAssignment::UnknownOutsideListedSubnets
    );
    let broad = review(&pic, reviewer, browser, &[93, 92]).outcome.unwrap();
    assert!(
        broad
            .assignments
            .contains(&(id(21, 1201), CandidateAssignment::ListedSubnet(id(22, 2))))
    );
    assert!(!broad.report.scenarios[0].completed);
    assert!(
        broad.report.scenarios[0].steps[0]
            .findings
            .iter()
            .any(|finding| finding.code == FindingCode::AssignedElsewhere
                && finding.nodes == [id(21, 1201)])
    );

    assert!(matches!(
        review(&pic, reviewer, browser, &[999_999]).outcome,
        Err(LiveError::InvalidEvidence(ReviewError::MissingProposal(
            999_999
        )))
    ));
    set(format!("subnet_record_{}", id(22, 2)), None);
    assert!(
        review(&pic, reviewer, browser, &[93])
            .outcome
            .unwrap()
            .report
            .scenarios[0]
            .completed
    );
    assert!(matches!(review(&pic, reviewer, browser, &[91]).outcome,
        Err(LiveError::InvalidEvidence(ReviewError::UnavailableRecord(RegistryKey::Subnet(id)))) if id == self::id(22, 2)));
    set(format!("subnet_record_{}", id(22, 0)), None);
    assert!(matches!(review(&pic, reviewer, browser, &[93]).outcome,
        Err(LiveError::InvalidEvidence(ReviewError::UnavailableRecord(RegistryKey::Subnet(id)))) if id == self::id(22, 0)));
    fixture_call("prepare_direct_registry", encode_args(()).unwrap());
    set(
        format!("api_boundary_node_{}", id(21, 1)),
        Some(
            ApiBoundaryNodeRecord {
                version: "fixture".into(),
            }
            .encode_to_vec(),
        ),
    );
    assert!(matches!(
        review(&pic, reviewer, browser, &[92]).outcome,
        Err(LiveError::InvalidEvidence(ReviewError::InvalidTopology))
    ));
    fixture_call("prepare_direct_registry", encode_args(()).unwrap());
    set(format!("node_record_{}", id(21, 1201)), None);
    let absent = review(&pic, reviewer, browser, &[93]).outcome.unwrap();
    assert_eq!(
        absent.assignments,
        [(id(21, 1201), CandidateAssignment::NodeAbsent)]
    );
    assert_eq!(
        absent.report.scenarios[0].steps[0].outcome,
        StepOutcome::Rejected
    );
    assert!(
        absent.report.scenarios[0].steps[0]
            .findings
            .iter()
            .any(|finding| finding.code == FindingCode::MissingNode)
    );
    set(format!("node_record_{}", id(21, 1201)), Some(vec![0xff]));
    assert!(matches!(review(&pic, reviewer, browser, &[93]).outcome,
        Err(LiveError::InvalidEvidence(ReviewError::UnavailableRecord(RegistryKey::Node(id)))) if id == self::id(21, 1201)));
    fixture_call("prepare_direct_registry", encode_args(()).unwrap());
    set(
        format!("node_operator_record_{}", id(23, 1)),
        Some(vec![0xff]),
    );
    set("data_center_record_example".into(), None);
    let missing_metadata = review(&pic, reviewer, browser, &[90]);
    assert_eq!(missing_metadata.usage.calls, 9);
    let preview = missing_metadata.outcome.unwrap();
    let replacement = &preview.report.scenarios[0];
    assert!(replacement.completed);
    let subnet = &replacement.subnets[&id(22, 0)];
    let after = subnet.after_steps[0].as_ref().unwrap();
    assert_eq!((subnet.baseline.member_count, after.member_count), (50, 50));
    assert_eq!(after.added, [id(21, 1201)]);
    assert_eq!(after.removed, [id(21, 1)]);
    fixture_call("prepare_direct_registry", encode_args(()).unwrap());

    let in_progress = pic
        .submit_call(
            reviewer,
            browser,
            "review_on_demand",
            encode_one(vec![101u64]).unwrap(),
        )
        .unwrap();
    for _ in 0..8 {
        pic.tick();
    }
    assert!(try_review(browser, vec![93]).is_err());
    fixture_call("set_proposal_executed", encode_one(true).unwrap());
    let changed = decode_one::<Reply>(&pic.await_call(in_progress).unwrap())
        .unwrap()
        .unwrap();
    assert!(matches!(
        changed.outcome,
        Err(LiveError::ProposalChanged {
            id: 101,
            status: 4,
            ..
        })
    ));
    let terminal = review(&pic, reviewer, browser, &[101]).outcome.unwrap();
    assert!(
        terminal.report.scenarios[0].steps[0]
            .findings
            .iter()
            .any(|finding| finding.code == FindingCode::HistoricalBaselineUnavailable)
    );

    let late = pic
        .submit_call(
            reviewer,
            browser,
            "review_on_demand",
            encode_one(vec![93u64]).unwrap(),
        )
        .unwrap();
    pic.tick();
    pic.advance_time(Duration::from_secs(121));
    let late = decode_one::<Reply>(&pic.await_call(late).unwrap())
        .unwrap()
        .unwrap();
    assert!(matches!(late.outcome, Err(LiveError::Deadline)));
    advance(&pic);
    assert_eq!(before, storage());

    if let Some(path) = std::env::var_os("NEXUS_REAL_PROPOSAL_REPLY") {
        let raw = std::fs::read(path).unwrap();
        let info = decode_candid::<Option<ProposalInfo>>(&raw)
            .unwrap()
            .unwrap();
        let proposal_id = info.id.unwrap().id;
        let action = governance::membership(info.executable().unwrap())
            .unwrap()
            .unwrap();
        let MembershipAction::Change {
            subnet,
            ref add,
            ref remove,
        } = action
        else {
            panic!("expected a real membership replacement");
        };
        assert_eq!((add.len(), remove.len()), (1, 1));
        fixture_call(
            "set_demo_proposal",
            encode_args((proposal_id, &raw)).unwrap(),
        );
        // Replay the exact Governance reply against an explicitly synthetic Registry.
        let retained = id(21, 99);
        set(
            "subnet_list".into(),
            Some(
                SubnetListRecord {
                    subnets: vec![subnet.as_slice().to_vec()],
                }
                .encode_to_vec(),
            ),
        );
        set(
            format!("subnet_record_{subnet}"),
            Some(
                SubnetRecord {
                    subnet_type: 1,
                    membership: vec![remove[0].as_slice().to_vec(), retained.as_slice().to_vec()],
                    ..Default::default()
                }
                .encode_to_vec(),
            ),
        );
        for node in add.iter().chain(remove) {
            set(
                format!("node_record_{node}"),
                Some(
                    NodeRecord {
                        node_operator_id: id(23, 1).as_slice().to_vec(),
                        ..Default::default()
                    }
                    .encode_to_vec(),
                ),
            );
        }
        let live = review(&pic, reviewer, browser, &[proposal_id])
            .outcome
            .unwrap();
        assert_eq!(live.report.manifest.proposals[0].raw_hash, sha256(&raw));
        let scenario = &live.report.scenarios[0];
        assert!(scenario.completed);
        let state = scenario.subnets[&subnet].after_steps[0].as_ref().unwrap();
        assert_eq!(state.added, *add);
        assert_eq!(state.removed, *remove);
    }
}

#[test]
#[ignore = "run through scripts/test-m0.sh to build Wasms and start PocketIC"]
fn membership_preview_finishes_while_data_center_metadata_is_delayed() {
    assert!(enabled());
    let pic = PocketIcBuilder::new()
        .with_nns_subnet()
        .with_application_subnet()
        .build();
    let topology = pic.topology();
    let controller = id(90, 1);
    let fixture = pic.create_canister_on_subnet(None, None, topology.get_nns().unwrap());
    let round_trip = pic.create_canister_on_subnet(None, None, topology.get_app_subnets()[0]);
    let reviewer =
        pic.create_canister_on_subnet(Some(controller), None, topology.get_app_subnets()[0]);
    let slow_fixture = wasm(".local/slow-source-fixture.wasm");
    pic.install_canister(
        fixture,
        slow_fixture.clone(),
        encode_args(()).unwrap(),
        None,
    );
    pic.install_canister(round_trip, slow_fixture, encode_args(()).unwrap(), None);
    pic.install_canister(
        reviewer,
        wasm(".local/reviewer-fixture.wasm"),
        encode_one(Some(Sources {
            registry: fixture,
            governance: fixture,
        }))
        .unwrap(),
        Some(controller),
    );
    for (method, args) in [
        ("set_delay_target", encode_one(round_trip).unwrap()),
        ("set_registry_mode", encode_one(1u8).unwrap()),
        ("prepare_direct_registry", encode_args(()).unwrap()),
        ("enable_proposal_fixture", encode_args(()).unwrap()),
    ] {
        support::call::<()>(&pic, fixture, method, args);
    }
    let delayed = pic
        .submit_call(
            fixture,
            Principal::anonymous(),
            "get_value",
            value_request_for_name("data_center_record_example", 5),
        )
        .unwrap();
    pic.tick();
    let response = review(&pic, reviewer, controller, &[90]);
    assert_eq!(response.usage.calls, 9);
    assert!(response.outcome.unwrap().report.scenarios[0].completed);
    let metadata_status = pic.ingress_status(delayed.clone());
    assert!(
        metadata_status.is_none(),
        "metadata request finished early: {metadata_status:?}"
    );
    assert!(!pic.await_call(delayed).unwrap().is_empty());
}
