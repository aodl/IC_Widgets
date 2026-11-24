use std::{
    cell::RefCell,
    collections::BTreeSet,
    ops::Bound::{Excluded, Unbounded},
};

use candid::{CandidType, Principal};
use ic_stable_structures::StableBTreeMap;
use nexus_domain::{Hash, sha256};
use nexus_ic_sources::{
    management::NodeMetrics,
    projection::{Details, RecordKey},
};
use nexus_review_engine::{
    Capture, NodeRole, Policy, Proposal, ProposalEvidence, Record, RecordStamp, RegistryBaseline,
    RegistryKey, Review, ReviewError, ReviewInput, ScenarioId, ScenarioSelection, ScopeIdentity,
    ScopeState, ScopeUnavailable, ScopedNode, analyze, data_center_key, relevant_nodes,
};
use serde::Deserialize;

use crate::{
    MetricSample, RecordAt, RecordEvidence, ReplyPage, SourceStatus,
    budget::FLOOR,
    evidence,
    governance_archive::{self, ActionStatus},
    metrics_archive, registry_sync, require_controller, review_records,
    store::{Memory, V1, memory},
};

const JOB_LIMIT: u64 = 64;
const NODE_LIMIT: usize = 384;
const INSTRUCTION_LIMIT: usize = 768;
const REGISTRY_BYTES: usize = 2 * 1024 * 1024;
const REPORT_BYTES: usize = 1024 * 1024;
const PAGE_ROWS: usize = 64;

#[derive(Clone, CandidType, Deserialize)]
pub struct SelectedProposal {
    pub id: u64,
    pub observation: Option<u64>,
}

#[derive(Clone, CandidType, Deserialize)]
pub struct ReviewRequest {
    pub registry_version: u64,
    pub proposals: Vec<SelectedProposal>,
    pub scenario: ScenarioSelection,
    pub request_missing: bool,
    pub hypothetical_executed: Option<bool>,
}

#[derive(Clone, CandidType, Deserialize)]
pub struct ReviewJob {
    pub request: ReviewRequest,
    pub state: ReviewJobState,
    queued: Vec<u64>,
}

#[derive(Clone, CandidType, Deserialize)]
pub enum ReviewJobState {
    Pending,
    Waiting { proposals: Vec<u64>, registry: bool },
    Complete(Hash),
    Blocked(ReviewFailure),
}

#[derive(Clone, CandidType, Deserialize)]
pub enum ReviewFailure {
    InvalidEvidence(ReviewError),
    SupersededByExecution {
        id: u64,
        execution_observation: u64,
    },
    UnavailableProposal {
        id: u64,
        observation: u64,
        status: SourceStatus,
    },
    RegistryRead {
        key: RegistryKey,
        reason: String,
    },
    ReviewLimit,
}

#[derive(CandidType, Deserialize)]
pub enum ScopePage {
    Unavailable(ScopeUnavailable),
    Nodes {
        identity: Box<ScopeIdentity>,
        selection: Hash,
        rows: Vec<(Principal, ScopedNode)>,
        next: Option<Principal>,
    },
}

thread_local! {
    static JOBS: RefCell<StableBTreeMap<Hash, V1<ReviewJob>, Memory>> =
        RefCell::new(StableBTreeMap::init(memory(21)));
    // The value is the exact v1 report encoding served to clients.
    static REPORTS: RefCell<StableBTreeMap<Hash, Vec<u8>, Memory>> =
        RefCell::new(StableBTreeMap::init(memory(22)));
}

#[ic_cdk::update]
fn request_membership_review(request: ReviewRequest) -> Result<Hash, String> {
    let mut request = request;
    require_controller()?;
    if request.proposals.is_empty()
        || request.proposals.len() > 2
        || request
            .proposals
            .iter()
            .any(|p| p.id == 0 || p.observation == Some(0))
        || (request.proposals.len() == 2 && request.proposals[0].id == request.proposals[1].id)
        || (request.proposals.len() == 1
            && !matches!(
                request.scenario,
                ScenarioSelection::All | ScenarioSelection::A
            ))
    {
        return Err("select one or two distinct proposal IDs and an applicable scenario".into());
    }
    request.hypothetical_executed = request.hypothetical_executed.filter(|enabled| *enabled);
    for selection in &mut request.proposals {
        if selection.observation.is_none() {
            selection.observation = governance_archive::index(selection.id).last_capture;
        }
    }
    let key = sha256(&candid::encode_args((1u16, &request)).expect("review request encoding"));
    JOBS.with_borrow_mut(|jobs| {
        if !jobs.contains_key(&key) {
            if jobs.len() >= JOB_LIMIT {
                return Err("review request storage limit reached".into());
            }
            jobs.insert(
                key,
                V1(ReviewJob {
                    request,
                    state: ReviewJobState::Pending,
                    queued: vec![],
                }),
            );
        }
        Ok(key)
    })
}

