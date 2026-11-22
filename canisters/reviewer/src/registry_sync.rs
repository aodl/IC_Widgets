use std::{
    cell::RefCell,
    ops::Bound::{Excluded, Included, Unbounded},
};

use candid::{CandidType, Principal};
use ic_stable_structures::{StableBTreeMap, StableCell, storable::Blob};
use nexus_domain::{Hash, sha256};
use nexus_ic_sources::{
    projection::{self, Content, Details, Mutation, RecordKey},
    registry,
};
use serde::Deserialize;

use crate::{
    budget::SECOND,
    evidence::{self, SourceStatus},
    ingestion::{Work, short},
    require_controller,
    store::{Memory, V1, memory},
};

// Bump only when an adapter change can replay a previously incompatible stage.
const RECOVERY_REVISION: u32 = 1;
const RECORDS_PER_SLICE: usize = 64;
const REFRESH: u64 = 5 * 60 * SECOND;

pub enum Next {
    Idle,
    Apply,
    Call(Work),
}

#[derive(Clone, Default, CandidType, Deserialize)]
pub struct RegistryStatus {
    pub observed_head: Option<u64>,
    pub bootstrap_target: Option<u64>,
    pub ingested_through: u64,
    pub published: Option<u64>,
    pub staging: Option<Staging>,
    pub last_observation: Option<u64>,
    pub updated_at: Option<u64>,
    pub blocked: Option<String>,
    pub attempts: u8,
    pub next_due: u64,
    pub processed_mutations: u64,
    pub superseded_mutations: u64,
    pub wire_bytes: u64,
    pub retained_mutations: u64,
    pub retained_value_bytes: u64,
    pub block: Option<RegistryBlock>,
    pub limits: Option<RegistryLimits>,
}

#[derive(Clone, Copy, CandidType, Deserialize)]
pub struct RegistryLimits {
    pub page_mutations: u32,
    pub staged_mutations: u32,
    pub record_chunks: u32,
    pub record_bytes: u32,
}

impl RegistryLimits {
    pub const MAX: Self = Self {
        page_mutations: projection::MAX_PAGE_MUTATIONS,
        staged_mutations: registry::MAX_STAGED_MUTATIONS,
        record_chunks: projection::MAX_CHUNKS as u32,
        record_bytes: projection::MAX_RECORD_BYTES as u32,
    };

    fn get(self, limit: RegistryLimit) -> u32 {
        match limit {
            RegistryLimit::PageMutations => self.page_mutations,
            RegistryLimit::StagedMutations => self.staged_mutations,
            RegistryLimit::RecordChunks => self.record_chunks,
            RegistryLimit::RecordBytes => self.record_bytes,
        }
    }
}

#[derive(Clone, Copy, Debug, CandidType, Deserialize, PartialEq, Eq)]
pub enum RegistryLimit {
    PageMutations,
    StagedMutations,
    RecordChunks,
    RecordBytes,
}

#[derive(Clone, Debug, CandidType, Deserialize, PartialEq, Eq)]
pub enum RegistryRecovery {
    RetryTransient,
    RepairSource,
    IncreaseLimit { limit: RegistryLimit, required: u32 },
    UpgradeAdapter,
}

#[derive(Clone, CandidType, Deserialize)]
pub struct RegistryBlock {
    pub request: Work,
    pub observation: u64,
    pub cursor: u64,
    pub version_range: Option<(u64, u64)>,
    pub record_key: Option<String>,
    pub reason: String,
    pub recovery: RegistryRecovery,
    pub adapter_revision: u32,
}

#[derive(Clone, CandidType, Deserialize)]
pub struct Staging {
    pub end: u64,
    pub observation: u64,
    pub count: u32,
    pub applied: u32,
    pub input_mutations: u32,
    pub superseded_mutations: u32,
}

#[derive(CandidType, Deserialize)]
struct Pending {
    mutation: Mutation,
    chunk_observations: Vec<u64>,
    chunk_bytes: u32,
}

