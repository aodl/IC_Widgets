use std::cell::RefCell;

use candid::CandidType;
use ic_stable_structures::{StableBTreeMap, StableCell};
use nexus_domain::{Hash, MembershipAction, sha256};
use nexus_ic_sources::{decode_candid, governance};
use serde::Deserialize;

use crate::{
    budget::SECOND,
    evidence::{self, SourceStatus},
    ingestion::{Work, short},
    require_controller,
    store::{Memory, V1, memory},
};

const QUEUE_LIMIT: usize = 128;
const DISCOVER_EVERY: u64 = 5 * 60 * SECOND;
const REFRESH_EVERY: u64 = 60 * 60 * SECOND;
const INITIAL_PAGES: u8 = 5;

#[derive(Clone, CandidType, Deserialize)]
struct Discovery {
    before: Option<u64>,
    top: Option<u64>,
    pages: u8,
}

#[derive(Clone, CandidType, Deserialize)]
struct Target {
    id: u64,
    due: u64,
    failures: u8,
}

#[derive(Clone, CandidType, Deserialize)]
struct State {
    discovery: Option<Discovery>,
    high_watermark: Option<u64>,
    oldest_scanned: Option<u64>,
    next_discovery: u64,
    last_discovery_observation: Option<u64>,
    list_failures: u8,
    list_limit: u32,
    pending: Vec<Target>,
}

impl Default for State {
    fn default() -> Self {
        Self {
            discovery: None,
            high_watermark: None,
            oldest_scanned: None,
            next_discovery: 0,
            last_discovery_observation: None,
            list_failures: 0,
            list_limit: governance::INITIAL_LIST_LIMIT,
            pending: vec![],
        }
    }
}

#[derive(Clone, CandidType, Deserialize, PartialEq, Eq)]
pub enum ActionStatus {
    Membership,
    UnsupportedFunction(i32),
    UnsupportedAction,
    MalformedPayload(String),
}

#[derive(Clone, CandidType, Deserialize)]
pub struct ProposalCapture {
    pub proposal_id: u64,
    pub observation: u64,
    pub collected_at: u64,
    pub raw_hash: Hash,
    pub payload_hash: Option<Hash>,
    pub claim_hash: Option<Hash>,
    pub function: Option<i32>,
    pub action_status: ActionStatus,
    pub lifecycle: Lifecycle,
}

#[derive(Clone, CandidType, Deserialize, PartialEq, Eq)]
pub struct Lifecycle {
    pub status: i32,
    pub topic: i32,
    pub proposed_at_seconds: u64,
    pub executed_at_seconds: Option<u64>,
    pub failed_at_seconds: Option<u64>,
    pub decided_at_seconds: Option<u64>,
}

#[derive(Clone, Default, CandidType, Deserialize)]
pub struct ProposalStatus {
    pub last_observation: Option<u64>,
    pub last_capture: Option<u64>,
    pub last_status: Option<SourceStatus>,
    pub capture_count: u64,
    pub next_lifecycle_check: Option<u64>,
}

#[derive(CandidType, Deserialize)]
pub struct DiscoveryStatus {
    pub high_watermark: Option<u64>,
    pub oldest_scanned: Option<u64>,
    pub next_discovery: u64,
    pub in_progress: bool,
    pub queued: u32,
    pub last_discovery_observation: Option<u64>,
}

#[derive(CandidType, Deserialize)]
pub struct CapturePage {
    pub rows: Vec<ProposalCapture>,
    pub next: Option<u64>,
}

thread_local! {
    static STATE: RefCell<StableCell<V1<State>, Memory>> =
        RefCell::new(StableCell::init(memory(12), V1(State::default())));
    static CAPTURES: RefCell<StableBTreeMap<(u64, u64), V1<ProposalCapture>, Memory>> =
        RefCell::new(StableBTreeMap::init(memory(13)));
    static INDEX: RefCell<StableBTreeMap<u64, V1<ProposalStatus>, Memory>> =
        RefCell::new(StableBTreeMap::init(memory(14)));
    static REFRESH: RefCell<StableBTreeMap<(u64, u64), u8, Memory>> =
        RefCell::new(StableBTreeMap::init(memory(15)));
}

fn load() -> State {
    STATE.with_borrow(|state| state.get().0.clone())
}

fn save(state: State) {
    STATE.with_borrow_mut(|cell| {
        cell.set(V1(state));
    });
}

pub fn index(id: u64) -> ProposalStatus {
    INDEX
        .with_borrow(|index| index.get(&id).map(|status| status.0))
        .unwrap_or_default()
}

