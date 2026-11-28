//! A finite public Governance observation, independent of the Registry pin.
use std::collections::{BTreeMap, BTreeSet};

use candid::{CandidType, Principal, encode_one};
use nexus_domain::{Hash, MembershipAction, sha256};
use nexus_ic_sources::{
    decode_candid,
    governance::{self, Action, BoundaryAction, ProposalInfo},
};
use nexus_review_engine::requested_nodes;
use serde::Deserialize;

use super::{LiveError, LiveResponse, Request, RequestGuard, proposals};
use crate::{Sources, store};

const PAGE_LIMIT: usize = 14;
const HYDRATION_LIMIT: usize = 72;
const MATCH_LIMIT: usize = 256;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, CandidType, Deserialize)]
pub enum ActivityLifecycle {
    Open,
    AdoptedPendingExecution,
    Other,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, CandidType, Deserialize)]
pub enum NodeReferenceRole {
    Incoming,
    Outgoing,
    NewSubnetMember,
    RegistryRemoval,
    BoundaryAddition,
    BoundaryRemoval,
    BoundaryVersionTarget,
    Textual,
    RecoveryReplacement,
    HostosVersionTarget,
}

#[derive(Clone, Debug, CandidType, Deserialize)]
pub struct ActivityProposal {
    pub id: u64,
    pub topic: i32,
    pub function: Option<i32>,
    pub motion: bool,
    pub title: Option<String>,
    pub lifecycle: ActivityLifecycle,
    pub observed_at: u64,
    pub target_subnet: Option<Principal>,
    pub targets: Option<Vec<Principal>>,
    pub unresolved: Option<bool>,
    pub decision: Option<i32>,
    pub voting_open: Option<bool>,
    pub deadline: Option<u64>,
    pub executed_at: Option<u64>,
}

#[derive(Debug, CandidType, Deserialize)]
pub struct ActivityMatch {
    pub node: Principal,
    pub proposal: u64,
    pub requested_role: NodeReferenceRole,
    pub other: u64,
    pub other_role: NodeReferenceRole,
}

#[derive(Debug, Default, CandidType, Deserialize)]
pub struct ActivityCoverage {
    pub pages: u32,
    pub pagination_complete: bool,
    pub oldest_listed: Option<u64>,
    pub open_listed: u32,
    pub adopted_listed: u32,
    pub hydrated: u32,
    pub changed_lifecycle: u32,
    pub textual_checked: u32,
    pub executable_decoded: u32,
    pub unsupported_actions: u32,
    pub missing_payloads: u32,
    pub malformed_payloads: u32,
    pub omitted_matches: u32,
    pub issues: Vec<String>,
}

#[derive(Debug, CandidType, Deserialize)]
pub struct LiveSubnetActivity {
    pub coverage: ActivityCoverage,
    pub complete: bool,
    pub proposals: Vec<ActivityProposal>,
    pub matches: Vec<ActivityMatch>,
    pub subnets: Option<Vec<Principal>>,
    pub voting_pagination_complete: Option<bool>,
    pub registry_complete: Option<bool>,
    pub registry_memberships_checked: Option<u32>,
    pub voting_issues: Option<Vec<String>>,
    pub requested_instructions: Option<Vec<(u64, i32, Hash)>>,
    pub truncated_proposals: Option<Vec<u64>>,
}

fn lifecycle(info: &ProposalInfo) -> Option<ActivityLifecycle> {
    if info.executed_timestamp_seconds > 0 || info.failed_timestamp_seconds.unwrap_or(0) > 0 {
        return None;
    }
    match info.status {
        1 => Some(ActivityLifecycle::Open),
        3 => Some(ActivityLifecycle::AdoptedPendingExecution),
        _ => None,
    }
}

type References = BTreeSet<(Principal, NodeReferenceRole)>;

#[derive(CandidType, Deserialize)]
struct NodesPayload {
    node_ids: Vec<Principal>,
}

#[derive(CandidType, Deserialize)]
struct RecoveryPayload {
    subnet_id: Principal,
    replacement_nodes: Option<Vec<Principal>>,
}

fn membership_roles(action: &MembershipAction, refs: &mut References) {
    let (incoming, outgoing) = requested_nodes(action);
    refs.extend(incoming.iter().map(|&id| (id, NodeReferenceRole::Incoming)));
    refs.extend(outgoing.iter().map(|&id| (id, NodeReferenceRole::Outgoing)));
}

