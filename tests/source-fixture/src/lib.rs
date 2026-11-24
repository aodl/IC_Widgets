//! Synthetic, test-only wire endpoints. Installed on a different subnet from the probe.
#![cfg(target_arch = "wasm32")]

mod proposal_fixture;
mod registry_fixture;

use candid::{CandidType, Principal, encode_one};
use ic_cdk::api::{msg_arg_data, msg_reply};
use nexus_domain::sha256;
use nexus_ic_sources::{
    governance::{
        Action, ExecuteNnsFunction, ListRequest, ListResponse, Proposal, ProposalId, ProposalInfo,
    },
    registry::{
        Chunk, ChunkRequest, Key,
        transport::*,
        wire::registry::{
            dc::v1::DataCenterRecord,
            node::v1::NodeRecord,
            node_operator::v1::NodeOperatorRecord,
            subnet::v1::{SubnetListRecord, SubnetRecord},
        },
    },
};
use prost::Message;

fn subnet() -> Principal {
    Principal::from_slice(&[52, 2])
}
fn node() -> Principal {
    Principal::from_slice(&[53, 2])
}
fn operator() -> Principal {
    Principal::from_slice(&[54, 2])
}
fn provider() -> Principal {
    Principal::from_slice(&[55, 2])
}

fn proposal(id: u64, full: bool) -> ProposalInfo {
    #[derive(CandidType)]
    struct Change {
        subnet_id: Principal,
        node_ids_add: Vec<Principal>,
        node_ids_remove: Vec<Principal>,
    }
    let mut payload = encode_one(Change {
        subnet_id: subnet(),
        node_ids_add: (0..37)
            .map(|index| Principal::from_slice(&[index; 29]))
            .collect(),
        node_ids_remove: vec![node()],
    })
    .unwrap();
    assert!(payload.len() > 1_000);
    if !full {
        payload.clear();
    }
    ProposalInfo {
        id: Some(ProposalId { id }),
        status: 1,
        topic: 3,
        proposal_timestamp_seconds: 100,
        executed_timestamp_seconds: 0,
        failed_timestamp_seconds: None,
        decided_timestamp_seconds: None,
        proposal: Some(Proposal {
            title: Some("Synthetic membership proposal".into()),
            summary: "A test fixture, not an on-chain proposal.".into(),
            action: Some(Action::ExecuteNnsFunction(ExecuteNnsFunction {
                nns_function: 31,
                payload,
            })),
        }),
    }
}

#[cfg(not(feature = "slow-governance"))]
#[ic_cdk::query]
fn list_proposals(request: ListRequest) -> ListResponse {
    list(request)
}

#[cfg(feature = "slow-governance")]
#[ic_cdk::update]
async fn list_proposals(request: ListRequest) -> ListResponse {
    let target = DELAY_TARGET
        .get()
        .expect("configure cross-subnet fixture target");
    for _ in 0..20 {
        ic_cdk::call::Call::bounded_wait(target, "delay_round")
            .await
            .expect("fixture round");
    }
    list(request)
}

#[cfg(feature = "slow-governance")]
#[ic_cdk::update]
fn delay_round() {}

#[cfg(feature = "slow-governance")]
thread_local! {
    static DELAY_TARGET: std::cell::Cell<Option<Principal>> = const { std::cell::Cell::new(None) };
}

#[cfg(feature = "slow-governance")]
#[ic_cdk::update]
fn set_delay_target(target: Principal) {
    DELAY_TARGET.set(Some(target));
}

fn list(request: ListRequest) -> ListResponse {
    let before = request.before_proposal.map_or(u64::MAX, |id| id.id);
    let extended = proposal_fixture::ENABLED.get();
    let first = if extended { 94 } else { 100 };
    ListResponse {
        proposal_info: (first..=101)
            .rev()
            .filter(|&id| id < before)
            .take(request.limit as usize)
            .map(|id| {
                let base = proposal(id, false);
                if extended {
                    proposal_fixture::proposal(id, false, base)
                } else {
                    base
                }
            })
            .collect(),
    }
}

