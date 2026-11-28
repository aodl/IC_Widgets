#[path = "../src/historical.rs"]
mod historical;

use std::collections::{BTreeMap, BTreeSet};

use candid::{decode_args, decode_one, encode_one};
use nexus_domain::{MembershipAction, sha256};
use nexus_ic_sources::{
    governance::{BoundaryAction, ProposalInfo, boundary_action, membership},
    projection::RecordKey,
    registry::transport::{HighCapacityRegistryGetValueResponse, registry_error},
};
use prost::Message;
use serde_json::Value;

#[test]
fn indexed_payloads_keep_exact_principals_and_action_families() {
    let catalogue: Value = serde_json::from_str(include_str!("../data/catalogue.json")).unwrap();
    let ids = |wire: &Value| {
        wire.as_array()
            .unwrap()
            .iter()
            .map(|row| historical::principal(row.as_str().unwrap()))
            .collect::<Vec<_>>()
    };
    for row in catalogue["proposals"].as_array().unwrap() {
        let id = row["proposal_id"].as_str().unwrap();
        let raw: Value = serde_json::from_slice(historical::indexed(id).unwrap()).unwrap();
        assert_eq!(raw["proposal_id"].as_u64(), Some(historical::decimal(id)));
        let p = &raw["payload"];
        for field in [
            "node_ids",
            "node_ids_add",
            "node_ids_remove",
            "replacement_nodes",
        ] {
            if p[field].is_array() {
                assert_eq!(ids(&p[field]).len(), p[field].as_array().unwrap().len());
            }
        }
        let function = row["function_id"].as_i64().unwrap() as i32;
        let Some(wire) = historical::action(function, p) else {
            assert_eq!(row["support"], "catalogue-only");
            continue;
        };
        let change = membership(&wire).unwrap();
        let boundary = boundary_action(&wire).unwrap();
        let subnet = || historical::principal(p["subnet_id"].as_str().unwrap());
        match function {
            31 => assert_eq!(
                change,
                Some(MembershipAction::Change {
                    subnet: subnet(),
                    add: ids(&p["node_ids_add"]),
                    remove: ids(&p["node_ids_remove"]),
                })
            ),
            2 => assert_eq!(
                change,
                Some(MembershipAction::Add {
                    subnet: subnet(),
                    nodes: ids(&p["node_ids"])
                })
            ),
            13 => assert_eq!(
                change,
                Some(MembershipAction::Remove {
                    nodes: ids(&p["node_ids"])
                })
            ),
            43 | 44 | 47 => {
                assert_eq!(change, None);
                let nodes = ids(&p["node_ids"]);
                let version = || p["version"].as_str().unwrap().to_owned();
                let expected = match function {
                    43 => BoundaryAction::Add {
                        nodes,
                        version: version(),
                    },
                    44 => BoundaryAction::Remove { nodes },
                    _ => BoundaryAction::DeployVersion {
                        nodes,
                        version: version(),
                    },
                };
                assert_eq!(boundary, Some(expected));
                continue;
            }
            18 => assert_eq!(change, None),
            _ => panic!("unexpected action {function}"),
        }
        assert_eq!(boundary, None);
    }

    let add: Value = serde_json::from_slice(historical::indexed("134902").unwrap()).unwrap();
    assert_eq!(ids(&add["payload"]["node_ids"]).len(), 17);
    let legacy = historical::action(46, &add["payload"]).unwrap();
    assert!(matches!(
        boundary_action(&legacy),
        Ok(Some(BoundaryAction::LegacyVersion { .. }))
    ));
    let remove: Value = serde_json::from_slice(historical::indexed("134994").unwrap()).unwrap();
    let remove = historical::action(44, &remove["payload"]).unwrap();
    let Some(BoundaryAction::Remove { nodes }) = boundary_action(&remove).unwrap() else {
        panic!()
    };
    // Keep distinct key families when removing a boundary role from these registered nodes.
    let mut registry = BTreeSet::new();
    for node in nodes {
        let role = RecordKey::ApiBoundary(node).name();
        let record = RecordKey::Node(node).name();
        assert!(role.starts_with("api_boundary_node_"));
        registry.insert(role.clone());
        registry.insert(record.clone());
        assert!(registry.remove(&role));
        assert!(registry.contains(&record));
    }
}

