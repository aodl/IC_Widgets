//! Paged reads at the preview's version and pure aggregation over the returned evidence.
use std::collections::{BTreeMap, BTreeSet};

use candid::{CandidType, Principal};
use ic_cdk::api::{canister_liquid_cycle_balance, msg_arg_data, performance_counter};
use nexus_domain::{Hash, sha256};
use nexus_ic_sources::projection::RecordKey;
use nexus_review_engine::{
    ANALYSIS_VERSION, DataCenter, MembershipComparison, Node, Operator, Record, TopologyEvidence,
    compare_membership, data_center_key,
};
use serde::Deserialize;

use super::{
    LiveError, LiveResponse, NODE_LIMIT, Request, RequestGuard, registry::Resolver,
    require_on_demand_caller,
};
use crate::{Sources, budget::FLOOR, review_records, store};

const PAGE_LIMIT: usize = 24;
const COMPARISON_INPUT_BYTES: usize = 256 * 1024;

#[derive(CandidType, Deserialize)]
pub enum DetailKeys {
    Nodes(Vec<Principal>),
    Operators(Vec<Principal>),
    DataCenters(Vec<String>),
}

#[derive(CandidType, Deserialize)]
pub enum DetailRecords {
    Nodes(Vec<Record<Node>>),
    Operators(Vec<Record<Operator>>),
    DataCenters(Vec<Record<DataCenter>>),
}

#[derive(CandidType, Deserialize)]
pub struct DetailComparisonInput {
    pub registry_version: u64,
    pub subnet: Principal,
    pub preview_revision: Hash,
    pub before: Vec<Principal>,
    pub after: Vec<Principal>,
    pub kind: i32,
    pub nodes: BTreeMap<Principal, Record<Node>>,
    pub operators: BTreeMap<Principal, Record<Operator>>,
    pub data_centers: BTreeMap<String, Record<DataCenter>>,
}

#[derive(CandidType, Deserialize)]
pub struct LiveMembershipComparison {
    pub comparison: MembershipComparison,
    /// Hash of the exact Candid argument bytes received by this update.
    pub input_hash: Hash,
    pub analysis_version: u16,
    pub instructions: u64,
}

fn valid_keys<T: Ord>(keys: &[T]) -> bool {
    (1..=PAGE_LIMIT).contains(&keys.len())
        && keys.iter().collect::<BTreeSet<_>>().len() == keys.len()
}

#[ic_cdk::update]
async fn membership_detail_page(
    version: u64,
    keys: DetailKeys,
) -> Result<LiveResponse<DetailRecords>, String> {
    let guard = RequestGuard::acquire()?;
    let valid = match &keys {
        DetailKeys::Nodes(ids) | DetailKeys::Operators(ids) => {
            valid_keys(ids) && ids.iter().all(|id| !id.as_slice().is_empty())
        }
        DetailKeys::DataCenters(ids) => {
            valid_keys(ids)
                && ids
                    .iter()
                    .all(|id| id.len() <= 128 && data_center_key(id).as_ref() == Some(id))
        }
    };
    if version == 0 || !valid {
        return Err("select one pinned Registry version and 1 to 24 distinct record keys".into());
    }
    let mut request = Request::new(guard.0);
    request.version = Some(version);
    let sources = if cfg!(feature = "local-fixtures") {
        store::config().sources
    } else {
        Sources::canonical()
    };
    let outcome = read(&mut request, sources.registry, version, keys).await;
    Ok(request.finish(outcome))
}

async fn read(
    request: &mut Request,
    source: Principal,
    version: u64,
    keys: DetailKeys,
) -> Result<DetailRecords, LiveError> {
    let mut resolver = Resolver {
        request,
        source,
        version,
        chunks: BTreeMap::new(),
    };
    match keys {
        DetailKeys::Nodes(ids) => resolver
            .read(
                ids.into_iter().map(RecordKey::Node).collect(),
                review_records::node,
            )
            .await
            .map(DetailRecords::Nodes),
        DetailKeys::Operators(ids) => resolver
            .read(
                ids.into_iter().map(RecordKey::Operator).collect(),
                review_records::operator,
            )
            .await
            .map(DetailRecords::Operators),
        DetailKeys::DataCenters(ids) => resolver
            .read(
                ids.into_iter().map(RecordKey::DataCenter).collect(),
                review_records::data_center,
            )
            .await
            .map(DetailRecords::DataCenters),
    }
}

fn comparison_ingress() -> Result<(), String> {
    require_on_demand_caller()?;
    if msg_arg_data().len() > COMPARISON_INPUT_BYTES {
        return Err("comparison input exceeds 256 KiB".into());
    }
    Ok(())
}

fn version_matches<T>(record: &Record<T>, registry_version: u64) -> bool {
    let stamp = match record {
        Record::Present { stamp, .. } | Record::Deleted(stamp) => Some(stamp),
        Record::Unavailable { stamp, .. } => stamp.as_ref(),
        Record::Missing => None,
    };
    stamp.is_none_or(|stamp| (1..=registry_version).contains(&stamp.mutation_version))
}

/// Replicated calculation over caller-supplied evidence. The scoped preview
/// and source receipts provide the scenario and Registry observations.
#[ic_cdk::update(guard = "comparison_ingress")]
fn compare_membership_details(
    input: DetailComparisonInput,
) -> Result<LiveMembershipComparison, String> {
    let _guard = RequestGuard::acquire()?;
    if canister_liquid_cycle_balance() < FLOOR {
        return Err("insufficient liquid cycles for comparison".into());
    }
    let DetailComparisonInput {
        registry_version,
        subnet,
        before,
        after,
        kind,
        nodes,
        operators,
        data_centers,
        ..
    } = input;
    if before.len() > NODE_LIMIT
        || after.len() > NODE_LIMIT
        || before.iter().collect::<BTreeSet<_>>().len() != before.len()
        || after.iter().collect::<BTreeSet<_>>().len() != after.len()
        || nodes.len() > 2 * NODE_LIMIT
        || operators.len() > 2 * NODE_LIMIT
        || data_centers.len() > 2 * NODE_LIMIT
    {
        return Err("comparison supports up to 128 distinct members per state".into());
    }
    if registry_version == 0
        || subnet.as_slice().is_empty()
        || nodes
            .values()
            .any(|row| !version_matches(row, registry_version))
        || operators
            .values()
            .any(|row| !version_matches(row, registry_version))
        || data_centers
            .values()
            .any(|row| !version_matches(row, registry_version))
    {
        return Err("comparison evidence is inconsistent with the pinned Registry version".into());
    }
    let evidence = TopologyEvidence {
        nodes: &nodes,
        operators: &operators,
        data_centers: &data_centers,
    };
    let comparison = compare_membership(&evidence, &before, &after, kind);
    Ok(LiveMembershipComparison {
        comparison,
        input_hash: sha256(&msg_arg_data()),
        analysis_version: ANALYSIS_VERSION,
        instructions: performance_counter(0),
    })
}