thread_local! {
    static DEMO_PROPOSAL: std::cell::RefCell<Option<(u64, Vec<u8>)>> = const { std::cell::RefCell::new(None) };
}

/// Replay one exact public reply on a local source canister for browser demonstrations.
#[ic_cdk::update]
fn set_demo_proposal(id: u64, reply: Vec<u8>) {
    assert!(ic_cdk::api::is_controller(&ic_cdk::api::msg_caller()));
    assert!(reply.len() <= 64 * 1024, "demo reply limit");
    let proposal: Option<ProposalInfo> =
        nexus_ic_sources::decode_candid(&reply).expect("full proposal reply");
    assert_eq!(proposal.and_then(|row| row.id).map(|row| row.id), Some(id));
    DEMO_PROPOSAL.replace(Some((id, reply)));
}

#[ic_cdk::query(manual_reply = true)]
fn get_proposal_info(id: u64) {
    if DEMO_PROPOSAL.with_borrow(|capture| {
        if let Some((expected, bytes)) = capture
            && *expected == id
        {
            msg_reply(bytes);
            return true;
        }
        false
    }) {
        return;
    }
    let reply = if proposal_fixture::ENABLED.get() && (91..=101).contains(&id) {
        Some(proposal_fixture::proposal(id, true, proposal(id, true)))
    } else {
        matches!(id, 101 | 100).then(|| proposal(id, true))
    };
    msg_reply(encode_one(reply).expect("fixture proposal reply"));
}

fn data_center() -> Vec<u8> {
    DataCenterRecord {
        id: "synthetic".into(),
        region: "Region,Registered Country,City".into(),
        owner: "Example owner".into(),
        gps: None,
    }
    .encode_to_vec()
}

fn pieces() -> [Vec<u8>; 2] {
    let record = data_center();
    let (one, two) = record.split_at(7);
    [one.to_vec(), two.to_vec()]
}

fn large() -> LargeValueChunkKeys {
    LargeValueChunkKeys {
        chunk_content_sha256s: pieces().iter().map(|part| sha256(part).to_vec()).collect(),
    }
}

#[unsafe(export_name = "canister_query get_latest_version")]
extern "C" fn latest() {
    assert!(
        msg_arg_data().is_empty(),
        "latest must receive empty protobuf"
    );
    let version = if let Some(version) = registry_fixture::direct_head() {
        version
    } else if registry_fixture::MODE.get() == 0 {
        5
    } else {
        registry_fixture::head()
    };
    msg_reply(RegistryGetLatestVersionResponse { version }.encode_to_vec());
}

#[unsafe(export_name = "canister_query get_changes_since")]
extern "C" fn changes() {
    use high_capacity_registry_value::Content;
    let after = RegistryGetChangesSinceRequest::decode(msg_arg_data().as_slice())
        .unwrap()
        .version;
    if registry_fixture::MODE.get() != 0 {
        msg_reply(registry_fixture::changes(after).encode_to_vec());
        return;
    }
    let delta = |key, values| HighCapacityRegistryDelta { key, values };
    let change = |version, content| HighCapacityRegistryValue {
        version,
        content: Some(content),
        timestamp_nanoseconds: 0,
    };
    let deltas = match after {
        0 => vec![
            delta(
                b"data_center_record_synthetic".to_vec(),
                vec![change(1, Content::LargeValueChunkKeys(large()))],
            ),
            delta(
                b"ignored-family".to_vec(),
                vec![
                    change(3, Content::Value(vec![7; 140_000])),
                    change(2, Content::DeletionMarker(true)),
                    change(1, Content::Value(vec![1])),
                ],
            ),
        ],
        3 => vec![delta(
            b"other-ignored-family".to_vec(),
            vec![
                change(5, Content::Value(vec![5])),
                change(4, Content::Value(vec![4])),
            ],
        )],
        _ => panic!("unexpected replay cursor {after}"),
    };
    msg_reply(
        HighCapacityRegistryGetChangesSinceResponse {
            version: 5,
            error: None,
            deltas,
        }
        .encode_to_vec(),
    );
}