fn job(key: Hash) -> Result<ReviewJob, String> {
    JOBS.with_borrow(|jobs| jobs.get(&key).map(|row| row.0))
        .ok_or("unknown review request".into())
}

#[ic_cdk::update]
fn membership_review_status(key: Hash) -> Result<ReviewJob, String> {
    require_controller()?;
    job(key)
}

#[ic_cdk::update]
fn advance_membership_review(key: Hash) -> Result<ReviewJob, String> {
    require_controller()?;
    let mut row = job(key)?;
    if matches!(
        row.state,
        ReviewJobState::Complete(_) | ReviewJobState::Blocked(_)
    ) {
        return Ok(row);
    }
    if ic_cdk::api::canister_cycle_balance() < FLOOR {
        return Err("cycle balance below the review safety floor".into());
    }
    row.state = match resolve(&mut row)? {
        Ok(state) => state,
        Err(failure) => ReviewJobState::Blocked(failure),
    };
    JOBS.with_borrow_mut(|jobs| jobs.insert(key, V1(row.clone())));
    Ok(row)
}

fn resolve(row: &mut ReviewJob) -> Result<Result<ReviewJobState, ReviewFailure>, String> {
    let mut captures = Vec::with_capacity(row.request.proposals.len());
    let mut waiting = vec![];
    for selection in &mut row.request.proposals {
        match full_capture(selection) {
            Ok(Some(proposal)) => {
                selection.observation = Some(proposal.evidence.observation);
                captures.push(proposal);
            }
            Ok(None) => {
                if row.request.request_missing && !row.queued.contains(&selection.id) {
                    governance_archive::enqueue_capture(selection.id)?;
                    row.queued.push(selection.id);
                }
                waiting.push(selection.id);
            }
            Err(failure) => return Ok(Err(failure)),
        }
    }
    let version = row.request.registry_version;
    let registry_waiting = registry_sync::require_version(version).is_err();
    if !waiting.is_empty() || registry_waiting {
        return Ok(Ok(ReviewJobState::Waiting {
            proposals: waiting,
            registry: registry_waiting,
        }));
    }
    Ok(build_report(
        version,
        captures,
        row.request.scenario,
        row.request.hypothetical_executed == Some(true),
    )
    .map(ReviewJobState::Complete))
}

fn full_capture(selection: &SelectedProposal) -> Result<Option<Proposal>, ReviewFailure> {
    let id = selection.id;
    let capture = match governance_archive::archived_proposal(id, selection.observation) {
        Ok(capture) => capture,
        Err(_) => {
            if selection.observation.is_some() {
                return Err(ReviewFailure::InvalidEvidence(
                    ReviewError::MissingProposal(id),
                ));
            }
            let index = governance_archive::index(id);
            if let Some(observation) = index.last_observation
                && let Some(status) = index.last_status
                && !governance_archive::pending_capture(id)
            {
                return Err(ReviewFailure::UnavailableProposal {
                    id,
                    observation,
                    status,
                });
            }
            return Ok(None);
        }
    };
    if capture.lifecycle.status != 4
        && let Ok(latest) = governance_archive::archived_proposal(id, None)
        && latest.lifecycle.status == 4
        && latest.observation > capture.observation
    {
        return Err(ReviewFailure::SupersededByExecution {
            id,
            execution_observation: latest.observation,
        });
    }
    let observation = capture.observation;
    let error = match capture.action_status {
        ActionStatus::Membership => None,
        ActionStatus::MalformedPayload(_) => {
            Some(ReviewError::MalformedPayload { id, observation })
        }
        _ => Some(ReviewError::UnsupportedAction {
            id,
            observation,
            function: capture.function,
        }),
    };
    if let Some(error) = error {
        return Err(ReviewFailure::InvalidEvidence(error));
    }
    let invalid = || ReviewFailure::InvalidEvidence(ReviewError::InvalidCapture(id));
    let action =
        governance_archive::archived_action(id, Some(observation)).map_err(|_| invalid())?;
    let source = evidence::observation(observation).ok_or_else(invalid)?;
    if source.method != "get_proposal_info" || source.observed_at != capture.collected_at {
        return Err(invalid());
    }
    Ok(Some(Proposal {
        evidence: ProposalEvidence {
            id,
            observation,
            observed_at_nanos: capture.collected_at,
            raw_hash: capture.raw_hash,
            payload_hash: capture.payload_hash.ok_or_else(invalid)?,
            decoder: source.decoder_revision,
            function: capture.function.ok_or_else(invalid)?,
            lifecycle_status: capture.lifecycle.status,
            proposed_at_seconds: (capture.lifecycle.proposed_at_seconds > 0)
                .then_some(capture.lifecycle.proposed_at_seconds),
            executed_at_seconds: capture.lifecycle.executed_at_seconds,
        },
        action,
    }))
}