fn supported_function(function: i32) -> bool {
    matches!(
        function,
        1 | 2 | 6 | 13 | 18 | 31 | 41 | 43 | 44 | 46 | 47 | 51
    )
}

fn executable(
    info: &ProposalInfo,
    refs: &mut References,
) -> Result<Option<Option<Principal>>, String> {
    let Some(action) = info.proposal.as_ref().and_then(|p| p.action.as_ref()) else {
        return Ok(None);
    };
    let Action::ExecuteNnsFunction(action) = action else {
        return Ok(None);
    };
    if let Some(operation) = governance::membership(action)? {
        let subnet = match &operation {
            MembershipAction::Add { subnet, .. } | MembershipAction::Change { subnet, .. } => {
                Some(*subnet)
            }
            MembershipAction::Remove { .. } => None,
        };
        membership_roles(&operation, refs);
        return Ok(Some(subnet));
    }
    if let Some(operation) = governance::boundary_action(action)? {
        let (nodes, role) = match operation {
            BoundaryAction::Add { nodes, .. } => (nodes, NodeReferenceRole::BoundaryAddition),
            BoundaryAction::Remove { nodes } => (nodes, NodeReferenceRole::BoundaryRemoval),
            BoundaryAction::LegacyVersion { nodes, .. }
            | BoundaryAction::DeployVersion { nodes, .. } => {
                (nodes, NodeReferenceRole::BoundaryVersionTarget)
            }
        };
        refs.extend(nodes.into_iter().map(|id| (id, role)));
        return Ok(Some(None));
    }
    if action.nns_function == 6 {
        let payload: RecoveryPayload = decode_candid(&action.payload)?;
        refs.extend(
            payload
                .replacement_nodes
                .unwrap_or_default()
                .into_iter()
                .map(|id| (id, NodeReferenceRole::RecoveryReplacement)),
        );
        return Ok(Some(Some(payload.subnet_id)));
    }
    let role = match action.nns_function {
        1 => NodeReferenceRole::NewSubnetMember,
        18 => NodeReferenceRole::RegistryRemoval,
        41 | 51 => NodeReferenceRole::HostosVersionTarget,
        _ => return Ok(None),
    };
    let NodesPayload { node_ids } = decode_candid(&action.payload)?;
    refs.extend(node_ids.into_iter().map(|id| (id, role)));
    Ok(Some(None))
}

fn textual(text: &str, targets: &BTreeMap<String, Principal>, refs: &mut References) {
    for word in text.split(|c: char| !(c.is_ascii_alphanumeric() || c == '-')) {
        if word.len() < 8 || word.len() > 63 {
            continue;
        }
        if let Some(&id) = targets.get(&word.to_ascii_lowercase()) {
            refs.insert((id, NodeReferenceRole::Textual));
        }
    }
}

#[ic_cdk::update]
async fn subnet_activity(selected: Vec<u64>) -> Result<LiveResponse<LiveSubnetActivity>, String> {
    if selected.len() > 2
        || selected.contains(&0)
        || selected.iter().collect::<BTreeSet<_>>().len() != selected.len()
    {
        return Err("Select up to two distinct positive proposal IDs.".into());
    }
    let guard = RequestGuard::acquire()?;
    let mut request = Request::new(guard.0);
    let sources = if cfg!(feature = "local-fixtures") {
        store::config().sources
    } else {
        Sources::canonical()
    };
    let outcome = observe(&mut request, sources, &selected).await;
    Ok(request.finish(outcome))
}

