use std::{
    fs,
    path::{Path, PathBuf},
    time::Duration,
};

use candid::{CandidType, Principal, decode_one, encode_args, encode_one};
use nexus_domain::sha256;
use nexus_ic_sources::registry::{Key, RecordSummary};
use nexus_reviewer::{
    Limits, Observation, ProbeBudget, ProbeRequest, Receipt, ReplyPage, Sources, Status, Stop,
};
use pocket_ic::{CreateCanisterParams, CreateCanisterPlacement, PocketIc, PocketIcBuilder};
use serde::de::DeserializeOwned;

const FUNDING: u128 = 10_000_000_000_000;

fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn enabled() -> bool {
    std::env::var_os("NEXUS_M0_TEST").is_some()
}

fn wasm(path: &str) -> Vec<u8> {
    fs::read(root().join(path)).unwrap_or_else(|err| panic!("{path}: {err}"))
}

fn call<T: CandidType + DeserializeOwned>(
    pic: &PocketIc,
    canister: Principal,
    method: &str,
    args: Vec<u8>,
) -> T {
    let reply = pic
        .update_call(canister, Principal::anonymous(), method, args)
        .unwrap_or_else(|err| panic!("{method}: {err:?}"));
    decode_one(&reply).unwrap()
}

fn status(pic: &PocketIc, canister: Principal, id: u64) -> Status {
    call::<Result<Status, String>>(pic, canister, "probe_status", encode_one(id).unwrap()).unwrap()
}

fn start(pic: &PocketIc, canister: Principal, request: &ProbeRequest) -> u64 {
    call::<Result<u64, String>>(pic, canister, "start_probe", encode_one(request).unwrap()).unwrap()
}

fn advance(pic: &PocketIc) {
    pic.advance_time(Duration::from_secs(2));
    for _ in 0..4 {
        pic.tick();
    }
}

fn run_to_completion(pic: &PocketIc, canister: Principal, id: u64) -> Status {
    for i in 0..120 {
        advance(pic);
        if i % 4 == 0 {
            let current = status(pic, canister, id);
            if current.completed_at_nanos.is_some() {
                let budget = call::<Result<ProbeBudget, String>>(
                    pic,
                    canister,
                    "probe_budget",
                    encode_one(id).unwrap(),
                )
                .unwrap();
                assert_eq!(current.stop_reason, None, "{:?}", budget.usage);
                return current;
            }
        }
    }
    panic!("probe did not complete");
}

fn receipt(pic: &PocketIc, canister: Principal, id: u64, index: u32) -> Receipt {
    call::<Result<Receipt, String>>(
        pic,
        canister,
        "probe_receipt",
        encode_args((id, index)).unwrap(),
    )
    .unwrap()
}

fn raw(pic: &PocketIc, canister: Principal, receipt: &Receipt) -> Option<Vec<u8>> {
    let mut all = vec![];
    let mut offset = 0;
    receipt.raw_bytes?;
    loop {
        let page = call::<Result<ReplyPage, String>>(
            pic,
            canister,
            "probe_reply",
            encode_args((receipt.job_id, receipt.index, offset)).unwrap(),
        )
        .unwrap();
        all.extend(page.bytes);
        let Some(next) = page.next_offset else {
            break;
        };
        assert_eq!(next as usize, all.len());
        offset = next;
    }
    assert_eq!(receipt.raw_bytes, Some(all.len() as u32));
    assert_eq!(receipt.raw_hash, Some(sha256(&all)));
    Some(all)
}

