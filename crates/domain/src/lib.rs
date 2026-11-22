use candid::{CandidType, Principal};
use serde::Deserialize;
use sha2::{Digest, Sha256};

pub type Hash = [u8; 32];

pub fn sha256(bytes: &[u8]) -> Hash {
    Sha256::digest(bytes).into()
}

/// Source order and duplicates are preserved for review.
#[derive(Clone, Debug, PartialEq, Eq, CandidType, Deserialize)]
pub enum MembershipAction {
    Change {
        subnet: Principal,
        add: Vec<Principal>,
        remove: Vec<Principal>,
    },
    Add {
        subnet: Principal,
        nodes: Vec<Principal>,
    },
    Remove {
        nodes: Vec<Principal>,
    },
}
