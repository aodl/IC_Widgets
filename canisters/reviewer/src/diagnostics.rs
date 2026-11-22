use std::{cell::RefCell, time::Duration};

use candid::{CandidType, Principal};
use ic_cdk::{
    api::{
        canister_cycle_balance, canister_self, cost_call, instruction_counter, stable_size,
        subnet_self, time,
    },
    call::{Call, CallErrorExt, CallFailed},
};
use nexus_domain::sha256;
use nexus_ic_sources::{DECODER_REVISION, MAX_RESPONSE_BYTES, governance};
use serde::Deserialize;

use crate::{
    budget::{CALL_TIMEOUT, LEASE, Limits, REPLY_BYTES, SECOND, Stop, Usage},
    model::{Job, Observation, ProbeRequest, Receipt, Step},
    probe, require_controller,
    store::{self, Memory, V1},
};
use ic_stable_structures::StableBTreeMap;

#[derive(CandidType, Deserialize)]
pub struct ProbeBudget {
    pub usage: Usage,
    pub migrated_from_m0: bool,
}

thread_local! {
    static BUDGETS: RefCell<StableBTreeMap<u64, V1<ProbeBudget>, Memory>> =
        RefCell::new(StableBTreeMap::init(store::memory(4)));
}

fn save_budget(id: u64, budget: ProbeBudget) {
    BUDGETS.with_borrow_mut(|budgets| budgets.insert(id, V1(budget)));
}

fn budget_for(job: &Job) -> ProbeBudget {
    if let Some(budget) = BUDGETS.with_borrow(|budgets| budgets.get(&job.id)) {
        return budget.0;
    }
    // M0 did not persist an admission ledger. Reconstruct a conservative
    // reservation for its receipted dispatches and the outstanding attempt.
    let mut usage = Usage::new(
        Limits::PROBE,
        job.started_at_nanos,
        canister_cycle_balance(),
    );
    for index in 0..job.receipt_count {
        let receipt = store::receipt(job.id, index).expect("legacy receipt");
        usage.raw_bytes += u64::from(receipt.raw_bytes.unwrap_or(0));
        usage.cycles_reserved +=
            cost_call(receipt.method.len() as u64, receipt.request.len() as u64);
    }
    usage.calls = job.receipt_count;
    if job.in_flight {
        let command = job.pending[0].command(store::config().sources);
        usage.calls += 1;
        usage.cycles_reserved +=
            cost_call(command.method.len() as u64, command.request.len() as u64);
    }
    usage.slices = usage.calls;
    if job.completed_at_nanos.is_some() && job.stop_reason.is_none() {
        usage.stop = Some(Stop::Completed);
    }
    ProbeBudget {
        usage,
        migrated_from_m0: true,
    }
}

const MAX_JOBS: u64 = 12;
const RAW_BUDGET: u64 = 128 * 1024 * 1024;
const EXPORT_PAGE: usize = 128 * 1024;
const STEP_DELAY_NANOS: u64 = 1_000_000_000;
const RETRY_DELAY_NANOS: u64 = 5_000_000_000;

#[derive(CandidType, Deserialize)]
pub struct Status {
    pub job_id: u64,
    pub caller_subnet: Principal,
    pub captured_registry_head: Option<u64>,
    pub detected_remote_subnet: Option<Principal>,
    pub receipt_count: u32,
    pub remaining_steps: u32,
    pub in_flight: bool,
    pub completed_at_nanos: Option<u64>,
    pub stop_reason: Option<String>,
    pub started_at_nanos: u64,
    pub stable_pages: u64,
    pub stored_reply_bytes: u64,
    pub cycles: u128,
}

#[derive(CandidType, Deserialize)]
pub struct ReplyPage {
    pub bytes: Vec<u8>,
    pub next_offset: Option<u32>,
}

pub fn restore() {
    let config = store::config();
    assert_eq!(config.schema_version, 1, "unsupported stable schema");
    if let Some(id) = config.active_job {
        let mut job = store::job(id).expect("active job");
        if job.in_flight {
            let budget = budget_for(&job);
            recover_lease(&mut job, budget);
            if job.completed_at_nanos.is_some() {
                return;
            }
        }
        schedule(&job);
    }
}

#[ic_cdk::update]
fn start_probe(request: ProbeRequest) -> Result<u64, String> {
    start_probe_with_limits(request, Limits::PROBE)
}