fn build_report(
    version: u64,
    proposals: Vec<Proposal>,
    scenario: ScenarioSelection,
    hypothetical_executed: bool,
) -> Result<Hash, ReviewFailure> {
    let instructions = proposals
        .iter()
        .map(|proposal| {
            let (adds, removes) = nexus_review_engine::requested_nodes(&proposal.action);
            adds.len() + removes.len()
        })
        .sum::<usize>();
    if instructions > INSTRUCTION_LIMIT {
        return Err(ReviewFailure::ReviewLimit);
    }
    let registry = resolve_registry(version, &proposals)?;
    let input = ReviewInput::build(
        registry,
        proposals
            .into_iter()
            .map(|proposal| Capture::Full(Box::new(proposal)))
            .collect(),
        scenario,
        Policy::V1,
        None,
        None,
        hypothetical_executed,
    )
    .map_err(ReviewFailure::InvalidEvidence)?;
    let review = analyze(&input);
    let report = candid::encode_one(&review).expect("review report encoding");
    if report.len() > REPORT_BYTES {
        return Err(ReviewFailure::ReviewLimit);
    }
    REPORTS.with_borrow_mut(|reports| {
        if !reports.contains_key(&review.revision) {
            reports.insert(review.revision, report);
        }
    });
    Ok(review.revision)
}

struct Resolver {
    version: u64,
    bytes_left: usize,
}

impl Resolver {
    fn read<T>(
        &mut self,
        key: RecordKey,
        reference: RegistryKey,
        project: impl FnOnce(Details) -> Option<T>,
    ) -> Result<Record<T>, ReviewFailure> {
        let row = registry_sync::read_with_byte_budget(self.version, &key, &mut self.bytes_left)
            .map_err(|reason| ReviewFailure::RegistryRead {
                key: reference,
                reason,
            })?;
        Ok(match row {
            RecordAt::Missing => Record::Missing,
            RecordAt::Deleted(row) => Record::Deleted(stamp(row)),
            RecordAt::Present { evidence, details } => match project(details) {
                Some(value) => Record::Present {
                    value,
                    stamp: stamp(evidence),
                },
                None => Record::Unavailable {
                    reason: "Registry review schema unavailable".into(),
                    stamp: Some(stamp(evidence)),
                },
            },
            RecordAt::Opaque { evidence, reason } => Record::Unavailable {
                reason,
                stamp: Some(stamp(evidence)),
            },
        })
    }
}

fn stamp(evidence: RecordEvidence) -> RecordStamp {
    RecordStamp {
        mutation_version: evidence.mutation_version,
        mutation_time: evidence.source_time,
        page_observation: evidence.page,
        chunk_observations: evidence.chunks,
        value_hash: evidence.value_hash,
    }
}

