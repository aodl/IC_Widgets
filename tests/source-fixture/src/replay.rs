use std::{cell::RefCell, collections::BTreeMap};

use candid::{Principal, encode_one};
use ic_cdk::api::{is_controller, msg_caller, msg_reply};
use nexus_domain::sha256;
use nexus_ic_sources::projection::RecordKey;
use nexus_ic_sources::registry::{
    NNS_SUBNET_KEY,
    transport::*,
    wire::registry::{
        dc::v1::{DataCenterRecord, Gps},
        node::v1::NodeRecord,
        node_operator::v1::NodeOperatorRecord,
        subnet::v1::{SubnetListRecord, SubnetRecord},
    },
};
use prost::Message;

use crate::{VOTING_REGISTRY, VotingRegistry, historical};

thread_local! {
    static REPLAY: RefCell<Option<Replay>> = const { RefCell::new(None) };
}

struct Replay {
    proposals: BTreeMap<u64, Vec<u8>>,
    fault: Option<String>,
    failure_active: bool,
}

pub fn clear() {
    REPLAY.set(None);
}

pub fn governance(id: u64) -> bool {
    REPLAY.with_borrow(|replay| {
        let Some(replay) = replay else { return false };
        assert!(
            !replay.failure_active || id == 143_190,
            "Named fixture Governance failure"
        );
        let reply = replay
            .proposals
            .get(&id)
            .expect("uncaptured Governance proposal");
        msg_reply(reply);
        true
    })
}

#[ic_cdk::update]
fn load_review_case(id: String) {
    assert!(is_controller(&msg_caller()));
    let case = historical::cases()
        .into_iter()
        .find(|case| case.id == id)
        .expect("unknown development replay");
    assert_eq!(case.proposal_ids.len(), case.function_ids.len());
    let recorded = case.lifecycle == "recorded-open";
    let mut proposals: BTreeMap<_, _> = case
        .proposal_ids
        .iter()
        .zip(case.function_ids)
        .map(|(id, function)| {
            let bytes = if recorded {
                assert_eq!(id, "144954");
                assert_eq!(function, 31);
                include_bytes!("../data/144954/governance.didbin").to_vec()
            } else {
                let info = historical::proposal(id, function, &case.lifecycle);
                encode_one(Some(info)).unwrap()
            };
            (historical::decimal(id), bytes)
        })
        .collect();
    proposals.insert(
        143_190,
        include_bytes!("../data/143190/governance.didbin").to_vec(),
    );
    match case.registry {
        historical::Baseline::CapturedWithOverlay => match case.fault.as_deref() {
            Some("missing-gps") => crate::set_voting_review_fixture(1),
            Some("location-reject") => crate::set_voting_review_fixture(2),
            _ => crate::load_voting_reference(),
        },
        historical::Baseline::Synthetic {
            version,
            mutation_version,
            roster,
            subnets,
        } => {
            VOTING_REGISTRY.set(Some(synthetic(
                historical::decimal(&version),
                historical::decimal(&mutation_version),
                roster,
                subnets,
                historical::requested(&proposals),
                case.fault.as_deref(),
            )));
        }
    }
    #[cfg(feature = "slow-governance")]
    crate::DELAY_TARGET
        .set((case.fault.as_deref() == Some("slow-locations")).then(ic_cdk::api::canister_self));
    REPLAY.set(Some(Replay {
        proposals,
        fault: case.fault,
        failure_active: false,
    }));
}

/// The harness triggers lifecycle and transport changes at a specific phase.
#[ic_cdk::update]
fn trigger_review_fault() {
    assert!(is_controller(&msg_caller()));
    REPLAY.with_borrow_mut(|state| {
        let state = state.as_mut().expect("load a development replay first");
        match state.fault.as_deref() {
            Some("open-then-executed") => {
                let executed = historical::proposal("144954", 31, "indexed-executed");
                state
                    .proposals
                    .insert(144_954, encode_one(Some(executed)).unwrap());
            }
            Some("final-governance-recheck-fails") => state.failure_active = true,
            _ => panic!("case has no phase-triggered fault"),
        }
    });
}