fn export(pic: &PocketIc, canister: Principal, status: &Status, profile: &str) -> Vec<Receipt> {
    let folder = root().join(".local/receipts").join(profile);
    fs::create_dir_all(&folder).unwrap();
    fs::write(
        folder.join(format!("job-{}-status.didbin", status.job_id)),
        encode_one(status).unwrap(),
    )
    .unwrap();
    let receipts: Vec<_> = (0..status.receipt_count)
        .map(|index| receipt(pic, canister, status.job_id, index))
        .collect();
    for receipt in &receipts {
        let stem = format!("{}-{:02}-{}", status.job_id, receipt.index, receipt.method);
        fs::write(
            folder.join(format!("{stem}.receipt.didbin")),
            encode_one(receipt).unwrap(),
        )
        .unwrap();
        if let Some(bytes) = raw(pic, canister, receipt) {
            fs::write(folder.join(format!("{stem}.reply.bin")), bytes).unwrap();
        }
        println!(
            "{profile}/{stem} {} bytes, {} cycles before-to-callback, {} ns: {:?}",
            receipt.raw_bytes.unwrap_or(0),
            receipt
                .cycles_before
                .saturating_sub(receipt.cycles_at_callback),
            receipt.received_at_nanos - receipt.sent_at_nanos,
            receipt.observation
        );
    }
    println!(
        "{profile} job {}: {} receipts, {} raw bytes (all jobs), {} stable pages",
        status.job_id, status.receipt_count, status.stored_reply_bytes, status.stable_pages
    );
    receipts
}

fn assert_management(rows: &[Receipt], own: Principal, remote: Principal) {
    for target in [own, remote] {
        assert!(
            rows.iter().any(|row| matches!(row.observation,
                Observation::SubnetInfo { subnet, ref replica_version, registry_version } if
                (subnet == target && !replica_version.is_empty() && registry_version > 0)
            )),
            "missing subnet_info for {target}"
        );
        assert!(
            rows.iter().any(|row| matches!(row.observation,
                Observation::Metrics { subnet, .. } if subnet == target
            )),
            "missing metrics reply for {target}"
        );
    }
}

