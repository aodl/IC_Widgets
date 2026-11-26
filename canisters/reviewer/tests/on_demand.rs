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
fn public_sessions_are_isolated_and_share_a_finite_work_budget() {
    use nexus_review_engine::ProposalEvidence;
    use nexus_reviewer::{DetailKeys, DetailRecords};

    assert!(enabled());
    let pic = PocketIcBuilder::new()
        .with_nns_subnet()
        .with_application_subnet()
        .build();
    let controller = id(90, 1);
    let a = id(90, 2);
    let b = id(90, 3);
    let anonymous = Principal::anonymous();
    let topology = pic.topology();
    let fixture =
        pic.create_canister_on_subnet(Some(controller), None, topology.get_nns().unwrap());
    let reviewer =
        pic.create_canister_on_subnet(Some(controller), None, topology.get_app_subnets()[0]);
    pic.install_canister(
        fixture,
        wasm("target/wasm32-unknown-unknown/release/nexus_source_fixture.wasm"),
        encode_args(()).unwrap(),
        Some(controller),
    );
    call::<()>(
        &pic,
        fixture,
        controller,
        "load_voting_reference",
        encode_args(()).unwrap(),
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
    let checkpoint = |method| {
        pic.update_call(reviewer, controller, method, encode_args(()).unwrap())
            .unwrap()
    };
    let registry = checkpoint("registry_status");
    let collector = checkpoint("collection_status");
    assert!(matches!(
        call::<Result<nexus_reviewer::CollectionStatus, String>>(
            &pic,
            reviewer,
            a,
            "collection_status",
            encode_args(()).unwrap()
        ),
        Err(reason) if reason.contains("controller required")
    ));
    let begin = |caller| {
        call::<Reply>(
            &pic,
            reviewer,
            caller,
            "begin_membership_review",
            encode_one([144_954u64]).unwrap(),
        )
    };
    let finish = |caller, token: [u8; 32]| {
        call::<Result<LiveResponse<Vec<ProposalEvidence>>, String>>(
            &pic,
            reviewer,
            caller,
            "finalize_membership_review",
            encode_one(token).unwrap(),
        )
    };
    let context = |caller| {
        begin(caller)
            .unwrap()
            .outcome
            .unwrap()
            .review_context
            .unwrap()
    };
    assert!(begin(anonymous).is_err());
    let a0 = context(a);
    let b0 = context(b);
    assert_ne!(a0, b0);
    assert!(finish(a, b0).is_err());
    assert!(finish(b, a0).is_err());
    assert!(finish(anonymous, a0).is_err());
    let a1 = context(a);
    assert_ne!(a0, a1);
    assert!(finish(a, a0).is_err());
    for (caller, token) in [(a, a1), (b, b0)] {
        assert_eq!(
            finish(caller, token).unwrap().outcome.unwrap()[0].id,
            144_954
        );
    }
    for index in 4..34 {
        context(id(90, index));
    }
    assert!(
        begin(id(90, 34))
            .err()
            .unwrap()
            .contains("session limit is full")
    );
    assert!(finish(b, b0).unwrap().outcome.is_ok());
    pic.advance_time(Duration::from_secs(30 * 60));
    assert!(finish(b, b0).is_err());
    assert!(finish(a, a1).is_err());
    context(id(90, 34));
    pic.advance_time(Duration::from_secs(768 * 30));
    assert!(
        review(&pic, reviewer, anonymous, &[144_954])
            .outcome
            .is_ok()
    );

    let page = |caller, count| {
        call::<Result<LiveResponse<DetailRecords>, String>>(
            &pic,
            reviewer,
            caller,
            "membership_detail_page",
            encode_args((
                66_013u64,
                DetailKeys::DataCenters(
                    (0..count).map(|index| format!("budget-{index}")).collect(),
                ),
            ))
            .unwrap(),
        )
    };
    let mut charged = 0;
    loop {
        let row = page(id(91, charged), 24).unwrap();
        if matches!(row.outcome, Err(LiveError::PublicBudget)) {
            charged += row.usage.calls as u16;
            break;
        }
        assert!(row.outcome.is_ok());
        assert_eq!(row.usage.calls, 24);
        charged += 24;
        assert!(charged <= 768);
    }
    assert!((752..=768).contains(&charged));
    let mut exhausted = false;
    for index in 0..96 {
        if let Err(reason) = page(id(92, index), 8) {
            assert!(reason.contains("public request budget"));
            exhausted = true;
            break;
        }
    }
    assert!(exhausted);
    pic.advance_time(Duration::from_secs(30));
    let refill = page(a, 1).unwrap();
    assert_eq!(refill.usage.calls, 1);
    assert!(refill.outcome.is_ok());
    assert_eq!(checkpoint("registry_status"), registry);
    assert_eq!(checkpoint("collection_status"), collector);
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
    use nexus_review_engine::Record;
    use nexus_reviewer::{DetailKeys, DetailRecords};

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

    let detail = pic
        .submit_call(
            reviewer,
            controller,
            "membership_detail_page",
            encode_args((
                5u64,
                DetailKeys::DataCenters(vec!["delayed-missing".into()]),
            ))
            .unwrap(),
        )
        .unwrap();
    for _ in 0..3 {
        pic.tick();
    }
    assert!(pic.ingress_status(detail.clone()).is_none());
    let raw = pic.await_call(detail).unwrap();
    let reply = decode_one::<Result<LiveResponse<DetailRecords>, String>>(&raw)
        .unwrap()
        .unwrap();
    assert_eq!(reply.registry_version, Some(5));
    assert_eq!(reply.usage.calls, 1);
    let DetailRecords::DataCenters(rows) = reply.outcome.unwrap() else {
        panic!()
    };
    assert!(matches!(
        rows[0],
        Record::Missing | Record::Unavailable { .. }
    ));
}

#[test]
#[ignore = "run through scripts/test-m0.sh to build Wasms and start PocketIC"]
fn voting_detail_replays_the_66013_registry() {
    use std::collections::BTreeMap;

    use nexus_review_engine::{ANALYSIS_VERSION, Dimension, Group, Record};
    use nexus_reviewer::{
        DetailComparisonInput, DetailKeys, DetailRecords, LiveMembershipComparison, PolicySnapshot,
    };

    assert!(enabled());
    let pic = PocketIcBuilder::new()
        .with_nns_subnet()
        .with_application_subnet()
        .build();
    let controller = id(90, 1);
    let fixture =
        pic.create_canister_on_subnet(Some(controller), None, pic.topology().get_nns().unwrap());
    let reviewer =
        pic.create_canister_on_subnet(Some(controller), None, pic.topology().get_app_subnets()[0]);
    pic.install_canister(
        fixture,
        wasm("target/wasm32-unknown-unknown/release/nexus_source_fixture.wasm"),
        encode_args(()).unwrap(),
        Some(controller),
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
    call::<()>(
        &pic,
        fixture,
        controller,
        "load_voting_reference",
        encode_args(()).unwrap(),
    );
    let response = call::<Result<LiveResponse<LiveReview>, String>>(
        &pic,
        reviewer,
        controller,
        "begin_membership_review",
        encode_one(vec![144_954u64]).unwrap(),
    )
    .unwrap();
    assert_eq!(response.registry_version, Some(66_013));
    assert_eq!(response.usage.calls, 9);
    let preview = response.outcome.unwrap();
    let token = preview.review_context.unwrap();
    assert_eq!(
        (preview.listed_subnets, preview.total_listed_subnets),
        (1, Some(96))
    );
    assert!(preview.report.scenarios[0].completed);
    let (&subnet, states) = preview.report.scenarios[0]
        .subnets
        .first_key_value()
        .unwrap();
    let before = &states.baseline;
    let after = states.after_steps[0].as_ref().unwrap();
    assert_eq!(
        (
            before.member_count,
            after.member_count,
            after.retained.len()
        ),
        (40, 40, 39)
    );
    assert_eq!(
        after.added[0].to_text(),
        "kaoz3-4okcl-24amq-v5y4k-vim56-4njvo-fwvyk-v4grq-kuqum-7zm3p-4qe"
    );
    assert_eq!(
        after.removed[0].to_text(),
        "tg4ec-b2g4p-h42kd-k7zvb-6rls2-i2q7l-gtr4h-ymr6v-rrez4-w6fao-oqe"
    );
    assert!(preview.assignments.contains(&(
        after.added[0],
        CandidateAssignment::UnknownOutsideListedSubnets
    )));
    assert!(
        preview.proposal_text.unwrap()[0]
            .summary
            .contains("Decommissioning of DC zh2")
    );
    let subnet_rules = preview
        .subnet_rules
        .unwrap()
        .into_iter()
        .find(|row| row.subnet == subnet)
        .unwrap();
    let read = |keys, label| {
        let wall = Instant::now();
        let balance = pic.cycle_balance(reviewer);
        let raw = pic
            .update_call(
                reviewer,
                controller,
                "membership_context_detail_page",
                encode_args((token, keys)).unwrap(),
            )
            .unwrap();
        let response = decode_one::<Result<LiveResponse<DetailRecords>, String>>(&raw)
            .unwrap()
            .unwrap();
        println!(
            "detail {label}: {} calls, {} source bytes, {} Candid bytes, {} ms wall, {} instructions, {} settled cycles, {} peak batch reservation",
            response.usage.calls,
            response.usage.source_bytes,
            raw.len(),
            wall.elapsed().as_millis(),
            response.usage.instructions,
            balance - pic.cycle_balance(reviewer),
            response.usage.peak_batch_reservation,
        );
        assert_eq!(response.registry_version, Some(66_013));
        assert_eq!(response.usage.calls as usize, response.receipts.len());
        assert!(response.receipts.iter().all(|r| r.method == "get_value"));
        response.outcome.unwrap()
    };
    let node_ids: Vec<_> = before
        .members
        .iter()
        .chain(&after.members)
        .copied()
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();
    let mut nodes = BTreeMap::new();
    for batch in node_ids.chunks(24) {
        let DetailRecords::Nodes(records) = read(DetailKeys::Nodes(batch.to_vec()), "nodes") else {
            panic!()
        };
        nodes.extend(batch.iter().copied().zip(records));
    }
    let operator_ids: Vec<_> = nodes
        .values()
        .filter_map(|row| row.value()?.operator)
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();
    let mut operators = BTreeMap::new();
    for batch in operator_ids.chunks(24) {
        let DetailRecords::Operators(records) =
            read(DetailKeys::Operators(batch.to_vec()), "operators")
        else {
            panic!()
        };
        operators.extend(batch.iter().copied().zip(records));
    }
    let dc_ids: Vec<_> = operators
        .values()
        .filter_map(|row| nexus_review_engine::data_center_key(&row.value()?.data_center))
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();
    let mut data_centers = BTreeMap::new();
    for batch in dc_ids.chunks(24) {
        let DetailRecords::DataCenters(records) =
            read(DetailKeys::DataCenters(batch.to_vec()), "data centers")
        else {
            panic!()
        };
        data_centers.extend(batch.iter().cloned().zip(records));
    }
    assert!(matches!(nodes[&after.removed[0]], Record::Present { .. }));
    let args_for = |registry_version, data_centers| {
        encode_one(DetailComparisonInput {
            registry_version,
            subnet,
            preview_revision: preview.report.revision,
            before: before.members.clone(),
            after: after.members.clone(),
            kind: subnet_rules.kind,
            nodes: nodes.clone(),
            operators: operators.clone(),
            data_centers,
        })
        .unwrap()
    };
    let caller = id(90, 2);
    let full_args = args_for(66_013, data_centers);
    assert!(
        pic.query_call(
            reviewer,
            controller,
            "compare_membership_details",
            full_args.clone()
        )
        .is_err()
    );
    let mut too_large = full_args.clone();
    too_large.resize(256 * 1024 + 1, 0);
    let rejected = pic
        .update_call(reviewer, caller, "compare_membership_details", too_large)
        .unwrap_err();
    assert!(format!("{rejected:?}").contains("exceeds 256 KiB"));
    let wrong_version: Result<LiveMembershipComparison, String> = call(
        &pic,
        reviewer,
        caller,
        "compare_membership_details",
        args_for(1, BTreeMap::new()),
    );
    assert!(
        wrong_version
            .err()
            .unwrap()
            .contains("pinned Registry version")
    );

    let policy = call::<Result<LiveResponse<PolicySnapshot>, String>>(
        &pic,
        reviewer,
        controller,
        "membership_target_topology",
        encode_args((token, None::<u64>)).unwrap(),
    )
    .unwrap()
    .outcome
    .unwrap();
    assert_eq!(policy.motion.as_ref().unwrap().id, 143_190);
    let digest = policy.digest;
    let compare_context = |input, digest| {
        let args = encode_args((input, token, digest)).unwrap();
        let expected = sha256(&args);
        let comparison = call::<Result<LiveMembershipComparison, String>>(
            &pic,
            reviewer,
            controller,
            "compare_membership_with_policy",
            args,
        );
        if let Ok(result) = &comparison {
            assert_eq!(result.input_hash, expected);
        }
        comparison
    };
    let original = || decode_one::<DetailComparisonInput>(&full_args).unwrap();
    assert!(
        compare_context(original(), digest)
            .unwrap()
            .target_rows
            .is_some()
    );
    for alter in [
        |input: &mut DetailComparisonInput| input.kind += 1,
        |input: &mut DetailComparisonInput| input.after.reverse(),
        |input: &mut DetailComparisonInput| input.registry_version -= 1,
        |input: &mut DetailComparisonInput| {
            input.nodes.pop_last();
        },
        |input: &mut DetailComparisonInput| {
            let Record::Present { value, .. } = input.data_centers.get_mut("sh1").unwrap() else {
                panic!()
            };
            value.registered_owner.push_str(" forged");
        },
        |input: &mut DetailComparisonInput| {
            let Record::Present { stamp, .. } = input.data_centers.get_mut("sh1").unwrap() else {
                panic!()
            };
            stamp.mutation_version = 1;
        },
    ] {
        let mut modified = original();
        alter(&mut modified);
        assert!(compare_context(modified, digest).is_err());
    }
    assert!(compare_context(original(), [7; 32]).is_err());

    let compare = |args: Vec<u8>| {
        let wall = Instant::now();
        let balance = pic.cycle_balance(reviewer);
        let expected = sha256(&args);
        let raw = pic
            .update_call(reviewer, caller, "compare_membership_details", args)
            .unwrap();
        let summary = decode_one::<Result<LiveMembershipComparison, String>>(&raw)
            .unwrap()
            .unwrap();
        assert_eq!(summary.input_hash, expected);
        assert_eq!(summary.analysis_version, ANALYSIS_VERSION);
        println!(
            "comparison: 0 source calls, 0 source bytes, {} Candid bytes, {} ms wall, {} instructions, {} settled cycles",
            raw.len(),
            wall.elapsed().as_millis(),
            summary.instructions,
            balance - pic.cycle_balance(reviewer)
        );
        summary
    };
    let full = compare(full_args);
    let full_hash = full.input_hash;
    let full = full.comparison;
    for (dimension, counts, largest, coefficients) in [
        (Dimension::RegisteredContinent, [6, 6], [17, 17], [1, 1]),
        (Dimension::RegisteredCountry, [24, 24], [3, 3], [5, 5]),
        (Dimension::DataCenter, [39, 38], [2, 3], [13, 12]),
        (Dimension::RegisteredOwner, [39, 38], [2, 3], [13, 12]),
        (Dimension::Provider, [38, 38], [3, 3], [12, 12]),
        (Dimension::Operator, [39, 38], [2, 3], [13, 12]),
    ] {
        for (index, state) in [&full.baseline, &full.selected].into_iter().enumerate() {
            let row = &state.distributions[&dimension];
            assert_eq!(row.groups.len(), counts[index]);
            assert_eq!(row.largest, Some(largest[index]));
            assert_eq!(row.unknown, 0);
            let threshold = row.greater_than_one_third.as_ref().unwrap();
            assert_eq!(threshold.nodes_required, 14);
            assert_eq!(threshold.groups_to_reach, Some(coefficients[index]));
        }
    }
    for area in [&full.registered_area_before, &full.registered_area_after] {
        assert_eq!(area.groups.len(), 31);
        assert_eq!(
            area.greater_than_one_third
                .as_ref()
                .unwrap()
                .groups_to_reach,
            Some(6)
        );
    }
    let group = |dimension, label: &str| {
        let key = Group::RegisteredLabel(label.into());
        (
            full.baseline.distributions[&dimension]
                .groups
                .get(&key)
                .copied()
                .unwrap_or(0),
            full.selected.distributions[&dimension]
                .groups
                .get(&key)
                .copied()
                .unwrap_or(0),
        )
    };
    assert_eq!(group(Dimension::DataCenter, "zh2"), (1, 0));
    assert_eq!(group(Dimension::DataCenter, "sh1"), (2, 3));
    assert_eq!(group(Dimension::RegisteredOwner, "Everyware"), (1, 0));
    assert_eq!(group(Dimension::RegisteredOwner, "Digital Realty"), (2, 3));
    for dimension in [Dimension::DataCenter, Dimension::RegisteredOwner] {
        let scores = [&full.baseline, &full.selected].map(|state| {
            state.distributions[&dimension]
                .greater_than_one_third
                .as_ref()
                .unwrap()
                .groups_to_reach
        });
        assert_eq!(scores, [Some(13), Some(12)]);
    }
    for (dimension, after) in &full.selected.distributions {
        let before = &full.baseline.distributions[dimension];
        println!(
            "{dimension:?}: groups {} -> {}, largest {:?} -> {:?}, >1/3 {:?} -> {:?}, unknown {} -> {}",
            before.groups.len(),
            after.groups.len(),
            before.largest,
            after.largest,
            before.greater_than_one_third,
            after.greater_than_one_third,
            before.unknown,
            after.unknown
        );
    }
    println!(
        "distance: {:?} -> {:?}",
        full.baseline.distances, full.selected.distances
    );
    assert_eq!(full.baseline.distances.total_pairs, 780);
    assert_eq!(full.selected.distances.total_pairs, 780);
    for (row, mean) in [
        (&full.baseline.distances, 7_367_029),
        (&full.selected.distances, 7_361_847),
    ] {
        assert_eq!((row.valid_pairs, row.known_nodes), (780, 40));
        assert_eq!(row.minimum_metres, Some(0));
        assert_eq!(row.mean_metres, Some(mean));
        assert_eq!(row.maximum_metres, Some(19_461_421));
    }
    let partial = compare(args_for(66_013, BTreeMap::new()));
    assert_ne!(full_hash, partial.input_hash);
    let partial = partial.comparison;
    assert_eq!(partial.selected.distances.valid_pairs, 0);
    assert_eq!(
        partial.selected.distributions[&Dimension::RegisteredCountry].unknown,
        40
    );
    assert!(
        partial.selected.distributions[&Dimension::RegisteredOwner]
            .greater_than_one_third
            .as_ref()
            .unwrap()
            .groups_to_reach
            .is_none()
    );
    assert_eq!(
        partial.selected.distributions[&Dimension::DataCenter],
        full.selected.distributions[&Dimension::DataCenter]
    );
    assert_eq!(
        partial.selected.distributions[&Dimension::Provider],
        full.selected.distributions[&Dimension::Provider]
    );

    let malformed: Result<LiveResponse<DetailRecords>, String> = call(
        &pic,
        reviewer,
        controller,
        "membership_detail_page",
        encode_args((66_013u64, DetailKeys::Nodes(vec![after.added[0]; 25]))).unwrap(),
    );
    assert!(malformed.is_err());
    let public_page: Result<LiveResponse<DetailRecords>, String> = call(
        &pic,
        reviewer,
        Principal::anonymous(),
        "membership_detail_page",
        encode_args((66_013u64, DetailKeys::Nodes(after.added.clone()))).unwrap(),
    );
    assert!(public_page.unwrap().outcome.is_ok());
}