#[test]
fn recorded_reply_and_constructed_lifecycles_remain_distinct() {
    let original: Option<ProposalInfo> =
        decode_one(include_bytes!("../data/144954/governance.didbin")).unwrap();
    let original = original.unwrap();
    let terminal = historical::proposal("144954", 31, "indexed-executed");
    assert_eq!(original.status, 1);
    assert_eq!(terminal.status, 4);
    assert_eq!(original.executed_timestamp_seconds, 0);
    assert_eq!(terminal.executed_timestamp_seconds, 1_795_679_157);
    assert_eq!(
        membership(original.executable().unwrap()),
        membership(terminal.executable().unwrap())
    );

    for case in historical::cases() {
        assert!(!case.id.is_empty());
        match &case.registry {
            historical::Baseline::CapturedWithOverlay => (),
            historical::Baseline::ActivityArchive => {
                let row: Option<ProposalInfo> =
                    decode_one(historical::activity_capture(&case.proposal_ids[0]).unwrap())
                        .unwrap();
                assert_eq!(row.unwrap().status, 1);
            }
            historical::Baseline::Synthetic {
                version,
                mutation_version,
                roster,
                subnets,
            } => {
                assert!(historical::decimal(mutation_version) < historical::decimal(version));
                for id in roster {
                    historical::principal(id);
                }
                for (subnet, members) in subnets {
                    assert!(roster.contains(subnet));
                    for node in members {
                        historical::principal(node);
                    }
                }
            }
        }
        if let Some(fault) = &case.fault {
            assert!(!fault.is_empty());
        }
        let mut activity_ids = BTreeSet::new();
        for activity in &case.activity {
            let id = historical::decimal(&activity.id);
            assert!(activity_ids.insert(id), "duplicate Activity proposal #{id}");
            let full = activity.info(false);
            let listed = activity.info(true);
            assert_eq!(full.id.unwrap().id, id);
            assert_eq!(listed.id.unwrap().id, id);
            if let Some(executable) = full.executable() {
                let listed = listed.executable().unwrap();
                assert_eq!(listed.nns_function, executable.nns_function);
                if activity.omit_list_payload {
                    assert!(listed.payload.is_empty());
                } else {
                    assert_eq!(listed.payload, executable.payload);
                }
            }
        }
        if case.lifecycle != "recorded-open" {
            let proposals = case
                .proposal_ids
                .iter()
                .zip(case.function_ids)
                .map(|(id, function)| {
                    let info = match case.activity.iter().find(|activity| &activity.id == id) {
                        Some(activity) => {
                            assert_eq!(activity.function, Some(function));
                            activity.info(false)
                        }
                        None => historical::proposal(id, function, &case.lifecycle),
                    };
                    let id = info.id.unwrap().id;
                    (id, encode_one(Some(info)).unwrap())
                })
                .collect();
            let candidates = historical::requested(&proposals);
            assert_eq!(candidates.is_empty(), case.id == "boundary-software-144909");
        }
    }
}

#[test]
fn recorded_registry_replies_match_each_capture_receipt() {
    let (pin, rows): (u64, BTreeMap<String, Vec<u8>>) =
        decode_args(include_bytes!("../data/144954/registry.didbin")).unwrap();
    let capture: Value = serde_json::from_str(include_str!("../data/144954/capture.json")).unwrap();
    assert_eq!(pin, 66_013);
    assert_eq!(rows.len(), capture["records"].as_object().unwrap().len());
    assert!(!rows.contains_key("nns_subnet_id"));
    let mut older = false;
    let mut absent = 0;
    for (key, wire) in rows {
        let hash: String = sha256(&wire).iter().map(|b| format!("{b:02x}")).collect();
        assert_eq!(hash, capture["records"][&key]["sha256"]);
        let reply = HighCapacityRegistryGetValueResponse::decode(wire.as_slice()).unwrap();
        assert!(reply.version <= pin);
        if let Some(error) = reply.error {
            assert_eq!(error.key, key.as_bytes());
            assert_eq!(error.code, registry_error::Code::KeyNotPresent as i32);
            absent += 1;
        } else {
            older |= reply.version < pin;
        }
    }
    assert!(older && absent > 0);
}
