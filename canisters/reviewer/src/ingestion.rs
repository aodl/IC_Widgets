use std::{cell::RefCell, time::Duration};

use candid::{CandidType, Principal};
use ic_cdk::{
    api::{canister_cycle_balance, cost_call, instruction_counter, stable_size, time},
    call::{Call, CallErrorExt, CallFailed},
};
use ic_stable_structures::StableCell;
use nexus_domain::{Hash, sha256};
use nexus_ic_sources::{DECODER_REVISION, MAX_RESPONSE_BYTES, registry};
use serde::Deserialize;

use crate::{
    budget::{CALL_TIMEOUT, LEASE, Limits, SECOND, Stop, Usage},
    evidence::{self, EvidenceManifest, SourceObservation, SourceStatus},
    model::Sources,
    registry_sync, require_controller,
    store::{self, Memory, V1, memory},
};

const DAY: u64 = 86_400 * SECOND;
const IDLE: u64 = 30 * SECOND;
const STORAGE_PAGES: u64 = 32_768 - 1024; // 2 GiB allocated, with room for one bounded slice.

pub const COLLECTION_LIMITS: Limits = Limits {
    cycle_ceiling: 100_000_000_000_000,
    calls: 2_000,
    attempts: 3,
    raw_bytes: 256 * 1024 * 1024,
    slices: 20_000,
    duration_secs: 86_400,
};

#[derive(Clone, Debug, CandidType, Deserialize)]
pub enum Work {
    RegistryHead,
    RegistryChanges(u64),
    RegistryChunk(Hash),
}

pub struct Request {
    pub source: Principal,
    pub method: &'static str,
    pub bytes: Vec<u8>,
}

impl Work {
    fn request(&self, sources: Sources) -> Request {
        let (method, bytes) = match self {
            Self::RegistryHead => ("get_latest_version", vec![]),
            Self::RegistryChanges(after) => {
                ("get_changes_since", registry::changes_request(*after))
            }
            Self::RegistryChunk(hash) => (
                "get_chunk",
                candid::encode_one(registry::ChunkRequest {
                    content_sha256: Some(hash.to_vec()),
                })
                .expect("chunk request"),
            ),
        };
        Request {
            source: sources.registry,
            method,
            bytes,
        }
    }
}

#[derive(Clone, CandidType, Deserialize)]
struct Lease {
    generation: u64,
    work: Work,
    dispatched_at: u64,
}

#[derive(Clone, Default, CandidType, Deserialize)]
struct Scheduler {
    limits: Option<Limits>,
    usage: Option<Usage>,
    generation: u64,
    observation: u64,
    lease: Option<Lease>,
}

#[derive(CandidType, Deserialize)]
pub struct CollectionStatus {
    pub enabled: bool,
    pub in_flight: Option<Work>,
    pub last_observation: u64,
    pub usage: Option<Usage>,
    pub allocated_pages: u64,
}

thread_local! {
    static SCHEDULER: RefCell<StableCell<V1<Scheduler>, Memory>> =
        RefCell::new(StableCell::init(memory(5), V1(Scheduler::default())));
}

fn load() -> Scheduler {
    SCHEDULER.with_borrow(|state| state.get().0.clone())
}

fn save(state: Scheduler) {
    SCHEDULER.with_borrow_mut(|cell| {
        cell.set(V1(state));
    });
}

pub fn owns_dispatch() -> bool {
    let state = load();
    state.limits.is_some() || state.lease.is_some()
}

pub fn restore() {
    let mut state = load();
    if let Some(lease) = state.lease.take() {
        record_interruption(&mut state, &lease);
        state.generation += 1;
        save(state.clone());
    }
    if state.limits.is_some() {
        schedule(state.generation, SECOND);
    }
}