fn resolve_registry(
    version: u64,
    proposals: &[Proposal],
) -> Result<RegistryBaseline, ReviewFailure> {
    let mut resolver = Resolver {
        version,
        bytes_left: REGISTRY_BYTES,
    };
    let roster = resolver.read(
        RecordKey::SubnetList,
        RegistryKey::Roster,
        review_records::roster,
    )?;
    let roster_ids = roster.value().ok_or(ReviewFailure::InvalidEvidence(
        ReviewError::UnavailableRecord(RegistryKey::Roster),
    ))?;
    let mut subnets: BTreeSet<_> = roster_ids.iter().copied().collect();
    for proposal in proposals {
        use nexus_domain::MembershipAction::*;
        if let Change { subnet, .. } | Add { subnet, .. } = &proposal.action {
            subnets.insert(*subnet);
        }
    }
    let mut registry = RegistryBaseline {
        version,
        complete: true,
        roster,
        subnets: Default::default(),
        nodes: Default::default(),
        operators: Default::default(),
        data_centers: Default::default(),
        boundaries: Default::default(),
    };
    for subnet in subnets {
        let row = resolver.read(
            RecordKey::Subnet(subnet),
            RegistryKey::Subnet(subnet),
            review_records::subnet,
        )?;
        registry.subnets.insert(subnet, row);
    }
    let actions: Vec<_> = proposals.iter().map(|proposal| &proposal.action).collect();
    let nodes = relevant_nodes(&registry, &actions).map_err(ReviewFailure::InvalidEvidence)?;
    if nodes.len() > NODE_LIMIT {
        return Err(ReviewFailure::ReviewLimit);
    }
    let mut operators = BTreeSet::new();
    for id in nodes {
        let node = resolver.read(
            RecordKey::Node(id),
            RegistryKey::Node(id),
            review_records::node,
        )?;
        operators.extend(node.value().and_then(|node| node.operator));
        registry.nodes.insert(id, node);
        let boundary = resolver.read(
            RecordKey::ApiBoundary(id),
            RegistryKey::ApiBoundary(id),
            review_records::boundary,
        )?;
        registry.boundaries.insert(id, boundary);
    }
    let mut centers = BTreeSet::new();
    for id in operators {
        let operator = resolver.read(
            RecordKey::Operator(id),
            RegistryKey::Operator(id),
            review_records::operator,
        )?;
        centers.extend(
            operator
                .value()
                .and_then(|operator| data_center_key(&operator.data_center)),
        );
        registry.operators.insert(id, operator);
    }
    for id in centers {
        let dc = resolver.read(
            RecordKey::DataCenter(id.clone()),
            RegistryKey::DataCenter(id.clone()),
            review_records::data_center,
        )?;
        registry.data_centers.insert(id, dc);
    }
    Ok(registry)
}

#[derive(CandidType, Deserialize)]
pub struct CompletedReview {
    pub revision: Hash,
    pub proposals: Vec<u64>,
    pub registry_version: u64,
    pub hypothetical_executed: Option<bool>,
}

/// Bounded replicated reads over completed reports. Generation remains controller-only.
#[ic_cdk::update]
fn list_completed_reviews() -> Vec<CompletedReview> {
    let mut rows: Vec<_> = JOBS.with_borrow(|jobs| {
        jobs.iter()
            .take(JOB_LIMIT as usize)
            .filter_map(|entry| {
                let job = entry.value().0;
                let ReviewJobState::Complete(revision) = job.state else {
                    return None;
                };
                Some(CompletedReview {
                    revision,
                    proposals: job
                        .request
                        .proposals
                        .iter()
                        .map(|proposal| proposal.id)
                        .collect(),
                    registry_version: job.request.registry_version,
                    hypothetical_executed: job.request.hypothetical_executed,
                })
            })
            .collect()
    });
    rows.sort_unstable_by(|a, b| {
        b.registry_version
            .cmp(&a.registry_version)
            .then(a.revision.cmp(&b.revision))
    });
    rows.dedup_by_key(|row| row.revision);
    rows
}

#[ic_cdk::update]
fn read_membership_review(revision: Hash) -> Result<Review, String> {
    if ic_cdk::api::canister_cycle_balance() < FLOOR {
        return Err("public reads temporarily unavailable due to low canister balance".into());
    }
    archived_review(revision)
}

fn archived_review(revision: Hash) -> Result<Review, String> {
    candid::decode_one(&report_bytes(revision)?)
        .map_err(|_| "archived report schema unavailable".into())
}

fn report_bytes(revision: Hash) -> Result<Vec<u8>, String> {
    REPORTS
        .with_borrow(|reports| reports.get(&revision))
        .ok_or("unknown membership review revision".into())
}

#[ic_cdk::update]
fn membership_review_page(revision: Hash, offset: u32) -> Result<ReplyPage, String> {
    require_controller()?;
    let bytes = report_bytes(revision)?;
    let offset = offset as usize;
    if offset > bytes.len() {
        return Err("offset beyond report".into());
    }
    let end = (offset + evidence::BLOB_PAGE).min(bytes.len());
    Ok(ReplyPage {
        bytes: bytes[offset..end].to_vec(),
        next_offset: (end < bytes.len()).then_some(end as u32),
    })
}