#[test]
#[ignore = "run through scripts/test-m0.sh to build Wasm and start PocketIC"]
fn cross_subnet_wire_calls_and_upgrade() {
    assert!(enabled(), "use scripts/test-m0.sh");
    let pic = PocketIcBuilder::new()
        .with_nns_subnet()
        .with_application_subnet()
        .build();
    let topology = pic.topology();
    let nns = topology.get_nns().unwrap();
    let app = topology.get_app_subnets()[0];
    let fixture = pic.create_canister_on_subnet(None, None, nns);
    pic.install_canister(
        fixture,
        wasm("target/wasm32-unknown-unknown/release/nexus_source_fixture.wasm"),
        encode_args(()).unwrap(),
        None,
    );
    let reviewer = pic.create_canister_on_subnet(None, None, app);
    pic.add_cycles(reviewer, FUNDING);
    let reviewer_wasm = wasm(".local/reviewer-fixture.wasm");
    pic.install_canister(
        reviewer,
        wasm(".local/m0-wasm/reviewer.wasm"),
        encode_one(Some(Sources {
            governance: fixture,
            registry: fixture,
        }))
        .unwrap(),
        None,
    );
    let request = ProbeRequest {
        proposal_id: None,
        registry_subnet: None,
        remote_subnet: Some(nns),
        metrics_start_nanos: 0,
    };
    let cycles_before = pic.cycle_balance(reviewer);
    let id = start(&pic, reviewer, &request);
    let caller = Principal::from_slice(&[42, 2]);
    let unauthorized = pic
        .update_call(
            reviewer,
            caller,
            "start_probe",
            encode_one(&request).unwrap(),
        )
        .unwrap();
    assert_eq!(
        decode_one::<Result<u64, String>>(&unauthorized).unwrap(),
        Err("controller required".into())
    );
    assert!(
        call::<Result<u64, String>>(&pic, reviewer, "start_probe", encode_one(&request).unwrap())
            .is_err()
    );

    advance(&pic);
    let before_upgrade = status(&pic, reviewer, id);
    assert!(before_upgrade.receipt_count > 0 && before_upgrade.remaining_steps > 0);
    let first = receipt(&pic, reviewer, id, 0);
    let original = raw(&pic, reviewer, &first);
    pic.upgrade_canister(reviewer, reviewer_wasm, encode_args(()).unwrap(), None)
        .unwrap();
    assert_eq!(raw(&pic, reviewer, &first), original);
    assert!(
        call::<Result<ProbeBudget, String>>(
            &pic,
            reviewer,
            "probe_budget",
            encode_one(id).unwrap()
        )
        .unwrap()
        .migrated_from_m0
    );
    let final_status = run_to_completion(&pic, reviewer, id);
    println!(
        "fixture lifecycle spent {} cycles including upgrade and status polling",
        cycles_before - pic.cycle_balance(reviewer)
    );
    let rows = export(&pic, reviewer, &final_status, "synthetic-wire");
    assert_management(&rows, app, nns);
    assert_eq!(rows.iter().filter(|row| matches!(row.observation, Observation::ProposalList(ref list)
        if list.first().is_some_and(|listed| listed.id == 101 && listed.listed_payload_bytes == Some(0)))).count(), 2);
    assert!(
        rows.iter()
            .any(|row| matches!(row.observation, Observation::Proposal {
        id: 101, payload_bytes: Some(size), membership: Some(_), .. } if size > 1000))
    );
    assert!(rows.iter().any(|row| row.method == "get_proposal_info"
        && matches!(row.observation, Observation::Unavailable)));
    let pages: Vec<_> = rows
        .iter()
        .filter_map(|row| match &row.observation {
            Observation::RegistryPage(span) => Some((
                span.requested_after,
                span.delivered_through,
                span.observed_head,
                span.tombstones,
            )),
            _ => None,
        })
        .collect();
    assert_eq!(pages, vec![(0, 3, 5, 1), (3, 5, 5, 0)]);
    let versions: Vec<_> = rows
        .iter()
        .filter_map(|row| match row.observation {
            Observation::RegistryValue {
                key: Key::SubnetList,
                requested_version,
                mutation_version,
                source_timestamp_nanos: None,
                ..
            } => Some((requested_version, mutation_version)),
            _ => None,
        })
        .collect();
    assert_eq!(versions, vec![(5, 3), (2, 1)]);
    assert!(rows.iter().any(|row| matches!(row.observation, Observation::Chunk { assembled: Some(ref joined), .. }
        if matches!(joined.record, Some(RecordSummary::DataCenter { ref id, .. }) if id == "synthetic"))));
    assert!(rows.iter().all(|row| !matches!(
        row.observation,
        Observation::InvalidResponse(_) | Observation::Rejected { .. }
    )));

    let id = start(
        &pic,
        reviewer,
        &ProbeRequest {
            remote_subnet: Some(Principal::from_slice(&[90, 90, 2])),
            ..request
        },
    );
    let final_status = run_to_completion(&pic, reviewer, id);
    let rows = export(&pic, reviewer, &final_status, "synthetic-wire");
    assert!(rows.iter().any(|row| row.method == "node_metrics_history"
        && matches!(row.observation, Observation::Rejected { .. })));
    assert!(rows.iter().any(
        |row| matches!(row.observation, Observation::Metrics { subnet, .. } if subnet == app)
    ));
}

