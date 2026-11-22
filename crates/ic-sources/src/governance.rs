use candid::{CandidType, Principal};
use nexus_domain::MembershipAction;
use serde::Deserialize;

use crate::decode_candid;

pub const INITIAL_LIST_LIMIT: u32 = 10;

/// PocketIC and the pinned replica report oversized replicated replies with this system API error.
pub fn reduced_list_limit(limit: u32, reject_message: &str) -> Option<u32> {
    (limit > 1 && reject_message.contains("ic0.msg_reply_data_append: application payload size"))
        .then_some(limit / 2)
}

#[derive(Clone, Copy, Debug, CandidType, Deserialize)]
pub struct ProposalId {
    pub id: u64,
}

#[derive(CandidType, Deserialize)]
pub struct ListRequest {
    pub include_reward_status: Vec<i32>,
    pub omit_large_fields: Option<bool>,
    pub before_proposal: Option<ProposalId>,
    pub limit: u32,
    pub exclude_topic: Vec<i32>,
    pub include_all_manage_neuron_proposals: Option<bool>,
    pub include_status: Vec<i32>,
    pub return_self_describing_action: Option<bool>,
}

pub fn list_request(before: Option<u64>, omit_large_fields: bool, limit: u32) -> ListRequest {
    ListRequest {
        include_reward_status: vec![],
        omit_large_fields: Some(omit_large_fields),
        before_proposal: before.map(|id| ProposalId { id }),
        limit,
        exclude_topic: vec![],
        include_all_manage_neuron_proposals: None,
        include_status: vec![],
        return_self_describing_action: Some(false),
    }
}

#[derive(CandidType, Deserialize)]
pub struct ListResponse {
    pub proposal_info: Vec<ProposalInfo>,
}

// A width projection of the pinned DID. Unrecognized action variants become
// absent in this projection. Preserve the exact outer response for later decoding.
#[derive(CandidType, Deserialize)]
pub struct ProposalInfo {
    pub id: Option<ProposalId>,
    pub status: i32,
    pub topic: i32,
    pub proposal_timestamp_seconds: u64,
    pub executed_timestamp_seconds: u64,
    pub failed_timestamp_seconds: Option<u64>,
    pub decided_timestamp_seconds: Option<u64>,
    pub proposal: Option<Proposal>,
}

impl ProposalInfo {
    pub fn executable(&self) -> Option<&ExecuteNnsFunction> {
        match self.proposal.as_ref()?.action.as_ref()? {
            Action::ExecuteNnsFunction(action) => Some(action),
        }
    }
}

#[derive(CandidType, Deserialize)]
pub struct Proposal {
    pub title: Option<String>,
    pub summary: String,
    pub action: Option<Action>,
}

#[derive(CandidType, Deserialize)]
pub enum Action {
    ExecuteNnsFunction(ExecuteNnsFunction),
}

#[derive(CandidType, Deserialize)]
pub struct ExecuteNnsFunction {
    pub nns_function: i32,
    pub payload: Vec<u8>,
}

#[derive(CandidType, Deserialize)]
struct ChangePayload {
    subnet_id: Principal,
    node_ids_add: Vec<Principal>,
    node_ids_remove: Vec<Principal>,
}

#[derive(CandidType, Deserialize)]
struct AddPayload {
    subnet_id: Principal,
    node_ids: Vec<Principal>,
}

#[derive(CandidType, Deserialize)]
struct RemovePayload {
    node_ids: Vec<Principal>,
}

pub fn is_membership(function: i32) -> bool {
    matches!(function, 31 | 2 | 13)
}

/// Only call with a full individual proposal. A listed empty payload can indicate omission.
pub fn membership(action: &ExecuteNnsFunction) -> Result<Option<MembershipAction>, String> {
    let operation = match action.nns_function {
        31 => {
            let ChangePayload {
                subnet_id,
                node_ids_add,
                node_ids_remove,
            } = decode_candid(&action.payload)?;
            MembershipAction::Change {
                subnet: subnet_id,
                add: node_ids_add,
                remove: node_ids_remove,
            }
        }
        2 => {
            let AddPayload {
                subnet_id,
                node_ids,
            } = decode_candid(&action.payload)?;
            MembershipAction::Add {
                subnet: subnet_id,
                nodes: node_ids,
            }
        }
        13 => {
            let RemovePayload { node_ids } = decode_candid(&action.payload)?;
            MembershipAction::Remove { nodes: node_ids }
        }
        _ => return Ok(None),
    };
    Ok(Some(operation))
}

