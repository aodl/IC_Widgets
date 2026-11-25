use std::collections::{BTreeMap, BTreeSet};

use candid::{CandidType, Principal};
use nexus_domain::Hash;
use serde::Deserialize;

use crate::{
    ConcentrationRule, Dimension, MembershipAction, MembershipState, Proposal, Record, RegistryKey,
    ReviewInput, ReviewManifest, ScenarioSelection, ScopeState,
    input::{digest, requested_nodes, target},
    scope::make_scope,
    topology::{Metadata, MetadataIssue, metadata, summarize},
};

type Memberships = BTreeMap<Principal, Vec<Principal>>;

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, CandidType, Deserialize)]
pub enum ScenarioId {
    A,
    B,
    AThenB,
    BThenA,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, CandidType, Deserialize)]
pub enum Severity {
    Note,
    Warning,
    Error,
}

#[derive(Clone, Debug, PartialEq, Eq, CandidType, Deserialize)]
pub enum FindingCode {
    InvalidTarget,
    UnlistedTarget,
    RemovalOutsideTarget,
    DuplicateInstruction,
    DuplicateResultingMembership,
    OverlappingInstructionsRemovalWins,
    AlreadyInTarget,
    AssignedElsewhere,
    PreviouslyUnassigned, // Retained for decoding existing reports.
    ApiBoundaryAssignment,
    MissingNode,
    DeletedNode,
    UnavailableNode,
    EmptyResultingSubnet,
    RewardTypeMismatch,
    MissingSevChipIdentity,
    HistoricalBaselineUnavailable,
    TerminalProposal(i32),
    EarlierBaselineHypothesis,
    ExecutedProposalHypothesis,
    UnaffectedRemovalCandidate,
    MissingRegistryMetadata,
    UnknownDimension(Dimension),
    UnavailableRegisteredCoordinates,
    ConcentrationIncreased(Dimension),
    DifferentIntermediateStates,
}

#[derive(Clone, Debug, PartialEq, Eq, CandidType, Deserialize)]
pub struct Finding {
    pub code: FindingCode,
    pub severity: Severity,
    pub step: Option<u8>,
    pub proposal: Option<u64>,
    pub nodes: Vec<Principal>,
    pub subnets: Vec<Principal>,
    /// References into the review manifest at the pinned baseline.
    pub registry: Vec<RegistryKey>,
}

#[derive(Clone, Debug, PartialEq, Eq, CandidType, Deserialize)]
pub enum StepOutcome {
    /// Values that the Registry would write under the modeled membership checks.
    Applied {
        writes: BTreeMap<Principal, Vec<Principal>>,
    },
    Rejected,
    Skipped {
        failed_step: u8,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, CandidType, Deserialize)]
pub struct Step {
    pub proposal: u64,
    pub requested: MembershipAction,
    pub outcome: StepOutcome,
    pub findings: Vec<Finding>,
}

#[derive(Clone, Debug, PartialEq, Eq, CandidType, Deserialize)]
pub struct SubnetReview {
    pub baseline: MembershipState,
    /// Aligned with scenario steps. A rejected or skipped step has no after-state.
    pub after_steps: Vec<Option<MembershipState>>,
}

#[derive(Clone, Debug, PartialEq, Eq, CandidType, Deserialize)]
pub struct Scenario {
    pub id: ScenarioId,
    pub proposal_ids: Vec<u64>,
    pub steps: Vec<Step>,
    pub completed: bool,
    pub subnets: BTreeMap<Principal, SubnetReview>,
    pub findings: Vec<Finding>,
}

#[derive(Clone, Debug, PartialEq, Eq, CandidType, Deserialize)]
pub struct Review {
    pub revision: Hash,
    pub hypothetical_executed: Option<bool>,
    pub manifest: ReviewManifest,
    pub scenarios: Vec<Scenario>,
    pub findings: Vec<Finding>,
}

impl Review {
    pub fn scope(&self, scenario: ScenarioId, subnet: Principal) -> ScopeState {
        make_scope(self, scenario, subnet)
    }
}

