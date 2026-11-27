//! Synthetic, test-only wire endpoints. Installed on a different subnet from the probe.
#![cfg(target_arch = "wasm32")]

mod historical;
mod proposal_fixture;
mod registry_fixture;
mod replay;

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

#[derive(CandidType)]
struct Change {
    subnet_id: Principal,
    node_ids_add: Vec<Principal>,
    node_ids_remove: Vec<Principal>,
}

fn proposal(id: u64, full: bool) -> ProposalInfo {
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
    replay::activity(&request).unwrap_or_else(|| list(request))
}

#[cfg(feature = "slow-governance")]
#[ic_cdk::update]
async fn list_proposals(request: ListRequest) -> ListResponse {
    if let Some(reply) = replay::activity(&request) {
        return reply;
    }
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
    static VOTING_REGISTRY: std::cell::RefCell<Option<VotingRegistry>> = const { std::cell::RefCell::new(None) };
    static VOTING_GOVERNANCE_FAILURE: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}

struct VotingRegistry {
    version: u64,
    replies: std::collections::BTreeMap<Vec<u8>, Vec<u8>>,
    chunks: std::collections::BTreeMap<Vec<u8>, Vec<u8>>,
}

#[ic_cdk::update]
fn load_voting_reference() {
    assert!(ic_cdk::api::is_controller(&ic_cdk::api::msg_caller()));
    replay::clear();
    VOTING_GOVERNANCE_FAILURE.set(false);
    let (version, mut rows): (u64, Vec<(String, Vec<u8>)>) =
        candid::decode_args(include_bytes!("../data/144954/registry.didbin")).unwrap();
    use nexus_ic_sources::registry::wire::types::v1::{PrincipalId, SubnetId};
    let target = rows
        .iter()
        .find_map(|(key, _)| key.strip_prefix("subnet_record_tdb26-"))
        .map(|suffix| Principal::from_text(format!("tdb26-{suffix}")).unwrap())
        .unwrap();
    rows.push((
        "nns_subnet_id".into(),
        HighCapacityRegistryGetValueResponse {
            error: None,
            version,
            timestamp_nanoseconds: 0,
            content: Some(high_capacity_registry_get_value_response::Content::Value(
                SubnetId {
                    principal_id: Some(PrincipalId {
                        raw: target.as_slice().to_vec(),
                    }),
                }
                .encode_to_vec(),
            )),
        }
        .encode_to_vec(),
    ));
    VOTING_REGISTRY.set(Some(VotingRegistry {
        version,
        replies: rows
            .into_iter()
            .map(|(key, reply)| (key.into_bytes(), reply))
            .collect(),
        chunks: Default::default(),
    }));
    set_demo_proposal(
        144_954,
        include_bytes!("../data/144954/governance.didbin").to_vec(),
    );
}