#[ic_cdk::update]
fn configure_collection(limits: Option<Limits>) -> Result<(), String> {
    require_controller()?;
    let mut state = load();
    if let Some(limits) = limits {
        limits.validate(COLLECTION_LIMITS)?;
        if state.limits.is_some() || state.lease.is_some() || store::config().active_job.is_some() {
            return Err("pause active work and let its outstanding call drain first".into());
        }
        state.usage = Some(Usage::new(limits, time(), canister_cycle_balance()));
        state.limits = Some(limits);
        state.generation += 1;
        schedule(state.generation, SECOND);
    } else {
        state.limits = None;
        if state.lease.is_none() {
            state.generation += 1;
        }
    }
    save(state);
    Ok(())
}

#[ic_cdk::update]
fn collection_status() -> Result<CollectionStatus, String> {
    require_controller()?;
    let state = load();
    Ok(CollectionStatus {
        enabled: state.limits.is_some(),
        in_flight: state.lease.map(|lease| lease.work),
        last_observation: state.observation,
        usage: state.usage,
        allocated_pages: stable_size(),
    })
}

#[ic_cdk::update]
fn source_observation(id: u64) -> Result<SourceObservation, String> {
    require_controller()?;
    evidence::observation(id).ok_or_else(|| "unknown source observation".into())
}

#[ic_cdk::update]
fn evidence_bytes(hash: Hash, offset: u32) -> Result<crate::ReplyPage, String> {
    require_controller()?;
    let data = evidence::blob(hash).ok_or("content not retained")?;
    let offset = offset as usize;
    if offset > data.len() {
        return Err("offset beyond content".into());
    }
    let end = (offset + evidence::BLOB_PAGE).min(data.len());
    Ok(crate::ReplyPage {
        bytes: data[offset..end].to_vec(),
        next_offset: (end < data.len()).then_some(end as u32),
    })
}

#[ic_cdk::update]
fn evidence_manifest(version: Option<u64>, ids: Vec<u64>) -> Result<EvidenceManifest, String> {
    require_controller()?;
    if let Some(version) = version {
        registry_sync::require_version(version)?;
    }
    evidence::manifest(version, ids)
}

fn schedule(generation: u64, delay: u64) -> ic_cdk_timers::TimerId {
    ic_cdk_timers::set_timer(Duration::from_nanos(delay), tick(generation))
}

