use std::collections::{BTreeMap, BTreeSet};

use candid::{CandidType, Principal};
use nexus_domain::{Hash, sha256};
use prost::Message;
use serde::Deserialize;

pub mod wire {
    include!(concat!(env!("OUT_DIR"), "/registry.rs"));
}

use transport::{
    HighCapacityRegistryGetChangesSinceResponse, HighCapacityRegistryGetValueResponse,
    RegistryGetChangesSinceRequest, RegistryGetLatestVersionResponse, RegistryGetValueRequest,
    high_capacity_registry_get_value_response, high_capacity_registry_value,
};
pub use wire::ic_registry_transport::pb::v1 as transport;

pub const MAX_CHUNKS: usize = 4;
pub const MAX_RECORD_BYTES: usize = 6 * 1024 * 1024;
pub const MISSING_KEY: &str = "network_nexus_m0_missing_key";

#[derive(Clone, Debug, CandidType, Deserialize, PartialEq, Eq)]
pub enum Key {
    SubnetList,
    Subnet(Principal),
    Node(Principal),
    Operator(Principal),
    DataCenter(String),
    MissingProbe,
}

impl Key {
    pub fn registry_name(&self) -> String {
        match self {
            Self::SubnetList => "subnet_list".into(),
            Self::Subnet(id) => format!("subnet_record_{id}"),
            Self::Node(id) => format!("node_record_{id}"),
            Self::Operator(id) => format!("node_operator_record_{id}"),
            Self::DataCenter(id) => format!("data_center_record_{}", id.to_lowercase()),
            Self::MissingProbe => MISSING_KEY.into(),
        }
    }
}

pub fn head(bytes: &[u8]) -> Result<u64, String> {
    let result = RegistryGetLatestVersionResponse::decode(bytes).map_err(|err| err.to_string())?;
    Ok(result.version)
}

pub fn changes_request(version: u64) -> Vec<u8> {
    RegistryGetChangesSinceRequest { version }.encode_to_vec()
}

pub fn value_request(key: &Key, version: u64) -> Vec<u8> {
    RegistryGetValueRequest {
        key: key.registry_name().into_bytes(),
        version: Some(version),
    }
    .encode_to_vec()
}

#[derive(Clone, Debug, CandidType, Deserialize, PartialEq, Eq)]
pub struct VersionSpan {
    pub requested_after: u64,
    pub delivered_through: u64,
    pub observed_head: u64,
    pub distinct_keys: u32,
    pub mutations: u32,
    pub tombstones: u32,
    pub chunked_mutations: u32,
}

pub struct Page {
    pub span: VersionSpan,
    /// One source-derived chunk candidate for the diagnostic.
    pub chunk_example: Option<(Vec<u8>, u64, Vec<Hash>)>,
}

/// Validate whole contiguous version ranges independently of per-key wire order.
pub fn decode_changes(bytes: &[u8], after: u64) -> Result<Page, String> {
    use high_capacity_registry_value::Content;

    let page = HighCapacityRegistryGetChangesSinceResponse::decode(bytes)
        .map_err(|err| err.to_string())?;
    if let Some(error) = page.error {
        return Err(format!(
            "Registry changes error {}: {}",
            error.code, error.reason
        ));
    }
    let mut records = BTreeMap::new();
    let mut versions = BTreeSet::new();
    let mut keys = BTreeSet::new();
    let mut span = VersionSpan {
        requested_after: after,
        delivered_through: after,
        observed_head: page.version,
        distinct_keys: 0,
        mutations: 0,
        tombstones: 0,
        chunked_mutations: 0,
    };
    let mut chunk_example = None;
    if page.version < after {
        return Err("Registry head precedes the requested cursor".into());
    }
    for delta in &page.deltas {
        if delta.key.is_empty() || delta.values.is_empty() {
            return Err("empty Registry delta".into());
        }
        keys.insert(delta.key.as_slice());
        for value in &delta.values {
            let version = value.version;
            if version <= after || version > page.version {
                return Err("Registry mutation lies outside requested range".into());
            }
            if let Some(old) = records.insert((version, delta.key.as_slice()), value) {
                if old != value {
                    return Err("conflicting Registry mutations for one key/version".into());
                }
                continue;
            }
            versions.insert(version);
            span.mutations += 1;
            match value.content.as_ref() {
                Some(Content::DeletionMarker(true)) => span.tombstones += 1,
                Some(Content::Value(_)) => (),
                Some(Content::LargeValueChunkKeys(hashes)) => {
                    span.chunked_mutations += 1;
                    if hashes.chunk_content_sha256s.is_empty()
                        || hashes
                            .chunk_content_sha256s
                            .iter()
                            .any(|hash| hash.len() != 32)
                    {
                        return Err("invalid Registry chunk reference".into());
                    }
                    if hashes.chunk_content_sha256s.len() <= MAX_CHUNKS {
                        let candidate = (delta.key.clone(), version, chunk_hashes(hashes)?);
                        if chunk_example
                            .as_ref()
                            .is_none_or(|previous| &candidate < previous)
                        {
                            chunk_example = Some(candidate);
                        }
                    }
                }
                _ => return Err("missing or invalid Registry mutation content".into()),
            }
        }
    }
    span.distinct_keys = keys.len() as u32;
    if versions.len() > 1_000 {
        return Err("Registry page exceeds the pinned 1,000-version contract".into());
    }
    for version in versions {
        if span.delivered_through.checked_add(1) != Some(version) {
            return Err("Registry page contains a version gap".into());
        }
        span.delivered_through = version;
    }
    if span.delivered_through == after && after < page.version {
        return Err("Registry head is ahead but the page made no progress".into());
    }
    Ok(Page {
        span,
        chunk_example,
    })
}