#[derive(Clone, Debug, PartialEq, Eq, CandidType, Deserialize)]
pub struct RecordEvidence {
    pub mutation_version: u64,
    pub source_time: Option<u64>,
    pub page: u64,
    pub chunks: Vec<u64>,
    pub value_hash: Option<Hash>,
}

#[derive(CandidType, Deserialize)]
pub enum RecordAt {
    Missing,
    Deleted(RecordEvidence),
    Present {
        evidence: RecordEvidence,
        details: Details,
    },
    Opaque {
        evidence: RecordEvidence,
        reason: String,
    },
}

#[derive(CandidType, Deserialize)]
struct StoredRecord {
    evidence: RecordEvidence,
    subnet: Option<SubnetMembership>,
    provider: Option<Principal>,
}

#[derive(CandidType, Deserialize)]
pub struct SubnetMembership {
    pub members: Vec<Principal>,
    pub kind: i32,
}

#[derive(CandidType, Deserialize)]
pub struct KeyPage {
    pub keys: Vec<RecordKey>,
    pub next: Option<String>,
}

#[derive(CandidType, Deserialize)]
pub enum Assignment {
    UnknownNode,
    Unassigned,
    Replica(Principal),
    ApiBoundary,
    Conflict {
        replicas: Vec<Principal>,
        api_boundary: bool,
    },
    Incomplete(String),
}

thread_local! {
    static STATE: RefCell<StableCell<V1<RegistryStatus>, Memory>> =
        RefCell::new(StableCell::init(memory(8), V1(RegistryStatus::default())));
    static HISTORY: RefCell<StableBTreeMap<(Blob<300>, u64), V1<StoredRecord>, Memory>> =
        RefCell::new(StableBTreeMap::init(memory(9)));
    static STAGED: RefCell<StableBTreeMap<u32, V1<Pending>, Memory>> =
        RefCell::new(StableBTreeMap::init(memory(10)));
    static KEYS: RefCell<StableBTreeMap<String, u8, Memory>> =
        RefCell::new(StableBTreeMap::init(memory(11)));
}

pub fn status() -> RegistryStatus {
    STATE.with_borrow(|state| state.get().0.clone())
}

fn save(state: RegistryStatus) {
    STATE.with_borrow_mut(|cell| {
        cell.set(V1(state));
    });
}

pub fn next(now: u64) -> Next {
    let state = status();
    if state.blocked.is_some() || now < state.next_due {
        return Next::Idle;
    }
    if let Some(stage) = state.staging {
        if let Some(row) = pending(stage.applied)
            && let Content::Chunks(ref hashes) = row.mutation.value
            && let Some(hash) = hashes.get(row.chunk_observations.len())
        {
            return Next::Call(Work::RegistryChunk(*hash));
        }
        return Next::Apply;
    }
    if let Some(head) = state.observed_head
        && state.ingested_through < head
    {
        Next::Call(Work::RegistryChanges(state.ingested_through))
    } else {
        Next::Call(Work::RegistryHead)
    }
}

pub fn accept(work: &Work, bytes: &[u8], observation: u64, now: u64) -> SourceStatus {
    let mut state = status();
    let result = match work {
        Work::RegistryHead => accept_head(&mut state, bytes, now),
        Work::RegistryChanges(after) => accept_page(&mut state, bytes, *after, observation, now),
        Work::RegistryChunk(hash) => accept_chunk(&mut state, bytes, *hash, observation),
        _ => unreachable!("Registry producer received another source's task"),
    };
    if let Err(error) = result {
        if state.block.is_none() {
            let recovery = match (&error, work) {
                (SourceStatus::Integrity(_), _) => RegistryRecovery::RepairSource,
                _ => RegistryRecovery::UpgradeAdapter,
            };
            block(
                &mut state,
                work,
                observation,
                &format!("{error:?}"),
                recovery,
                Some(bytes),
            );
        }
        state.last_observation = Some(observation);
        save(state);
        return error;
    }
    state.last_observation = Some(observation);
    state.wire_bytes += bytes.len() as u64;
    state.attempts = 0;
    save(state);
    SourceStatus::Valid
}

