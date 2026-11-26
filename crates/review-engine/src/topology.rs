use std::collections::{BTreeMap, BTreeSet};

use candid::{CandidType, Principal};
use serde::Deserialize;

use crate::{Coordinates, Record, RegistryBaseline, RegistryKey, data_center_key};

#[derive(Clone, Copy, Debug, PartialEq, Eq, CandidType, Deserialize)]
pub enum ConcentrationRule {
    GreaterThanOneThird,
    FaultBudgetPlusOne,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, CandidType, Deserialize)]
pub struct Policy {
    pub version: u16,
    pub concentration_rule: ConcentrationRule,
    pub warn_on_largest_share_increase: bool,
}

impl Policy {
    pub const V1: Self = Self {
        version: 1,
        concentration_rule: ConcentrationRule::GreaterThanOneThird,
        warn_on_largest_share_increase: true,
    };

    pub(crate) fn is_supported(self) -> bool {
        self.version == 1
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, CandidType, Deserialize)]
pub enum Dimension {
    Operator,
    Provider,
    DataCenter,
    RegisteredOwner,
    RegisteredCountry,
    RegisteredContinent,
}

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, CandidType, Deserialize)]
pub enum Group {
    Principal(Principal),
    RegisteredLabel(String),
}

#[derive(Clone, Debug, PartialEq, Eq, CandidType, Deserialize)]
pub struct Threshold {
    pub nodes_required: u32,
    /// Populated only with full coverage.
    pub groups_to_reach: Option<u32>,
}

#[derive(Clone, Debug, PartialEq, Eq, CandidType, Deserialize)]
pub struct Distribution {
    pub groups: BTreeMap<Group, u32>,
    pub unknown: u32,
    pub smallest: Option<u32>,
    pub largest: Option<u32>,
    /// Exact mean of known group sizes as (known members, groups).
    pub mean_ratio: Option<(u32, u32)>,
    pub greater_than_one_third: Option<Threshold>,
    pub fault_budget_plus_one: Option<Threshold>,
}

#[derive(Clone, Debug, PartialEq, Eq, CandidType, Deserialize)]
pub struct Distances {
    pub known_nodes: u32,
    pub unknown_nodes: u32,
    pub valid_pairs: u64,
    pub total_pairs: u64,
    pub minimum_metres: Option<u32>,
    pub maximum_metres: Option<u32>,
    pub mean_metres: Option<u32>,
}

#[derive(Clone, Debug, PartialEq, Eq, CandidType, Deserialize)]
pub struct MembershipState {
    /// Registry order is preserved because it affects validation.
    pub members: Vec<Principal>,
    pub added: Vec<Principal>,
    pub removed: Vec<Principal>,
    pub retained: Vec<Principal>,
    pub baseline_count: u32,
    pub member_count: u32,
    pub net_change: i64,
    pub distributions: BTreeMap<Dimension, Distribution>,
    pub distances: Distances,
}

/// Descriptive comparison of explicitly selected members. It makes no claims
/// about assignment coverage, eligibility, or the validity of an execution.
#[derive(Debug, CandidType, Deserialize)]
pub struct MembershipComparison {
    pub baseline: MembershipState,
    pub selected: MembershipState,
    pub registered_area_before: Distribution,
    pub registered_area_after: Distribution,
}

/// Only the metadata used for descriptive grouping. Assignment coverage and
/// proposal eligibility are evaluated by the separate simulation contract.
pub struct TopologyEvidence<'a> {
    pub nodes: &'a BTreeMap<Principal, Record<crate::Node>>,
    pub operators: &'a BTreeMap<Principal, Record<crate::Operator>>,
    pub data_centers: &'a BTreeMap<String, Record<crate::DataCenter>>,
}

impl<'a> From<&'a RegistryBaseline> for TopologyEvidence<'a> {
    fn from(baseline: &'a RegistryBaseline) -> Self {
        Self {
            nodes: &baseline.nodes,
            operators: &baseline.operators,
            data_centers: &baseline.data_centers,
        }
    }
}