pub fn analyze(input: &ReviewInput) -> Review {
    const A: &[usize] = &[0];
    const B: &[usize] = &[1];
    const AB: &[usize] = &[0, 1];
    const BA: &[usize] = &[1, 0];
    let available = &[
        (ScenarioId::A, A),
        (ScenarioId::B, B),
        (ScenarioId::AThenB, AB),
        (ScenarioId::BThenA, BA),
    ];
    let mut original = Memberships::new();
    for id in input.baseline.roster.value().expect("validated roster") {
        if let Some(record) = input.baseline.subnets.get(id) {
            original.insert(
                *id,
                record.value().expect("validated subnet").members.clone(),
            );
        }
    }
    let metadata = (!input.membership_only).then(|| {
        input
            .baseline
            .nodes
            .keys()
            .map(|id| (*id, metadata(&input.baseline, *id)))
            .collect()
    });
    let scenarios: Vec<_> = available
        .iter()
        .filter(|(id, order)| {
            order.iter().all(|i| *i < input.proposals.len())
                && selected(input.manifest.scenario, *id)
        })
        .map(|(id, order)| run(input, &original, metadata.as_ref(), *id, order))
        .collect();

    let mut findings = vec![];
    let left = scenarios.iter().find(|s| s.id == ScenarioId::AThenB);
    let right = scenarios.iter().find(|s| s.id == ScenarioId::BThenA);
    if let Some((left, right)) = left.zip(right) {
        let compare = left
            .subnets
            .keys()
            .chain(right.subnets.keys())
            .copied()
            .collect::<BTreeSet<_>>();
        let differing: Vec<_> = compare
            .into_iter()
            .filter(|id| {
                left.subnets
                    .get(id)
                    .and_then(|s| s.after_steps[0].as_ref())
                    .map(|s| &s.members)
                    != right
                        .subnets
                        .get(id)
                        .and_then(|s| s.after_steps[0].as_ref())
                        .map(|s| &s.members)
            })
            .collect();
        if !differing.is_empty() {
            findings.push(Finding {
                code: FindingCode::DifferentIntermediateStates,
                severity: Severity::Note,
                step: Some(0),
                proposal: None,
                nodes: vec![],
                registry: differing.iter().copied().map(RegistryKey::Subnet).collect(),
                subnets: differing,
            });
        }
    }

    let revision = digest(&(1u16, input.manifest.revision(), &scenarios, &findings));
    Review {
        revision,
        hypothetical_executed: input.hypothetical_executed.then_some(true),
        manifest: input.manifest.clone(),
        scenarios,
        findings,
    }
}

fn selected(selection: ScenarioSelection, id: ScenarioId) -> bool {
    matches!(
        (selection, id),
        (ScenarioSelection::All, _)
            | (ScenarioSelection::A, ScenarioId::A)
            | (ScenarioSelection::B, ScenarioId::B)
            | (ScenarioSelection::AThenB, ScenarioId::AThenB)
            | (ScenarioSelection::BThenA, ScenarioId::BThenA)
    )
}