fn block(
    state: &mut RegistryStatus,
    request: &Work,
    observation: u64,
    reason: &str,
    recovery: RegistryRecovery,
    response: Option<&[u8]>,
) {
    let record = state
        .staging
        .as_ref()
        .and_then(|stage| pending(stage.applied));
    let version_range = record
        .as_ref()
        .map(|row| (row.mutation.version, row.mutation.version))
        .or_else(|| match request {
            Work::RegistryChanges(_) => response.and_then(registry::changes_range_hint),
            _ => None,
        });
    let reason = short(reason);
    state.blocked = Some(reason.clone());
    state.block = Some(RegistryBlock {
        request: request.clone(),
        observation,
        cursor: state.ingested_through,
        version_range,
        record_key: record.map(|row| row.mutation.key.name()),
        reason,
        recovery,
        adapter_revision: RECOVERY_REVISION,
    });
}

fn limit_recovery(
    limits: RegistryLimits,
    limit: RegistryLimit,
    required: u32,
) -> Option<RegistryRecovery> {
    (required > limits.get(limit)).then_some(RegistryRecovery::IncreaseLimit { limit, required })
}

fn accept_head(state: &mut RegistryStatus, bytes: &[u8], now: u64) -> Result<(), SourceStatus> {
    let head = registry::head(bytes).map_err(malformed)?;
    if state.observed_head.is_some_and(|old| head < old) {
        return Err(SourceStatus::Integrity("Registry head regressed".into()));
    }
    state.observed_head = Some(head);
    state.bootstrap_target.get_or_insert(head);
    if head == state.ingested_through {
        state.published = Some(head);
        state.updated_at = Some(now);
        state.next_due = now.saturating_add(REFRESH);
    }
    Ok(())
}

fn accept_page(
    state: &mut RegistryStatus,
    bytes: &[u8],
    after: u64,
    observation: u64,
    now: u64,
) -> Result<(), SourceStatus> {
    if after != state.ingested_through || state.staging.is_some() {
        return Err(SourceStatus::Integrity(
            "Registry page does not match staging cursor".into(),
        ));
    }
    let through = state
        .published
        .is_none()
        .then_some(state.bootstrap_target)
        .flatten();
    let page = registry::decode_projection_changes(bytes, after, through).map_err(malformed)?;
    if state
        .observed_head
        .is_some_and(|old| page.span.observed_head < old)
    {
        return Err(SourceStatus::Integrity(
            "Registry page head regressed".into(),
        ));
    }
    let limits = state.limits.unwrap_or(RegistryLimits::MAX);
    let excess = limit_recovery(limits, RegistryLimit::PageMutations, page.raw_mutations)
        .or_else(|| {
            limit_recovery(
                limits,
                RegistryLimit::StagedMutations,
                page.projected.len() as u32,
            )
        })
        .or_else(|| {
            page.projected
                .iter()
                .find_map(|mutation| match &mutation.value {
                    Content::Chunks(hashes) => {
                        limit_recovery(limits, RegistryLimit::RecordChunks, hashes.len() as u32)
                    }
                    Content::Value(bytes) => {
                        limit_recovery(limits, RegistryLimit::RecordBytes, bytes.len() as u32)
                    }
                    Content::Deleted => None,
                })
        });
    if let Some(recovery) = excess {
        block(
            state,
            &Work::RegistryChanges(after),
            observation,
            "Registry page exceeds a configured projection limit",
            recovery,
            Some(bytes),
        );
        return Err(SourceStatus::Oversized);
    }
    state.observed_head = Some(page.span.observed_head);
    let end = if state.published.is_none() {
        page.span
            .delivered_through
            .min(state.bootstrap_target.expect("captured bootstrap target"))
    } else {
        page.span.delivered_through
    };
    if end == after {
        state.updated_at = Some(now);
        state.next_due = now.saturating_add(REFRESH);
        return Ok(());
    }

    let mutations = page
        .projected
        .into_iter()
        .take_while(|mutation| mutation.version <= end);
    let mut count = 0;
    STAGED.with_borrow_mut(|staging| {
        assert!(staging.is_empty(), "orphaned Registry stage");
        for mutation in mutations {
            staging.insert(
                count,
                V1(Pending {
                    mutation,
                    chunk_observations: vec![],
                    chunk_bytes: 0,
                }),
            );
            count += 1;
        }
    });
    state.staging = Some(Staging {
        end,
        observation,
        count,
        applied: 0,
        input_mutations: page.raw_mutations,
        superseded_mutations: page.superseded_mutations,
    });
    Ok(())
}

