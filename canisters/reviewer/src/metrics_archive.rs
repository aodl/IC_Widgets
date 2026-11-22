use std::{
    cell::RefCell,
    collections::BTreeMap,
    ops::Bound::{Excluded, Included},
};

use candid::{CandidType, Principal};
use ic_stable_structures::{StableBTreeMap, StableCell};
use nexus_domain::{Hash, sha256};
use nexus_ic_sources::management::{self, NodeMetricsHistoryResult};
use serde::Deserialize;

use crate::{
    budget::SECOND,
    evidence::{self, SourceStatus},
    ingestion::{Work, short},
    registry_sync, require_controller,
    store::{Memory, V1, memory},
};

const DAILY: u64 = 86_400 * SECOND;
const RETRY: u64 = 5 * 60 * SECOND;
const SHORT_BACKFILL: u64 = 7 * DAILY;

#[derive(Clone, Default, CandidType, Deserialize)]
struct Roster {
    version: Option<u64>,
    eligible: Vec<Principal>,
    unsupported: Vec<Principal>,
    error: Option<String>,
    retry_at: u64,
}

#[derive(Clone, CandidType, Deserialize)]
pub struct MetricsRosterStatus {
    pub registry_version: Option<u64>,
    pub eligible_count: u32,
    pub unsupported: Vec<Principal>,
    pub error: Option<String>,
}

#[derive(Clone, Default, CandidType, Deserialize)]
pub struct SubnetCollection {
    pub eligible: bool,
    pub cursor: Option<u64>,
    pub next_due: Option<u64>,
    pub last_observation: Option<u64>,
    pub last_success_at: Option<u64>,
    pub last_status: Option<SourceStatus>,
    pub failures: u8,
    pub history_retry_start: Option<u64>,
    pub gap: Option<CollectionGap>,
    pub gaps_observed: u64,
}

#[derive(Clone, Debug, CandidType, Deserialize, PartialEq, Eq)]
pub enum CollectionGap {
    BoundaryMissing {
        expected: u64,
        earliest: Option<u64>,
    },
    ShortenedHistory {
        requested: u64,
        from: u64,
    },
    MissingDays {
        before: u64,
        after: u64,
    },
}

#[derive(Clone, CandidType, Deserialize)]
pub struct MetricSample {
    pub subnet: Principal,
    pub timestamp_nanos: u64,
    pub collected_at: u64,
    pub observation: u64,
    pub sample_hash: Hash,
    pub raw_response_hash: Hash,
    pub node_rows: u32,
    pub previous_sample: Option<u64>,
    pub preceding_gap: Option<CollectionGap>,
    pub decreased_counters: u32,
    pub conflicted: bool,
}

#[derive(Clone, CandidType, Deserialize)]
pub struct MetricConflict {
    pub observation: u64,
    pub observed_at: u64,
    pub previous_hash: Hash,
    pub conflicting_hash: Hash,
    pub raw_response_hash: Hash,
}

#[derive(CandidType, Deserialize)]
pub struct MetricPage {
    pub rows: Vec<MetricSample>,
    pub next: Option<u64>,
    pub collection: SubnetCollection,
}

type ConflictIndex = StableBTreeMap<(Principal, u64, Hash), V1<MetricConflict>, Memory>;

thread_local! {
    static ROSTER: RefCell<StableCell<V1<Roster>, Memory>> =
        RefCell::new(StableCell::init(memory(16), V1(Roster::default())));
    static SUBNETS: RefCell<StableBTreeMap<Principal, V1<SubnetCollection>, Memory>> =
        RefCell::new(StableBTreeMap::init(memory(17)));
    static DUE: RefCell<StableBTreeMap<(u64, Principal), u8, Memory>> =
        RefCell::new(StableBTreeMap::init(memory(18)));
    static SAMPLES: RefCell<StableBTreeMap<(Principal, u64), V1<MetricSample>, Memory>> =
        RefCell::new(StableBTreeMap::init(memory(19)));
    static CONFLICTS: RefCell<ConflictIndex> =
        RefCell::new(StableBTreeMap::init(memory(20)));
}