fn synthetic(
    version: u64,
    mutation: u64,
    roster: Vec<String>,
    subnets: BTreeMap<String, Vec<String>>,
    mut members: std::collections::BTreeSet<Principal>,
    fault: Option<&str>,
) -> VotingRegistry {
    use high_capacity_registry_get_value_response::Content;
    assert!(mutation > 0 && mutation < version);
    let mut registry = VotingRegistry {
        version,
        replies: BTreeMap::new(),
        chunks: BTreeMap::new(),
    };
    let mut insert = |key: String, content: Content| {
        assert!(
            registry
                .replies
                .insert(
                    key.into_bytes(),
                    HighCapacityRegistryGetValueResponse {
                        error: None,
                        version: mutation,
                        content: Some(content),
                        timestamp_nanoseconds: 0,
                    }
                    .encode_to_vec(),
                )
                .is_none()
        );
    };
    let inline = Content::Value;
    let bytes = |id: Principal| id.as_slice().to_vec();
    insert(
        RecordKey::SubnetList.name(),
        inline(
            SubnetListRecord {
                subnets: roster
                    .iter()
                    .map(|id| bytes(historical::principal(id)))
                    .collect(),
            }
            .encode_to_vec(),
        ),
    );
    for (id, nodes) in subnets {
        assert!(roster.contains(&id));
        let nodes: Vec<_> = nodes.iter().map(|id| historical::principal(id)).collect();
        members.extend(nodes.iter().copied());
        insert(
            RecordKey::Subnet(historical::principal(&id)).name(),
            inline(
                SubnetRecord {
                    membership: nodes.into_iter().map(bytes).collect(),
                    subnet_type: 1,
                    ..Default::default()
                }
                .encode_to_vec(),
            ),
        );
    }
    for (index, node) in members.iter().enumerate() {
        insert(
            RecordKey::Node(*node).name(),
            inline(
                NodeRecord {
                    node_operator_id: vec![90 + (index % 2) as u8, 42, 2],
                    ..Default::default()
                }
                .encode_to_vec(),
            ),
        );
    }
    for (i, longitude) in [(0, -30.0), (1, 45.0)] {
        let id = format!("fixture-{i}");
        let operator = Principal::from_slice(&[90 + i, 42, 2]);
        insert(
            RecordKey::Operator(operator).name(),
            inline(
                NodeOperatorRecord {
                    node_operator_principal_id: bytes(operator),
                    node_provider_principal_id: vec![100 + i, 42, 2],
                    dc_id: id.clone(),
                    ..Default::default()
                }
                .encode_to_vec(),
            ),
        );
        let center = DataCenterRecord {
            id: id.clone(),
            region: format!("Fixture,Label {i},Synthetic site {i}"),
            owner: format!("Synthetic owner {i}"),
            gps: Some(Gps {
                latitude: 35.0,
                longitude,
            }),
        }
        .encode_to_vec();
        let content = if i == 0 && matches!(fault, Some("chunked-location" | "corrupt-chunk")) {
            let mut chunk_content_sha256s = Vec::new();
            for part in center.chunks(32) {
                let hash = sha256(part).to_vec();
                let value = if fault == Some("corrupt-chunk") && chunk_content_sha256s.is_empty() {
                    vec![0]
                } else {
                    part.to_vec()
                };
                registry.chunks.insert(hash.clone(), value);
                chunk_content_sha256s.push(hash);
            }
            Content::LargeValueChunkKeys(LargeValueChunkKeys {
                chunk_content_sha256s,
            })
        } else {
            inline(center)
        };
        insert(RecordKey::DataCenter(id).name(), content);
    }
    let absent = members
        .into_iter()
        .map(|node| RecordKey::ApiBoundary(node).name())
        .chain(std::iter::once(NNS_SUBNET_KEY.into()));
    for key in absent {
        let key = key.into_bytes();
        registry.replies.insert(
            key.clone(),
            HighCapacityRegistryGetValueResponse {
                error: Some(RegistryError {
                    code: registry_error::Code::KeyNotPresent as i32,
                    reason: "Explicit synthetic absence".into(),
                    key,
                }),
                ..Default::default()
            }
            .encode_to_vec(),
        );
    }
    registry
}