#[ic_cdk::update]
fn start_probe_with_limits(request: ProbeRequest, limits: Limits) -> Result<u64, String> {
    require_controller()?;
    limits.validate(Limits::PROBE)?;
    let mut config = store::config();
    if let Some(id) = config.active_job {
        return Err(format!("probe {id} is already in progress"));
    }
    if config.jobs_created >= MAX_JOBS || config.raw_bytes + MAX_RESPONSE_BYTES as u64 > RAW_BUDGET
    {
        return Err("M0 stable evidence budget reached".into());
    }
    if matches!(request.proposal_id, Some(0 | u64::MAX)) {
        return Err("select a non-sentinel positive proposal ID".into());
    }
    let caller_subnet = subnet_self();
    if request.remote_subnet == Some(caller_subnet) {
        return Err("remote_subnet must differ from the calling subnet".into());
    }
    let mut pending = vec![
        Step::List {
            before: None,
            omit_large_fields: true,
            limit: governance::INITIAL_LIST_LIMIT,
        },
        Step::List {
            before: None,
            omit_large_fields: false,
            limit: governance::INITIAL_LIST_LIMIT,
        },
        Step::Head,
        Step::Proposal(u64::MAX),
    ];
    if let Some(id) = request.proposal_id {
        pending.insert(1, Step::Proposal(id));
    }
    probe::add_management(&mut pending, caller_subnet, request.metrics_start_nanos);
    if let Some(remote) = request.remote_subnet {
        probe::add_management(&mut pending, remote, request.metrics_start_nanos);
    }

    let id = config.jobs_created + 1;
    let job = Job {
        id,
        request,
        caller_subnet,
        captured_head: None,
        auto_remote: None,
        page_chunk_attempted: false,
        pending,
        receipt_count: 0,
        attempts: 0,
        generation: 0,
        in_flight: false,
        wake_at_nanos: time().saturating_add(STEP_DELAY_NANOS),
        stop_reason: None,
        started_at_nanos: time(),
        completed_at_nanos: None,
    };
    config.jobs_created = id;
    config.active_job = Some(id);
    store::put_config(config);
    schedule(&job);
    save_budget(
        id,
        ProbeBudget {
            usage: Usage::new(limits, job.started_at_nanos, canister_cycle_balance()),
            migrated_from_m0: false,
        },
    );
    store::put_job(job);
    Ok(id)
}

// Replicated diagnostics keep evidence retrieval authenticated by the IC protocol.
#[ic_cdk::update]
fn probe_status(id: u64) -> Result<Status, String> {
    require_controller()?;
    let job = store::job(id).ok_or("unknown job")?;
    Ok(Status {
        job_id: id,
        caller_subnet: job.caller_subnet,
        captured_registry_head: job.captured_head,
        detected_remote_subnet: job.auto_remote.or(job.request.remote_subnet),
        receipt_count: job.receipt_count,
        remaining_steps: job.pending.len() as u32,
        in_flight: job.in_flight,
        completed_at_nanos: job.completed_at_nanos,
        started_at_nanos: job.started_at_nanos,
        stop_reason: job.stop_reason,
        stable_pages: stable_size(),
        stored_reply_bytes: store::config().raw_bytes,
        cycles: canister_cycle_balance(),
    })
}

#[ic_cdk::update]
fn probe_receipt(id: u64, index: u32) -> Result<Receipt, String> {
    require_controller()?;
    store::receipt(id, index).ok_or_else(|| "unknown receipt".into())
}

#[ic_cdk::update]
fn probe_reply(id: u64, index: u32, offset: u32) -> Result<ReplyPage, String> {
    require_controller()?;
    let raw = store::raw(id, index).ok_or("no stored reply for receipt")?;
    let offset = offset as usize;
    if offset > raw.len() {
        return Err("offset beyond stored reply".into());
    }
    let end = (offset + EXPORT_PAGE).min(raw.len());
    Ok(ReplyPage {
        bytes: raw[offset..end].to_vec(),
        next_offset: (end < raw.len()).then_some(end as u32),
    })
}

#[ic_cdk::update]
fn probe_budget(id: u64) -> Result<ProbeBudget, String> {
    require_controller()?;
    store::job(id)
        .as_ref()
        .map(budget_for)
        .ok_or_else(|| "unknown job".into())
}

fn schedule(job: &Job) {
    let (id, generation) = (job.id, job.generation);
    let delay = Duration::from_nanos(job.wake_at_nanos.saturating_sub(time()));
    ic_cdk_timers::set_timer(delay, tick(id, generation));
}

