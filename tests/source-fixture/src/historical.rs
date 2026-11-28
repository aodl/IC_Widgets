//! Test-only adapter from the committed indexed captures to the pinned wire types.
use std::collections::{BTreeMap, BTreeSet};

use candid::{CandidType, Principal, encode_one};
use nexus_ic_sources::governance::{
    Action, ExecuteNnsFunction, Proposal, ProposalId, ProposalInfo,
};
use serde::Deserialize;
use serde_json::Value;

#[derive(Deserialize)]
pub struct Case {
    pub id: String,
    pub proposal_ids: Vec<String>,
    pub function_ids: Vec<i32>,
    pub lifecycle: String,
    pub registry: Baseline,
    pub fault: Option<String>,
    #[serde(default)]
    pub activity: Vec<ActivityFixture>,
}

#[derive(Deserialize)]
pub struct ActivityFixture {
    pub id: String,
    pub status: i32,
    pub topic: i32,
    pub title: String,
    #[serde(default)]
    pub summary: String,
    pub function: Option<i32>,
    pub payload: Option<Value>,
    pub motion: Option<String>,
    #[serde(default)]
    pub omit_list_payload: bool,
}

impl ActivityFixture {
    pub fn info(&self, list: bool) -> ProposalInfo {
        let action = if let Some(function) = self.function {
            let executable = self
                .payload
                .as_ref()
                .and_then(|value| action(function, value));
            Some(Action::ExecuteNnsFunction(ExecuteNnsFunction {
                nns_function: function,
                payload: if list && self.omit_list_payload {
                    vec![]
                } else {
                    executable.map_or_else(Vec::new, |action| action.payload)
                },
            }))
        } else {
            self.motion.as_ref().map(|text| Action::Motion {
                motion_text: text.clone(),
            })
        };
        ProposalInfo {
            id: Some(ProposalId {
                id: decimal(&self.id),
            }),
            status: self.status,
            reward_status: Some(if self.status == 1 { 1 } else { 2 }),
            deadline_timestamp_seconds: Some(1796042112),
            topic: self.topic,
            proposal_timestamp_seconds: 1795696512,
            executed_timestamp_seconds: if self.status == 4 { 1795696513 } else { 0 },
            failed_timestamp_seconds: None,
            decided_timestamp_seconds: (self.status != 1).then_some(1795696513),
            proposal: Some(Proposal {
                title: Some(self.title.clone()),
                summary: self.summary.clone(),
                action,
            }),
        }
    }
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum Baseline {
    CapturedWithOverlay,
    ActivityArchive,
    Synthetic {
        version: String,
        mutation_version: String,
        roster: Vec<String>,
        subnets: BTreeMap<String, Vec<String>>,
    },
}

pub fn cases() -> Vec<Case> {
    #[derive(Deserialize)]
    struct Cases {
        schema_version: u8,
        replays: Vec<Case>,
    }
    let cases: Cases =
        serde_json::from_str(include_str!("../data/historical/replays.json")).unwrap();
    assert_eq!(cases.schema_version, 1);
    cases.replays
}

pub fn indexed(id: &str) -> Option<&'static [u8]> {
    macro_rules! raw {
        ($($id:literal),+) => {
            match id {
                $( $id => Some(include_bytes!(concat!("../data/historical/raw/api/", $id, ".json"))), )+
                _ => None,
            }
        };
    }
    raw!(
        "48615", "85612", "85622", "130714", "132102", "132483", "134902", "134993", "134994",
        "135053", "135310", "139792", "140279", "140280", "140988", "142743", "142931", "143100",
        "144681", "144850", "144865", "144909", "144939", "144940", "144954"
    )
}

pub fn activity_capture(id: &str) -> Option<&'static [u8]> {
    macro_rules! archived {
        ($($id:literal),+) => { match id {
            $($id => Some(include_bytes!(concat!("../../../docs/subnet-activity/governance-2026-11-27/", $id, ".governance.didbin"))),)+
            _ => None,
        } };
    }
    archived!("145077", "145076", "145075", "145071", "145063")
}

pub fn decimal(value: &str) -> u64 {
    let parsed: u64 = value.parse().expect("decimal fixture identifier");
    assert_eq!(value, parsed.to_string(), "canonical decimal identifier");
    parsed
}

pub fn principal(value: &str) -> Principal {
    let parsed = Principal::from_text(value).expect("fixture principal");
    assert_eq!(value, parsed.to_text());
    assert!(
        !parsed.as_slice().is_empty(),
        "nonempty record key principal"
    );
    parsed
}

