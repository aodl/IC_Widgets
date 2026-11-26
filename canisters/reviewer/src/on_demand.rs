//! Bounded, request-local source reads. No archive or collector participates.
mod detail;
mod policy;
mod registry;

use std::{cell::Cell, collections::BTreeSet};

pub use detail::{DetailComparisonInput, DetailKeys, DetailRecords, LiveMembershipComparison};
pub use policy::PolicySnapshot;

use candid::{CandidType, Principal, encode_one};
use futures_util::future::join_all;
use ic_cdk::{
    api::{
        call_context_instruction_counter, canister_cycle_balance, canister_liquid_cycle_balance,
        is_controller, msg_caller, time,
    },
    call::Call,
};
use nexus_domain::{Hash, sha256};
use nexus_ic_sources::{
    decode_candid,
    governance::{self, ProposalInfo},
    management::{NodeMetricsHistoryArgs, NodeMetricsHistoryResult, decode_metrics},
};
use nexus_review_engine::{
    Capture, Proposal, ProposalEvidence, Review, ReviewError, ReviewInput, ScenarioId, ScopeState,
    analyze, requested_nodes,
};
use serde::Deserialize;

use crate::{Sources, budget::FLOOR, require_controller, store};

const SECOND: u64 = 1_000_000_000;
const DEADLINE: u64 = 120 * SECOND;
const PARALLEL: usize = 8;
const CALL_LIMIT: usize = 384;
const SOURCE_BYTES: u64 = 4 * 1024 * 1024;
const RESULT_BYTES: usize = 1024 * 1024;
const NODE_LIMIT: usize = 128;

thread_local! {
    static DELEGATE: Cell<Option<Principal>> = const { Cell::new(None) };
    static BUSY_UNTIL: Cell<u64> = const { Cell::new(0) };
}

#[derive(Debug, CandidType, Deserialize)]
pub enum LiveError {
    Deadline,
    CycleBalance,
    CallLimit,
    SourceBytes,
    ResultLimit,
    Source {
        observation: u64,
        reason: String,
    },
    InvalidEvidence(ReviewError),
    ProposalChanged {
        id: u64,
        status: i32,
        observation: u64,
    },
}

#[derive(CandidType, Deserialize)]
pub struct LiveReceipt {
    pub id: u64,
    pub source: Principal,
    pub method: String,
    pub item: String,
    pub argument_hash: Hash,
    pub observed_at: u64,
    pub reply_hash: Option<Hash>,
    pub reply_bytes: u64,
    pub reject: Option<String>,
}

#[derive(CandidType, Deserialize)]
pub struct LiveUsage {
    pub started_at: u64,
    pub finished_at: u64,
    pub calls: u32,
    pub source_bytes: u64,
    pub instructions: u64,
    pub balance_before: u128,
    pub balance_after: u128,
    pub peak_batch_reservation: u128,
}

#[derive(CandidType, Deserialize)]
pub struct LiveResponse<T> {
    pub registry_version: Option<u64>,
    pub outcome: Result<T, LiveError>,
    pub receipts: Vec<LiveReceipt>,
    pub usage: LiveUsage,
}

#[derive(Debug, CandidType, Deserialize, PartialEq, Eq)]
pub enum CandidateAssignment {
    ListedSubnet(Principal),
    ApiBoundary,
    UnknownOutsideListedSubnets,
    NodeAbsent,
}

#[derive(CandidType, Deserialize)]
pub struct LiveReview {
    pub report: Review,
    /// Listed subnet memberships actually checked.
    pub listed_subnets: u32,
    /// Present for membership previews. The Registry roster may be larger than the checked set.
    pub total_listed_subnets: Option<u32>,
    pub assignments: Vec<(Principal, CandidateAssignment)>,
    pub scopes: Vec<LiveScope>,
    pub proposal_text: Option<Vec<ProposalText>>,
    pub subnet_rules: Option<Vec<SubnetRules>>,
    pub review_context: Option<Hash>,
}