async fn tick(generation: u64) {
    let mut state = load();
    if state.generation != generation {
        return;
    }
    if let Some(lease) = state.lease.take() {
        record_interruption(&mut state, &lease);
        next_tick(state, SECOND);
        return;
    }
    let Some(limits) = state.limits else {
        return;
    };
    let mut usage = state.usage.expect("enabled collection budget");
    let now = time();
    if now >= usage.started_at.saturating_add(DAY) {
        usage = Usage::new(limits, now, canister_cycle_balance());
    }
    let task = registry_sync::next(now);
    let (work, request) = match task {
        registry_sync::Next::Idle => {
            state.usage = Some(usage);
            next_tick(state, IDLE);
            return;
        }
        registry_sync::Next::Apply => (None, None),
        registry_sync::Next::Call(work) => {
            let request = work.request(store::config().sources);
            (Some(work), Some(request))
        }
    };
    let price = request
        .as_ref()
        .map(|r| cost_call(r.method.len() as u64, r.bytes.len() as u64));
    let admitted = if stable_size() >= STORAGE_PAGES {
        Err(Stop::StorageLimit)
    } else {
        usage.admit(now, canister_cycle_balance(), price)
    };
    if let Err(stop) = admitted {
        usage.stop = Some(stop);
        state.usage = Some(usage);
        let delay = match stop {
            Stop::CycleBalance | Stop::StorageLimit => 300 * SECOND,
            _ => usage
                .started_at
                .saturating_add(DAY)
                .saturating_sub(now)
                .max(SECOND),
        };
        next_tick(state, delay);
        return;
    }
    usage.stop = None;
    state.usage = Some(usage);
    let (Some(work), Some(request)) = (work, request) else {
        registry_sync::apply_slice(now);
        account_instructions(&mut state);
        next_tick(state, SECOND);
        return;
    };

    state.generation += 1;
    let lease = Lease {
        generation: state.generation,
        work,
        dispatched_at: now,
    };
    state.lease = Some(lease.clone());
    let watchdog = schedule(lease.generation, LEASE);
    save(state);

    let reply = Call::bounded_wait(request.source, request.method)
        .change_timeout(CALL_TIMEOUT)
        .with_raw_args(&request.bytes)
        .await;
    let mut state = load();
    if state.lease.as_ref().map(|active| active.generation) != Some(lease.generation) {
        return;
    }
    ic_cdk_timers::clear_timer(watchdog);
    state.lease = None;
    state.observation += 1;
    let id = state.observation;
    let observed_at = time();
    let (status, raw_hash, raw_bytes) = match reply {
        Ok(reply) if reply.len() <= MAX_RESPONSE_BYTES => {
            let bytes = reply.into_bytes();
            let hash = sha256(&bytes);
            let len = bytes.len() as u32;
            let status = registry_sync::accept(&lease.work, &bytes, id, observed_at);
            if matches!(
                status,
                SourceStatus::Malformed(_) | SourceStatus::Integrity(_)
            ) {
                evidence::put_blob(hash, bytes);
            }
            (status, Some(hash), Some(len))
        }
        Ok(_) => (SourceStatus::Oversized, None, None),
        Err(error) => (call_error(error), None, None),
    };
    if let Some(usage) = &mut state.usage {
        usage.raw_bytes += u64::from(raw_bytes.unwrap_or(0));
    }
    if !matches!(status, SourceStatus::Valid) {
        registry_sync::failed(&status, id, observed_at, limits.attempts);
    }
    evidence::observe(row(
        id,
        &lease,
        request,
        observed_at,
        raw_hash,
        raw_bytes,
        status,
    ));
    account_instructions(&mut state);
    next_tick(state, SECOND);
}

fn call_error(err: CallFailed) -> SourceStatus {
    let code = match &err {
        CallFailed::CallRejected(reject) => reject.reject_code().ok().map(|code| code as u32),
        _ => None,
    };
    let message = err.to_string();
    if code == Some(5) && message.contains("ic0.msg_reply_data_append: application payload size") {
        return SourceStatus::Oversized;
    }
    SourceStatus::Rejected {
        code,
        retryable: err.is_immediately_retryable(),
        message: short(&message),
    }
}

pub fn short(message: &str) -> String {
    message.chars().take(240).collect()
}

fn record_interruption(state: &mut Scheduler, lease: &Lease) {
    state.observation += 1;
    let now = time();
    registry_sync::failed(
        &SourceStatus::Interrupted,
        state.observation,
        now,
        state.usage.map_or(1, |usage| usage.limits.attempts),
    );
    evidence::observe(row(
        state.observation,
        lease,
        lease.work.request(store::config().sources),
        now,
        None,
        None,
        SourceStatus::Interrupted,
    ));
}

fn row(
    id: u64,
    lease: &Lease,
    request: Request,
    observed_at: u64,
    raw_hash: Option<Hash>,
    raw_bytes: Option<u32>,
    status: SourceStatus,
) -> SourceObservation {
    SourceObservation {
        id,
        source: request.source,
        method: request.method.into(),
        argument_hash: sha256(&request.bytes),
        argument: request.bytes,
        dispatched_at: lease.dispatched_at,
        observed_at,
        raw_hash,
        raw_bytes,
        decoder_revision: DECODER_REVISION.into(),
        status,
    }
}

fn account_instructions(state: &mut Scheduler) {
    if let Some(usage) = &mut state.usage {
        usage.observe_balance(canister_cycle_balance());
        usage.measured_instructions = usage
            .measured_instructions
            .saturating_add(instruction_counter());
    }
}

fn next_tick(mut state: Scheduler, delay: u64) {
    state.generation += 1;
    if state.limits.is_some() {
        schedule(state.generation, delay);
    }
    save(state);
}