fn accept_chunk(
    state: &mut RegistryStatus,
    bytes: &[u8],
    hash: Hash,
    observation: u64,
) -> Result<(), SourceStatus> {
    let stage = state
        .staging
        .as_ref()
        .expect("chunk with no Registry stage");
    let mut pending = pending(stage.applied).expect("chunk with no staged mutation");
    let Content::Chunks(hashes) = &pending.mutation.value else {
        return Err(SourceStatus::Integrity("unsolicited Registry chunk".into()));
    };
    if hashes.get(pending.chunk_observations.len()) != Some(&hash) {
        return Err(SourceStatus::Integrity(
            "Registry chunk does not match stage".into(),
        ));
    }
    let chunk = registry::verify_chunk(bytes, hash).map_err(|err| match err {
        registry::ChunkError::Schema(message) => malformed(message),
        other => SourceStatus::Integrity(short(&other.to_string())),
    })?;
    let required = pending.chunk_bytes + chunk.len() as u32;
    let recovery = if required as usize > projection::MAX_RECORD_BYTES {
        Some(RegistryRecovery::UpgradeAdapter)
    } else {
        limit_recovery(
            state.limits.unwrap_or(RegistryLimits::MAX),
            RegistryLimit::RecordBytes,
            required,
        )
    };
    if let Some(recovery) = recovery {
        block(
            state,
            &Work::RegistryChunk(hash),
            observation,
            "Registry record exceeds reconstructed byte limit",
            recovery,
            None,
        );
        return Err(SourceStatus::Oversized);
    }
    pending.chunk_bytes += chunk.len() as u32;
    pending.chunk_observations.push(observation);
    evidence::put_blob(hash, chunk);
    STAGED.with_borrow_mut(|staging| staging.insert(stage.applied, V1(pending)));
    Ok(())
}

fn pending(index: u32) -> Option<Pending> {
    STAGED.with_borrow(|staging| staging.get(&index).map(|value| value.0))
}

pub fn apply_slice(now: u64) {
    let mut state = status();
    let mut stage = state.staging.take().expect("Registry apply without stage");
    for _ in 0..RECORDS_PER_SLICE {
        let Some(row) = pending(stage.applied) else {
            break;
        };
        if let Content::Chunks(hashes) = &row.mutation.value
            && hashes.len() != row.chunk_observations.len()
        {
            break;
        }
        match apply(row, &stage) {
            Ok((fresh, bytes)) => {
                state.retained_mutations += u64::from(fresh);
                state.retained_value_bytes += bytes;
                STAGED.with_borrow_mut(|staged| staged.remove(&stage.applied));
                stage.applied += 1;
            }
            Err(error) => {
                state.staging = Some(stage.clone());
                let cursor = state.ingested_through;
                block(
                    &mut state,
                    &Work::RegistryChanges(cursor),
                    stage.observation,
                    &error,
                    RegistryRecovery::UpgradeAdapter,
                    None,
                );
                break;
            }
        }
    }
    if stage.applied == stage.count {
        state.ingested_through = stage.end;
        state.processed_mutations += u64::from(stage.input_mutations);
        state.superseded_mutations += u64::from(stage.superseded_mutations);
        if state.published.is_some() || state.bootstrap_target == Some(stage.end) {
            state.published = Some(stage.end);
            state.updated_at = Some(now);
        }
        if state.observed_head == Some(stage.end) {
            state.next_due = now.saturating_add(REFRESH);
        }
    } else {
        state.staging = Some(stage);
    }
    save(state);
}

