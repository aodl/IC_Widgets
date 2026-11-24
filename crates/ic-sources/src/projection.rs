use candid::{CandidType, Principal};
use nexus_domain::Hash;
use prost::Message;
use serde::Deserialize;

use crate::registry::{principal, wire::registry as pb};

pub const MAX_CHUNKS: usize = 16;
pub const MAX_RECORD_BYTES: usize = 16 * 1024 * 1024;
pub const MAX_PAGE_MUTATIONS: u32 = 40_000;
pub const DECODER_REVISION: &str = "m1.2-registry";

#[derive(Clone, Debug, CandidType, Deserialize, PartialEq, Eq)]
pub enum RecordKey {
    SubnetList,
    Subnet(Principal),
    Node(Principal),
    Operator(Principal),
    DataCenter(String),
    ApiBoundary(Principal),
    UnassignedConfig,
    ReplicaVersion(String),
    StandardEngineVersion,
}

impl RecordKey {
    pub fn name(&self) -> String {
        match self {
            Self::SubnetList => "subnet_list".into(),
            Self::Subnet(id) => format!("subnet_record_{id}"),
            Self::Node(id) => format!("node_record_{id}"),
            Self::Operator(id) => format!("node_operator_record_{id}"),
            Self::DataCenter(id) => format!("data_center_record_{}", id.to_lowercase()),
            Self::ApiBoundary(id) => format!("api_boundary_node_{id}"),
            Self::UnassignedConfig => "unassigned_nodes_config".into(),
            Self::ReplicaVersion(id) => format!("replica_version_{id}"),
            Self::StandardEngineVersion => "standard_engine_replica_version".into(),
        }
    }