async fn observe(
    request: &mut Request,
    sources: Sources,
    selected: &[u64],
) -> Result<LiveSubnetActivity, LiveError> {
    let source = sources.governance;
    let mut coverage = ActivityCoverage::default();
    let mut requested = BTreeMap::<u64, References>::new();
    let mut instructions = Vec::new();
    for (proposal, _) in proposals(request, source, selected).await? {
        let evidence = proposal.evidence;
        membership_roles(&proposal.action, requested.entry(evidence.id).or_default());
        instructions.push((evidence.id, evidence.function, evidence.payload_hash));
    }
    let (mut listed, pagination_complete) = discover(request, source, false, &mut coverage).await;
    coverage.pagination_complete = pagination_complete;
    let pending: BTreeSet<_> = listed.keys().copied().collect();
    let mut voting_pagination_complete = None;
    let mut voting_coverage = ActivityCoverage::default();
    if selected.is_empty() {
        let (voting, complete) = discover(request, source, true, &mut voting_coverage).await;
        listed.extend(voting);
        voting_pagination_complete = Some(complete);
    }
    for (row, _) in listed.values() {
        match lifecycle(row) {
            Some(ActivityLifecycle::Open) => coverage.open_listed += 1,
            Some(ActivityLifecycle::AdoptedPendingExecution) => coverage.adopted_listed += 1,
            _ => {}
        }
    }
    // Hydrate once per potentially incomplete proposal, irrespective of how
    // many nodes or subnets will consume the observation.
    let hydrate: Vec<_> = listed
        .iter()
        .rev()
        .filter(|(_, (row, _))| {
            row.proposal.as_ref().is_none_or(|p| p.action.is_none())
                || row
                    .executable()
                    .is_some_and(|a| supported_function(a.nns_function) && a.payload.is_empty())
        })
        .map(|(&id, _)| id)
        .collect();
    let needs_hydration: BTreeSet<_> = hydrate.iter().copied().collect();
    let mut full = BTreeMap::new();
    for batch in hydrate.chunks(8).take(HYDRATION_LIMIT / 8) {
        let replies = request
            .read(
                source,
                "get_proposal_info",
                batch
                    .iter()
                    .map(|&id| (id.to_string(), encode_one(id).expect("proposal ID")))
                    .collect(),
            )
            .await;
        match replies {
            Ok(replies) => {
                for (&id, reply) in batch.iter().zip(replies) {
                    if let Ok(body) = reply.body
                        && let Ok(Some(info)) = decode_candid::<Option<ProposalInfo>>(&body)
                        && info.id.map(|id| id.id) == Some(id)
                    {
                        if pending.contains(&id) || lifecycle(&info).is_some() {
                            coverage.hydrated += 1;
                        }
                        full.insert(id, (info, reply.observed_at));
                    } else {
                        let issues = if pending.contains(&id) {
                            &mut coverage.issues
                        } else {
                            &mut voting_coverage.issues
                        };
                        issues.push(format!("Proposal #{id} could not be hydrated."));
                    }
                }
            }
            Err(error) => {
                coverage
                    .issues
                    .push(format!("Proposal hydration not admitted: {error:?}"));
                break;
            }
        }
    }
    if hydrate.len() > HYDRATION_LIMIT {
        coverage
            .issues
            .push("Proposal hydration reached the request limit.".into());
    }

    // Only valid untargeted removals need individual subnet membership records.
    // Resolve after hydration so omitted but recoverable actions use the same pin.
    let (subnets, owners, registry_complete, memberships_checked) = if selected.is_empty() {
        let resolve_removals = listed.iter().any(|(id, row)| {
            let info = &full.get(id).unwrap_or(row).0;
            (lifecycle(info).is_some() || info.reward_status == Some(1))
                && info.executable().is_some_and(|action| {
                    action.nns_function == 13
                        && matches!(
                            governance::membership(action),
                            Ok(Some(MembershipAction::Remove { .. }))
                        )
                })
        });
        let (subnets, owners, complete, checked) =
            super::registry::activity_roster(request, sources.registry, resolve_removals).await?;
        (Some(subnets), owners, Some(complete), Some(checked))
    } else {
        (None, BTreeMap::new(), None, None)
    };

    let mut details = Vec::new();
    for (id, row) in listed.into_iter().rev() {
        let hydrated = full.remove(&id);
        let missing_hydration = needs_hydration.contains(&id) && hydrated.is_none();
        let (info, observed_at) = hydrated.unwrap_or(row);
        let relevant = lifecycle(&info);
        let voting_open = info.reward_status == Some(1);
        if relevant.is_none() {
            coverage.changed_lifecycle += u32::from(pending.contains(&id));
            if !selected.is_empty() || !voting_open {
                continue;
            }
        }
        let action_coverage = if relevant.is_some() {
            &mut coverage
        } else {
            &mut voting_coverage
        };
        let lifecycle = relevant.unwrap_or(ActivityLifecycle::Other);
        let mut refs = References::new();
        let function = info.executable().map(|a| a.nns_function);
        let mut target_subnet = None;
        if function.is_some_and(|id| !supported_function(id)) {
            action_coverage.unsupported_actions += 1;
        } else if missing_hydration
            || info
                .proposal
                .as_ref()
                .is_none_or(|row| row.action.is_none())
            || info.executable().is_some_and(|a| a.payload.is_empty())
        {
            action_coverage.missing_payloads += 1;
            action_coverage.issues.push(format!(
                "Proposal #{id} has no available executable payload."
            ));
        } else if !matches!(
            info.proposal.as_ref().and_then(|row| row.action.as_ref()),
            Some(Action::Motion { .. })
        ) {
            match executable(&info, &mut refs) {
                Ok(Some(target)) => {
                    action_coverage.executable_decoded += 1;
                    target_subnet = target;
                }
                Ok(None) => action_coverage.unsupported_actions += 1,
                Err(_) => {
                    action_coverage.malformed_payloads += 1;
                    action_coverage.issues.push(format!(
                        "Proposal #{id} has an undecodable supported payload."
                    ));
                }
            }
        }
        if let Some(action) = info.executable()
            && let Ok(Some(operation)) = governance::membership(action)
            && selected.is_empty()
        {
            membership_roles(&operation, requested.entry(id).or_default());
            instructions.push((id, action.nns_function, sha256(&action.payload)));
        }
        let mut targets = Vec::new();
        let mut unresolved = false;
        if let Some(subnets) = &subnets {
            if let Some(target) = target_subnet {
                unresolved = !subnets.contains(&target);
                if !unresolved {
                    targets.push(target);
                }
            } else if function == Some(13) {
                let nodes: Vec<_> = refs
                    .iter()
                    .filter(|(_, role)| *role == NodeReferenceRole::Outgoing)
                    .map(|(node, _)| node)
                    .collect();
                unresolved = registry_complete != Some(true) || nodes.is_empty();
                for node in nodes {
                    if let Some(assigned) = owners.get(node) {
                        targets.extend(assigned);
                        unresolved |= assigned.len() != 1;
                    } else {
                        unresolved = true;
                    }
                }
                targets.sort_unstable();
                targets.dedup();
            } else {
                unresolved = matches!(function, Some(2 | 6 | 31));
            }
        }
        details.push((
            ActivityProposal {
                id,
                topic: info.topic,
                function,
                motion: matches!(
                    info.proposal.as_ref().and_then(|p| p.action.as_ref()),
                    Some(Action::Motion { .. })
                ),
                lifecycle,
                observed_at,
                target_subnet,
                targets: subnets.as_ref().map(|_| targets),
                unresolved: subnets.as_ref().map(|_| unresolved),
                decision: Some(info.status),
                voting_open: info.reward_status.map(|_| voting_open),
                deadline: info.deadline_timestamp_seconds,
                executed_at: (info.executed_timestamp_seconds != 0)
                    .then_some(info.executed_timestamp_seconds),
                title: info
                    .proposal
                    .as_ref()
                    .and_then(|p| p.title.as_ref())
                    .map(|s| s.chars().take(200).collect()),
            },
            info,
            refs,
        ));
    }
    let targets = requested
        .values()
        .flatten()
        .map(|&(id, _)| (id.to_text(), id))
        .collect();
    let mut index = BTreeMap::<Principal, Vec<(u64, NodeReferenceRole)>>::new();
    let mut output = Vec::new();
    for (row, info, mut refs) in details {
        if row.lifecycle != ActivityLifecycle::Other
            && let Some(proposal) = info.proposal
        {
            coverage.textual_checked += 1;
            textual(
                proposal.title.as_deref().unwrap_or_default(),
                &targets,
                &mut refs,
            );
            textual(&proposal.summary, &targets, &mut refs);
            if let Some(Action::Motion { motion_text }) = proposal.action {
                textual(&motion_text, &targets, &mut refs);
            }
        }
        if row.lifecycle != ActivityLifecycle::Other {
            for (id, role) in refs {
                index.entry(id).or_default().push((row.id, role));
            }
        }
        output.push(row);
    }
    let mut matches = Vec::new();
    let mut truncated = BTreeSet::new();
    for (proposal, refs) in requested {
        for (node, requested_role) in refs {
            for &(other, other_role) in index.get(&node).map(Vec::as_slice).unwrap_or_default() {
                if other == proposal {
                    continue;
                }
                if matches.len() >= MATCH_LIMIT {
                    coverage.omitted_matches += 1;
                    truncated.insert(proposal);
                } else {
                    matches.push(ActivityMatch {
                        node,
                        proposal,
                        requested_role,
                        other,
                        other_role,
                    });
                }
            }
        }
    }
    if voting_coverage.missing_payloads
        + voting_coverage.malformed_payloads
        + voting_coverage.unsupported_actions
        > 0
    {
        voting_coverage.issues.push(format!(
            "Decided voting rows: {} unsupported actions, {} unavailable actions or payloads, {} malformed payloads.",
            voting_coverage.unsupported_actions, voting_coverage.missing_payloads, voting_coverage.malformed_payloads,
        ));
    }
    let complete = complete(&coverage);
    Ok(LiveSubnetActivity {
        coverage,
        complete,
        proposals: output,
        matches,
        subnets,
        voting_pagination_complete,
        registry_complete,
        registry_memberships_checked: memberships_checked,
        voting_issues: voting_pagination_complete.map(|_| voting_coverage.issues),
        requested_instructions: Some(instructions),
        truncated_proposals: Some(truncated.into_iter().collect()),
    })
}