fn chunk_hashes(keys: &transport::LargeValueChunkKeys) -> Result<Vec<Hash>, String> {
    if keys.chunk_content_sha256s.is_empty() || keys.chunk_content_sha256s.len() > MAX_CHUNKS {
        return Err("Registry record exceeds the probe chunk-count budget".into());
    }
    keys.chunk_content_sha256s
        .iter()
        .map(|hash| {
            hash.as_slice()
                .try_into()
                .map_err(|_| "invalid Registry chunk hash length".into())
        })
        .collect()
}

pub struct Record {
    pub version: u64,
    pub timestamp_nanos: Option<u64>,
    pub content: ValueContent,
}

pub enum ValueContent {
    Inline(Vec<u8>),
    Chunked(Vec<Hash>),
}

pub fn decode_value(bytes: &[u8], key: &Key, requested: u64) -> Result<Option<Record>, String> {
    use high_capacity_registry_get_value_response::Content;

    let response =
        HighCapacityRegistryGetValueResponse::decode(bytes).map_err(|err| err.to_string())?;
    if let Some(error) = response.error {
        if error.code == transport::registry_error::Code::KeyNotPresent as i32
            && error.key == key.registry_name().as_bytes()
        {
            return Ok(None);
        }
        return Err(format!(
            "Registry value error {}: {}",
            error.code, error.reason
        ));
    }
    if response.version == 0 || response.version > requested {
        return Err("Registry record version is invalid for the requested snapshot".into());
    }
    let content = match response.content.ok_or("missing Registry record content")? {
        Content::Value(bytes) => ValueContent::Inline(bytes),
        Content::LargeValueChunkKeys(keys) => ValueContent::Chunked(chunk_hashes(&keys)?),
    };
    Ok(Some(Record {
        version: response.version,
        timestamp_nanos: (response.timestamp_nanoseconds != 0)
            .then_some(response.timestamp_nanoseconds),
        content,
    }))
}

#[derive(CandidType, Deserialize)]
pub struct ChunkRequest {
    pub content_sha256: Option<Vec<u8>>,
}

#[derive(CandidType, Deserialize)]
pub struct Chunk {
    pub content: Option<Vec<u8>>,
}

pub fn chunk_bytes(bytes: &[u8], expected: Hash) -> Result<Vec<u8>, String> {
    let chunk: Result<Chunk, String> = crate::decode_candid(bytes)?;
    let content = chunk?.content.ok_or("Registry chunk has no content")?;
    if sha256(&content) != expected {
        return Err("Registry chunk hash mismatch".into());
    }
    Ok(content)
}

#[derive(Clone, Debug, CandidType, Deserialize, PartialEq, Eq)]
pub enum RecordSummary {
    SubnetList {
        count: u32,
        first: Option<Principal>,
    },
    Subnet {
        subnet_type: i32,
        configured_version: String,
        member_count: u32,
        first: Option<Principal>,
    },
    Node {
        operator: Principal,
    },
    Operator {
        provider: Principal,
        dc: String,
    },
    DataCenter {
        id: String,
        region: String,
        registered_owner: String,
        has_gps: bool,
    },
}