pub fn roster_refresh_due(now: u64) -> bool {
    let version = registry_sync::status().published;
    ROSTER.with_borrow(|roster| {
        version.is_some() && version != roster.get().0.version && now >= roster.get().0.retry_at
    })
}

pub fn refresh_roster(now: u64) {
    let Some(version) = registry_sync::status().published else {
        return;
    };
    let old = ROSTER.with_borrow(|roster| roster.get().0.clone());
    let new = classify(version);
    let update = match new {
        Ok((eligible, unsupported)) => {
            for subnet in &old.eligible {
                if !eligible.contains(subnet) {
                    let mut state = subnet_state(*subnet);
                    state.eligible = false;
                    schedule(*subnet, &mut state, None);
                    save(*subnet, state);
                }
            }
            for subnet in &eligible {
                if !old.eligible.contains(subnet) {
                    let mut state = subnet_state(*subnet);
                    state.eligible = true;
                    schedule(*subnet, &mut state, Some(now));
                    save(*subnet, state);
                }
            }
            Roster {
                version: Some(version),
                eligible,
                unsupported,
                error: None,
                retry_at: 0,
            }
        }
        Err(err) => Roster {
            error: Some(short(&err)),
            retry_at: now.saturating_add(RETRY),
            ..old
        },
    };
    ROSTER.with_borrow_mut(|roster| {
        roster.set(V1(update));
    });
}

fn classify(version: u64) -> Result<(Vec<Principal>, Vec<Principal>), String> {
    let mut eligible = vec![];
    let mut unsupported = vec![];
    for subnet in registry_sync::roster(version)? {
        match registry_sync::subnet_membership(version, subnet)? {
            Some(record) if matches!(record.kind, 1 | 2 | 4) => eligible.push(subnet),
            _ => unsupported.push(subnet),
        }
    }
    Ok((eligible, unsupported))
}

pub fn next(now: u64) -> Option<Work> {
    let ((due, subnet), _) = DUE.with_borrow(|index| index.first_key_value())?;
    if due > now {
        return None;
    }
    let state = subnet_state(subnet);
    Some(Work::NodeMetrics {
        subnet,
        start: state.history_retry_start.or(state.cursor).unwrap_or(0),
    })
}

fn subnet_state(subnet: Principal) -> SubnetCollection {
    SUBNETS
        .with_borrow(|subnets| subnets.get(&subnet).map(|row| row.0))
        .unwrap_or_default()
}

fn save(subnet: Principal, state: SubnetCollection) {
    SUBNETS.with_borrow_mut(|subnets| subnets.insert(subnet, V1(state)));
}

fn schedule(subnet: Principal, state: &mut SubnetCollection, due: Option<u64>) {
    DUE.with_borrow_mut(|index| {
        if let Some(old) = state.next_due {
            index.remove(&(old, subnet));
        }
        if let Some(due) = due {
            index.insert((due, subnet), 0);
        }
    });
    state.next_due = due;
}

fn sample_at(subnet: Principal, timestamp: u64) -> Option<MetricSample> {
    SAMPLES.with_borrow(|rows| rows.get(&(subnet, timestamp)).map(|row| row.0))
}