fn run(
    input: &ReviewInput,
    original: &Memberships,
    metadata: Option<&BTreeMap<Principal, Metadata>>,
    id: ScenarioId,
    order: &[usize],
) -> Scenario {
    let mut touched = BTreeSet::new();
    let mut mentioned = BTreeSet::new();
    for &index in order {
        let action = &input.proposals[index].action;
        let (add, remove) = requested_nodes(action);
        mentioned.extend(add.iter().chain(remove).copied());
        if let Some(subnet) = target(action) {
            touched.insert(subnet);
        } else {
            touched.extend(
                original
                    .iter()
                    .filter(|(_, members)| members.iter().any(|node| remove.contains(node)))
                    .map(|(id, _)| *id),
            );
        }
    }
    let mut subnets = BTreeMap::new();
    for id in touched {
        if let Some(before) = original.get(&id) {
            let kind = input.baseline.subnets[&id]
                .value()
                .expect("validated subnet")
                .kind;
            mentioned.extend(before);
            subnets.insert(
                id,
                SubnetReview {
                    baseline: summarize(before, before, kind, metadata),
                    after_steps: vec![],
                },
            );
        }
    }
    let mut findings = vec![];
    if let Some(metadata) = metadata {
        for node in mentioned {
            for issue in &metadata[&node].issues {
                let (code, key) = match issue {
                    MetadataIssue::MissingRecord(key) => {
                        (FindingCode::MissingRegistryMetadata, key)
                    }
                    MetadataIssue::UnknownDimension(dimension, key) => {
                        (FindingCode::UnknownDimension(*dimension), key)
                    }
                    MetadataIssue::InvalidCoordinates(key) => {
                        (FindingCode::UnavailableRegisteredCoordinates, key)
                    }
                };
                findings.push(Finding {
                    code,
                    severity: Severity::Warning,
                    step: None,
                    proposal: None,
                    nodes: vec![node],
                    subnets: subnets
                        .iter()
                        .filter(|(_, s)| s.baseline.members.contains(&node))
                        .map(|(id, _)| *id)
                        .collect(),
                    registry: vec![key.clone()],
                });
            }
        }
    }
    let mut state = original.clone();
    let mut steps = vec![];
    let mut failed_step = None;
    for (position, &index) in order.iter().enumerate() {
        let proposal = &input.proposals[index];
        let (outcome, findings) = match failed_step {
            Some(failed_step) => (StepOutcome::Skipped { failed_step }, vec![]),
            None => apply(input, &state, proposal, position as u8),
        };
        if let StepOutcome::Applied { writes } = &outcome {
            state.extend(writes.iter().map(|(id, members)| (*id, members.clone())));
        } else if failed_step.is_none() {
            failed_step = Some(position as u8);
        }
        let mut step = Step {
            proposal: proposal.evidence.id,
            requested: proposal.action.clone(),
            outcome,
            findings,
        };
        for (id, result) in &mut subnets {
            let after = matches!(step.outcome, StepOutcome::Applied { .. }).then(|| {
                let kind = input.baseline.subnets[id]
                    .value()
                    .expect("validated subnet")
                    .kind;
                let after = summarize(&result.baseline.members, &state[id], kind, metadata);
                let before = result
                    .after_steps
                    .last()
                    .and_then(Option::as_ref)
                    .unwrap_or(&result.baseline);
                compare_concentration(
                    &input.manifest,
                    *id,
                    before,
                    &after,
                    position as u8,
                    &mut step,
                );
                after
            });
            result.after_steps.push(after);
        }
        steps.push(step);
    }
    Scenario {
        id,
        proposal_ids: steps.iter().map(|step| step.proposal).collect(),
        steps,
        completed: failed_step.is_none(),
        subnets,
        findings,
    }
}