#[derive(CandidType, Deserialize)]
pub struct SubnetRules {
    pub subnet: Principal,
    pub kind: i32,
    pub sev_enabled: bool,
}

#[derive(CandidType, Deserialize)]
pub struct ProposalText {
    pub id: u64,
    pub title: Option<String>,
    pub summary: String,
    pub truncated: bool,
}

#[derive(CandidType, Deserialize)]
pub struct LiveScope {
    pub scenario: ScenarioId,
    pub subnet: Principal,
    pub nodes: Vec<Principal>,
}

#[derive(CandidType, Deserialize)]
pub struct LivePerformance {
    pub subnet: Principal,
    pub start_at_timestamp_nanos: u64,
    pub samples: NodeMetricsHistoryResult,
}

/// One optional browser principal for a local or explicitly approved pilot.
/// The principal is cleared on upgrade and receives no controller permissions.
#[ic_cdk::update]
fn set_on_demand_caller(caller: Option<Principal>) -> Result<(), String> {
    require_controller()?;
    if caller == Some(Principal::anonymous()) {
        return Err("an authenticated principal is required".into());
    }
    DELEGATE.set(caller);
    Ok(())
}

fn require_on_demand_caller() -> Result<(), String> {
    let caller = msg_caller();
    #[cfg(feature = "fixture-browser")]
    if caller != Principal::anonymous() {
        let sources = store::config().sources;
        if sources.governance == sources.registry
            && sources.registry != Sources::canonical().registry
        {
            return Ok(());
        }
    }
    if caller == Principal::anonymous()
        || (!is_controller(&caller) && DELEGATE.get() != Some(caller))
    {
        return Err("on-demand access requires an authorized principal".into());
    }
    Ok(())
}

struct RequestGuard(u64);

impl RequestGuard {
    fn acquire() -> Result<Self, String> {
        require_on_demand_caller()?;
        let now = time();
        if BUSY_UNTIL.get() > now {
            return Err("another on-demand request is running".into());
        }
        let expiry = now.saturating_add(DEADLINE);
        BUSY_UNTIL.set(expiry);
        Ok(Self(expiry))
    }
}

impl Drop for RequestGuard {
    fn drop(&mut self) {
        if BUSY_UNTIL.get() == self.0 {
            BUSY_UNTIL.set(0);
        }
    }
}

#[ic_cdk::update]
async fn review_on_demand(ids: Vec<u64>) -> Result<LiveResponse<LiveReview>, String> {
    preview(ids, false).await
}

#[ic_cdk::update]
async fn begin_membership_review(ids: Vec<u64>) -> Result<LiveResponse<LiveReview>, String> {
    preview(ids, true).await
}

async fn preview(ids: Vec<u64>, contextual: bool) -> Result<LiveResponse<LiveReview>, String> {
    let guard = RequestGuard::acquire()?;
    if !(1..=2).contains(&ids.len()) || ids.contains(&0) || (ids.len() == 2 && ids[0] == ids[1]) {
        return Err("select one or two distinct positive proposal IDs".into());
    }
    let mut request = Request::new(guard.0);
    let sources = if cfg!(feature = "local-fixtures") {
        store::config().sources
    } else {
        Sources::canonical()
    };
    let mut outcome = review(&mut request, sources, &ids).await;
    if contextual && let Ok(review) = &mut outcome {
        review.review_context = Some(policy::begin(
            &review.report,
            review.subnet_rules.as_deref().unwrap_or_default(),
        ));
    }
    Ok(request.finish(outcome))
}

#[ic_cdk::update]
async fn node_performance_on_demand(
    subnet: Principal,
    start_at_timestamp_nanos: u64,
    nodes: Option<Vec<Principal>>,
) -> Result<LiveResponse<LivePerformance>, String> {
    let guard = RequestGuard::acquire()?;
    const MAX_LOOKBACK: u64 = 60 * 24 * 60 * 60 * SECOND;
    let now = time();
    if subnet.as_slice().is_empty()
        || start_at_timestamp_nanos > now
        || now - start_at_timestamp_nanos > MAX_LOOKBACK
        || nodes.as_ref().is_some_and(|nodes| nodes.len() > NODE_LIMIT)
    {
        return Err("select a subnet, up to 128 nodes and a start within the last 60 days".into());
    }
    let mut request = Request::new(guard.0);
    let outcome = performance(&mut request, subnet, start_at_timestamp_nanos, nodes).await;
    Ok(request.finish(outcome))
}