pub fn accept(
    subnet: Principal,
    start: u64,
    bytes: &[u8],
    observation: u64,
    now: u64,
) -> SourceStatus {
    let mut samples = match management::decode_metrics(bytes, start) {
        Ok(samples) => samples,
        Err(err) => return SourceStatus::Malformed(short(&err)),
    };
    if let Err(err) = normalize(&mut samples) {
        return SourceStatus::Malformed(err);
    }
    let raw_hash = sha256(bytes);
    let digests: Vec<_> = samples
        .iter()
        .map(|sample| sha256(&candid::encode_one(sample).expect("sample encoding")))
        .collect();
    let mut conflicted = false;
    for (sample, &digest) in samples.iter().zip(&digests) {
        let Some(mut old) = sample_at(subnet, sample.timestamp_nanos) else {
            continue;
        };
        if old.sample_hash == digest {
            continue;
        }
        conflicted = true;
        old.conflicted = true;
        let finding = MetricConflict {
            observation,
            observed_at: now,
            previous_hash: old.sample_hash,
            conflicting_hash: digest,
            raw_response_hash: raw_hash,
        };
        CONFLICTS.with_borrow_mut(|rows| {
            let key = (subnet, sample.timestamp_nanos, digest);
            if !rows.contains_key(&key) {
                rows.insert(key, V1(finding));
            }
        });
        SAMPLES.with_borrow_mut(|rows| rows.insert((subnet, sample.timestamp_nanos), V1(old)));
    }
    if conflicted {
        evidence::put_blob(raw_hash, bytes.to_vec());
        return SourceStatus::Integrity(
            "different node metrics for an existing subnet timestamp".into(),
        );
    }

    let mut state = subnet_state(subnet);
    let first = samples.first().map(|sample| sample.timestamp_nanos);
    let boundary_gap = state
        .cursor
        .filter(|cursor| first != Some(*cursor))
        .map(|expected| CollectionGap::BoundaryMissing {
            expected,
            earliest: first,
        });
    if let Some(gap) = &boundary_gap {
        state.gap = Some(gap.clone());
        state.gaps_observed += 1;
    }
    let mut added = false;
    for (index, (sample, &sample_hash)) in samples.iter().zip(&digests).enumerate() {
        if sample_at(subnet, sample.timestamp_nanos).is_some() {
            continue;
        }
        let previous = index.checked_sub(1).map(|index| &samples[index]);
        let preceding_gap = if let Some(previous) = previous {
            let before = previous.timestamp_nanos;
            let after = sample.timestamp_nanos;
            (after / DAILY > before / DAILY + 1)
                .then_some(CollectionGap::MissingDays { before, after })
        } else {
            boundary_gap
                .clone()
                .or_else(|| state.history_retry_start.and(state.gap.clone()))
        };
        if matches!(preceding_gap, Some(CollectionGap::MissingDays { .. })) {
            state.gap = preceding_gap.clone();
            state.gaps_observed += 1;
        }
        let decreased_counters = if preceding_gap.is_none() {
            previous.map_or(0, |previous| {
                decreases(&previous.node_metrics, &sample.node_metrics)
            })
        } else {
            0
        };
        let row = MetricSample {
            subnet,
            timestamp_nanos: sample.timestamp_nanos,
            collected_at: now,
            observation,
            sample_hash,
            raw_response_hash: raw_hash,
            node_rows: sample.node_metrics.len() as u32,
            previous_sample: previous.map(|row| row.timestamp_nanos),
            preceding_gap,
            decreased_counters,
            conflicted: false,
        };
        SAMPLES.with_borrow_mut(|rows| rows.insert((subnet, sample.timestamp_nanos), V1(row)));
        added = true;
    }
    if added || samples.is_empty() {
        evidence::put_blob(raw_hash, bytes.to_vec());
    }
    state.cursor = samples
        .last()
        .map(|sample| sample.timestamp_nanos)
        .or(state.cursor);
    state.last_observation = Some(observation);
    state.last_status = Some(SourceStatus::Valid);
    state.last_success_at = Some(now);
    state.failures = 0;
    state.history_retry_start = None;
    schedule(subnet, &mut state, Some(now.saturating_add(DAILY)));
    save(subnet, state);
    SourceStatus::Valid
}

