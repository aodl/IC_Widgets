use std::cell::Cell;

use candid::{CandidType, Principal, encode_one};
use nexus_ic_sources::governance::{
    Action, ExecuteNnsFunction, Proposal, ProposalId, ProposalInfo,
};

thread_local! {
    pub static ENABLED: Cell<bool> = const { Cell::new(false) };
    static EXECUTED: Cell<bool> = const { Cell::new(false) };
}

#[ic_cdk::update]
fn enable_proposal_fixture() {
    ENABLED.set(true);
}

#[ic_cdk::update]
fn set_proposal_executed(executed: bool) {
    EXECUTED.set(executed);
}

#[derive(CandidType)]
struct Add {
    subnet_id: Principal,
    node_ids: Vec<Principal>,
}

#[derive(CandidType)]
struct Remove {
    node_ids: Vec<Principal>,
}

pub fn proposal(id: u64, full: bool, mut base: ProposalInfo) -> ProposalInfo {
    let proposal: &mut Proposal = base.proposal.as_mut().unwrap();
    let node = Principal::from_slice(&[53, 2]);
    let subnet_id = Principal::from_slice(&[52, 2]);
    let only_node = || {
        encode_one(Remove {
            node_ids: vec![node],
        })
        .unwrap()
    };
    base.id = Some(ProposalId { id });
    proposal.title = Some(format!("Synthetic proposal {id}"));
    proposal.action = match id {
        90 => Some(Action::ExecuteNnsFunction(ExecuteNnsFunction {
            nns_function: 31,
            payload: encode_one(crate::Change {
                subnet_id: crate::registry_fixture::id(22, 0),
                node_ids_add: vec![crate::registry_fixture::id(21, 1201)],
                node_ids_remove: vec![crate::registry_fixture::id(21, 1)],
            })
            .unwrap(),
        })),
        91 => Some(Action::ExecuteNnsFunction(ExecuteNnsFunction {
            nns_function: 13,
            payload: encode_one(Remove {
                node_ids: vec![
                    crate::registry_fixture::id(21, 1),
                    crate::registry_fixture::id(21, 80),
                ],
            })
            .unwrap(),
        })),
        93 => Some(Action::ExecuteNnsFunction(ExecuteNnsFunction {
            nns_function: 2,
            payload: encode_one(Add {
                subnet_id: crate::registry_fixture::id(22, 0),
                node_ids: vec![crate::registry_fixture::id(21, 1201)],
            })
            .unwrap(),
        })),
        92 => Some(Action::ExecuteNnsFunction(ExecuteNnsFunction {
            nns_function: 13,
            payload: encode_one(Remove {
                node_ids: vec![crate::registry_fixture::id(21, 1)],
            })
            .unwrap(),
        })),
        99 => Some(Action::ExecuteNnsFunction(ExecuteNnsFunction {
            nns_function: 2,
            payload: encode_one(Add {
                subnet_id,
                node_ids: vec![node],
            })
            .unwrap(),
        })),
        98 => Some(Action::ExecuteNnsFunction(ExecuteNnsFunction {
            nns_function: 13,
            payload: only_node(),
        })),
        97 => Some(Action::ExecuteNnsFunction(ExecuteNnsFunction {
            nns_function: 18,
            payload: only_node(),
        })),
        96 => Some(Action::ExecuteNnsFunction(ExecuteNnsFunction {
            nns_function: 31,
            payload: vec![0xff],
        })),
        95 => None,
        94 => {
            if full {
                proposal.summary = "x".repeat(2 * 1024 * 1024);
            }
            None
        }
        _ => proposal.action.take(),
    };
    if EXECUTED.get() && id == 101 {
        base.status = 4;
        base.executed_timestamp_seconds = 130;
        base.decided_timestamp_seconds = Some(120);
    }
    base
}