pub fn compare_membership(
    evidence: &TopologyEvidence<'_>,
    before: &[Principal],
    after: &[Principal],
    kind: i32,
) -> MembershipComparison {
    let nodes: BTreeSet<_> = before.iter().chain(after).copied().collect();
    let metadata: BTreeMap<_, _> = nodes
        .into_iter()
        .map(|id| (id, metadata(evidence, id)))
        .collect();
    let areas = |members: &[Principal]| {
        let mut groups = BTreeMap::new();
        for member in members {
            if let Some(area) = &metadata[member].area {
                *groups
                    .entry(Group::RegisteredLabel(area.clone()))
                    .or_insert(0) += 1;
            }
        }
        distribution(groups, members.len() as u32, matches!(kind, 1 | 2 | 4))
    };
    MembershipComparison {
        baseline: summarize(before, before, kind, Some(&metadata)),
        selected: summarize(before, after, kind, Some(&metadata)),
        registered_area_before: areas(before),
        registered_area_after: areas(after),
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum MetadataIssue {
    MissingRecord(RegistryKey),
    UnknownDimension(Dimension, RegistryKey),
    InvalidCoordinates(RegistryKey),
}

#[derive(Default)]
pub(crate) struct Metadata {
    groups: BTreeMap<Dimension, Group>,
    gps: Option<Coordinates>,
    area: Option<String>,
    pub(crate) issues: Vec<MetadataIssue>,
}

const DIMENSIONS: [Dimension; 6] = [
    Dimension::Operator,
    Dimension::Provider,
    Dimension::DataCenter,
    Dimension::RegisteredOwner,
    Dimension::RegisteredCountry,
    Dimension::RegisteredContinent,
];

pub(crate) fn metadata(registry: &TopologyEvidence<'_>, id: Principal) -> Metadata {
    use Dimension::*;
    let mut result = Metadata::default();
    let Some(node) = registry.nodes.get(&id).and_then(Record::value) else {
        result
            .issues
            .push(MetadataIssue::MissingRecord(RegistryKey::Node(id)));
        return result;
    };
    let Some(operator_id) = node.operator else {
        result.issues.push(MetadataIssue::UnknownDimension(
            Operator,
            RegistryKey::Node(id),
        ));
        return result;
    };
    result
        .groups
        .insert(Operator, Group::Principal(operator_id));
    let operator_key = RegistryKey::Operator(operator_id);
    let Some(operator) = registry.operators.get(&operator_id).and_then(Record::value) else {
        result
            .issues
            .push(MetadataIssue::MissingRecord(operator_key));
        return result;
    };
    if let Some(provider_id) = operator.provider {
        result
            .groups
            .insert(Provider, Group::Principal(provider_id));
    } else {
        result.issues.push(MetadataIssue::UnknownDimension(
            Provider,
            operator_key.clone(),
        ));
    }
    let Some(dc_id) = data_center_key(&operator.data_center) else {
        result
            .issues
            .push(MetadataIssue::UnknownDimension(DataCenter, operator_key));
        return result;
    };
    // The operator record registers a DC ID independently of the DC details.
    result
        .groups
        .insert(DataCenter, Group::RegisteredLabel(dc_id.clone()));
    let dc_key = RegistryKey::DataCenter(dc_id.clone());
    let Some(dc) = registry.data_centers.get(&dc_id).and_then(Record::value) else {
        result.issues.push(MetadataIssue::MissingRecord(dc_key));
        return result;
    };
    let owner = dc.registered_owner.trim();
    let (continent, country) = registered_geography(&dc.registered_region);
    result.area = dc
        .registered_region
        .split(',')
        .nth(2)
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .map(str::to_owned);
    for (dimension, value) in [
        (RegisteredOwner, (!owner.is_empty()).then_some(owner)),
        (RegisteredCountry, country),
        (RegisteredContinent, continent),
    ] {
        if let Some(value) = value {
            result
                .groups
                .insert(dimension, Group::RegisteredLabel(value.into()));
        } else {
            result
                .issues
                .push(MetadataIssue::UnknownDimension(dimension, dc_key.clone()));
        }
    }
    result.gps = dc.coordinates.clone().filter(Coordinates::is_valid);
    if result.gps.is_none() {
        result
            .issues
            .push(MetadataIssue::InvalidCoordinates(dc_key));
    }
    result
}

/// Registry regions are free-form. Parse only the documented comma-separated
/// layout and keep unknown fields independent of each other.
pub fn registered_geography(region: &str) -> (Option<&str>, Option<&str>) {
    let mut parts = region.split(',');
    let Some((continent, country)) = parts.next().zip(parts.next()) else {
        return (None, None);
    };
    let (continent, country) = (continent.trim(), country.trim());
    (
        (!continent.is_empty()).then_some(continent),
        (!country.is_empty()).then_some(country),
    )
}

pub(crate) fn summarize(
    baseline: &[Principal],
    members: &[Principal],
    kind: i32,
    metadata: Option<&BTreeMap<Principal, Metadata>>,
) -> MembershipState {
    let original: BTreeSet<_> = baseline.iter().copied().collect();
    let current: BTreeSet<_> = members.iter().copied().collect();
    let mut distributions = metadata
        .into_iter()
        .flat_map(|_| DIMENSIONS)
        .map(|d| (d, BTreeMap::new()))
        .collect::<BTreeMap<_, _>>();
    let mut locations = BTreeMap::new();
    for id in members {
        if let Some(node) = metadata.and_then(|rows| rows.get(id)) {
            for (dimension, key) in &node.groups {
                *distributions
                    .get_mut(dimension)
                    .expect("known dimension")
                    .entry(key.clone())
                    .or_insert(0) += 1;
            }
            if let Some(position) = &node.gps {
                *locations.entry(position.clone()).or_insert(0u64) += 1;
            }
        }
    }
    let member_count = members.len() as u32;
    MembershipState {
        members: members.to_vec(),
        added: current.difference(&original).copied().collect(),
        removed: original.difference(&current).copied().collect(),
        retained: current.intersection(&original).copied().collect(),
        baseline_count: baseline.len() as u32,
        member_count,
        net_change: i64::from(member_count) - baseline.len() as i64,
        distributions: distributions
            .into_iter()
            .map(|(dimension, groups)| {
                (
                    dimension,
                    distribution(groups, member_count, matches!(kind, 1 | 2 | 4)),
                )
            })
            .collect(),
        distances: distances(locations, member_count),
    }
}

fn distribution(groups: BTreeMap<Group, u32>, total: u32, conventional: bool) -> Distribution {
    let mut counts: Vec<_> = groups.values().copied().collect();
    counts.sort_unstable_by(|a, b| b.cmp(a));
    let known = counts.iter().sum::<u32>();
    let threshold = |nodes_required| {
        let mut sum = 0;
        let groups_to_reach = (known == total)
            .then(|| {
                counts.iter().position(|count| {
                    sum += count;
                    sum >= nodes_required
                })
            })
            .flatten()
            .map(|i| i as u32 + 1);
        Threshold {
            nodes_required,
            groups_to_reach,
        }
    };
    Distribution {
        groups,
        unknown: total - known,
        smallest: counts.last().copied(),
        largest: counts.first().copied(),
        mean_ratio: (!counts.is_empty()).then_some((known, counts.len() as u32)),
        greater_than_one_third: (conventional && total > 0).then(|| threshold(total / 3 + 1)),
        fault_budget_plus_one: (conventional && total > 0).then(|| threshold((total - 1) / 3 + 1)),
    }
}

fn distances(locations: BTreeMap<Coordinates, u64>, total: u32) -> Distances {
    let locations: Vec<_> = locations.into_iter().collect();
    let known = locations.iter().map(|(_, count)| count).sum::<u64>();
    let pairs = |count: u64| count * count.saturating_sub(1) / 2;
    let valid_pairs = pairs(known);
    let mut min = u32::MAX;
    let mut max = 0;
    let mut sum = 0u64;
    for (index, (point, count)) in locations.iter().enumerate() {
        if *count > 1 {
            min = 0;
        }
        for (other, other_count) in &locations[index + 1..] {
            let distance = distance_metres(point, other);
            min = min.min(distance);
            max = max.max(distance);
            sum += u64::from(distance) * count * other_count;
        }
    }
    Distances {
        known_nodes: known as u32,
        unknown_nodes: total - known as u32,
        valid_pairs,
        total_pairs: pairs(u64::from(total)),
        minimum_metres: (valid_pairs > 0).then_some(min),
        maximum_metres: (valid_pairs > 0).then_some(max),
        mean_metres: (valid_pairs > 0).then(|| ((sum + valid_pairs / 2) / valid_pairs) as u32),
    }
}

fn distance_metres(a: &Coordinates, b: &Coordinates) -> u32 {
    let radians = |value: i32| (f64::from(value) / 10_000_000.0).to_radians();
    let (lat_a, lat_b) = (radians(a.latitude_e7), radians(b.latitude_e7));
    let dlon = radians(a.longitude_e7) - radians(b.longitude_e7);
    let haversine = ((lat_b - lat_a) * 0.5).sin().powi(2)
        + lat_a.cos() * lat_b.cos() * (dlon * 0.5).sin().powi(2);
    (2.0 * 6_376_500.0 * haversine.clamp(0.0, 1.0).sqrt().asin()).round() as u32
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strict_third_and_fault_budget_thresholds_differ_at_a_multiple_of_three() {
        let groups = [("A", 2), ("B", 2), ("C", 2)]
            .map(|(label, count)| (Group::RegisteredLabel(label.into()), count))
            .into();
        let row = distribution(groups, 6, true);
        assert_eq!(
            row.greater_than_one_third,
            Some(Threshold {
                nodes_required: 3,
                groups_to_reach: Some(2)
            }),
        );
        assert_eq!(
            row.fault_budget_plus_one,
            Some(Threshold {
                nodes_required: 2,
                groups_to_reach: Some(1)
            }),
        );
        let partial = distribution(row.groups, 7, true);
        assert_eq!(partial.unknown, 1);
        assert_eq!(
            partial.greater_than_one_third.unwrap().groups_to_reach,
            None
        );
        let cloud_engine = distribution(partial.groups, 6, false);
        assert!(cloud_engine.greater_than_one_third.is_none());
    }

    #[test]
    fn co_location_contributes_zero_and_unknown_pairs_do_not_enter_the_mean() {
        let points = [
            (Coordinates::from_degrees(0.0, 0.0).unwrap(), 2),
            (Coordinates::from_degrees(0.0, 90.0).unwrap(), 1),
        ]
        .into();
        let row = distances(points, 4);
        assert_eq!(
            (
                row.known_nodes,
                row.unknown_nodes,
                row.valid_pairs,
                row.total_pairs
            ),
            (3, 1, 3, 6)
        );
        assert_eq!(row.minimum_metres, Some(0));
        assert_eq!(row.maximum_metres, Some(10_016_183));
        assert_eq!(row.mean_metres, Some(6_677_455));
        assert!(Coordinates::from_degrees(f64::NAN, 0.0).is_none());
        assert!(Coordinates::from_degrees(0.0, 181.0).is_none());
    }
}