fn normalize(samples: &mut NodeMetricsHistoryResult) -> Result<(), String> {
    if samples
        .windows(2)
        .any(|pair| pair[0].timestamp_nanos / DAILY == pair[1].timestamp_nanos / DAILY)
    {
        return Err("node history has two samples on the same UTC day".into());
    }
    for sample in samples {
        if sample
            .node_metrics
            .iter()
            .any(|row| row.node_id.as_slice().is_empty())
        {
            return Err("node history contains an empty node principal".into());
        }
        sample.node_metrics.sort_unstable_by_key(|row| row.node_id);
        if sample
            .node_metrics
            .windows(2)
            .any(|pair| pair[0].node_id == pair[1].node_id)
        {
            return Err("node history contains duplicate node rows".into());
        }
    }
    Ok(())
}

fn decreases(old: &[management::NodeMetrics], new: &[management::NodeMetrics]) -> u32 {
    let previous: BTreeMap<_, _> = old.iter().map(|row| (row.node_id, row)).collect();
    new.iter()
        .filter(|row| {
            previous.get(&row.node_id).is_some_and(|before| {
                row.num_blocks_proposed_total < before.num_blocks_proposed_total
                    || row.num_block_failures_total < before.num_block_failures_total
            })
        })
        .count() as u32
}

pub fn failed(
    subnet: Principal,
    start: u64,
    status: &SourceStatus,
    observation: u64,
    now: u64,
    attempts: u8,
) {
    let mut state = subnet_state(subnet);
    state.last_observation = Some(observation);
    state.last_status = Some(status.clone());
    state.failures = state.failures.saturating_add(1);
    let next = if matches!(status, SourceStatus::Oversized)
        && state.history_retry_start.is_none()
        && state.failures < attempts
        && start < now.saturating_sub(SHORT_BACKFILL)
    {
        let from = now.saturating_sub(SHORT_BACKFILL);
        state.history_retry_start = Some(from);
        state.gap = Some(CollectionGap::ShortenedHistory {
            requested: start,
            from,
        });
        state.gaps_observed += 1;
        now.saturating_add(RETRY)
    } else if matches!(
        status,
        SourceStatus::Interrupted
            | SourceStatus::Rejected {
                retryable: true,
                ..
            }
    ) && state.failures < attempts
    {
        now.saturating_add(RETRY << (state.failures - 1))
    } else {
        state.failures = 0;
        now.saturating_add(DAILY)
    };
    schedule(subnet, &mut state, Some(next));
    save(subnet, state);
}

#[ic_cdk::update]
fn metrics_roster() -> Result<MetricsRosterStatus, String> {
    require_controller()?;
    Ok(ROSTER.with_borrow(|roster| {
        let state = &roster.get().0;
        MetricsRosterStatus {
            registry_version: state.version,
            eligible_count: state.eligible.len() as u32,
            unsupported: state.unsupported.clone(),
            error: state.error.clone(),
        }
    }))
}

#[ic_cdk::update]
fn metrics_status(subnet: Principal) -> Result<SubnetCollection, String> {
    require_controller()?;
    Ok(subnet_state(subnet))
}

#[ic_cdk::update]
fn metric_samples(
    subnet: Principal,
    from: u64,
    through: u64,
    after: Option<u64>,
) -> Result<MetricPage, String> {
    require_controller()?;
    sample_window(subnet, from, through, after)
}

pub fn sample_window(
    subnet: Principal,
    from: u64,
    through: u64,
    after: Option<u64>,
) -> Result<MetricPage, String> {
    if from > through || after.is_some_and(|cursor| cursor < from || cursor > through) {
        return Err("invalid metrics window or cursor".into());
    }
    let start = after.map_or(Included((subnet, from)), |cursor| {
        Excluded((subnet, cursor))
    });
    let mut rows = SAMPLES.with_borrow(|samples| {
        samples
            .range((start, Included((subnet, through))))
            .take(33)
            .map(|row| row.value().0)
            .collect::<Vec<_>>()
    });
    let next = if rows.len() > 32 {
        rows.pop();
        Some(rows[31].timestamp_nanos)
    } else {
        None
    };
    Ok(MetricPage {
        rows,
        next,
        collection: subnet_state(subnet),
    })
}