fn save_index(id: u64, status: ProposalStatus) {
    INDEX.with_borrow_mut(|index| index.insert(id, V1(status)));
}

fn capture(id: u64, observation: u64) -> Option<ProposalCapture> {
    CAPTURES.with_borrow(|captures| captures.get(&(id, observation)).map(|row| row.0))
}

pub fn next(now: u64) -> Option<Work> {
    let state = load();
    if let Some(target) = state.pending.iter().find(|target| target.due <= now) {
        return Some(Work::GovernanceProposal(target.id));
    }
    // Preserve discovery progress even when many proposals are open. A bounded
    // new-ID scan runs before routine (hourly) lifecycle refresh.
    if now >= state.next_discovery && state.pending.len() + state.list_limit as usize <= QUEUE_LIMIT
    {
        return Some(Work::GovernanceList {
            before: state.discovery.and_then(|scan| scan.before),
            limit: state.list_limit,
        });
    }
    REFRESH.with_borrow(|refresh| {
        refresh
            .first_key_value()
            .filter(|((due, _), _)| *due <= now)
            .map(|((_, id), _)| Work::GovernanceProposal(id))
    })
}

pub fn accept(work: &Work, bytes: &[u8], observation: u64, now: u64) -> SourceStatus {
    match work {
        Work::GovernanceList { before, limit } => {
            match governance::decode_page(bytes, *before, *limit) {
                Ok(rows) => {
                    discovered(rows, *before, *limit, observation, now);
                    SourceStatus::Valid
                }
                Err(error) => SourceStatus::Malformed(short(&error)),
            }
        }
        Work::GovernanceProposal(id) => accept_proposal(*id, bytes, observation, now),
        _ => unreachable!("Governance producer received another source's task"),
    }
}

fn discovered(
    rows: Vec<governance::ProposalInfo>,
    before: Option<u64>,
    limit: u32,
    observation: u64,
    now: u64,
) {
    let mut state = load();
    let mut scan = state.discovery.take().unwrap_or(Discovery {
        before: None,
        top: None,
        pages: 0,
    });
    assert_eq!(scan.before, before, "discovery cursor changed during call");
    let first = rows.first().and_then(|row| row.id).map(|id| id.id);
    let last = rows.last().and_then(|row| row.id).map(|id| id.id);
    scan.top = scan.top.or(first);
    scan.pages = scan.pages.saturating_add(1);
    if let Some(last) = last {
        state.oldest_scanned = Some(state.oldest_scanned.map_or(last, |oldest| oldest.min(last)));
        scan.before = Some(last);
    }
    let floor = state.high_watermark.unwrap_or(0);
    for row in &rows {
        let id = row.id.expect("validated Governance list ID").id;
        if id > floor
            && row
                .executable()
                .is_some_and(|action| governance::is_membership(action.nns_function))
            && index(id).last_capture.is_none()
        {
            enqueue(&mut state, id, now);
        }
    }
    let finished = rows.len() < limit as usize
        || last.is_some_and(|id| id <= floor)
        || (state.high_watermark.is_none() && scan.pages >= INITIAL_PAGES);
    if finished {
        state.high_watermark = scan.top.map(|top| top.max(floor)).or(state.high_watermark);
        state.next_discovery = now.saturating_add(DISCOVER_EVERY);
        state.list_limit = governance::INITIAL_LIST_LIMIT;
    } else {
        state.discovery = Some(scan);
    }
    state.last_discovery_observation = Some(observation);
    state.list_failures = 0;
    save(state);
}