#[unsafe(export_name = "canister_query get_value")]
extern "C" fn value() {
    use high_capacity_registry_get_value_response::Content;
    let request = RegistryGetValueRequest::decode(msg_arg_data().as_slice()).unwrap();
    if let Some(reply) = registry_fixture::direct_value(&request) {
        msg_reply(reply.encode_to_vec());
        return;
    }
    let key = std::str::from_utf8(&request.key).unwrap();
    let at = request.version.unwrap();
    let mut reply = HighCapacityRegistryGetValueResponse {
        error: None,
        version: 1,
        timestamp_nanoseconds: 0,
        content: None,
    };
    let inline = |bytes| Some(Content::Value(bytes));
    reply.content = if key == Key::SubnetList.registry_name() && matches!(at, 2 | 5) {
        reply.version = if at == 5 { 3 } else { 1 };
        inline(
            SubnetListRecord {
                subnets: vec![subnet().as_slice().to_vec()],
            }
            .encode_to_vec(),
        )
    } else if key == Key::Subnet(subnet()).registry_name() && at == 5 {
        inline(
            SubnetRecord {
                membership: vec![node().as_slice().to_vec()],
                subnet_type: 1,
                replica_version_id: "synthetic-configured-version".into(),
                ..Default::default()
            }
            .encode_to_vec(),
        )
    } else if key == Key::Node(node()).registry_name() && at == 5 {
        inline(
            NodeRecord {
                node_operator_id: operator().as_slice().to_vec(),
                ..Default::default()
            }
            .encode_to_vec(),
        )
    } else if key == Key::Operator(operator()).registry_name() && at == 5 {
        inline(
            NodeOperatorRecord {
                node_operator_principal_id: operator().as_slice().to_vec(),
                node_provider_principal_id: provider().as_slice().to_vec(),
                dc_id: "Synthetic".into(),
                ..Default::default()
            }
            .encode_to_vec(),
        )
    } else if key == Key::DataCenter("Synthetic".into()).registry_name() && at == 5 {
        Some(Content::LargeValueChunkKeys(large()))
    } else {
        reply.version = 0;
        reply.error = Some(RegistryError {
            code: 1,
            reason: "missing key".into(),
            key: request.key,
        });
        None
    };
    msg_reply(reply.encode_to_vec());
}

#[ic_cdk::query]
fn get_chunk(request: ChunkRequest) -> Result<Chunk, String> {
    let hash = request.content_sha256.ok_or("missing hash")?;
    let mode = registry_fixture::MODE.get();
    if mode != 0 {
        let part = registry_fixture::chunks()
            .into_iter()
            .find(|part| sha256(part).as_slice() == hash);
        return part
            .map(|part| Chunk {
                content: Some(if mode == 2 { vec![0] } else { part }),
            })
            .ok_or_else(|| "unknown fixture chunk".into());
    }
    let content = pieces()
        .into_iter()
        .find(|part| sha256(part).as_slice() == hash);
    content
        .map(|content| Chunk {
            content: Some(content),
        })
        .ok_or_else(|| "unknown hash".into())
}

#[ic_cdk::query]
fn absent_data_certificate() -> bool {
    ic_cdk::api::data_certificate().is_none()
}

#[ic_cdk::query]
fn oversized_replicated_reply() -> Vec<u8> {
    vec![0; 2 * 1024 * 1024 + 1]
}

#[ic_cdk::update]
async fn remote_query_has_no_certificate(remote: Principal) -> bool {
    ic_cdk::call::Call::bounded_wait(remote, "absent_data_certificate")
        .await
        .expect("ordinary replicated query")
        .candid::<bool>()
        .expect("certificate presence")
}

#[ic_cdk::update]
async fn remote_oversized_reply_error(remote: Principal) -> String {
    ic_cdk::call::Call::bounded_wait(remote, "oversized_replicated_reply")
        .await
        .expect_err("oversized replicated reply must be rejected")
        .to_string()
}