#[derive(CandidType, Deserialize)]
pub struct MetricConflictPage {
    pub rows: Vec<MetricConflict>,
    pub next: Option<Hash>,
}

#[ic_cdk::update]
fn metric_conflicts(
    subnet: Principal,
    timestamp: u64,
    after: Option<Hash>,
) -> Result<MetricConflictPage, String> {
    require_controller()?;
    let first = after.map_or(Included((subnet, timestamp, [0; 32])), |hash| {
        Excluded((subnet, timestamp, hash))
    });
    let end = Included((subnet, timestamp, [u8::MAX; 32]));
    let mut rows = CONFLICTS.with_borrow(|conflicts| {
        conflicts
            .range((first, end))
            .take(33)
            .map(|row| row.value().0)
            .collect::<Vec<_>>()
    });
    let next = if rows.len() > 32 {
        rows.pop();
        Some(rows[31].conflicting_hash)
    } else {
        None
    };
    Ok(MetricConflictPage { rows, next })
}

#[ic_cdk::update]
fn metric_sample_rows(
    subnet: Principal,
    timestamp: u64,
    after: Option<Principal>,
) -> Result<MetricRows, String> {
    require_controller()?;
    sample_rows(subnet, timestamp, after)
}

pub fn sample_rows(
    subnet: Principal,
    timestamp: u64,
    after: Option<Principal>,
) -> Result<MetricRows, String> {
    let sample = sample_at(subnet, timestamp).ok_or("metrics sample unavailable")?;
    let bytes =
        evidence::blob(sample.raw_response_hash).ok_or("metrics source bytes unavailable")?;
    let mut samples = management::decode_metrics(&bytes, 0)?;
    normalize(&mut samples)?;
    let index = samples
        .binary_search_by_key(&timestamp, |sample| sample.timestamp_nanos)
        .map_err(|_| "sample missing from its source reply")?;
    let sample_rows = &samples[index].node_metrics;
    let start = after.map_or(0, |cursor| {
        sample_rows.partition_point(|row| row.node_id <= cursor)
    });
    let end = (start + 256).min(sample_rows.len());
    Ok(MetricRows {
        sample,
        rows: sample_rows[start..end].to_vec(),
        next: (end < sample_rows.len()).then(|| sample_rows[end - 1].node_id),
    })
}

#[derive(CandidType, Deserialize)]
pub struct MetricRows {
    pub sample: MetricSample,
    pub rows: Vec<management::NodeMetrics>,
    pub next: Option<Principal>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use management::{NodeMetrics, NodeMetricsHistoryRecord};

    fn node(id: u8, count: u64) -> NodeMetrics {
        NodeMetrics {
            node_id: Principal::from_slice(&[id, 2]),
            num_blocks_proposed_total: count,
            num_block_failures_total: 0,
        }
    }

    fn day(day: u64, rows: Vec<NodeMetrics>) -> NodeMetricsHistoryRecord {
        NodeMetricsHistoryRecord {
            timestamp_nanos: day * DAILY,
            node_metrics: rows,
        }
    }