#[test]
#[ignore = "run through scripts/test-m0.sh to fetch pinned upstream Wasm"]
fn pinned_nns_release_code_from_application_subnet() {
    assert!(enabled(), "use scripts/test-m0.sh");
    let pic = PocketIcBuilder::new()
        .with_nns_subnet()
        .with_application_subnet()
        .build();
    let gov = Principal::from_text("rrkah-fqaaa-aaaaa-aaaaq-cai").unwrap();
    let registry = Principal::from_text("rwlgt-iiaaa-aaaaa-aaaaa-cai").unwrap();
    for target in [gov, registry] {
        pic.create_canister_with_id(None, None, target).unwrap();
    }
    let own = pic.topology().get_app_subnets()[0];
    let nns = pic.topology().get_nns().unwrap();
    let governance_state = governance_init(nns);
    let gov_wasm = wasm(".local/governance-canister.wasm.gz");
    let registry_wasm = wasm(".local/registry-canister.wasm.gz");
    let registry_state = encode_one(EmptyRegistry { mutations: vec![] }).unwrap();
    pic.install_canister(gov, gov_wasm.clone(), governance_state, None);
    pic.install_canister(registry, registry_wasm.clone(), registry_state, None);
    assert_eq!(
        pic.canister_status(gov, None).unwrap().module_hash,
        Some(sha256(&gov_wasm).to_vec())
    );
    assert_eq!(
        pic.canister_status(registry, None).unwrap().module_hash,
        Some(sha256(&registry_wasm).to_vec())
    );
    let reviewer = pic.create_canister_on_subnet(None, None, own);
    pic.add_cycles(reviewer, FUNDING);
    let binary = wasm("target/wasm32-unknown-unknown/release/nexus_reviewer.wasm");
    let args = encode_one::<Option<Sources>>(None).unwrap();
    pic.install_canister(reviewer, binary.clone(), args, None);
    println!("real-wasm probe module hash: {:02x?}", sha256(&binary));
    let cycles_before = pic.cycle_balance(reviewer);
    let id = start(
        &pic,
        reviewer,
        &ProbeRequest {
            proposal_id: Some(101),
            registry_subnet: None,
            remote_subnet: Some(nns),
            metrics_start_nanos: 0,
        },
    );
    let result = run_to_completion(&pic, reviewer, id);
    println!(
        "release-artifact run spent {} cycles including status polling",
        cycles_before - pic.cycle_balance(reviewer)
    );
    let rows = export(&pic, reviewer, &result, "pinned-nns-wasm");
    assert_management(&rows, own, nns);
    assert_eq!(rows.iter().filter(|row| matches!(row.observation, Observation::ProposalList(ref list)
        if list.first().is_some_and(|listed| listed.id == 101 && listed.listed_payload_bytes == Some(0)))).count(), 2);
    assert!(
        rows.iter()
            .any(|row| matches!(row.observation, Observation::Proposal {
        id: 101, payload_bytes: Some(size), membership: Some(_), .. } if size > 1000))
    );
    assert!(rows.iter().any(|row| row.method == "get_proposal_info"
        && matches!(row.observation, Observation::Unavailable)));
    assert!(rows.iter().any(
        |row| row.source == registry && matches!(row.observation, Observation::RegistryHead(0))
    ));
    assert!(rows.iter().any(|row| row.source == registry
        && matches!(row.observation, Observation::RegistryPage(ref span)
        if span.requested_after == 0 && span.delivered_through == 0 && span.observed_head == 0)));
}

#[derive(CandidType)]
struct EmptyRegistry {
    mutations: Vec<candid::Empty>,
}