pub fn decode_page(
    bytes: &[u8],
    before: Option<u64>,
    limit: u32,
) -> Result<Vec<ProposalInfo>, String> {
    let ListResponse { proposal_info } = decode_candid(bytes)?;
    if proposal_info.len() > limit as usize {
        return Err("Governance exceeded the requested page limit".into());
    }
    let mut previous = before;
    for proposal in &proposal_info {
        let id = proposal.id.ok_or("listed proposal without an ID")?.id;
        if previous.is_some_and(|upper| id >= upper) {
            return Err("Governance list is not in descending exclusive order".into());
        }
        previous = Some(id);
    }
    Ok(proposal_info)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn candid_projects_known_branch_from_wider_variant_and_preserves_the_rest_as_absent() {
        #[derive(CandidType)]
        enum WiderAction {
            ExecuteNnsFunction(ExecuteNnsFunction),
            Motion { motion_text: String },
        }
        #[derive(CandidType)]
        struct WiderProposal {
            title: Option<String>,
            summary: String,
            action: Option<WiderAction>,
            url: String,
        }
        let make = |action| {
            candid::encode_one(WiderProposal {
                title: None,
                summary: String::new(),
                action: Some(action),
                url: String::new(),
            })
            .unwrap()
        };
        let known = make(WiderAction::ExecuteNnsFunction(ExecuteNnsFunction {
            nns_function: 31,
            payload: vec![],
        }));
        assert!(decode_candid::<Proposal>(&known).unwrap().action.is_some());
        let unknown = make(WiderAction::Motion {
            motion_text: "test".into(),
        });
        assert!(
            decode_candid::<Proposal>(&unknown)
                .unwrap()
                .action
                .is_none()
        );
    }

    #[test]
    fn oversized_list_limit_shrinks_until_one() {
        let reason = "IC0504: ic0.msg_reply_data_append: application payload size (2097166) cannot be larger than 2097152";
        let mut limit = INITIAL_LIST_LIMIT;
        for expected in [5, 2, 1] {
            limit = reduced_list_limit(limit, reason).unwrap();
            assert_eq!(limit, expected);
        }
        assert_eq!(reduced_list_limit(limit, reason), None);
        assert_eq!(
            reduced_list_limit(INITIAL_LIST_LIMIT, "temporarily unavailable"),
            None
        );
    }

    #[test]
    fn membership_functions_decode_distinct_payloads() {
        let subnet = Principal::from_slice(&[1]);
        let node = Principal::from_slice(&[2]);
        let remove_payload = candid::encode_one(RemovePayload {
            node_ids: vec![node, node],
        })
        .unwrap();
        for (nns_function, payload, expected) in [
            (
                31,
                candid::encode_one(ChangePayload {
                    subnet_id: subnet,
                    node_ids_add: vec![node],
                    node_ids_remove: vec![node],
                })
                .unwrap(),
                Some(MembershipAction::Change {
                    subnet,
                    add: vec![node],
                    remove: vec![node],
                }),
            ),
            (
                2,
                candid::encode_one(AddPayload {
                    subnet_id: subnet,
                    node_ids: vec![node],
                })
                .unwrap(),
                Some(MembershipAction::Add {
                    subnet,
                    nodes: vec![node],
                }),
            ),
            (
                13,
                remove_payload.clone(),
                Some(MembershipAction::Remove {
                    nodes: vec![node, node],
                }),
            ),
            (18, remove_payload, None),
        ] {
            assert_eq!(
                membership(&ExecuteNnsFunction {
                    nns_function,
                    payload
                })
                .unwrap(),
                expected
            );
        }
        assert!(
            membership(&ExecuteNnsFunction {
                nns_function: 31,
                payload: vec![]
            })
            .is_err()
        );
    }
}