fn apply(row: Pending, stage: &Staging) -> Result<(bool, u64), String> {
    let Pending {
        mutation,
        chunk_observations,
        chunk_bytes,
    } = row;
    let bytes = match mutation.value {
        Content::Value(bytes) => Some(bytes),
        Content::Deleted => None,
        Content::Chunks(hashes) => {
            let mut assembled = Vec::with_capacity(chunk_bytes as usize);
            for hash in hashes {
                let chunk = evidence::blob(hash).ok_or("missing verified Registry chunk")?;
                assembled.extend(chunk);
            }
            if assembled.len() != chunk_bytes as usize {
                return Err("reconstructed Registry record length changed".into());
            }
            Some(assembled)
        }
    };
    let details = bytes
        .as_ref()
        .map(|bytes| {
            projection::details(&mutation.key, bytes)
                .map_err(|err| format!("{} at {}: {err}", mutation.key.name(), mutation.version))
        })
        .transpose()?;
    let (subnet, provider) = match details {
        Some(Details::Subnet { members, kind, .. }) => {
            (Some(SubnetMembership { members, kind }), None)
        }
        Some(Details::Operator { provider, .. }) => (None, provider),
        _ => (None, None),
    };
    let hash = bytes.as_deref().map(sha256);
    let key = mutation.key.name();
    let index = (
        Blob::try_from(key.as_bytes()).map_err(|_| "Registry index key too long")?,
        mutation.version,
    );
    let record = RecordEvidence {
        mutation_version: mutation.version,
        source_time: mutation.source_time,
        page: stage.observation,
        chunks: chunk_observations,
        value_hash: hash,
    };
    if let Some(old) = HISTORY.with_borrow(|history| history.get(&index)) {
        if old.0.evidence.value_hash != record.value_hash
            || old.0.evidence.source_time != record.source_time
        {
            return Err("conflicting Registry record already staged at this version".into());
        }
        return Ok((false, 0));
    }
    let bytes_len = bytes.as_ref().map_or(0, |bytes| bytes.len() as u64);
    if let Some((hash, bytes)) = hash.zip(bytes) {
        evidence::put_blob(hash, bytes);
    }
    HISTORY.with_borrow_mut(|history| {
        history.insert(
            index,
            V1(StoredRecord {
                evidence: record,
                subnet,
                provider,
            }),
        )
    });
    KEYS.with_borrow_mut(|keys| keys.insert(key, 0));
    Ok((true, bytes_len))
}

pub fn failed(work: &Work, error: &SourceStatus, observation: u64, now: u64, attempts: u8) {
    let mut state = status();
    if state.block.is_some() {
        return;
    }
    state.last_observation = Some(observation);
    state.attempts = state.attempts.saturating_add(1);
    let transient = matches!(
        error,
        SourceStatus::Interrupted
            | SourceStatus::Rejected {
                retryable: true,
                ..
            }
    );
    if transient && state.attempts < attempts {
        state.next_due = now.saturating_add((5 * SECOND) << (state.attempts - 1));
    } else {
        let recovery = if transient {
            RegistryRecovery::RetryTransient
        } else if matches!(error, SourceStatus::Oversized | SourceStatus::Malformed(_)) {
            RegistryRecovery::UpgradeAdapter
        } else {
            RegistryRecovery::RepairSource
        };
        block(
            &mut state,
            work,
            observation,
            &format!("{error:?}"),
            recovery,
            None,
        );
    }
    save(state);
}

fn malformed(error: String) -> SourceStatus {
    SourceStatus::Malformed(short(&error))
}

pub fn require_version(version: u64) -> Result<(), String> {
    if status()
        .published
        .is_some_and(|published| version <= published)
    {
        Ok(())
    } else {
        Err("Registry version is unavailable or incomplete".into())
    }
}