#[derive(CandidType, Deserialize)]
pub struct ScopeRequest {
    pub revision: Hash,
    pub scenario: ScenarioId,
    pub subnet: Principal,
    pub roles: Option<Vec<NodeRole>>,
    pub nodes: Option<Vec<Principal>>,
    pub cursor: Option<ScopeCursor>,
}

#[derive(CandidType, Deserialize)]
pub struct ScopeCursor {
    pub selection: Hash,
    pub after: Principal,
}

#[ic_cdk::update]
fn membership_review_scope(request: ScopeRequest) -> Result<ScopePage, String> {
    require_controller()?;
    resolved_page(request, |selection| selection)
}

fn resolved_page(
    request: ScopeRequest,
    cursor_selection: impl FnOnce(Hash) -> Hash,
) -> Result<ScopePage, String> {
    if request
        .nodes
        .as_ref()
        .is_some_and(|nodes| nodes.len() > NODE_LIMIT)
        || request.roles.as_ref().is_some_and(|roles| roles.len() > 10)
    {
        return Err("scope filter exceeds supported limits".into());
    }
    let review = archived_review(request.revision)?;
    let mut scope = review.scope(request.scenario, request.subnet);
    if let Some(roles) = request.roles {
        scope = scope.narrow_roles(&roles.into_iter().collect());
    }
    if let Some(nodes) = request.nodes {
        scope = scope.narrow_nodes(&nodes.into_iter().collect());
    }
    let ScopeState::Resolved(scope) = scope else {
        let ScopeState::Unavailable(reason) = scope else {
            unreachable!()
        };
        return Ok(ScopePage::Unavailable(reason));
    };
    let selection = scope.selection_id();
    let start = if let Some(cursor) = request.cursor {
        if cursor.selection != cursor_selection(selection) {
            return Err("cursor belongs to a different scope or sample selection".into());
        }
        Excluded(cursor.after)
    } else {
        Unbounded
    };
    let mut rows: Vec<_> = scope
        .nodes()
        .range((start, Unbounded))
        .take(PAGE_ROWS + 1)
        .map(|(id, node)| (*id, node.clone()))
        .collect();
    let next = if rows.len() > PAGE_ROWS {
        rows.pop();
        Some(rows[PAGE_ROWS - 1].0)
    } else {
        None
    };
    Ok(ScopePage::Nodes {
        identity: Box::new(scope.identity().clone()),
        selection,
        rows,
        next,
    })
}

#[derive(CandidType, Deserialize)]
pub struct PerformanceRequest {
    pub scope: ScopeRequest,
    pub timestamp: Option<u64>,
}

#[derive(CandidType, Deserialize)]
pub struct PerformancePage {
    pub scope: ScopePage,
    pub sample: Option<MetricSample>,
    pub last_success_at: Option<u64>,
    pub rows: Vec<NodeMetrics>,
}

#[ic_cdk::update]
fn read_membership_performance(request: PerformanceRequest) -> Result<PerformancePage, String> {
    if ic_cdk::api::canister_cycle_balance() < FLOOR {
        return Err("public reads temporarily unavailable due to low canister balance".into());
    }
    let continuation = request.scope.cursor.is_some();
    let scope = resolved_page(request.scope, |selection| {
        performance_selection(selection, request.timestamp)
    })?;
    let mut page = PerformancePage {
        scope,
        sample: None,
        last_success_at: None,
        rows: vec![],
    };
    if let ScopePage::Nodes {
        identity,
        selection,
        rows,
        ..
    } = &mut page.scope
    {
        if !rows.is_empty() && (!continuation || request.timestamp.is_some()) {
            let subnet = identity.target_subnet;
            let nodes = rows.iter().map(|(id, _)| *id).collect();
            (page.sample, page.rows) =
                metrics_archive::scoped_sample(subnet, request.timestamp, &nodes)?;
            page.last_success_at = metrics_archive::last_success_at(subnet);
        }
        *selection = performance_selection(
            *selection,
            page.sample.as_ref().map(|sample| sample.timestamp_nanos),
        );
    }
    Ok(page)
}

fn performance_selection(scope: Hash, timestamp: Option<u64>) -> Hash {
    sha256(
        &candid::encode_args(("membership-performance", scope, timestamp)).expect("scope cursor"),
    )
}