async fn review(
    request: &mut Request,
    sources: Sources,
    ids: &[u64],
) -> Result<LiveReview, LiveError> {
    let initial = proposals(request, sources.governance, ids).await?;
    let instructions = initial
        .iter()
        .map(|(proposal, _)| {
            let (adds, removes) = requested_nodes(&proposal.action);
            adds.len() + removes.len()
        })
        .sum::<usize>();
    if instructions > 2 * NODE_LIMIT {
        return Err(LiveError::CallLimit);
    }
    let initial_proposals: Vec<_> = initial
        .iter()
        .map(|(proposal, _)| proposal.clone())
        .collect();
    let (baseline, assignments) =
        registry::resolve(request, sources.registry, &initial_proposals).await?;
    let roster = baseline.roster.value().expect("resolved roster");
    let listed_subnets = roster
        .iter()
        .filter(|id| baseline.subnets.contains_key(id))
        .count() as u32;
    let total_listed_subnets = Some(roster.len() as u32);

    // A status or action can change while Registry reads are in flight.
    let current = proposals(request, sources.governance, ids).await?;
    for ((before, _), (after, _)) in initial.iter().zip(&current) {
        let before = &before.evidence;
        let after = &after.evidence;
        check_proposal(before, after)?;
    }
    let subnet_rules = baseline
        .subnets
        .iter()
        .filter_map(|(&subnet, record)| {
            record.value().map(|row| SubnetRules {
                subnet,
                kind: row.kind,
                sev_enabled: row.sev_enabled,
            })
        })
        .collect();
    let (current, proposal_text): (Vec<_>, Vec<_>) = current.into_iter().unzip();
    let input = ReviewInput::build_membership(
        baseline,
        current
            .into_iter()
            .map(|p| Capture::Full(Box::new(p)))
            .collect(),
    )
    .map_err(LiveError::InvalidEvidence)?;
    let report = analyze(&input);
    let mut scopes = vec![];
    for scenario in &report.scenarios {
        for &subnet in scenario.subnets.keys() {
            if let ScopeState::Resolved(scope) = report.scope(scenario.id, subnet) {
                scopes.push(LiveScope {
                    scenario: scenario.id,
                    subnet,
                    nodes: scope.nodes().keys().copied().collect(),
                });
            }
        }
    }
    Ok(LiveReview {
        report,
        listed_subnets,
        total_listed_subnets,
        assignments,
        scopes,
        proposal_text: Some(proposal_text),
        subnet_rules: Some(subnet_rules),
        review_context: None,
    })
}

fn check_proposal(before: &ProposalEvidence, after: &ProposalEvidence) -> Result<(), LiveError> {
    if before.lifecycle_status != after.lifecycle_status
        || before.executed_at_seconds != after.executed_at_seconds
        || before.proposed_at_seconds != after.proposed_at_seconds
        || before.function != after.function
        || before.payload_hash != after.payload_hash
    {
        return Err(LiveError::ProposalChanged {
            id: after.id,
            status: after.lifecycle_status,
            observation: after.observation,
        });
    }
    Ok(())
}

