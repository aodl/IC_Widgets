use std::collections::{BTreeMap, BTreeSet};

use candid::{CandidType, Principal};
use nexus_domain::Hash;
use serde::Deserialize;

use crate::{
    Review, ScenarioId, StepOutcome,
    input::{digest, requested_nodes},
};

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, CandidType, Deserialize)]
pub enum NodeRole {
    BaselineMember,
    MentionedForAddition,
    MentionedForRemoval,
    ParticipatedInAppliedState,
    AddedInStep,
    RemovedInStep,
    FinalMember,
    Retained,
    NetAdded,
    NetRemoved,
}

#[derive(Clone, Debug, PartialEq, Eq, CandidType, Deserialize)]
pub struct StepParticipation {
    pub step: u8,
    pub requested_add: bool,
    pub requested_remove: bool,
    pub before: Option<bool>,
    pub after: Option<bool>,
}

#[derive(Clone, Debug, PartialEq, Eq, CandidType, Deserialize)]
pub struct ScopedNode {
    pub roles: BTreeSet<NodeRole>,
    pub steps: Vec<StepParticipation>,
}

#[derive(Clone, Debug, PartialEq, Eq, CandidType, Deserialize)]
pub struct ScopeIdentity {
    pub review_revision: Hash,
    pub evidence_revision: Hash,
    pub analysis_version: u16,
    pub metrics_revision: Option<Hash>,
    pub ordered_proposals: Vec<u64>,
    pub scenario: ScenarioId,
    pub baseline_registry_version: u64,
    pub target_subnet: Principal,
}

#[derive(Clone, Debug, PartialEq, Eq, CandidType, Deserialize)]
pub struct ResolvedScope {
    pub(crate) identity: ScopeIdentity,
    pub(crate) nodes: BTreeMap<Principal, ScopedNode>,
}

#[derive(Clone, Debug, PartialEq, Eq, CandidType, Deserialize)]
pub enum ScopeUnavailable {
    ScenarioUnavailable,
    SubnetOutsideReview,
}

#[derive(Clone, Debug, PartialEq, Eq, CandidType, Deserialize)]
pub enum ScopeState {
    Resolved(ResolvedScope),
    Unavailable(ScopeUnavailable),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ScopeConflict;

impl ResolvedScope {
    pub fn identity(&self) -> &ScopeIdentity {
        &self.identity
    }

    pub fn nodes(&self) -> &BTreeMap<Principal, ScopedNode> {
        &self.nodes
    }

    pub fn selection_id(&self) -> Hash {
        digest(&(
            &self.identity,
            self.nodes.keys().copied().collect::<Vec<_>>(),
        ))
    }

    /// Matches any of the selected roles. An empty filter selects zero nodes.
    pub fn narrow_roles(&self, roles: &BTreeSet<NodeRole>) -> Self {
        self.narrow(|_, node| !node.roles.is_disjoint(roles))
    }

    pub fn narrow_nodes(&self, nodes: &BTreeSet<Principal>) -> Self {
        self.narrow(|id, _| nodes.contains(id))
    }

    pub fn intersect(&self, other: &Self) -> Result<Self, ScopeConflict> {
        if self.identity != other.identity {
            return Err(ScopeConflict);
        }
        Ok(self.narrow(|id, _| other.nodes.contains_key(id)))
    }

    fn narrow(&self, keep: impl Fn(&Principal, &ScopedNode) -> bool) -> Self {
        Self {
            identity: self.identity.clone(),
            nodes: self
                .nodes
                .iter()
                .filter(|(id, node)| keep(id, node))
                .map(|(id, node)| (*id, node.clone()))
                .collect(),
        }
    }
}

impl ScopeState {
    pub fn narrow_roles(&self, roles: &BTreeSet<NodeRole>) -> Self {
        match self {
            Self::Resolved(scope) => Self::Resolved(scope.narrow_roles(roles)),
            Self::Unavailable(reason) => Self::Unavailable(reason.clone()),
        }
    }

