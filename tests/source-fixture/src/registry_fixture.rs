//! Larger projected Registry fixture. Mode 2 corrupts the first returned chunk.
use std::cell::Cell;

use candid::Principal;
use nexus_domain::sha256;
use nexus_ic_sources::registry::{
    transport::{
        HighCapacityRegistryDelta, HighCapacityRegistryGetChangesSinceResponse,
        HighCapacityRegistryValue, LargeValueChunkKeys, high_capacity_registry_value::Content,
    },
    wire::registry::{
        api_boundary_node::v1::ApiBoundaryNodeRecord,
        dc::v1::DataCenterRecord,
        node::v1::NodeRecord,
        node_operator::v1::NodeOperatorRecord,
        replica_version::v1::ReplicaVersionRecord,
        subnet::v1::{SubnetListRecord, SubnetRecord},
        unassigned_nodes_config::v1::UnassignedNodesConfigRecord,
    },
};
use prost::Message;

thread_local! {
    pub static MODE: Cell<u8> = const { Cell::new(0) };
    static METRICS_SUBNETS: std::cell::RefCell<Vec<(Principal, i32)>> = const { std::cell::RefCell::new(vec![]) };
}

#[ic_cdk::update]
fn set_registry_mode(mode: u8) {
    MODE.set(mode);
}

pub fn id(kind: u8, index: u16) -> Principal {
    let mut bytes = [kind; 29];
    bytes[..2].copy_from_slice(&index.to_be_bytes());
    bytes[28] = 2;
    Principal::from_slice(&bytes)
}

pub fn head() -> u64 {
    match MODE.get() {
        2 => 3,
        4 => 6,
        5 => 1,
        _ => 5,
    }
}

pub fn dc() -> Vec<u8> {
    DataCenterRecord {
        id: "example".into(),
        region: "EU,GB,London".into(),
        owner: "Registered owner".into(),
        gps: None,
    }
    .encode_to_vec()
}

pub fn chunks() -> Vec<Vec<u8>> {
    // More than four chunks, including a short final chunk.
    dc().chunks(8).map(<[u8]>::to_vec).collect()
}

#[ic_cdk::update]
fn set_metrics_subnets(subnets: Vec<(Principal, i32)>) {
    METRICS_SUBNETS.set(subnets);
    MODE.set(5);
}

fn metrics_changes(after: u64) -> HighCapacityRegistryGetChangesSinceResponse {
    let mut deltas = vec![];
    if after == 0 {
        METRICS_SUBNETS.with_borrow(|subnets| {
            let make = |key: String, bytes| HighCapacityRegistryDelta {
                key: key.into_bytes(),
                values: vec![HighCapacityRegistryValue {
                    version: 1,
                    timestamp_nanoseconds: 1,
                    content: Some(Content::Value(bytes)),
                }],
            };
            let roster = SubnetListRecord {
                subnets: subnets
                    .iter()
                    .map(|(id, _)| id.as_slice().to_vec())
                    .collect(),
            };
            deltas.push(make("subnet_list".into(), roster.encode_to_vec()));
            for (id, kind) in subnets {
                let record = SubnetRecord {
                    subnet_type: *kind,
                    ..Default::default()
                };
                deltas.push(make(format!("subnet_record_{id}"), record.encode_to_vec()));
            }
        });
    }
    HighCapacityRegistryGetChangesSinceResponse {
        error: None,
        version: 1,
        deltas,
    }
}