fn accept_proposal(id: u64, bytes: &[u8], observation: u64, now: u64) -> SourceStatus {
    let info: Option<governance::ProposalInfo> = match decode_candid(bytes) {
        Ok(info) => info,
        Err(err) => return SourceStatus::Malformed(short(&err)),
    };
    let Some(info) = info else {
        return SourceStatus::Unavailable;
    };
    if info.id.map(|id| id.id) != Some(id) {
        return SourceStatus::Integrity("proposal reply ID differs from request".into());
    }
    let action = info.executable();
    let action_status = match action {
        None => ActionStatus::UnsupportedAction,
        Some(action) => match governance::membership(action) {
            Ok(Some(_)) => ActionStatus::Membership,
            Ok(None) => ActionStatus::UnsupportedFunction(action.nns_function),
            Err(error) => ActionStatus::MalformedPayload(short(&error)),
        },
    };
    let raw_hash = sha256(bytes);
    let capture_row = ProposalCapture {
        proposal_id: id,
        observation,
        collected_at: now,
        raw_hash,
        payload_hash: action.map(|action| sha256(&action.payload)),
        claim_hash: info.proposal.as_ref().map(|p| {
            sha256(&candid::encode_args((&p.title, &p.summary)).expect("encode proposer claims"))
        }),
        function: action.map(|action| action.nns_function),
        action_status,
        lifecycle: Lifecycle {
            status: info.status,
            topic: info.topic,
            proposed_at_seconds: info.proposal_timestamp_seconds,
            executed_at_seconds: (info.executed_timestamp_seconds > 0)
                .then_some(info.executed_timestamp_seconds),
            failed_at_seconds: info
                .failed_timestamp_seconds
                .filter(|timestamp| *timestamp > 0),
            decided_at_seconds: info
                .decided_timestamp_seconds
                .filter(|timestamp| *timestamp > 0),
        },
    };
    // Presence of an option remains explicit. A payload or text change for a
    // previously captured ID stays independently inspectable.
    let mut kind = SourceStatus::Valid;
    let mut last = index(id);
    if let Some(old) = last
        .last_capture
        .and_then(|observation| capture(id, observation))
        && old
            .payload_hash
            .zip(capture_row.payload_hash)
            .is_some_and(|(a, b)| a != b)
    {
        kind = SourceStatus::Integrity("proposal executable bytes changed for one ID".into());
    }
    let unchanged = last
        .last_capture
        .and_then(|observation| capture(id, observation))
        .is_some_and(|old| {
            old.lifecycle == capture_row.lifecycle
                && old.payload_hash == capture_row.payload_hash
                && old.function == capture_row.function
                && old.claim_hash == capture_row.claim_hash
                && old.action_status == capture_row.action_status
        });
    if !unchanged {
        evidence::put_blob(raw_hash, bytes.to_vec());
        CAPTURES.with_borrow_mut(|captures| {
            captures.insert((id, observation), V1(capture_row.clone()))
        });
        last.last_capture = Some(observation);
        last.capture_count += 1;
    }
    last.last_observation = Some(observation);
    last.last_status = Some(kind.clone());
    schedule_lifecycle(
        &mut last,
        id,
        matches!(capture_row.lifecycle.status, 1 | 3).then_some(now + REFRESH_EVERY),
    );
    save_index(id, last);
    let mut state = load();
    state.pending.retain(|target| target.id != id);
    save(state);
    kind
}

fn enqueue(state: &mut State, id: u64, due: u64) {
    if let Some(target) = state.pending.iter_mut().find(|target| target.id == id) {
        target.due = target.due.min(due);
    } else if state.pending.len() < QUEUE_LIMIT {
        state.pending.push(Target {
            id,
            due,
            failures: 0,
        });
    }
}

fn schedule_lifecycle(last: &mut ProposalStatus, id: u64, due: Option<u64>) {
    REFRESH.with_borrow_mut(|refresh| {
        if let Some(old) = last.next_lifecycle_check {
            refresh.remove(&(old, id));
        }
        if let Some(due) = due {
            refresh.insert((due, id), 0);
        }
    });
    last.next_lifecycle_check = due;
}

pub fn failed(work: &Work, status: &SourceStatus, observation: u64, now: u64, attempts: u8) {
    let mut state = load();
    let retry = matches!(
        status,
        SourceStatus::Interrupted
            | SourceStatus::Rejected {
                retryable: true,
                ..
            }
    );
    match work {
        Work::GovernanceList { limit, .. } => {
            state.last_discovery_observation = Some(observation);
            state.list_failures += 1;
            if matches!(status, SourceStatus::Oversized) && *limit > 1 {
                state.list_limit = limit / 2;
                state.next_discovery = now;
            } else if retry && state.list_failures < attempts {
                state.next_discovery =
                    now.saturating_add((5 * SECOND) << (state.list_failures - 1));
            } else {
                state.list_failures = 0;
                state.next_discovery = now.saturating_add(DISCOVER_EVERY);
            }
        }
        Work::GovernanceProposal(id) => {
            let mut last = index(*id);
            let mut failures = state
                .pending
                .iter()
                .find(|target| target.id == *id)
                .map_or(1, |target| target.failures + 1);
            // A refresh may have been scheduled outside the manual/discovery queue.
            if let Some(due) = last.next_lifecycle_check {
                failures = failures.max(
                    REFRESH
                        .with_borrow(|refresh| refresh.get(&(due, *id)))
                        .unwrap_or(0)
                        + 1,
                );
            }
            last.last_observation = Some(observation);
            last.last_status = Some(status.clone());
            state.pending.retain(|target| target.id != *id);
            let follow_up = if retry && failures < attempts {
                Some(now.saturating_add((5 * SECOND) << (failures - 1)))
            } else {
                None
            };
            schedule_lifecycle(&mut last, *id, follow_up);
            if let Some(due) = follow_up {
                REFRESH.with_borrow_mut(|refresh| refresh.insert((due, *id), failures));
            }
            save_index(*id, last);
        }
        _ => unreachable!("Governance producer received another source's task"),
    }
    save(state);
}