/// Variations of the recorded reference for local browser acceptance tests.
#[ic_cdk::update]
fn set_voting_review_fixture(mode: u8) {
    if mode == 5 {
        assert!(ic_cdk::api::is_controller(&ic_cdk::api::msg_caller()));
        replay::clear();
        VOTING_REGISTRY.set(None);
        DEMO_PROPOSAL.set(None);
        VOTING_GOVERNANCE_FAILURE.set(false);
        return;
    }
    load_voting_reference();
    match mode {
        0 => {}
        1..=3 => VOTING_REGISTRY.with_borrow_mut(|state| {
            use high_capacity_registry_get_value_response::Content;
            let registry = state.as_mut().unwrap();
            let sh1 = b"data_center_record_sh1".as_slice();
            if mode == 2 {
                let reply = registry.replies.get_mut(sh1).unwrap();
                let mut outer =
                    HighCapacityRegistryGetValueResponse::decode(reply.as_slice()).unwrap();
                outer.content = None;
                outer.error = Some(RegistryError {
                    code: registry_error::Code::MalformedMessage as i32,
                    reason: "Local fixture withheld optional data-center evidence".into(),
                    key: sh1.to_vec(),
                });
                *reply = outer.encode_to_vec();
            } else if mode == 1 {
                let reply = registry.replies.get_mut(sh1).unwrap();
                let mut outer =
                    HighCapacityRegistryGetValueResponse::decode(reply.as_slice()).unwrap();
                let Some(Content::Value(bytes)) = outer.content.as_mut() else {
                    panic!()
                };
                let mut center = DataCenterRecord::decode(bytes.as_slice()).unwrap();
                center.gps = None;
                *bytes = center.encode_to_vec();
                *reply = outer.encode_to_vec();
            } else {
                let reply = registry
                    .replies
                    .iter_mut()
                    .find(|(key, _)| key.starts_with(b"subnet_record_tdb26-"))
                    .unwrap()
                    .1;
                let mut outer =
                    HighCapacityRegistryGetValueResponse::decode(reply.as_slice()).unwrap();
                let Some(Content::Value(bytes)) = outer.content.as_mut() else {
                    panic!()
                };
                let mut subnet = SubnetRecord::decode(bytes.as_slice()).unwrap();
                subnet.membership.push(subnet.membership[0].clone());
                *bytes = subnet.encode_to_vec();
                *reply = outer.encode_to_vec();
            }
        }),
        4 | 7 => {
            let mut captured: Option<ProposalInfo> =
                candid::decode_one(include_bytes!("../data/144954/governance.didbin")).unwrap();
            let proposal = captured.as_mut().unwrap();
            if mode == 4 {
                proposal.status = 4;
                proposal.executed_timestamp_seconds = proposal.proposal_timestamp_seconds + 60;
                proposal.decided_timestamp_seconds = Some(proposal.executed_timestamp_seconds);
            } else {
                proposal.proposal.as_mut().unwrap().action = Some(Action::Motion {
                    motion_text: "Fixture changed action".into(),
                });
            }
            set_demo_proposal(144_954, encode_one(captured).unwrap());
        }
        6 => VOTING_GOVERNANCE_FAILURE.set(true),
        _ => panic!("unknown reference fixture"),
    }
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
    if replay::governance(id) {
        return;
    }
    if id == 144_954 && VOTING_GOVERNANCE_FAILURE.get() {
        ic_cdk::trap("Temporary fixture Governance failure");
    }
    if id == 143_190 {
        msg_reply(include_bytes!("../data/143190/governance.didbin"));
        return;
    }
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
    let reply = if proposal_fixture::ENABLED.get() && (90..=101).contains(&id) {
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
    let captured =
        VOTING_REGISTRY.with_borrow(|registry| registry.as_ref().map(|fixture| fixture.version));
    let version = if let Some(version) = captured.or_else(registry_fixture::direct_head) {
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

#[cfg(not(feature = "slow-governance"))]
#[ic_cdk::query(
    name = "get_value",
    manual_reply = true,
    decode_with = "decode_value_request",
    hidden = true
)]
fn value(request: RegistryGetValueRequest) {
    reply_value(request);
}

#[cfg(feature = "slow-governance")]
#[ic_cdk::update(
    name = "get_value",
    manual_reply = true,
    decode_with = "decode_value_request",
    hidden = true
)]
async fn value(request: RegistryGetValueRequest) {
    if request.key.starts_with(b"data_center_record_")
        && let Some(target) = DELAY_TARGET.get()
    {
        for _ in 0..64 {
            ic_cdk::call::Call::bounded_wait(target, "delay_round")
                .await
                .expect("fixture round");
        }
    }
    reply_value(request);
}

fn decode_value_request(bytes: Vec<u8>) -> RegistryGetValueRequest {
    RegistryGetValueRequest::decode(bytes.as_slice()).unwrap()
}

fn reply_value(request: RegistryGetValueRequest) {
    use high_capacity_registry_get_value_response::Content;
    if VOTING_REGISTRY.with_borrow(|registry| {
        let Some(registry) = registry else {
            return false;
        };
        assert_eq!(
            request.version,
            Some(registry.version),
            "pinned reference version"
        );
        msg_reply(
            registry
                .replies
                .get(&request.key)
                .expect("uncaptured Registry key"),
        );
        true
    }) {
        return;
    }
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
    if let Some(result) = VOTING_REGISTRY.with_borrow(|registry| {
        registry.as_ref().map(|registry| {
            registry
                .chunks
                .get(&hash)
                .cloned()
                .map(|content| Chunk {
                    content: Some(content),
                })
                .ok_or_else(|| "uncaptured Registry chunk".into())
        })
    }) {
        return result;
    }
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

ic_cdk::export_candid!();
