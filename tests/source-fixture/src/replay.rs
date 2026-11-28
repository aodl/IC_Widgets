use std::{cell::RefCell, collections::BTreeMap};

use candid::{Principal, encode_one};
use ic_cdk::api::{is_controller, msg_caller, msg_reply};
use nexus_domain::sha256;
use nexus_ic_sources::governance::{ListRequest, ListResponse};
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
    activity: Vec<historical::ActivityFixture>,
    archived: bool,
    untargeted_activity_probe: bool,
    failure_active: bool,
    composition_listing: bool,
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

pub fn activity(request: &ListRequest) -> Option<ListResponse> {
    REPLAY.with_borrow(|replay| {
        let replay = replay.as_ref()?;
        if replay.archived {
            let original: ListResponse = candid::decode_one(include_bytes!(
                "../../../docs/subnet-activity/governance-2026-11-27/governance-page.didbin"
            ))
            .unwrap();
            let cursor = request.before_proposal.map_or(u64::MAX, |id| id.id);
            let proposal_info: Vec<_> = original
                .proposal_info
                .into_iter()
                .filter(|row| row.id.is_some_and(|id| id.id < cursor))
                .filter(|row| {
                    request.include_status.is_empty()
                        || request.include_status.contains(&row.status)
                })
                .filter(|row| {
                    request.include_reward_status.is_empty()
                        || row
                            .reward_status
                            .is_some_and(|status| request.include_reward_status.contains(&status))
                })
                .take(request.limit as usize)
                .collect();
            assert!(
                !proposal_info.is_empty(),
                "Original Governance discovery ended after one captured page"
            );
            return Some(ListResponse { proposal_info });
        }
        if replay.untargeted_activity_probe {
            let id = 132_102;
            let info: Option<nexus_ic_sources::governance::ProposalInfo> =
                candid::decode_one(&replay.proposals[&id]).unwrap();
            let proposal_info = info
                .into_iter()
                .filter(|row| {
                    request.before_proposal.is_none_or(|before| id < before.id)
                        && (request.include_status.is_empty()
                            || request.include_status.contains(&row.status))
                        && (request.include_reward_status.is_empty()
                            || request.include_reward_status.contains(&1))
                })
                .map(|mut row| {
                    row.reward_status = Some(1);
                    row
                })
                .collect();
            return Some(ListResponse { proposal_info });
        }
        if replay.composition_listing && replay.activity.is_empty() {
            // A synthetic discovery supplement for the disposable composition
            // rehearsal. Individual proposal reads still return fixture bytes.
            let cursor = request.before_proposal.map_or(u64::MAX, |id| id.id);
            let proposal_info = replay
                .proposals
                .range(..cursor)
                .rev()
                .filter_map(|(_, bytes)| {
                    let mut row: nexus_ic_sources::governance::ProposalInfo =
                        candid::decode_one::<Option<_>>(bytes).unwrap()?;
                    row.reward_status = Some(1);
                    (request.include_status.is_empty()
                        || request.include_status.contains(&row.status))
                    .then_some(row)
                })
                .filter(|_| {
                    request.include_reward_status.is_empty()
                        || request.include_reward_status.contains(&1)
                })
                .take(request.limit as usize)
                .collect();
            return Some(ListResponse { proposal_info });
        }
        assert!(
            !replay.activity.is_empty(),
            "No cross-proposal discovery captured for this case"
        );
        let before = request.before_proposal.map_or(u64::MAX, |id| id.id);
        let mut rows: Vec<_> = replay
            .activity
            .iter()
            .filter(|row| historical::decimal(&row.id) < before)
            .filter(|row| {
                request.include_status.is_empty() || request.include_status.contains(&row.status)
            })
            .filter(|row| {
                request.include_reward_status.is_empty()
                    || row
                        .info(false)
                        .reward_status
                        .is_some_and(|value| request.include_reward_status.contains(&value))
            })
            .collect();
        rows.sort_by_key(|row| std::cmp::Reverse(historical::decimal(&row.id)));
        Some(ListResponse {
            proposal_info: rows
                .into_iter()
                .take(request.limit as usize)
                .map(|row| row.info(request.omit_large_fields.unwrap_or(false)))
                .collect(),
        })
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
    let archived = matches!(case.registry, historical::Baseline::ActivityArchive);
    let recorded = case.lifecycle == "recorded-open";
    let mut proposals: BTreeMap<_, _> = case
        .proposal_ids
        .iter()
        .zip(case.function_ids)
        .map(|(id, function)| {
            let bytes = if recorded {
                assert_eq!(function, 31);
                historical::activity_capture(id)
                    .unwrap_or(include_bytes!("../data/144954/governance.didbin"))
                    .to_vec()
            } else if let Some(row) = case.activity.iter().find(|row| row.id == *id) {
                assert_eq!(row.function, Some(function));
                encode_one(Some(row.info(false))).unwrap()
            } else {
                let info = historical::proposal(id, function, &case.lifecycle);
                encode_one(Some(info)).unwrap()
            };
            (historical::decimal(id), bytes)
        })
        .collect();
    let requested = historical::requested(&proposals);
    if archived {
        for id in ["145077", "145076", "145075", "145071", "145063"] {
            proposals.insert(
                historical::decimal(id),
                historical::activity_capture(id).unwrap().to_vec(),
            );
        }
    }
    for row in &case.activity {
        proposals
            .entry(historical::decimal(&row.id))
            .or_insert_with(|| encode_one(Some(row.info(false))).unwrap());
    }
    proposals.insert(
        143_190,
        include_bytes!("../data/143190/governance.didbin").to_vec(),
    );
    match case.registry {
        historical::Baseline::ActivityArchive => {
            let archive: serde_json::Value = serde_json::from_str(include_str!(
                "../../../docs/subnet-activity/governance-2026-11-27/pinned-registry-values.json"
            ))
            .unwrap();
            let replies = archive["records"]
                .as_object()
                .unwrap()
                .iter()
                .map(|(key, value)| {
                    let wire = value["replyHex"]
                        .as_str()
                        .unwrap()
                        .as_bytes()
                        .chunks_exact(2)
                        .map(|digit| {
                            u8::from_str_radix(std::str::from_utf8(digit).unwrap(), 16).unwrap()
                        })
                        .collect();
                    (key.as_bytes().to_vec(), wire)
                })
                .collect();
            VOTING_REGISTRY.set(Some(VotingRegistry {
                version: archive["requestedVersion"].as_u64().unwrap(),
                replies,
                chunks: BTreeMap::new(),
            }));
        }
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
                requested,
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
        activity: case.activity,
        archived,
        untargeted_activity_probe: id == "untargeted-two-subnets",
        failure_active: false,
        composition_listing: false,
    }));
}

/// Opt into synthetic listing only for the disposable composition harness.
#[ic_cdk::update]
fn load_composition_case(id: String) {
    load_review_case(id);
    REPLAY.with_borrow_mut(|state| state.as_mut().unwrap().composition_listing = true);
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
