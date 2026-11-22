//! Contracts for scoped derivation from cumulative subnet blockmaking counters.
use candid::{CandidType, Principal};
use serde::Deserialize;

use crate::{ResolvedScope, ScopeState};

#[derive(Clone, Copy, Debug, PartialEq, Eq, CandidType, Deserialize)]
pub struct Counters {
    pub proposed: u64,
    pub failures: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, CandidType, Deserialize)]
pub enum Observation {
    Row(Counters),
    SparseOmission,
    MissingSample,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, CandidType, Deserialize)]
pub enum Continuity {
    SameEpoch,
    Unknown,
    Gap,
    Reappearance,
    SubnetTransition,
    ConflictingSample,
}

#[derive(Clone, Debug, PartialEq, Eq, CandidType, Deserialize)]
pub struct CounterEdge {
    pub node: Principal,
    pub previous_subnet: Principal,
    pub subnet: Principal,
    pub previous_timestamp: u64,
    pub timestamp: u64,
    pub previous: Observation,
    pub current: Observation,
    pub continuity: Continuity,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, CandidType, Deserialize)]
pub enum Interval {
    Observed { proposed: u64, failures: u64 },
    ZeroObservedOpportunities,
    SparseOmission,
    MissingSample,
    CounterReset,
    Reappearance,
    SubnetTransition,
    ConflictingSample,
    InsufficientCoverage,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, CandidType, Deserialize)]
pub enum MetricsUnavailable {
    ScopeUnavailable,
    OutOfScopeNode,
    SubnetOutsideScope,
}

pub fn scoped_interval(
    scope: &ScopeState,
    edge: &CounterEdge,
) -> Result<Interval, MetricsUnavailable> {
    let ScopeState::Resolved(scope) = scope else {
        return Err(MetricsUnavailable::ScopeUnavailable);
    };
    analyze_edge(scope, edge)
}

fn analyze_edge(scope: &ResolvedScope, edge: &CounterEdge) -> Result<Interval, MetricsUnavailable> {
    if !scope.nodes().contains_key(&edge.node) {
        return Err(MetricsUnavailable::OutOfScopeNode);
    }
    if scope.identity().target_subnet != edge.subnet {
        return Err(MetricsUnavailable::SubnetOutsideScope);
    }
    Ok(derive_interval(edge))
}

pub fn derive_interval(edge: &CounterEdge) -> Interval {
    if edge.timestamp <= edge.previous_timestamp {
        return Interval::InsufficientCoverage;
    }
    if edge.subnet != edge.previous_subnet {
        return Interval::SubnetTransition;
    }
    match edge.continuity {
        Continuity::ConflictingSample => return Interval::ConflictingSample,
        Continuity::Gap => return Interval::MissingSample,
        Continuity::Reappearance => return Interval::Reappearance,
        Continuity::SubnetTransition => return Interval::SubnetTransition,
        _ => {}
    }
    match (edge.previous, edge.current) {
        (Observation::MissingSample, _) | (_, Observation::MissingSample) => {
            Interval::MissingSample
        }
        (Observation::SparseOmission, _) | (_, Observation::SparseOmission) => {
            Interval::SparseOmission
        }
        (Observation::Row(a), Observation::Row(b)) => {
            let counters = b
                .proposed
                .checked_sub(a.proposed)
                .zip(b.failures.checked_sub(a.failures));
            match counters {
                None => Interval::CounterReset,
                Some(_) if edge.continuity != Continuity::SameEpoch => {
                    Interval::InsufficientCoverage
                }
                Some((0, 0)) => Interval::ZeroObservedOpportunities,
                Some((proposed, failures)) => Interval::Observed { proposed, failures },
            }
        }
    }
}