async fn discover(
    request: &mut Request,
    source: Principal,
    voting: bool,
    coverage: &mut ActivityCoverage,
) -> (BTreeMap<u64, (ProposalInfo, u64)>, bool) {
    let mut listed = BTreeMap::<u64, (ProposalInfo, u64)>::new();
    let mut complete = false;
    let mut before = None;
    let mut limit = governance::INITIAL_LIST_LIMIT;
    for _ in 0..PAGE_LIMIT {
        let mut args = governance::list_request(before, true, limit);
        if voting {
            args.include_reward_status = vec![1];
        } else {
            args.include_status = vec![1, 3];
        }
        let response = request
            .one(
                source,
                "list_proposals",
                format!(
                    "{} before {before:?}",
                    if voting {
                        "Accepting votes"
                    } else {
                        "Open and adopted"
                    }
                ),
                encode_one(args).expect("Governance discovery arguments"),
            )
            .await;
        let (rows, observed_at) = match response {
            Ok(reply) => {
                let body = match reply.body {
                    Ok(body) => body,
                    Err(error) => {
                        if let Some(reduced) = governance::reduced_list_limit(limit, &error) {
                            limit = reduced;
                            continue;
                        }
                        coverage.issues.push(format!("Governance page: {error}"));
                        break;
                    }
                };
                let rows = match governance::decode_page(&body, before, limit) {
                    Ok(rows) => rows,
                    Err(error) => {
                        coverage.issues.push(format!("Governance page: {error}"));
                        break;
                    }
                };
                (rows, reply.observed_at)
            }
            Err(error) => {
                coverage
                    .issues
                    .push(format!("Governance page not admitted: {error:?}"));
                break;
            }
        };
        coverage.pages += 1;
        if rows.is_empty() {
            complete = true;
            break;
        }
        before = rows.last().and_then(|row| row.id).map(|id| id.id);
        if !voting {
            coverage.oldest_listed = before;
        }
        for row in rows {
            let id = row.id.expect("validated pagination").id;
            listed.insert(id, (row, observed_at));
        }
    }
    if !complete && coverage.issues.is_empty() {
        coverage
            .issues
            .push("Governance discovery reached the page limit.".into());
    }

    (listed, complete)
}