#[derive(CandidType)]
struct Change {
    subnet_id: Principal,
    node_ids_add: Vec<Principal>,
    node_ids_remove: Vec<Principal>,
}

#[derive(CandidType)]
struct Add {
    subnet_id: Principal,
    node_ids: Vec<Principal>,
}

#[derive(CandidType)]
struct Nodes {
    node_ids: Vec<Principal>,
}

#[derive(CandidType)]
struct VersionedNodes {
    node_ids: Vec<Principal>,
    version: String,
}

fn nodes(payload: &Value, key: &str) -> Vec<Principal> {
    payload[key]
        .as_array()
        .expect("fixture node list")
        .iter()
        .map(|node| principal(node.as_str().expect("text principal")))
        .collect()
}

pub fn action(function: i32, payload: &Value) -> Option<ExecuteNnsFunction> {
    let subnet = || principal(payload["subnet_id"].as_str().expect("target subnet"));
    let ids = || nodes(payload, "node_ids");
    let bytes = match function {
        31 => encode_one(Change {
            subnet_id: subnet(),
            node_ids_add: nodes(payload, "node_ids_add"),
            node_ids_remove: nodes(payload, "node_ids_remove"),
        }),
        2 => encode_one(Add {
            subnet_id: subnet(),
            node_ids: ids(),
        }),
        13 | 18 | 44 => encode_one(Nodes { node_ids: ids() }),
        43 | 46 | 47 => encode_one(VersionedNodes {
            node_ids: ids(),
            version: payload["version"].as_str().expect("GuestOS version").into(),
        }),
        _ => return None,
    };
    Some(ExecuteNnsFunction {
        nns_function: function,
        payload: bytes.unwrap(),
    })
}

pub fn proposal(id: &str, function: i32, lifecycle: &str) -> ProposalInfo {
    let index: Value =
        serde_json::from_slice(indexed(id).expect("committed indexed reply")).unwrap();
    let timestamp = |name| index[name].as_u64().expect("indexed timestamp");
    let id = decimal(id);
    assert_eq!(index["proposal_id"].as_u64(), Some(id));
    let status = match index["status"].as_str() {
        Some("OPEN") => 1,
        Some("REJECTED") => 2,
        Some("ADOPTED") => 3,
        Some("EXECUTED") => 4,
        Some("FAILED") => 5,
        _ => panic!("unknown indexed status"),
    };
    let status = match lifecycle {
        "constructed-open" => 1,
        "constructed-adopted" => 3,
        "indexed-executed" if status == 4 => status,
        "indexed-rejected" if status == 2 => status,
        "indexed-failed" if status == 5 => status,
        _ => panic!("incompatible replay lifecycle"),
    };
    let topic = match index["topic"].as_str() {
        Some("TOPIC_SUBNET_MANAGEMENT") => 7,
        Some("TOPIC_API_BOUNDARY_NODE_MANAGEMENT") => 15,
        Some("TOPIC_IC_OS_VERSION_DEPLOYMENT") => 12,
        _ => panic!("unsupported replay topic"),
    };
    ProposalInfo {
        id: Some(ProposalId { id }),
        reward_status: None,
        deadline_timestamp_seconds: None,
        status,
        topic,
        proposal_timestamp_seconds: timestamp("proposal_timestamp_seconds"),
        executed_timestamp_seconds: if status == 4 {
            timestamp("executed_timestamp_seconds")
        } else {
            0
        },
        failed_timestamp_seconds: (status == 5).then(|| timestamp("failed_timestamp_seconds")),
        decided_timestamp_seconds: (status != 1).then(|| timestamp("decided_timestamp_seconds")),
        proposal: Some(Proposal {
            title: index["title"].as_str().map(str::to_owned),
            summary: index["summary"].as_str().expect("indexed summary").into(),
            action: action(function, &index["payload"]).map(Action::ExecuteNnsFunction),
        }),
    }
}

pub fn requested(proposals: &BTreeMap<u64, Vec<u8>>) -> BTreeSet<Principal> {
    use nexus_domain::MembershipAction;
    proposals
        .values()
        .filter_map(|bytes| {
            let row: Option<ProposalInfo> = candid::decode_one(bytes).unwrap();
            nexus_ic_sources::governance::membership(row.as_ref()?.executable()?)
                .expect("fixture membership payload")
        })
        .flat_map(|action| match action {
            MembershipAction::Change {
                mut add, remove, ..
            } => {
                add.extend(remove);
                add
            }
            MembershipAction::Add { nodes, .. } | MembershipAction::Remove { nodes } => nodes,
        })
        .collect()
}