pub fn changes(after: u64) -> HighCapacityRegistryGetChangesSinceResponse {
    if MODE.get() == 5 {
        return metrics_changes(after);
    }
    let node = |index: u16| id(21, index);
    let subnet = |index: u16| id(22, index);
    let operator = id(23, 1);
    let one = |key: String, version, content| HighCapacityRegistryDelta {
        key: key.into_bytes(),
        values: vec![HighCapacityRegistryValue {
            version,
            content: Some(content),
            timestamp_nanoseconds: version * 10,
        }],
    };
    let inline = |bytes| Content::Value(bytes);
    let new_node = || {
        one(
            format!("node_record_{}", node(1201)),
            4,
            inline(
                NodeRecord {
                    node_operator_id: operator.as_slice().to_vec(),
                    ..Default::default()
                }
                .encode_to_vec(),
            ),
        )
    };
    let mut deltas = vec![];
    let mut version = 5;
    if after == 0 {
        deltas.push(one(
            "subnet_list".into(),
            1,
            inline(
                SubnetListRecord {
                    subnets: (0..24)
                        .map(|index| subnet(index).as_slice().to_vec())
                        .collect(),
                }
                .encode_to_vec(),
            ),
        ));
        for subnet_index in 0..24 {
            let range = match (MODE.get(), subnet_index) {
                (6, 0) => 0..70,
                (6, 1) => 70..100,
                _ => subnet_index * 50..(subnet_index + 1) * 50,
            };
            let members = range.map(|index| node(index).as_slice().to_vec()).collect();
            let record = SubnetRecord {
                membership: members,
                subnet_type: 1,
                replica_version_id: "release-a".into(),
                ..Default::default()
            };
            deltas.push(one(
                format!("subnet_record_{}", subnet(subnet_index)),
                1,
                inline(record.encode_to_vec()),
            ));
        }
        for index in 0..1200 {
            let record = NodeRecord {
                node_operator_id: operator.as_slice().to_vec(),
                hostos_version_id: Some("configured-hostos".into()),
                ..Default::default()
            };
            deltas.push(one(
                format!("node_record_{}", node(index)),
                1,
                inline(record.encode_to_vec()),
            ));
        }
        let record = NodeOperatorRecord {
            node_operator_principal_id: operator.as_slice().to_vec(),
            node_provider_principal_id: id(24, 1).as_slice().to_vec(),
            dc_id: "Example".into(),
            ..Default::default()
        };
        deltas.push(one(
            format!("node_operator_record_{operator}"),
            1,
            inline(record.encode_to_vec()),
        ));
        deltas.push(one(
            "data_center_record_example".into(),
            1,
            Content::LargeValueChunkKeys(LargeValueChunkKeys {
                chunk_content_sha256s: chunks()
                    .iter()
                    .map(|chunk| sha256(chunk).to_vec())
                    .collect(),
            }),
        ));
        let mut boundary = one(
            format!("api_boundary_node_{}", node(0)),
            1,
            inline(
                ApiBoundaryNodeRecord {
                    version: "release-a".into(),
                }
                .encode_to_vec(),
            ),
        );
        boundary.values.insert(
            0,
            HighCapacityRegistryValue {
                version: 2,
                content: Some(Content::DeletionMarker(true)),
                timestamp_nanoseconds: 20,
            },
        );
        deltas.push(boundary);
        deltas.push(one(
            "unassigned_nodes_config".into(),
            2,
            inline(
                UnassignedNodesConfigRecord {
                    ssh_readonly_access: vec![],
                    replica_version: "release-a".into(),
                }
                .encode_to_vec(),
            ),
        ));
        deltas.push(one(
            "replica_version_release-a".into(),
            2,
            inline(
                ReplicaVersionRecord {
                    replica_version_id: "release-a".into(),
                    ..Default::default()
                }
                .encode_to_vec(),
            ),
        ));
        let mut ignored = one("unrelated_crypto".into(), 4, inline(vec![4]));
        ignored.values.push(HighCapacityRegistryValue {
            version: 3,
            content: Some(inline(vec![3; 140_000])),
            timestamp_nanoseconds: 30,
        });
        deltas.push(ignored);
        deltas.push(new_node());
    } else if after == 3 || after == 4 {
        let mut ignored = one("unrelated_crypto".into(), 5, inline(vec![5]));
        if after == 3 {
            deltas.push(new_node());
            ignored.values.push(HighCapacityRegistryValue {
                version: 4,
                content: Some(inline(vec![4])),
                timestamp_nanoseconds: 40,
            });
        }
        deltas.push(ignored);
    } else if after == 5 && MODE.get() == 4 {
        version = 6;
        deltas.push(one(
            format!("node_record_{}", node(1201)),
            6,
            inline(vec![0xff]),
        ));
    }
    HighCapacityRegistryGetChangesSinceResponse {
        error: None,
        version,
        deltas,
    }
}
