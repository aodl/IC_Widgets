use candid::{CandidType, Principal};
use nexus_domain::{Hash, MembershipAction};
use nexus_ic_sources::registry::{Key, RecordSummary, VersionSpan};
use serde::Deserialize;

#[derive(Clone, Debug, CandidType, Deserialize)]
pub struct ProbeRequest {
    pub proposal_id: Option<u64>,
    pub registry_subnet: Option<Principal>,
    pub remote_subnet: Option<Principal>,
    pub metrics_start_nanos: u64,
}

#[derive(Clone, Copy, CandidType, Deserialize)]
pub struct Sources {
    pub governance: Principal,
    pub registry: Principal,
}

impl Sources {
    pub fn canonical() -> Self {
        Self {
            governance: Principal::from_text("rrkah-fqaaa-aaaaa-aaaaq-cai").unwrap(),
            registry: Principal::from_text("rwlgt-iiaaa-aaaaa-aaaaa-cai").unwrap(),
        }
    }
}

#[derive(Clone, Debug, CandidType, Deserialize)]
pub enum Step {
    List {
        before: Option<u64>,
        omit_large_fields: bool,
        limit: u32,
    },
    Proposal(u64),
    Head,
    Changes {
        after: u64,
        remaining: u8,
    },
    Value {
        key: Key,
        at: u64,
    },
    Chunk(ChunkPlan),
    SubnetInfo(Principal),
    Metrics {
        subnet: Principal,
        start: u64,
        expected_boundary_hash: Option<Hash>,
    },
}

#[derive(Clone, Debug, CandidType, Deserialize)]
pub struct ChunkPlan {
    pub key: Option<Key>,
    pub registry_key: String,
    pub at: u64,
    pub mutation_version: u64,
    pub timestamp_nanos: Option<u64>,
    pub hashes: Vec<Hash>,
    pub prior_receipts: Vec<u32>,
}

#[derive(Clone, CandidType, Deserialize)]
pub struct Job {
    pub id: u64,
    pub request: ProbeRequest,
    pub caller_subnet: Principal,
    pub captured_head: Option<u64>,
    pub auto_remote: Option<Principal>,
    pub page_chunk_attempted: bool,
    pub pending: Vec<Step>,
    pub receipt_count: u32,
    pub attempts: u8,
    pub generation: u64,
    pub in_flight: bool,
    pub wake_at_nanos: u64,
    pub stop_reason: Option<String>,
    pub started_at_nanos: u64,
    pub completed_at_nanos: Option<u64>,
}

#[derive(Clone, Debug, CandidType, Deserialize)]
pub struct ListedProposal {
    pub id: u64,
    pub function: Option<i32>,
    pub listed_payload_bytes: Option<u32>,
}

#[derive(Clone, Debug, CandidType, Deserialize)]
pub enum Observation {
    ProposalList(Vec<ListedProposal>),
    Proposal {
        id: u64,
        status: i32,
        topic: i32,
        proposal_time_seconds: u64,
        executed_time_seconds: Option<u64>,
        function: Option<i32>,
        payload_bytes: Option<u32>,
        payload_hash: Option<Hash>,
        membership: Option<MembershipAction>,
        payload_decode_error: Option<String>,
    },
    RegistryHead(u64),
    RegistryPage(VersionSpan),
    RegistryValue {
        key: Key,
        requested_version: u64,
        mutation_version: u64,
        source_timestamp_nanos: Option<u64>,
        record: RecordSummary,
    },
    RegistryChunks {
        registry_key: String,
        mutation_version: u64,
        hashes: Vec<Hash>,
    },
    Chunk {
        hash: Hash,
        bytes: u32,
        assembled: Option<Assembled>,
    },
    SubnetInfo {
        subnet: Principal,
        replica_version: String,
        registry_version: u64,
    },
    Metrics {
        subnet: Principal,
        requested_start_nanos: u64,
        sample_count: u32,
        first_timestamp_nanos: Option<u64>,
        last_timestamp_nanos: Option<u64>,
        minimum_rows: Option<u32>,
        maximum_rows: Option<u32>,
        first_sample_hash: Option<Hash>,
        overlap_matches: Option<bool>,
    },
    Unavailable,
    InvalidResponse(String),
    Rejected {
        code: Option<u32>,
        retryable: bool,
        message: String,
    },
}

#[derive(Clone, Debug, CandidType, Deserialize)]
pub struct Assembled {
    pub hash: Hash,
    pub bytes: u32,
    pub record: Option<RecordSummary>,
}

#[derive(Clone, Debug, CandidType, Deserialize)]
pub struct Receipt {
    pub job_id: u64,
    pub index: u32,
    pub attempt: u8,
    pub calling_canister: Principal,
    pub calling_subnet: Principal,
    pub source: Principal,
    pub method: String,
    pub request: Vec<u8>,
    pub sent_at_nanos: u64,
    pub received_at_nanos: u64,
    pub cycles_before: u128,
    pub cycles_at_callback: u128,
    pub raw_bytes: Option<u32>,
    pub raw_hash: Option<Hash>,
    pub decoder_revision: String,
    pub observation: Observation,
}