fn complete(coverage: &ActivityCoverage) -> bool {
    coverage.pagination_complete
        && coverage.issues.is_empty()
        && coverage.unsupported_actions == 0
        && coverage.missing_payloads == 0
        && coverage.malformed_payloads == 0
        && coverage.omitted_matches == 0
}

#[cfg(test)]
mod tests {
    use super::*;
    use nexus_ic_sources::governance::{ExecuteNnsFunction, Proposal, ProposalId};

    fn candidate(status: i32, executed: u64, action: Action) -> ProposalInfo {
        ProposalInfo {
            id: Some(ProposalId { id: 42 }),
            reward_status: None,
            deadline_timestamp_seconds: None,
            status,
            topic: 3,
            proposal_timestamp_seconds: 5,
            executed_timestamp_seconds: executed,
            failed_timestamp_seconds: None,
            decided_timestamp_seconds: None,
            proposal: Some(Proposal {
                title: None,
                summary: String::new(),
                action: Some(action),
            }),
        }
    }

    #[test]
    fn matches_executable_nodes_and_exact_tokens_as_distinct_roles() {
        let a = Principal::from_slice(&[1, 2, 3, 2]);
        let b = Principal::from_slice(&[2, 3, 4, 2]);
        let mut found = References::new();
        let info = candidate(
            1,
            0,
            Action::ExecuteNnsFunction(ExecuteNnsFunction {
                nns_function: 18,
                payload: encode_one(NodesPayload { node_ids: vec![a] }).unwrap(),
            }),
        );
        assert_eq!(executable(&info, &mut found).unwrap(), Some(None));
        let targets = [(a.to_text(), a), (b.to_text(), b)].into_iter().collect();
        textual(
            &format!(
                "({}) prefix-{} {}",
                a.to_text(),
                b.to_text(),
                &b.to_text()[..8]
            ),
            &targets,
            &mut found,
        );
        assert_eq!(
            found,
            [
                (a, NodeReferenceRole::RegistryRemoval),
                (a, NodeReferenceRole::Textual)
            ]
            .into_iter()
            .collect()
        );
    }