    pub fn narrow_nodes(&self, nodes: &BTreeSet<Principal>) -> Self {
        match self {
            Self::Resolved(scope) => Self::Resolved(scope.narrow_nodes(nodes)),
            Self::Unavailable(reason) => Self::Unavailable(reason.clone()),
        }
    }
}

/// Explicit comparison preserves both identities and both independent node sets.
pub fn compare_scopes<'a>(
    left: &'a ResolvedScope,
    right: &'a ResolvedScope,
) -> (&'a ResolvedScope, &'a ResolvedScope) {
    (left, right)
}

pub(crate) fn make_scope(review: &Review, id: ScenarioId, subnet: Principal) -> ScopeState {
    use NodeRole::*;
    let Some(scenario) = review.scenarios.iter().find(|s| s.id == id) else {
        return ScopeState::Unavailable(ScopeUnavailable::ScenarioUnavailable);
    };
    let Some(result) = scenario.subnets.get(&subnet) else {
        return ScopeState::Unavailable(ScopeUnavailable::SubnetOutsideReview);
    };
    let requests: Vec<_> = scenario
        .steps
        .iter()
        .map(|step| {
            let (add, remove) = requested_nodes(&step.requested);
            (
                add.iter().copied().collect::<BTreeSet<_>>(),
                remove.iter().copied().collect::<BTreeSet<_>>(),
            )
        })
        .collect();
    let baseline: BTreeSet<_> = result.baseline.members.iter().copied().collect();
    let mut ids = baseline.clone();
    for (add, remove) in &requests {
        ids.extend(add);
        ids.extend(remove);
    }
    let states: Vec<_> = result
        .after_steps
        .iter()
        .map(|state| {
            state
                .as_ref()
                .map(|state| state.members.iter().copied().collect::<BTreeSet<_>>())
        })
        .collect();
    let nodes = ids
        .into_iter()
        .map(|node| {
            let was_member = baseline.contains(&node);
            let mut roles = BTreeSet::new();
            if was_member {
                roles.insert(BaselineMember);
            }
            let mut before = Some(was_member);
            let mut steps = vec![];
            for (index, (add, remove)) in requests.iter().enumerate() {
                let requested_add = add.contains(&node);
                let requested_remove = remove.contains(&node);
                if requested_add {
                    roles.insert(MentionedForAddition);
                }
                if requested_remove {
                    roles.insert(MentionedForRemoval);
                }
                let after = states[index].as_ref().map(|row| row.contains(&node));
                if after == Some(true) {
                    roles.insert(ParticipatedInAppliedState);
                }
                if before == Some(false) && after == Some(true) {
                    roles.insert(AddedInStep);
                }
                if before == Some(true) && after == Some(false) {
                    roles.insert(RemovedInStep);
                }
                steps.push(StepParticipation {
                    step: index as u8,
                    requested_add,
                    requested_remove,
                    before: if matches!(scenario.steps[index].outcome, StepOutcome::Skipped { .. })
                    {
                        None
                    } else {
                        before
                    },
                    after,
                });
                before = after;
            }
            if scenario.completed {
                if before == Some(true) {
                    roles.insert(FinalMember);
                    roles.insert(if was_member { Retained } else { NetAdded });
                } else if was_member {
                    roles.insert(NetRemoved);
                }
            }
            (node, ScopedNode { roles, steps })
        })
        .collect();
    ScopeState::Resolved(ResolvedScope {
        identity: ScopeIdentity {
            review_revision: review.revision,
            evidence_revision: review.manifest.revision(),
            analysis_version: review.manifest.analysis_version,
            metrics_revision: review.manifest.metrics_revision,
            ordered_proposals: scenario.proposal_ids.clone(),
            scenario: id,
            baseline_registry_version: review.manifest.registry_version,
            target_subnet: subnet,
        },
        nodes,
    })
}