    pub fn parse(raw: &[u8]) -> Result<Option<Self>, String> {
        let Ok(key) = std::str::from_utf8(raw) else {
            // A relevant prefix followed by invalid UTF-8 is a corrupt key.
            return if [
                b"subnet_record_".as_slice(),
                b"node_record_",
                b"node_operator_record_",
                b"data_center_record_",
                b"api_boundary_node_",
                b"replica_version_",
            ]
            .iter()
            .any(|prefix| raw.starts_with(prefix))
            {
                Err("malformed projected Registry key".into())
            } else {
                Ok(None)
            };
        };
        let singleton = match key {
            "subnet_list" => Some(Self::SubnetList),
            "unassigned_nodes_config" => Some(Self::UnassignedConfig),
            "standard_engine_replica_version" => Some(Self::StandardEngineVersion),
            _ => None,
        };
        if singleton.is_some() {
            return Ok(singleton);
        }
        type PrincipalFamily = (&'static str, fn(Principal) -> RecordKey);
        let principal_families: [PrincipalFamily; 4] = [
            ("subnet_record_", Self::Subnet),
            ("node_record_", Self::Node),
            ("node_operator_record_", Self::Operator),
            ("api_boundary_node_", Self::ApiBoundary),
        ];
        for (prefix, constructor) in principal_families {
            if let Some(suffix) = key.strip_prefix(prefix) {
                let id = Principal::from_text(suffix)
                    .map_err(|_| "invalid principal in Registry key")?;
                if id.as_slice().is_empty() || id.to_text() != suffix {
                    return Err("noncanonical Registry principal key".into());
                }
                return Ok(Some(constructor(id)));
            }
        }
        for (prefix, constructor) in [
            (
                "data_center_record_",
                Self::DataCenter as fn(String) -> Self,
            ),
            ("replica_version_", Self::ReplicaVersion),
        ] {
            if let Some(suffix) = key.strip_prefix(prefix) {
                if suffix.is_empty() || suffix.len() > 256 {
                    return Err("invalid Registry key suffix".into());
                }
                let parsed = constructor(suffix.into());
                if parsed.name() != key {
                    return Err("noncanonical Registry key".into());
                }
                return Ok(Some(parsed));
            }
        }
        Ok(None)
    }
}

#[derive(Clone, Debug, CandidType, Deserialize)]
pub struct Mutation {
    pub key: RecordKey,
    pub version: u64,
    pub source_time: Option<u64>,
    pub value: Content,
}

#[derive(Clone, Debug, CandidType, Deserialize)]
pub enum Content {
    Value(Vec<u8>),
    Deleted,
    Chunks(Vec<Hash>),
}

#[derive(Clone, CandidType, Deserialize)]
pub struct Endpoint {
    pub ip: String,
    pub port: u32,
}

#[derive(Clone, CandidType, Deserialize)]
pub struct Position {
    pub latitude: f32,
    pub longitude: f32,
}

#[derive(Clone, CandidType, Deserialize)]
pub enum Details {
    SubnetList(Vec<Principal>),
    Subnet {
        members: Vec<Principal>,
        kind: i32,
        configured_version: String,
        halted: bool,
        sev_enabled: Option<bool>,
    },
    Node {
        operator: Option<Principal>,
        http: Option<Endpoint>,
        xnet: Option<Endpoint>,
        domain: Option<String>,
        hostos: Option<String>,
        ipv4: Option<String>,
        reward_type: Option<i32>,
        has_chip_id: Option<bool>,
    },
    Operator {
        provider: Option<Principal>,
        data_center: String,
        allowance: u64,
    },
    DataCenter {
        id: String,
        registered_region: String,
        registered_owner: String,
        gps: Option<Position>,
    },
    ApiBoundary {
        configured_version: String,
    },
    UnassignedConfig {
        configured_version: String,
    },
    ReplicaVersion {
        archive_hash: String,
        archive_urls: Vec<String>,
    },
    StandardEngineVersion {
        new_version: String,
        old_version: String,
        deployment_progress: f64,
    },
}

pub enum DecodedRecord {
    Present(Details),
    Opaque(&'static str),
}

pub fn decode_record(key: &RecordKey, value: &[u8]) -> Result<DecodedRecord, String> {
    let err = |err: prost::DecodeError| err.to_string();
    let principal_list = |members: &[Vec<u8>], max: usize| -> Result<Vec<Principal>, String> {
        if members.len() > max {
            return Err("projected membership exceeds operational bound".into());
        }
        members.iter().map(|id| principal(id)).collect()
    };
    let optional_principal =
        |bytes: &[u8]| (!bytes.is_empty()).then(|| principal(bytes)).transpose();
    let endpoint = |record: pb::node::v1::ConnectionEndpoint| Endpoint {
        ip: record.ip_addr,
        port: record.port,
    };
    Ok(DecodedRecord::Present(match key {
        RecordKey::SubnetList => {
            let record = pb::subnet::v1::SubnetListRecord::decode(value).map_err(err)?;
            let mut ids = principal_list(&record.subnets, 512)?;
            ids.sort_unstable();
            if ids.windows(2).any(|pair| pair[0] == pair[1]) {
                return Err("duplicate subnet in Registry roster".into());
            }
            Details::SubnetList(ids)
        }
        RecordKey::Subnet(_) => {
            let record = pb::subnet::v1::SubnetRecord::decode(value).map_err(err)?;
            let members = principal_list(&record.membership, 2048)?;
            Details::Subnet {
                members,
                kind: record.subnet_type,
                configured_version: record.replica_version_id,
                halted: record.is_halted,
                sev_enabled: Some(
                    record
                        .features
                        .is_some_and(|features| features.sev_enabled == Some(true)),
                ),
            }
        }
        RecordKey::Node(_) => {
            let record = pb::node::v1::NodeRecord::decode(value).map_err(err)?;
            Details::Node {
                operator: optional_principal(&record.node_operator_id)?,
                http: record.http.map(endpoint),
                xnet: record.xnet.map(endpoint),
                domain: record.domain,
                hostos: record.hostos_version_id,
                ipv4: record.public_ipv4_config.map(|record| record.ip_addr),
                reward_type: record.node_reward_type,
                has_chip_id: Some(record.chip_id.is_some()),
            }
        }
        RecordKey::Operator(id) => {
            let record = pb::node_operator::v1::NodeOperatorRecord::decode(value).map_err(err)?;
            let provider = optional_principal(&record.node_provider_principal_id)?;
            if optional_principal(&record.node_operator_principal_id)?
                .is_some_and(|embedded| embedded != *id)
            {
                // Historical Registry updates (first observed at 48,021) can
                // contain conflicting identities. Keep the value without joins.
                return Ok(DecodedRecord::Opaque(
                    "operator record principal disagrees with key",
                ));
            }
            Details::Operator {
                provider,
                data_center: record.dc_id,
                allowance: record.node_allowance,
            }
        }
        RecordKey::DataCenter(id) => {
            let record = pb::dc::v1::DataCenterRecord::decode(value).map_err(err)?;
            if record.id.to_lowercase() != id.to_lowercase() {
                return Err("data center record disagrees with key".into());
            }
            Details::DataCenter {
                id: record.id,
                registered_region: record.region,
                registered_owner: record.owner,
                gps: record.gps.map(|gps| Position {
                    latitude: gps.latitude,
                    longitude: gps.longitude,
                }),
            }
        }
        RecordKey::ApiBoundary(_) => {
            let record =
                pb::api_boundary_node::v1::ApiBoundaryNodeRecord::decode(value).map_err(err)?;
            Details::ApiBoundary {
                configured_version: record.version,
            }
        }
        RecordKey::UnassignedConfig => {
            let record =
                pb::unassigned_nodes_config::v1::UnassignedNodesConfigRecord::decode(value)
                    .map_err(err)?;
            Details::UnassignedConfig {
                configured_version: record.replica_version,
            }
        }
        RecordKey::ReplicaVersion(id) => {
            let record =
                pb::replica_version::v1::ReplicaVersionRecord::decode(value).map_err(err)?;
            if !record.replica_version_id.is_empty() && record.replica_version_id != *id {
                return Err("replica version record disagrees with key".into());
            }
            Details::ReplicaVersion {
                archive_hash: record.release_package_sha256_hex,
                archive_urls: record.release_package_urls,
            }
        }
        RecordKey::StandardEngineVersion => {
            let record = pb::standard_engine_replica_version::v1::StandardEngineReplicaVersionRecord::decode(value).map_err(err)?;
            Details::StandardEngineVersion {
                new_version: record.new_replica_version_id,
                old_version: record.old_replica_version_id,
                deployment_progress: record.deployment_progress,
            }
        }
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn malformed_membership_and_operator_principals_are_errors() {
        let id = Principal::from_slice(&[1, 2]);
        let oversized_principal = vec![1; 30];
        let subnet = pb::subnet::v1::SubnetRecord {
            membership: vec![oversized_principal.clone()],
            ..Default::default()
        };
        let operator = pb::node_operator::v1::NodeOperatorRecord {
            node_operator_principal_id: vec![2, 2],
            node_provider_principal_id: oversized_principal,
            ..Default::default()
        };
        assert!(decode_record(&RecordKey::Subnet(id), &subnet.encode_to_vec()).is_err());
        assert!(decode_record(&RecordKey::Operator(id), &operator.encode_to_vec()).is_err());
    }
}