async fn proposals(
    request: &mut Request,
    source: Principal,
    ids: &[u64],
) -> Result<Vec<(Proposal, ProposalText)>, LiveError> {
    let replies = request
        .read(
            source,
            "get_proposal_info",
            ids.iter()
                .map(|id| (id.to_string(), encode_one(id).expect("proposal ID")))
                .collect(),
        )
        .await?;
    ids.iter()
        .zip(replies)
        .map(|(&id, reply)| {
            let raw = reply
                .body
                .map_err(|reason| source_error(reply.id, reason))?;
            let info = decode_candid::<Option<ProposalInfo>>(&raw)
                .map_err(|err| source_error(reply.id, err))?
                .ok_or(LiveError::InvalidEvidence(ReviewError::MissingProposal(id)))?;
            if info.id.map(|p| p.id) != Some(id) {
                return Err(LiveError::InvalidEvidence(ReviewError::InvalidCapture(id)));
            }
            let executable = info.executable();
            let unsupported = || {
                LiveError::InvalidEvidence(ReviewError::UnsupportedAction {
                    id,
                    observation: reply.id,
                    function: executable.map(|action| action.nns_function),
                })
            };
            let executable = executable.ok_or_else(unsupported)?;
            let action = governance::membership(executable)
                .map_err(|_| {
                    LiveError::InvalidEvidence(ReviewError::MalformedPayload {
                        id,
                        observation: reply.id,
                    })
                })?
                .ok_or_else(unsupported)?;
            let proposal = Proposal {
                evidence: ProposalEvidence {
                    id,
                    observation: reply.id,
                    observed_at_nanos: reply.observed_at,
                    raw_hash: reply.hash.expect("successful reply hash"),
                    payload_hash: sha256(&executable.payload),
                    decoder: "on-demand-governance-v1".into(),
                    function: executable.nns_function,
                    lifecycle_status: info.status,
                    proposed_at_seconds: (info.proposal_timestamp_seconds > 0)
                        .then_some(info.proposal_timestamp_seconds),
                    executed_at_seconds: (info.executed_timestamp_seconds > 0)
                        .then_some(info.executed_timestamp_seconds),
                },
                action,
            };
            let text = info.proposal.expect("executable proposal");
            fn cap(mut text: String, limit: usize) -> String {
                if text.len() > limit {
                    let end = (0..=limit)
                        .rev()
                        .find(|&index| text.is_char_boundary(index))
                        .expect("start of string");
                    text.truncate(end);
                }
                text
            }
            let truncated = text.summary.len() > 30_000;
            Ok((
                proposal,
                ProposalText {
                    id,
                    title: text.title.map(|title| cap(title, 1024)),
                    summary: cap(text.summary, 30_000),
                    truncated,
                },
            ))
        })
        .collect()
}

async fn performance(
    request: &mut Request,
    subnet: Principal,
    start: u64,
    nodes: Option<Vec<Principal>>,
) -> Result<LivePerformance, LiveError> {
    let args = NodeMetricsHistoryArgs {
        subnet_id: subnet,
        start_at_timestamp_nanos: start,
    };
    let reply = request
        .one(
            Principal::management_canister(),
            "node_metrics_history",
            subnet.to_text(),
            encode_one(args).expect("metrics args"),
        )
        .await?;
    let data = reply
        .body
        .map_err(|reason| source_error(reply.id, reason))?;
    let mut samples = decode_metrics(&data, start).map_err(|err| source_error(reply.id, err))?;
    let nodes = nodes.map(|nodes| nodes.into_iter().collect::<BTreeSet<_>>());
    for sample in &mut samples {
        let mut seen = BTreeSet::new();
        if sample
            .node_metrics
            .iter()
            .any(|row| !seen.insert(row.node_id))
        {
            return Err(source_error(reply.id, "duplicate counter rows for a node"));
        }
        if let Some(nodes) = &nodes {
            sample
                .node_metrics
                .retain(|row| nodes.contains(&row.node_id));
        }
    }
    Ok(LivePerformance {
        subnet,
        start_at_timestamp_nanos: start,
        samples,
    })
}

struct Reply {
    id: u64,
    observed_at: u64,
    hash: Option<Hash>,
    body: Result<Vec<u8>, String>,
}

struct Request {
    started_at: u64,
    deadline: u64,
    balance_before: u128,
    peak_batch_reservation: u128,
    version: Option<u64>,
    bytes: u64,
    receipts: Vec<LiveReceipt>,
}

impl Request {
    fn new(deadline: u64) -> Self {
        Self {
            started_at: time(),
            deadline,
            balance_before: canister_cycle_balance(),
            peak_batch_reservation: 0,
            version: None,
            bytes: 0,
            receipts: vec![],
        }
    }