    #[test]
    fn execution_and_failure_exclude_adopted_candidates() {
        let row = |status, executed| {
            candidate(
                status,
                executed,
                Action::Motion {
                    motion_text: String::new(),
                },
            )
        };
        assert_eq!(lifecycle(&row(1, 0)), Some(ActivityLifecycle::Open));
        assert_eq!(
            lifecycle(&row(3, 0)),
            Some(ActivityLifecycle::AdoptedPendingExecution)
        );
        assert_eq!(lifecycle(&row(4, 9)), None);
        assert_eq!(lifecycle(&row(3, 9)), None);
        let mut failed = row(3, 0);
        failed.failed_timestamp_seconds = Some(9);
        assert_eq!(lifecycle(&failed), None);
    }

    #[test]
    fn recovery_and_both_hostos_deployments_decode_full_node_ids() {
        let target = Principal::from_slice(&[10, 2]);
        let node = Principal::from_slice(&[11, 2]);
        for function in [6, 41, 51] {
            let payload = if function == 6 {
                encode_one(RecoveryPayload {
                    subnet_id: target,
                    replacement_nodes: Some(vec![node]),
                })
                .unwrap()
            } else {
                encode_one(NodesPayload {
                    node_ids: vec![node],
                })
                .unwrap()
            };
            let row = candidate(
                1,
                0,
                Action::ExecuteNnsFunction(ExecuteNnsFunction {
                    nns_function: function,
                    payload,
                }),
            );
            let mut refs = References::new();
            let expected = if function == 6 {
                NodeReferenceRole::RecoveryReplacement
            } else {
                NodeReferenceRole::HostosVersionTarget
            };
            assert_eq!(
                executable(&row, &mut refs).unwrap(),
                Some((function == 6).then_some(target))
            );
            assert_eq!(refs, BTreeSet::from([(node, expected)]));
        }
    }

    #[test]
    fn executed_proposal_is_excluded_even_when_its_reward_status_accepts_votes() {
        #[derive(CandidType)]
        struct GovernanceReply {
            id: Option<ProposalId>,
            status: i32,
            topic: i32,
            proposal_timestamp_seconds: u64,
            executed_timestamp_seconds: u64,
            reward_status: i32,
        }
        let wire = encode_one(GovernanceReply {
            id: Some(ProposalId { id: 19 }),
            status: 4,
            topic: 7,
            proposal_timestamp_seconds: 5,
            executed_timestamp_seconds: 9,
            reward_status: 1,
        })
        .unwrap();
        let projected: ProposalInfo = decode_candid(&wire).unwrap();
        assert_eq!(lifecycle(&projected), None);
    }

    #[test]
    fn partial_pagination_or_decoding_cannot_report_complete() {
        let mut coverage = ActivityCoverage::default();
        assert!(!complete(&coverage));
        coverage.pagination_complete = true;
        assert!(complete(&coverage));
        coverage.missing_payloads = 1;
        assert!(!complete(&coverage));
        coverage.missing_payloads = 0;
        coverage.unsupported_actions = 1;
        assert!(!complete(&coverage));
    }
}