async fn tick(id: u64, generation: u64) {
    let config = store::config();
    if config.active_job != Some(id) {
        return;
    }
    let mut job = store::job(id).expect("active job");
    if job.generation != generation || time() < job.wake_at_nanos {
        return;
    }
    let mut budget = budget_for(&job);
    if job.in_flight {
        recover_lease(&mut job, budget);
        if job.completed_at_nanos.is_none() {
            schedule(&job);
        }
        return;
    }
    let Some(step) = job.pending.first().cloned() else {
        finish(job, config, budget, Stop::Completed);
        return;
    };
    if config.raw_bytes.saturating_add(REPLY_BYTES) > RAW_BUDGET {
        finish(job, config, budget, Stop::StorageLimit);
        return;
    }
    let command = step.command(config.sources);
    let price = cost_call(command.method.len() as u64, command.request.len() as u64);
    if let Err(reason) = budget
        .usage
        .admit(time(), canister_cycle_balance(), Some(price))
    {
        finish(job, config, budget, reason);
        return;
    }

    job.attempts += 1;
    job.generation += 1;
    job.in_flight = true;
    job.wake_at_nanos = time().saturating_add(LEASE);
    let generation = job.generation;
    schedule(&job);
    let limits = budget.usage.limits;
    save_budget(id, budget);
    store::put_job(job);

    let sent_at_nanos = time();
    let cycles_before = canister_cycle_balance();
    let result = Call::bounded_wait(command.source, command.method)
        .change_timeout(CALL_TIMEOUT.min(limits.duration_secs))
        .with_raw_args(&command.request)
        .await;

    let cycles_at_callback = canister_cycle_balance();
    let received_at_nanos = time();
    let mut config = store::config();
    let Some(mut job) = store::job(id).filter(|active| {
        config.active_job == Some(id) && active.generation == generation && active.in_flight
    }) else {
        return;
    };
    let mut budget = budget_for(&job);
    let (raw, observation, retry) = match result {
        Ok(response) if response.len() <= MAX_RESPONSE_BYTES => {
            let bytes = response.into_bytes();
            let observation = step
                .observe(&bytes, &mut job)
                .unwrap_or_else(|err| Observation::InvalidResponse(probe::short_error(&err)));
            (Some(bytes), observation, false)
        }
        Ok(_) => (
            None,
            Observation::InvalidResponse("replicated reply exceeded byte budget".into()),
            false,
        ),
        Err(err) => {
            let code = match &err {
                CallFailed::CallRejected(reject) => {
                    reject.reject_code().ok().map(|code| code as u32)
                }
                _ => None,
            };
            if let (
                Some(5),
                Step::List {
                    before,
                    omit_large_fields,
                    limit,
                },
                CallFailed::CallRejected(reject),
            ) = (code, &step, &err)
                && let Some(limit) = governance::reduced_list_limit(*limit, reject.reject_message())
            {
                job.pending.insert(
                    1,
                    Step::List {
                        before: *before,
                        omit_large_fields: *omit_large_fields,
                        limit,
                    },
                );
            }
            let retryable = err.is_immediately_retryable();
            let observation = Observation::Rejected {
                code,
                retryable,
                message: probe::short_error(&err.to_string()),
            };
            (
                None,
                observation,
                retryable && job.attempts < limits.attempts,
            )
        }
    };
    let receipt = Receipt {
        job_id: id,
        index: job.receipt_count,
        attempt: job.attempts,
        calling_canister: canister_self(),
        calling_subnet: job.caller_subnet,
        source: command.source,
        method: command.method.into(),
        request: command.request,
        sent_at_nanos,
        received_at_nanos,
        cycles_before,
        cycles_at_callback,
        raw_bytes: raw.as_ref().map(|bytes| bytes.len() as u32),
        raw_hash: raw.as_deref().map(sha256),
        decoder_revision: DECODER_REVISION.into(),
        observation,
    };
    let reply_bytes = u64::from(receipt.raw_bytes.unwrap_or(0));
    budget.usage.raw_bytes += reply_bytes;
    config.raw_bytes += reply_bytes;
    store::put_receipt(receipt, raw);
    budget.usage.observe_balance(canister_cycle_balance());
    budget.usage.measured_instructions = budget
        .usage
        .measured_instructions
        .saturating_add(instruction_counter());

    job.receipt_count += 1;
    job.in_flight = false;
    job.generation += 1;
    if !retry {
        job.pending.remove(0);
        job.attempts = 0;
    }
    if job.pending.is_empty() {
        finish(job, config, budget, Stop::Completed);
    } else {
        let delay = if retry {
            RETRY_DELAY_NANOS
        } else {
            STEP_DELAY_NANOS
        };
        job.wake_at_nanos = time().saturating_add(delay);
        schedule(&job);
        save_budget(id, budget);
        store::put_job(job);
        store::put_config(config);
    }
}

fn recover_lease(job: &mut Job, budget: ProbeBudget) {
    job.in_flight = false;
    job.generation += 1;
    job.wake_at_nanos = time().saturating_add(SECOND);
    if job.attempts >= budget.usage.limits.attempts {
        job.completed_at_nanos = Some(time());
        finish(job.clone(), store::config(), budget, Stop::AttemptLimit);
    } else {
        save_budget(job.id, budget);
        store::put_job(job.clone());
    }
}

fn finish(mut job: Job, mut config: store::Config, mut budget: ProbeBudget, reason: Stop) {
    budget.usage.observe_balance(canister_cycle_balance());
    budget.usage.stop = Some(reason);
    job.stop_reason = (reason != Stop::Completed).then(|| format!("{reason:?}"));
    job.completed_at_nanos = Some(time());
    config.active_job = None;
    save_budget(job.id, budget);
    store::put_job(job);
    store::put_config(config);
}