    fn finish<T: CandidType>(self, mut outcome: Result<T, LiveError>) -> LiveResponse<T> {
        if time() >= self.deadline {
            outcome = Err(LiveError::Deadline);
        }
        if outcome.as_ref().is_ok_and(|value| {
            encode_one(value).expect("on-demand result encoding").len() > RESULT_BYTES
        }) {
            outcome = Err(LiveError::ResultLimit);
        }
        LiveResponse {
            registry_version: self.version,
            outcome,
            usage: LiveUsage {
                started_at: self.started_at,
                finished_at: time(),
                calls: self.receipts.len() as u32,
                source_bytes: self.bytes,
                instructions: call_context_instruction_counter(),
                balance_before: self.balance_before,
                balance_after: canister_cycle_balance(),
                peak_batch_reservation: self.peak_batch_reservation,
            },
            receipts: self.receipts,
        }
    }

    async fn one(
        &mut self,
        source: Principal,
        method: &'static str,
        item: String,
        args: Vec<u8>,
    ) -> Result<Reply, LiveError> {
        Ok(self
            .read(source, method, vec![(item, args)])
            .await?
            .pop()
            .expect("one reply"))
    }

    async fn read(
        &mut self,
        source: Principal,
        method: &'static str,
        requests: Vec<(String, Vec<u8>)>,
    ) -> Result<Vec<Reply>, LiveError> {
        if self.receipts.len() + requests.len() > CALL_LIMIT {
            return Err(LiveError::CallLimit);
        }
        let mut replies = Vec::with_capacity(requests.len());
        for batch in requests.chunks(PARALLEL) {
            let seconds = self.deadline.saturating_sub(time()) / SECOND;
            if seconds == 0 {
                return Err(LiveError::Deadline);
            }
            let calls: Vec<_> = batch
                .iter()
                .map(|(_, args)| {
                    Call::bounded_wait(source, method)
                        .change_timeout(seconds.min(10) as u32)
                        .with_raw_args(args)
                })
                .collect();
            let reservation = calls.iter().map(Call::get_cost).sum::<u128>();
            if canister_liquid_cycle_balance() < reservation.saturating_add(FLOOR) {
                return Err(LiveError::CycleBalance);
            }
            self.peak_batch_reservation = self.peak_batch_reservation.max(reservation);
            let results = join_all(calls.into_iter().map(|call| async move {
                let response = call.await;
                (time(), response)
            }))
            .await;
            for ((item, args), (observed_at, response)) in batch.iter().zip(results) {
                let id = self.receipts.len() as u64 + 1;
                let body = response
                    .map(|reply| reply.into_bytes())
                    .map_err(|err| bounded_reason(err.to_string()));
                let (size, hash) = body.as_ref().map_or((0, None), |bytes| {
                    let size = bytes.len() as u64;
                    (
                        size,
                        (size <= SOURCE_BYTES && self.bytes + size <= SOURCE_BYTES)
                            .then(|| sha256(bytes)),
                    )
                });
                self.bytes += size;
                self.receipts.push(LiveReceipt {
                    id,
                    source,
                    method: method.into(),
                    item: item.clone(),
                    argument_hash: sha256(args),
                    observed_at,
                    reply_bytes: size,
                    reply_hash: hash,
                    reject: body.as_ref().err().cloned(),
                });
                replies.push(Reply {
                    id,
                    observed_at,
                    hash,
                    body,
                });
            }
            if self.bytes > SOURCE_BYTES {
                return Err(LiveError::SourceBytes);
            }
            if time() >= self.deadline {
                return Err(LiveError::Deadline);
            }
        }
        Ok(replies)
    }
}

fn bounded_reason(reason: String) -> String {
    reason.chars().take(240).collect()
}

fn source_error(observation: u64, reason: impl Into<String>) -> LiveError {
    LiveError::Source {
        observation,
        reason: bounded_reason(reason.into()),
    }
}