fn governance_init(subnet_id: Principal) -> Vec<u8> {
    use nexus_ic_sources::governance::{Action, ExecuteNnsFunction, ProposalId};

    #[derive(CandidType)]
    struct Setup {
        wait_for_quiet_threshold_seconds: u64,
        short_voting_period_seconds: u64,
        genesis_timestamp_seconds: u64,
        default_followees: Vec<(i32, candid::Empty)>,
        economics: Option<Economics>,
        node_providers: Vec<candid::Empty>,
        to_claim_transfers: Vec<candid::Empty>,
        proposals: Vec<(u64, Data)>,
        in_flight_commands: Vec<(u64, candid::Empty)>,
        neurons: Vec<(u64, candid::Empty)>,
    }

    #[derive(CandidType)]
    struct Economics {
        neuron_minimum_stake_e8s: u64,
        max_proposals_to_keep_per_topic: u32,
        neuron_management_fee_per_proposal_e8s: u64,
        reject_cost_e8s: u64,
        transaction_fee_e8s: u64,
        neuron_spawn_dissolve_delay_seconds: u64,
        minimum_icp_xdr_rate: u64,
        maximum_node_provider_rewards_e8s: u64,
    }

    #[derive(CandidType)]
    struct Data {
        id: Option<ProposalId>,
        ballots: Vec<(u64, candid::Empty)>,
        proposal_timestamp_seconds: u64,
        reward_event_round: u64,
        failed_timestamp_seconds: u64,
        reject_cost_e8s: u64,
        decided_timestamp_seconds: u64,
        executed_timestamp_seconds: u64,
        proposal: Option<Proposal>,
    }

    #[derive(CandidType)]
    struct Proposal {
        url: String,
        summary: String,
        title: Option<String>,
        action: Option<Action>,
    }

    #[derive(CandidType)]
    struct Change {
        subnet_id: Principal,
        node_ids_add: Vec<Principal>,
        node_ids_remove: Vec<Principal>,
    }
    let proposals = [100, 101]
        .into_iter()
        .map(|id| {
            let payload = encode_one(Change {
                subnet_id,
                node_ids_add: (0..37).map(|i| Principal::from_slice(&[i; 29])).collect(),
                node_ids_remove: vec![],
            })
            .unwrap();
            (
                id,
                Data {
                    id: Some(ProposalId { id }),
                    ballots: vec![],
                    proposal_timestamp_seconds: 1_700_000_000,
                    reward_event_round: 1,
                    failed_timestamp_seconds: 0,
                    reject_cost_e8s: 0,
                    decided_timestamp_seconds: 1_700_000_001,
                    executed_timestamp_seconds: 1_700_000_002,
                    proposal: Some(Proposal {
                        url: String::new(),
                        summary: "Synthetic test input for released Governance Wasm".into(),
                        title: None,
                        action: Some(Action::ExecuteNnsFunction(ExecuteNnsFunction {
                            nns_function: 31,
                            payload,
                        })),
                    }),
                },
            )
        })
        .collect();
    encode_one(Setup {
        wait_for_quiet_threshold_seconds: 4 * 24 * 60 * 60,
        short_voting_period_seconds: 12 * 60 * 60,
        genesis_timestamp_seconds: 1_700_000_000,
        default_followees: vec![],
        economics: Some(Economics {
            neuron_minimum_stake_e8s: 100_000_000,
            max_proposals_to_keep_per_topic: 100,
            neuron_management_fee_per_proposal_e8s: 10_000,
            reject_cost_e8s: 100_000_000,
            transaction_fee_e8s: 10_000,
            neuron_spawn_dissolve_delay_seconds: 7 * 86_400,
            minimum_icp_xdr_rate: 100,
            maximum_node_provider_rewards_e8s: 100_000_000_000,
        }),
        node_providers: vec![],
        to_claim_transfers: vec![],
        proposals,
        in_flight_commands: vec![],
        neurons: vec![],
    })
    .unwrap()
}

#[test]
#[ignore = "run through scripts/test-m0.sh to build Wasm and start PocketIC"]
fn replicated_queries_have_different_limits_from_client_queries() {
    assert!(enabled(), "use scripts/test-m0.sh");
    let pic = PocketIcBuilder::new()
        .with_nns_subnet()
        .with_application_subnet()
        .build();
    let topology = pic.topology();
    let app = topology.get_app_subnets()[0];
    let client = pic.create_canister_on_subnet(None, None, app);
    pic.add_cycles(client, FUNDING);
    let source = pic.create_canister_on_subnet(None, None, topology.get_nns().unwrap());
    let binary = wasm("target/wasm32-unknown-unknown/release/nexus_source_fixture.wasm");
    for canister in [client, source] {
        pic.install_canister(canister, binary.clone(), encode_args(()).unwrap(), None);
    }
    let query = |method| {
        pic.query_call(
            source,
            Principal::anonymous(),
            method,
            encode_args(()).unwrap(),
        )
        .unwrap()
    };
    assert!(!decode_one::<bool>(&query("absent_data_certificate")).unwrap());
    assert!(call::<bool>(
        &pic,
        client,
        "remote_query_has_no_certificate",
        encode_one(source).unwrap()
    ));
    assert!(query("oversized_replicated_reply").len() > 2 * 1024 * 1024);
    let message = call::<String>(
        &pic,
        client,
        "remote_oversized_reply_error",
        encode_one(source).unwrap(),
    );
    println!("replicated response size failure: {message}");
    assert!(message.contains("2097152"), "{message}");
}