pub fn read(version: u64, key: &RecordKey) -> Result<RecordAt, String> {
    require_version(version)?;
    let name = key.name();
    if RecordKey::parse(name.as_bytes())?.is_none() {
        return Err("unknown record family".into());
    }
    let Some(StoredRecord { evidence, .. }) = entry(name, version) else {
        return Ok(RecordAt::Missing);
    };
    let Some(hash) = evidence.value_hash else {
        return Ok(RecordAt::Deleted(evidence));
    };
    let bytes = evidence::blob(hash).ok_or("published Registry record missing content")?;
    let details = projection::details(key, &bytes)?;
    Ok(RecordAt::Present { evidence, details })
}

fn entry(name: String, version: u64) -> Option<StoredRecord> {
    let name = Blob::try_from(name.as_bytes()).ok()?;
    HISTORY.with_borrow(|history| {
        history
            .range((name, 0)..=(name, version))
            .next_back()
            .map(|entry| entry.value().0)
    })
}

pub fn subnet_membership(
    version: u64,
    subnet: Principal,
) -> Result<Option<SubnetMembership>, String> {
    require_version(version)?;
    Ok(entry(RecordKey::Subnet(subnet).name(), version).and_then(|row| row.subnet))
}

pub fn roster(version: u64) -> Result<Vec<Principal>, String> {
    match read(version, &RecordKey::SubnetList)? {
        RecordAt::Present {
            details: Details::SubnetList(subnets),
            ..
        } => Ok(subnets),
        _ => Err("published subnet roster unavailable".into()),
    }
}

#[ic_cdk::update]
fn registry_status() -> Result<RegistryStatus, String> {
    require_controller()?;
    Ok(status())
}

#[ic_cdk::update]
fn configure_registry_limits(limits: RegistryLimits) -> Result<(), String> {
    require_controller()?;
    if [
        RegistryLimit::PageMutations,
        RegistryLimit::StagedMutations,
        RegistryLimit::RecordChunks,
        RegistryLimit::RecordBytes,
    ]
    .into_iter()
    .any(|limit| limits.get(limit) == 0 || limits.get(limit) > RegistryLimits::MAX.get(limit))
    {
        return Err("Registry limits exceed supported operational bounds".into());
    }
    let mut state = status();
    if state.staging.is_some() {
        let old = state.limits.unwrap_or(RegistryLimits::MAX);
        if limits.record_bytes < old.record_bytes || limits.record_chunks < old.record_chunks {
            return Err("cannot reduce record limits while a Registry page is staged".into());
        }
    }
    state.limits = Some(limits);
    save(state);
    Ok(())
}

#[ic_cdk::update]
fn retry_registry() -> Result<(), String> {
    require_controller()?;
    let mut state = status();
    if let Some(block) = &state.block {
        match block.recovery {
            RegistryRecovery::UpgradeAdapter if block.adapter_revision >= RECOVERY_REVISION => {
                return Err(
                    "Registry recovery requires a compatible adapter or protocol upgrade".into(),
                );
            }
            RegistryRecovery::IncreaseLimit { limit, required }
                if state.limits.unwrap_or(RegistryLimits::MAX).get(limit) < required =>
            {
                return Err(format!(
                    "raise {limit:?} to at least {required} before retrying"
                ));
            }
            _ => {}
        }
    }
    state.blocked = None;
    state.block = None;
    state.next_due = 0;
    state.attempts = 0;
    save(state);
    Ok(())
}

#[ic_cdk::update]
fn registry_record(version: u64, key: RecordKey) -> Result<RecordAt, String> {
    require_controller()?;
    let row = read(version, &key)?;
    if let RecordAt::Present { evidence, details } = &row
        && candid::encode_one(details)
            .expect("encode Registry view")
            .len()
            > 256 * 1024
    {
        return Ok(RecordAt::Opaque {
            evidence: evidence.clone(),
            reason: "typed view exceeds response budget".into(),
        });
    }
    Ok(row)
}

