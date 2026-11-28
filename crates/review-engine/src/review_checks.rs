use std::collections::BTreeSet;

use candid::{CandidType, Principal};
use serde::Deserialize;

use crate::{FindingCode, Review, ScenarioId, StepOutcome, requested_nodes};

#[derive(Debug, PartialEq, Eq, CandidType, Deserialize)]
pub enum MembershipPreconditions {
    EstablishedInCheckedScope,
    IncompleteAssignmentCoverage,
    Rejected,
    Skipped,
}

#[derive(Debug, PartialEq, Eq, CandidType, Deserialize)]
pub struct TransitionSide {
    pub members: u32,
    pub fault_budget: u32,
    pub modeled_unavailable: u32,
    pub remaining: i32,
}

#[derive(Debug, PartialEq, Eq, CandidType, Deserialize)]
pub struct TransitionMargin {
    pub before: TransitionSide,
    pub proposed: TransitionSide,
    pub remaining: i32,
    pub further_faults_to_exceed: u32,
}

#[derive(Debug, PartialEq, Eq, CandidType, Deserialize)]
pub struct SubnetTransition {
    pub subnet: Principal,
    pub margin: Option<TransitionMargin>,
    pub cumulative_margin: Option<TransitionMargin>,
}

#[derive(Debug, PartialEq, Eq, CandidType, Deserialize)]
pub struct ReviewCheck {
    pub scenario: ScenarioId,
    pub step: u8,
    pub proposal: u64,
    pub add_duplicates: Vec<Principal>,
    pub remove_duplicates: Vec<Principal>,
    pub overlap: Vec<Principal>,
    pub preconditions: MembershipPreconditions,
    pub transitions: Vec<SubnetTransition>,
}

fn duplicates(nodes: &[Principal]) -> Vec<Principal> {
    let mut seen = BTreeSet::new();
    nodes
        .iter()
        .copied()
        .filter(|id| !seen.insert(*id))
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
}

pub fn transition_margin(before: &[Principal], proposed: &[Principal]) -> Option<TransitionMargin> {
    margin_with_unsynchronized(before, proposed, &BTreeSet::new())
}

fn margin_with_unsynchronized(
    before: &[Principal],
    proposed: &[Principal],
    earlier: &BTreeSet<Principal>,
) -> Option<TransitionMargin> {
    let from: BTreeSet<_> = before.iter().copied().collect();
    let to: BTreeSet<_> = proposed.iter().copied().collect();
    if from.is_empty() || to.is_empty() || from.len() != before.len() || to.len() != proposed.len()
    {
        return None;
    }
    let side = |members: usize, modeled_unavailable: usize| {
        let members = members as u32;
        let fault_budget = (members - 1) / 3;
        TransitionSide {
            members,
            fault_budget,
            modeled_unavailable: modeled_unavailable as u32,
            remaining: fault_budget as i32 - modeled_unavailable as i32,
        }
    };
    let before = side(
        from.len(),
        from.iter()
            .filter(|node| !to.contains(node) || earlier.contains(node))
            .count(),
    );
    let proposed = side(
        to.len(),
        to.iter()
            .filter(|node| !from.contains(node) || earlier.contains(node))
            .count(),
    );
    let remaining = before.remaining.min(proposed.remaining);
    Some(TransitionMargin {
        before,
        proposed,
        remaining,
        further_faults_to_exceed: (remaining + 1).max(0) as u32,
    })
}

