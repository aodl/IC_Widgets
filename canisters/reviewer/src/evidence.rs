use std::cell::RefCell;

use candid::{CandidType, Principal};
use ic_stable_structures::StableBTreeMap;
use nexus_domain::{Hash, sha256};
use serde::Deserialize;

use crate::store::{Memory, V1, memory};

pub const BLOB_PAGE: usize = 128 * 1024;

#[derive(Clone, Debug, CandidType, Deserialize, PartialEq, Eq)]
pub enum SourceStatus {
    Valid,
    Unavailable,
    Malformed(String),
    Integrity(String),
    Oversized,
    Rejected {
        code: Option<u32>,
        retryable: bool,
        message: String,
    },
    Interrupted,
}

#[derive(Clone, Debug, CandidType, Deserialize)]
pub struct SourceObservation {
    pub id: u64,
    pub source: Principal,
    pub method: String,
    pub argument_hash: Hash,
    pub argument: Vec<u8>,
    pub dispatched_at: u64,
    pub observed_at: u64,
    pub raw_hash: Option<Hash>,
    pub raw_bytes: Option<u32>,
    pub decoder_revision: String,
    pub status: SourceStatus,
}

#[derive(CandidType, Deserialize)]
pub struct EvidenceManifest {
    pub schema_version: u16,
    pub registry_version: Option<u64>,
    pub observations: Vec<SourceObservation>,
    pub manifest_id: Hash,
}

thread_local! {
    static OBSERVATIONS: RefCell<StableBTreeMap<u64, V1<SourceObservation>, Memory>> =
        RefCell::new(StableBTreeMap::init(memory(6)));
    static BLOBS: RefCell<StableBTreeMap<Hash, Vec<u8>, Memory>> =
        RefCell::new(StableBTreeMap::init(memory(7)));
}

pub fn observation(id: u64) -> Option<SourceObservation> {
    OBSERVATIONS.with_borrow(|rows| rows.get(&id).map(|row| row.0))
}

pub fn observe(row: SourceObservation) {
    OBSERVATIONS.with_borrow_mut(|rows| {
        assert!(
            rows.insert(row.id, V1(row)).is_none(),
            "duplicate source observation"
        );
    });
}

pub fn blob(hash: Hash) -> Option<Vec<u8>> {
    BLOBS.with_borrow(|blobs| blobs.get(&hash))
}

pub fn put_blob(hash: Hash, bytes: Vec<u8>) {
    BLOBS.with_borrow_mut(|blobs| {
        if !blobs.contains_key(&hash) {
            blobs.insert(hash, bytes);
        }
    });
}

pub fn manifest(
    registry_version: Option<u64>,
    mut ids: Vec<u64>,
) -> Result<EvidenceManifest, String> {
    if ids.len() > 64 {
        return Err("manifest references at most 64 source observations".into());
    }
    ids.sort_unstable();
    ids.dedup();
    let observations = ids
        .iter()
        .map(|id| observation(*id).ok_or_else(|| format!("unknown source observation {id}")))
        .collect::<Result<Vec<_>, _>>()?;
    let canonical =
        candid::encode_args((1u16, registry_version, &observations)).expect("manifest encoding");
    Ok(EvidenceManifest {
        schema_version: 1,
        registry_version,
        observations,
        manifest_id: sha256(&canonical),
    })
}