#[ic_cdk::update]
fn registry_keys(version: u64, after: Option<String>) -> Result<KeyPage, String> {
    require_controller()?;
    require_version(version)?;
    if after.as_ref().is_some_and(|key| key.len() > 300) {
        return Err("invalid Registry key cursor".into());
    }
    let scanned: Vec<String> = KEYS.with_borrow(|keys| {
        keys.range((after.map_or(Unbounded, Excluded), Unbounded))
            .take(65)
            .map(|entry| entry.key().clone())
            .collect()
    });
    let mut out = KeyPage {
        next: (scanned.len() > 64).then(|| scanned[63].clone()),
        keys: vec![],
    };
    for name in scanned.into_iter().take(64) {
        let Some(key) = RecordKey::parse(name.as_bytes())? else {
            continue;
        };
        let present = entry(name, version).is_some_and(|row| row.evidence.value_hash.is_some());
        if present {
            out.keys.push(key);
        }
    }
    Ok(out)
}

#[derive(CandidType, Deserialize)]
pub struct ProviderPage {
    pub operators: Vec<(Principal, RecordEvidence)>,
    pub next: Option<String>,
}

#[ic_cdk::update]
fn registry_provider(
    version: u64,
    provider: Principal,
    after: Option<String>,
) -> Result<ProviderPage, String> {
    require_controller()?;
    require_version(version)?;
    const PREFIX: &str = "node_operator_record_";
    if after
        .as_ref()
        .is_some_and(|key| key.len() > 300 || !key.starts_with(PREFIX))
    {
        return Err("invalid provider lookup cursor".into());
    }
    let lower = after.map_or_else(|| Included(PREFIX.into()), Excluded);
    let scanned: Vec<_> = KEYS.with_borrow(|keys| {
        keys.range((lower, Unbounded))
            .take_while(|entry| entry.key().starts_with(PREFIX))
            .take(65)
            .map(|entry| entry.key().clone())
            .collect()
    });
    let next = (scanned.len() > 64).then(|| scanned[63].clone());
    let mut operators = vec![];
    for name in scanned.into_iter().take(64) {
        let Some(RecordKey::Operator(operator)) = RecordKey::parse(name.as_bytes())? else {
            continue;
        };
        let Some(row) = entry(name, version) else {
            continue;
        };
        let Some(hash) = row.evidence.value_hash else {
            continue;
        };
        // Older projection envelopes omit the index. Recover the registered
        // provider from the preserved value when the index is unavailable.
        let registered = match row.provider {
            Some(provider) => Some(provider),
            None => {
                let bytes = evidence::blob(hash).ok_or("operator evidence unavailable")?;
                match projection::details(&RecordKey::Operator(operator), &bytes)? {
                    Details::Operator { provider, .. } => provider,
                    _ => unreachable!("operator decoder"),
                }
            }
        };
        if registered == Some(provider) {
            operators.push((operator, row.evidence));
        }
    }
    Ok(ProviderPage { operators, next })
}

#[ic_cdk::update]
fn registry_assignment(version: u64, node: Principal) -> Result<Assignment, String> {
    require_controller()?;
    assignment_at(version, node)
}

pub fn assignment_at(version: u64, node: Principal) -> Result<Assignment, String> {
    require_version(version)?;
    if !matches!(
        read(version, &RecordKey::Node(node))?,
        RecordAt::Present { .. }
    ) {
        return Ok(Assignment::UnknownNode);
    }
    let boundary = matches!(
        read(version, &RecordKey::ApiBoundary(node))?,
        RecordAt::Present { .. }
    );
    let mut replicas = vec![];
    for subnet in roster(version)? {
        let Some(membership) = subnet_membership(version, subnet)? else {
            return Ok(Assignment::Incomplete(format!(
                "subnet {subnet} unavailable at {version}"
            )));
        };
        if membership.members.contains(&node) {
            replicas.push(subnet);
        }
    }
    Ok(match (replicas.as_slice(), boundary) {
        ([], false) => Assignment::Unassigned,
        ([], true) => Assignment::ApiBoundary,
        ([subnet], false) => Assignment::Replica(*subnet),
        _ => Assignment::Conflict {
            replicas,
            api_boundary: boundary,
        },
    })
}