pub fn summarize(key: &Key, bytes: &[u8]) -> Result<RecordSummary, String> {
    use wire::registry::{
        dc::v1::DataCenterRecord,
        node::v1::NodeRecord,
        node_operator::v1::NodeOperatorRecord,
        subnet::v1::{SubnetListRecord, SubnetRecord},
    };
    let decode_error = |err: prost::DecodeError| err.to_string();

    match key {
        Key::SubnetList => {
            let record = SubnetListRecord::decode(bytes).map_err(decode_error)?;
            let first = validate_principals(&record.subnets)?;
            Ok(RecordSummary::SubnetList {
                count: record.subnets.len() as u32,
                first,
            })
        }
        Key::Subnet(_) => {
            let record = SubnetRecord::decode(bytes).map_err(decode_error)?;
            let first = validate_principals(&record.membership)?;
            Ok(RecordSummary::Subnet {
                subnet_type: record.subnet_type,
                configured_version: record.replica_version_id,
                member_count: record.membership.len() as u32,
                first,
            })
        }
        Key::Node(_) => {
            let record = NodeRecord::decode(bytes).map_err(decode_error)?;
            Ok(RecordSummary::Node {
                operator: principal(&record.node_operator_id)?,
            })
        }
        Key::Operator(id) => {
            let record = NodeOperatorRecord::decode(bytes).map_err(decode_error)?;
            if principal(&record.node_operator_principal_id)? != *id {
                return Err("operator record does not match its Registry key".into());
            }
            if record.dc_id.is_empty() || record.dc_id.len() > 128 {
                return Err("invalid or missing registered DC identifier".into());
            }
            Ok(RecordSummary::Operator {
                provider: principal(&record.node_provider_principal_id)?,
                dc: record.dc_id,
            })
        }
        Key::DataCenter(id) => {
            let record = DataCenterRecord::decode(bytes).map_err(decode_error)?;
            if record.id.to_lowercase() != id.to_lowercase() {
                return Err("data-center record does not match its Registry key".into());
            }
            Ok(RecordSummary::DataCenter {
                id: record.id,
                region: record.region,
                registered_owner: record.owner,
                has_gps: record.gps.is_some(),
            })
        }
        Key::MissingProbe => Err("sentinel key unexpectedly exists".into()),
    }
}

fn principal(bytes: &[u8]) -> Result<Principal, String> {
    if bytes.is_empty() {
        return Err("empty Registry principal".into());
    }
    Principal::try_from_slice(bytes).map_err(|err| err.to_string())
}

fn validate_principals(ids: &[Vec<u8>]) -> Result<Option<Principal>, String> {
    for id in ids {
        principal(id)?;
    }
    ids.first().map(|id| principal(id)).transpose()
}

#[cfg(test)]
mod tests {
    use super::*;
    use transport::{
        HighCapacityRegistryDelta, HighCapacityRegistryValue, high_capacity_registry_value::Content,
    };

    fn delta(key: &[u8], history: Vec<(u64, Content)>) -> HighCapacityRegistryDelta {
        HighCapacityRegistryDelta {
            key: key.to_vec(),
            values: history
                .into_iter()
                .map(|(version, content)| HighCapacityRegistryValue {
                    version,
                    content: Some(content),
                    timestamp_nanoseconds: 0,
                })
                .collect(),
        }
    }

    fn page(deltas: Vec<HighCapacityRegistryDelta>) -> Vec<u8> {
        HighCapacityRegistryGetChangesSinceResponse {
            error: None,
            version: 150,
            deltas,
        }
        .encode_to_vec()
    }

    #[test]
    fn complete_versions_use_all_families_and_preserve_deletions() {
        let bytes = page(vec![
            delta(
                b"subnet_list",
                vec![
                    (102, Content::DeletionMarker(true)),
                    (101, Content::Value(vec![1])),
                ],
            ),
            delta(
                b"ignored",
                vec![
                    (103, Content::Value(vec![2])),
                    (101, Content::Value(vec![3])),
                ],
            ),
        ]);
        let result = decode_changes(&bytes, 100).unwrap();
        assert_eq!(result.span.delivered_through, 103);
        assert_eq!(result.span.observed_head, 150);
        assert_eq!(result.span.tombstones, 1);
        assert_eq!(result.span.mutations, 4);
    }

    #[test]
    fn empty_gap_conflict_and_invalid_tombstone_are_errors() {
        for bytes in [
            page(vec![]),
            page(vec![delta(b"k", vec![(102, Content::Value(vec![2]))])]),
            page(vec![delta(
                b"k",
                vec![
                    (101, Content::Value(vec![1])),
                    (101, Content::Value(vec![2])),
                ],
            )]),
            page(vec![delta(
                b"k",
                vec![(101, Content::DeletionMarker(false))],
            )]),
        ] {
            assert!(decode_changes(&bytes, 100).is_err());
        }
    }

    #[test]
    fn identical_wire_duplicates_are_coalesced() {
        let entry = delta(b"k", vec![(101, Content::Value(vec![1]))]);
        assert_eq!(
            decode_changes(&page(vec![entry.clone(), entry]), 100)
                .unwrap()
                .span
                .mutations,
            1
        );
    }

    #[test]
    fn chunk_integrity_rejects_mismatch_missing_content_and_source_error() {
        let expected = sha256(b"record");
        let reply = |content: Option<Vec<u8>>| {
            candid::encode_one(Ok::<Chunk, String>(Chunk { content })).unwrap()
        };
        assert_eq!(
            chunk_bytes(&reply(Some(b"record".to_vec())), expected).unwrap(),
            b"record"
        );
        assert!(chunk_bytes(&reply(Some(b"wrong".to_vec())), expected).is_err());
        assert!(chunk_bytes(&reply(None), expected).is_err());
        assert!(
            chunk_bytes(
                &candid::encode_one(Err::<Chunk, _>("missing")).unwrap(),
                expected
            )
            .is_err()
        );
    }
}