#[ic_cdk::update]
fn capture_proposal(id: u64) -> Result<(), String> {
    require_controller()?;
    enqueue_capture(id)
}

pub fn pending_capture(id: u64) -> bool {
    index(id).next_lifecycle_check.is_some() || load().pending.iter().any(|target| target.id == id)
}

pub fn enqueue_capture(id: u64) -> Result<(), String> {
    if id == 0 {
        return Err("select a positive proposal ID".into());
    }
    let mut state = load();
    if state.pending.len() >= QUEUE_LIMIT && !state.pending.iter().any(|target| target.id == id) {
        return Err("proposal queue full".into());
    }
    enqueue(&mut state, id, ic_cdk::api::time());
    save(state);
    Ok(())
}

#[ic_cdk::update]
fn proposal_status(id: u64) -> Result<ProposalStatus, String> {
    require_controller()?;
    Ok(index(id))
}

#[ic_cdk::update]
fn discovery_status() -> Result<DiscoveryStatus, String> {
    require_controller()?;
    let state = load();
    Ok(DiscoveryStatus {
        high_watermark: state.high_watermark,
        oldest_scanned: state.oldest_scanned,
        next_discovery: state.next_discovery,
        in_progress: state.discovery.is_some(),
        queued: state.pending.len() as u32,
        last_discovery_observation: state.last_discovery_observation,
    })
}

#[ic_cdk::update]
fn proposal_archive(id: u64, observation: Option<u64>) -> Result<ProposalCapture, String> {
    require_controller()?;
    archived_proposal(id, observation)
}

pub fn archived_proposal(id: u64, observation: Option<u64>) -> Result<ProposalCapture, String> {
    let observation = observation
        .or_else(|| index(id).last_capture)
        .ok_or("no archived capture")?;
    capture(id, observation).ok_or_else(|| "no capture for source observation".into())
}

#[ic_cdk::update]
fn proposal_history(id: u64, after: Option<u64>) -> Result<CapturePage, String> {
    require_controller()?;
    let start = after.unwrap_or(0).saturating_add(1);
    let mut rows = CAPTURES.with_borrow(|captures| {
        captures
            .range((id, start)..=(id, u64::MAX))
            .take(33)
            .map(|entry| entry.value().0)
            .collect::<Vec<_>>()
    });
    let next = if rows.len() > 32 {
        rows.pop();
        Some(rows[31].observation)
    } else {
        None
    };
    Ok(CapturePage { rows, next })
}

#[ic_cdk::update]
fn proposal_action(id: u64, observation: Option<u64>) -> Result<MembershipAction, String> {
    require_controller()?;
    archived_action(id, observation)
}

pub fn archived_action(id: u64, observation: Option<u64>) -> Result<MembershipAction, String> {
    let capture = archived_proposal(id, observation)?;
    if capture.action_status != ActionStatus::Membership {
        return Err("no decoded membership action in this capture".into());
    }
    let source =
        evidence::observation(capture.observation).ok_or("capture source observation missing")?;
    if source.status != SourceStatus::Valid {
        return Err("capture unavailable for membership analysis".into());
    }
    let raw = evidence::blob(capture.raw_hash).ok_or("captured proposal bytes missing")?;
    if source.raw_hash != Some(capture.raw_hash) || sha256(&raw) != capture.raw_hash {
        return Err("archived proposal reply disagrees with its observation".into());
    }
    let proposal: Option<governance::ProposalInfo> = decode_candid(&raw)?;
    let action = proposal
        .as_ref()
        .and_then(|p| p.executable())
        .ok_or("captured action missing")?;
    if proposal
        .as_ref()
        .and_then(|row| row.id.as_ref())
        .map(|id| id.id)
        != Some(id)
        || capture.payload_hash != Some(sha256(&action.payload))
        || capture.function != Some(action.nns_function)
    {
        return Err("archived proposal payload identity changed".into());
    }
    let decoded = governance::membership(action)?.ok_or("unsupported membership action")?;
    if candid::encode_one(&decoded).expect("encoded action").len() > 256 * 1024 {
        return Err("typed action exceeds response budget; inspect captured wire bytes".into());
    }
    Ok(decoded)
}