    #[test]
    fn overlap_conflicts_gaps_reset_and_subnet_isolation() {
        let subnet = Principal::from_slice(&[200, 2]);
        let other = Principal::from_slice(&[201, 2]);
        let encode = |rows: Vec<NodeMetricsHistoryRecord>| candid::encode_one(rows).unwrap();
        let initial = encode(vec![
            day(1, vec![node(2, 8), node(1, 10)]),
            day(2, vec![node(1, 3)]),
            day(3, vec![node(2, 2)]),
        ]);
        assert_eq!(
            accept(subnet, 0, &initial, 1, 4 * DAILY),
            SourceStatus::Valid
        );
        assert_eq!(sample_at(subnet, 2 * DAILY).unwrap().decreased_counters, 1);
        let reappeared = sample_at(subnet, 3 * DAILY).unwrap();
        assert_eq!(reappeared.decreased_counters, 0);
        assert_eq!(reappeared.node_rows, 1);
        let repeated = encode(vec![day(3, vec![node(2, 2)])]);
        assert_eq!(
            accept(subnet, 3 * DAILY, &repeated, 2, 4 * DAILY),
            SourceStatus::Valid
        );
        assert_eq!(sample_at(subnet, 3 * DAILY).unwrap().observation, 1);

        let conflict = encode(vec![day(3, vec![node(2, 99)]), day(4, vec![node(2, 100)])]);
        assert!(matches!(
            accept(subnet, 3 * DAILY, &conflict, 3, 5 * DAILY),
            SourceStatus::Integrity(_)
        ));
        let stored = sample_at(subnet, 3 * DAILY).unwrap();
        assert_eq!(stored.sample_hash, reappeared.sample_hash);
        assert!(stored.conflicted);
        assert!(sample_at(subnet, 4 * DAILY).is_none());
        assert_eq!(subnet_state(subnet).cursor, Some(3 * DAILY));
        assert_eq!(evidence::blob(sha256(&conflict)).unwrap(), conflict);

        let gapped = encode(vec![day(5, vec![node(2, 6)]), day(7, vec![node(2, 5)])]);
        assert_eq!(
            accept(subnet, 3 * DAILY, &gapped, 4, 8 * DAILY),
            SourceStatus::Valid
        );
        assert!(matches!(
            sample_at(subnet, 5 * DAILY).unwrap().preceding_gap,
            Some(CollectionGap::BoundaryMissing { .. })
        ));
        let seventh = sample_at(subnet, 7 * DAILY).unwrap();
        assert!(matches!(
            seventh.preceding_gap,
            Some(CollectionGap::MissingDays { .. })
        ));
        assert_eq!(seventh.decreased_counters, 0);

        assert_eq!(
            accept(
                other,
                0,
                &encode(vec![day(7, vec![node(2, 1)])]),
                5,
                8 * DAILY
            ),
            SourceStatus::Valid
        );
        let independent = sample_at(other, 7 * DAILY).unwrap();
        assert!(independent.previous_sample.is_none());
        assert_eq!(independent.decreased_counters, 0);

        failed(
            subnet,
            7 * DAILY,
            &SourceStatus::Interrupted,
            6,
            8 * DAILY,
            3,
        );
        failed(
            subnet,
            7 * DAILY,
            &SourceStatus::Interrupted,
            7,
            8 * DAILY,
            3,
        );
        assert_eq!(subnet_state(subnet).next_due, Some(8 * DAILY + 2 * RETRY));
        assert_eq!(subnet_state(subnet).cursor, Some(7 * DAILY));
        assert_eq!(subnet_state(other).last_status, Some(SourceStatus::Valid));
    }

    #[test]
    fn malformed_history_and_empty_history_are_distinct() {
        let subnet = Principal::from_slice(&[202, 2]);
        let duplicates = candid::encode_one(vec![day(1, vec![node(1, 3), node(1, 4)])]).unwrap();
        assert!(matches!(
            accept(subnet, 0, &duplicates, 1, 2 * DAILY),
            SourceStatus::Malformed(_)
        ));
        assert_eq!(subnet_state(subnet).last_success_at, None);
        let empty = candid::encode_one(NodeMetricsHistoryResult::new()).unwrap();
        assert_eq!(accept(subnet, 0, &empty, 2, 2 * DAILY), SourceStatus::Valid);
        let state = subnet_state(subnet);
        assert_eq!(state.last_success_at, Some(2 * DAILY));
        assert_eq!(state.cursor, None);
    }
}