/// Each comparison uses the preceding actual simulated state and the current
/// step's resulting state. This remains separate from concentration analysis.
pub fn review_checks(
    review: &Review,
    unseen_assignments: &BTreeSet<Principal>,
) -> Vec<ReviewCheck> {
    review
        .scenarios
        .iter()
        .flat_map(|scenario| {
            scenario.steps.iter().enumerate().map(move |(index, step)| {
                let (add, remove) = requested_nodes(&step.requested);
                let adds: BTreeSet<_> = add.iter().copied().collect();
                let removes: BTreeSet<_> = remove.iter().copied().collect();
                let preconditions = match &step.outcome {
                    StepOutcome::Rejected => MembershipPreconditions::Rejected,
                    StepOutcome::Skipped { .. } => MembershipPreconditions::Skipped,
                    StepOutcome::Applied { .. }
                        if adds
                            .difference(&removes)
                            .any(|node| unseen_assignments.contains(node)) =>
                    {
                        MembershipPreconditions::IncompleteAssignmentCoverage
                    }
                    StepOutcome::Applied { .. } => {
                        MembershipPreconditions::EstablishedInCheckedScope
                    }
                };
                let transitions = scenario
                    .subnets
                    .iter()
                    .filter(|(subnet, _)| match &step.outcome {
                        StepOutcome::Applied { writes } => writes.contains_key(subnet),
                        _ => {
                            step.findings.is_empty()
                                || step.findings.iter().any(|finding| {
                                    finding.subnets.contains(subnet)
                                        || matches!(finding.code, FindingCode::TerminalProposal(_))
                                })
                        }
                    })
                    .map(|(&subnet, view)| {
                        let before = if index == 0 {
                            Some(&view.baseline)
                        } else {
                            view.after_steps.get(index - 1).and_then(Option::as_ref)
                        };
                        let proposed = view.after_steps.get(index).and_then(Option::as_ref);
                        let (margin, cumulative_margin) =
                            if matches!(step.outcome, StepOutcome::Applied { .. }) {
                                before
                                    .zip(proposed)
                                    .map_or((None, None), |(before, proposed)| {
                                        let mut earlier = BTreeSet::new();
                                        let mut previous: BTreeSet<_> =
                                            view.baseline.members.iter().copied().collect();
                                        for state in view.after_steps.iter().take(index).flatten() {
                                            let now: BTreeSet<_> =
                                                state.members.iter().copied().collect();
                                            earlier.retain(|node| now.contains(node));
                                            earlier.extend(now.difference(&previous).copied());
                                            previous = now;
                                        }
                                        (
                                            transition_margin(&before.members, &proposed.members),
                                            (index > 0)
                                                .then(|| {
                                                    margin_with_unsynchronized(
                                                        &before.members,
                                                        &proposed.members,
                                                        &earlier,
                                                    )
                                                })
                                                .flatten(),
                                        )
                                    })
                            } else {
                                (None, None)
                            };
                        SubnetTransition {
                            subnet,
                            margin,
                            cumulative_margin,
                        }
                    })
                    .collect();
                ReviewCheck {
                    scenario: scenario.id,
                    step: index as u8,
                    proposal: step.proposal,
                    add_duplicates: duplicates(add),
                    remove_duplicates: duplicates(remove),
                    overlap: adds.intersection(&removes).copied().collect(),
                    preconditions,
                    transitions,
                }
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn nodes(from: u8, to: u8) -> Vec<Principal> {
        (from..to)
            .map(|id| Principal::from_slice(&[id, 2]))
            .collect()
    }

    #[test]
    fn thirteen_nodes_with_three_four_or_five_replacements_distinguish_margins() {
        let before = nodes(0, 13);
        for (replaced, remaining, further) in [(3, 1, 2), (4, 0, 1), (5, -1, 0)] {
            let margin = transition_margin(&before, &nodes(replaced, replaced + 13)).unwrap();
            assert_eq!(margin.before.fault_budget, 4);
            assert_eq!(margin.before.modeled_unavailable, replaced as u32);
            assert_eq!(margin.remaining, remaining);
            assert_eq!(margin.further_faults_to_exceed, further);
        }
    }

    #[test]
    fn overlapping_steps_count_earlier_arrivals_once_even_when_departing() {
        let before = nodes(0, 13);
        let proposed = nodes(1, 14);
        let earlier = BTreeSet::from([before[0], before[1]]);
        let result = margin_with_unsynchronized(&before, &proposed, &earlier).unwrap();
        assert_eq!(result.before.modeled_unavailable, 2);
        assert_eq!(result.proposed.modeled_unavailable, 2);
        assert_eq!(result.remaining, 2);
        assert_eq!(transition_margin(&before, &proposed).unwrap().remaining, 3);
    }

    #[test]
    fn growth_shrinkage_small_and_nonstandard_sizes_use_both_states() {
        let six = nodes(0, 6);
        let eight = nodes(0, 8);
        let grow = transition_margin(&six, &eight).unwrap();
        assert_eq!(
            (
                grow.before.remaining,
                grow.proposed.remaining,
                grow.remaining
            ),
            (1, 0, 0)
        );
        let shrink = transition_margin(&eight, &six).unwrap();
        assert_eq!(
            (
                shrink.before.remaining,
                shrink.proposed.remaining,
                shrink.remaining
            ),
            (0, 1, 0)
        );
        for (size, budget) in [(1, 0), (3, 0), (6, 1), (9, 2), (17, 5)] {
            let members = nodes(0, size);
            assert_eq!(
                transition_margin(&members, &members).unwrap().remaining,
                budget
            );
        }
        assert!(transition_margin(&six, &[]).is_none());
        assert!(transition_margin(&six, &[six[0], six[0]]).is_none());
    }
}