#[test]
#[ignore = "run through scripts/test-m0.sh to build both Wasm generations"]
fn in_flight_upgrade_and_budget_exhaustion() {
    assert!(enabled());
    let pic = PocketIcBuilder::new()
        .with_nns_subnet()
        .with_application_subnet()
        .build();
    let topology = pic.topology();
    let app = topology.get_app_subnets()[0];
    let fixture = pic.create_canister_on_subnet(None, None, topology.get_nns().unwrap());
    let slow = wasm(".local/slow-source-fixture.wasm");
    let delay_target = pic.create_canister_on_subnet(None, None, app);
    pic.install_canister(delay_target, slow.clone(), encode_args(()).unwrap(), None);
    pic.install_canister(fixture, slow, encode_args(()).unwrap(), None);
    pic.update_call(
        fixture,
        Principal::anonymous(),
        "set_delay_target",
        encode_one(delay_target).unwrap(),
    )
    .unwrap();
    let reviewer = pic.create_canister_on_subnet(None, None, app);
    pic.add_cycles(reviewer, FUNDING);
    pic.install_canister(
        reviewer,
        wasm(".local/m0-wasm/reviewer.wasm"),
        encode_one(Some(Sources {
            governance: fixture,
            registry: fixture,
        }))
        .unwrap(),
        None,
    );
    let request = ProbeRequest {
        proposal_id: None,
        registry_subnet: None,
        remote_subnet: None,
        metrics_start_nanos: 0,
    };
    let id = start(&pic, reviewer, &request);
    advance(&pic);
    let inflight = status(&pic, reviewer, id);
    assert!(
        inflight.in_flight,
        "remaining {}, receipts {}, first {:?}",
        inflight.remaining_steps,
        inflight.receipt_count,
        (inflight.receipt_count > 0).then(|| receipt(&pic, reviewer, id, 0).observation)
    );
    assert_eq!(inflight.receipt_count, 0);
    let new_binary = wasm(".local/reviewer-fixture.wasm");
    pic.upgrade_canister(reviewer, new_binary.clone(), encode_args(()).unwrap(), None)
        .unwrap();
    pic.upgrade_canister(
        fixture,
        wasm("target/wasm32-unknown-unknown/release/nexus_source_fixture.wasm"),
        encode_args(()).unwrap(),
        None,
    )
    .unwrap();
    let final_status = run_to_completion(&pic, reviewer, id);
    let ledger = |id| {
        call::<Result<ProbeBudget, String>>(&pic, reviewer, "probe_budget", encode_one(id).unwrap())
            .unwrap()
    };
    let recovered = ledger(id);
    assert!(recovered.migrated_from_m0);
    assert_eq!(recovered.usage.calls, final_status.receipt_count + 1);
    assert_eq!(recovered.usage.stop, Some(Stop::Completed));
    assert_eq!(receipt(&pic, reviewer, id, 0).attempt, 2);

    for (limits, expected, calls) in [
        (
            Limits {
                calls: 1,
                ..Limits::PROBE
            },
            Stop::CallLimit,
            1,
        ),
        (
            Limits {
                cycle_ceiling: 1,
                ..Limits::PROBE
            },
            Stop::CycleCeiling,
            0,
        ),
        (
            Limits {
                raw_bytes: 2 * 1024 * 1024,
                ..Limits::PROBE
            },
            Stop::RawByteLimit,
            1,
        ),
        (
            Limits {
                duration_secs: 1,
                ..Limits::PROBE
            },
            Stop::Deadline,
            0,
        ),
    ] {
        let id = call::<Result<u64, String>>(
            &pic,
            reviewer,
            "start_probe_with_limits",
            encode_args((&request, limits)).unwrap(),
        )
        .unwrap();
        for _ in 0..5 {
            advance(&pic);
        }
        let budget = ledger(id);
        assert_eq!(budget.usage.stop, Some(expected));
        assert_eq!(budget.usage.calls, calls);
    }

    let low = pic
        .create_canister_with_params(
            None,
            CreateCanisterParams {
                cycles: Some(40_000_000_000),
                placement: Some(CreateCanisterPlacement::SubnetId(
                    topology.get_nns().unwrap(),
                )),
                settings: None,
            },
        )
        .unwrap();
    pic.install_canister(
        low,
        new_binary,
        encode_one::<Option<Sources>>(None).unwrap(),
        None,
    );
    let id = start(&pic, low, &request);
    advance(&pic);
    let budget =
        call::<Result<ProbeBudget, String>>(&pic, low, "probe_budget", encode_one(id).unwrap())
            .unwrap();
    assert_eq!(budget.usage.stop, Some(Stop::CycleBalance));
    assert_eq!(budget.usage.calls, 0);
}