fn apply(
    input: &ReviewInput,
    state: &Memberships,
    proposal: &Proposal,
    position: u8,
) -> (StepOutcome, Vec<Finding>) {
    use FindingCode::*;
    use Severity::*;
    let mut findings = vec![];
    let mut report = |code, severity, nodes, subnets, registry| {
        findings.push(Finding {
            code,
            severity,
            step: Some(position),
            proposal: Some(proposal.evidence.id),
            nodes,
            subnets,
            registry,
        });
    };
    let evidence = &proposal.evidence;
    if evidence.lifecycle_status == 4 || evidence.executed_at_seconds.is_some() {
        let safe = evidence
            .proposed_at_seconds
            .zip(evidence.executed_at_seconds)
            .zip(input.manifest.historical_head.as_ref())
            .is_some_and(|((proposed, executed), head)| {
                proposed > 0
                    && proposed <= executed
                    && head.observed_at_nanos / 1_000_000_000 < proposed
                    && head.observed_at_nanos <= evidence.observed_at_nanos
            });
        if input.hypothetical_executed {
            report(ExecutedProposalHypothesis, Note, vec![], vec![], vec![]);
        } else if !safe {
            report(HistoricalBaselineUnavailable, Error, vec![], vec![], vec![]);
            return (StepOutcome::Rejected, findings);
        } else {
            report(EarlierBaselineHypothesis, Note, vec![], vec![], vec![]);
        }
    } else if !matches!(evidence.lifecycle_status, 1 | 3) {
        report(
            TerminalProposal(evidence.lifecycle_status),
            Error,
            vec![],
            vec![],
            vec![],
        );
        return (StepOutcome::Rejected, findings);
    }

    let (add, remove) = requested_nodes(&proposal.action);
    let adds: BTreeSet<_> = add.iter().copied().collect();
    let removals: BTreeSet<_> = remove.iter().copied().collect();
    let subnet = target(&proposal.action);
    if adds.len() != add.len() || removals.len() != remove.len() {
        let mut duplicates = BTreeSet::new();
        for instructions in [add, remove] {
            let mut seen = BTreeSet::new();
            duplicates.extend(instructions.iter().copied().filter(|id| !seen.insert(*id)));
        }
        report(
            DuplicateInstruction,
            Warning,
            duplicates.into_iter().collect(),
            subnet.into_iter().collect(),
            vec![],
        );
    }
    let overlap: Vec<_> = adds.intersection(&removals).copied().collect();
    if !overlap.is_empty() {
        report(
            OverlappingInstructionsRemovalWins,
            Warning,
            overlap,
            subnet.into_iter().collect(),
            vec![],
        );
    }
    let mut writes = Memberships::new();
    if let Some(id) = subnet {
        let Some(current) = state.get(&id) else {
            let code = if input
                .baseline
                .subnets
                .get(&id)
                .and_then(Record::value)
                .is_some()
            {
                UnlistedTarget
            } else {
                InvalidTarget
            };
            report(
                code,
                Error,
                vec![],
                vec![id],
                vec![RegistryKey::Subnet(id), RegistryKey::Roster],
            );
            return (StepOutcome::Rejected, findings);
        };
        let current_set: BTreeSet<_> = current.iter().copied().collect();
        let outsider: Vec<_> = removals.difference(&current_set).copied().collect();
        if !outsider.is_empty() {
            report(
                RemovalOutsideTarget,
                Error,
                outsider,
                vec![id],
                vec![RegistryKey::Subnet(id)],
            );
            return (StepOutcome::Rejected, findings);
        }
        for &node in &adds {
            if current_set.contains(&node) {
                report(
                    AlreadyInTarget,
                    Note,
                    vec![node],
                    vec![id],
                    vec![RegistryKey::Subnet(id)],
                );
            }
            if matches!(proposal.action, MembershipAction::Add { .. })
                && input.baseline.boundaries[&node].value().is_some()
            {
                report(
                    ApiBoundaryAssignment,
                    Error,
                    vec![node],
                    vec![id],
                    vec![RegistryKey::ApiBoundary(node)],
                );
            }
        }
        let mut result: Vec<_> = add
            .iter()
            .chain(current)
            .filter(|node| !removals.contains(node))
            .copied()
            .collect();
        result.dedup(); // Upstream Vec::dedup collapses only adjacent repetitions.
        writes.insert(id, result);
    } else {
        let mut seen = BTreeSet::new();
        for (&id, current) in state {
            let result = current
                .iter()
                .filter(|node| {
                    let drop = removals.contains(node);
                    if drop {
                        seen.insert(**node);
                    }
                    !drop
                })
                .copied()
                .collect::<Vec<_>>();
            if result.len() != current.len() {
                writes.insert(id, result);
            }
        }
        for &node in removals.difference(&seen) {
            report(
                UnaffectedRemovalCandidate,
                Note,
                vec![node],
                vec![],
                vec![RegistryKey::Node(node)],
            );
        }
    }

    let mut owners = BTreeMap::<Principal, BTreeSet<Principal>>::new();
    for (&subnet, existing) in state {
        for &node in writes.get(&subnet).unwrap_or(existing) {
            owners.entry(node).or_default().insert(subnet);
        }
    }
    for (&id, members) in &writes {
        let mut checked = BTreeSet::new();
        if members.is_empty() {
            report(
                EmptyResultingSubnet,
                Error,
                vec![],
                vec![id],
                vec![RegistryKey::Subnet(id)],
            );
        }
        let subnet = input.baseline.subnets[&id].value().expect("listed subnet");
        for &node_id in members {
            if !checked.insert(node_id) {
                report(
                    DuplicateResultingMembership,
                    Error,
                    vec![node_id],
                    vec![id],
                    vec![RegistryKey::Subnet(id)],
                );
                continue;
            }
            if owners[&node_id].len() > 1 {
                let subnets: Vec<_> = owners[&node_id].iter().copied().collect();
                report(
                    AssignedElsewhere,
                    Error,
                    vec![node_id],
                    subnets.clone(),
                    subnets.into_iter().map(RegistryKey::Subnet).collect(),
                );
            }
            let key = RegistryKey::Node(node_id);
            let Some(record) = input.baseline.nodes.get(&node_id) else {
                debug_assert!(input.membership_only, "full review validates every member");
                continue;
            };
            let node = match record {
                Record::Present { value, .. } => value,
                record => {
                    let code = match record {
                        Record::Missing => MissingNode,
                        Record::Deleted(_) => DeletedNode,
                        _ => UnavailableNode,
                    };
                    report(code, Error, vec![node_id], vec![id], vec![key]);
                    continue;
                }
            };
            let boundary = &input.baseline.boundaries[&node_id];
            let boundary_code = match boundary {
                Record::Present { .. } => Some(ApiBoundaryAssignment),
                Record::Unavailable { .. } => Some(UnavailableNode),
                _ => None,
            };
            if let Some(code) = boundary_code {
                // Function 2 has already explicitly reported requested boundary nodes.
                if !matches!(proposal.action, MembershipAction::Add { .. })
                    || !adds.contains(&node_id)
                    || matches!(boundary, Record::Unavailable { .. })
                {
                    report(
                        code,
                        Error,
                        vec![node_id],
                        vec![id],
                        vec![RegistryKey::ApiBoundary(node_id)],
                    );
                }
            }
            if (subnet.kind == 5) != matches!(node.reward_type, Some(7..=12)) {
                report(
                    RewardTypeMismatch,
                    Error,
                    vec![node_id],
                    vec![id],
                    vec![key.clone(), RegistryKey::Subnet(id)],
                );
            }
            if subnet.sev_enabled && !node.has_chip_id {
                report(
                    MissingSevChipIdentity,
                    Error,
                    vec![node_id],
                    vec![id],
                    vec![key, RegistryKey::Subnet(id)],
                );
            }
        }
    }
    let outcome = if findings.iter().any(|finding| finding.severity == Error) {
        StepOutcome::Rejected
    } else {
        StepOutcome::Applied { writes }
    };
    (outcome, findings)
}

fn compare_concentration(
    manifest: &ReviewManifest,
    subnet: Principal,
    before: &MembershipState,
    after: &MembershipState,
    step_index: u8,
    step: &mut Step,
) {
    for (dimension, prior) in &before.distributions {
        let current = &after.distributions[dimension];
        if prior.unknown > 0 || current.unknown > 0 {
            continue;
        }
        let coefficient = |distribution: &crate::Distribution| {
            let value = match manifest.policy.concentration_rule {
                ConcentrationRule::GreaterThanOneThird => &distribution.greater_than_one_third,
                ConcentrationRule::FaultBudgetPlusOne => &distribution.fault_budget_plus_one,
            };
            value.as_ref().and_then(|value| value.groups_to_reach)
        };
        let smaller_coalition = coefficient(prior)
            .zip(coefficient(current))
            .is_some_and(|(old, new)| new < old);
        let higher_share = manifest.policy.warn_on_largest_share_increase
            && prior
                .largest
                .zip(current.largest)
                .is_some_and(|(old, new)| {
                    u64::from(new) * u64::from(before.member_count)
                        > u64::from(old) * u64::from(after.member_count)
                });
        if smaller_coalition || higher_share {
            step.findings.push(Finding {
                code: FindingCode::ConcentrationIncreased(*dimension),
                severity: Severity::Warning,
                step: Some(step_index),
                proposal: Some(step.proposal),
                nodes: vec![],
                subnets: vec![subnet],
                registry: vec![RegistryKey::Subnet(subnet)],
            });
        }
    }
}
