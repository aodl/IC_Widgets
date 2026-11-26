//! Narrow interpretation of a consolidated NNS Target Topology motion.
use candid::CandidType;
use serde::Deserialize;

use crate::{Dimension, Distribution, MembershipComparison};

const TABLE: [&str; 7] = [
    "Subnet Type",
    "# Subnets",
    "# Nodes in subnet",
    "Total",
    "SEV",
    "Subnet limit NP, DC, DC Provider",
    "Subnet limit country",
];

#[derive(Clone, Debug, CandidType, Deserialize, PartialEq, Eq)]
pub struct NnsTarget {
    pub size: u32,
    pub country_cap: u32,
    pub group_cap: u32,
    pub exception: Option<String>,
    pub sev_designated: bool,
    pub clause: String,
}

fn cells(line: &str) -> Option<Vec<&str>> {
    Some(
        line.trim()
            .strip_prefix('|')?
            .strip_suffix('|')?
            .split('|')
            .map(str::trim)
            .collect(),
    )
}

fn count(cell: &str) -> Option<u32> {
    if cell.is_empty() || !cell.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    cell.parse().ok().filter(|&n| n > 0)
}

pub fn parse_nns_target(motion: &str, summary: &str) -> Option<NnsTarget> {
    // The supported motion explicitly adopts the consolidated table in the
    // summary, including its overall totals. An unrelated summary is not a rule.
    let totals = motion.trim()
        .strip_prefix("This motion proposes to replace the current subnet target topology with the revised and consolidated target topology set out in the summary, comprising ")?
        .strip_suffix(" nodes.")?
        .split_once(" subnets and ")?;
    let expected_totals = (count(totals.0)?, count(totals.1)?);
    let mut lines = summary.lines();
    lines.find(|line| cells(line).is_some_and(|row| row == TABLE))?;
    let delimiter = cells(lines.next()?)?;
    if delimiter.len() != TABLE.len()
        || delimiter
            .iter()
            .any(|cell| cell.len() < 3 || !cell.bytes().all(|byte| byte == b'-'))
    {
        return None;
    }

    let mut target = None;
    let mut declared_totals = None;
    let mut sum = (0u32, 0u32);
    let mut roles = std::collections::BTreeSet::new();
    for line in lines.by_ref() {
        if !line.trim().starts_with('|') {
            break;
        }
        let row = cells(line)?;
        let [role, subnets, size, total, sev, group, country] = row.as_slice() else {
            return None;
        };
        if *role == "**Total**" {
            if declared_totals.is_some()
                || [size, sev, group, country]
                    .iter()
                    .any(|cell| !cell.is_empty())
            {
                return None;
            }
            declared_totals = Some((
                count(subnets.strip_prefix("**")?.strip_suffix("**")?)?,
                count(total.strip_prefix("**")?.strip_suffix("**")?)?,
            ));
            continue;
        }
        if declared_totals.is_some() || !roles.insert(role.to_ascii_lowercase()) {
            return None;
        }
        let (subnets, size, total) = (count(subnets)?, count(size)?, count(total)?);
        if subnets.checked_mul(size)? != total {
            return None;
        }
        sum = (sum.0.checked_add(subnets)?, sum.1.checked_add(total)?);
        if *role != "NNS" {
            continue;
        }
        if subnets != 1 {
            return None;
        }
        let (group, exception) = match group.strip_suffix(" (with exception for DFINITY nodes)") {
            Some(plain) => (plain, Some("Exception for DFINITY nodes. The motion does not define qualifying nodes or their limits.".to_owned())),
            None => (*group, None),
        };
        target = Some(NnsTarget {
            size,
            country_cap: count(country)?,
            group_cap: count(group)?,
            exception,
            sev_designated: match *sev {
                "yes" => true,
                "no" => false,
                _ => return None,
            },
            clause: line.trim().into(),
        });
    }
    if declared_totals != Some(expected_totals)
        || sum != expected_totals
        || lines.any(|line| cells(line).is_some_and(|row| row == TABLE))
    {
        return None;
    }
    target
}

#[derive(Clone, Copy, Debug, CandidType, Deserialize, PartialEq, Eq)]
pub enum TargetMetric {
    Size,
    Provider,
    DataCenter,
    RegisteredOwner,
    RegisteredCountry,
}

#[derive(Clone, Copy, Debug, CandidType, Deserialize, PartialEq, Eq)]
pub enum Assessment {
    MatchesTarget,
    DiffersFromTarget,
    WithinLimit,
    AtLimit,
    ExceedsLimit,
    ExceptionUnresolved,
    IdentityUnresolved,
    DataIncomplete,
}

#[derive(Clone, Copy, Debug, CandidType, Deserialize, PartialEq, Eq)]
pub enum BreachChange {
    New,
    Worsened,
    Unchanged,
    Improved,
    Resolved,
}

#[derive(Clone, Debug, CandidType, Deserialize)]
pub struct TargetRow {
    pub metric: TargetMetric,
    pub limit: u32,
    /// Largest known recorded group. Scope and missing records bound this
    /// quantity, while canonical identity may have additional ambiguity.
    pub before: Option<u32>,
    pub after: Option<u32>,
    pub unknown_before: u32,
    pub unknown_after: u32,
    pub before_assessment: Assessment,
    pub assessment: Assessment,
    pub breach: Option<BreachChange>,
}

pub fn assess_target(target: &NnsTarget, comparison: &MembershipComparison) -> Vec<TargetRow> {
    use Assessment::*;
    use TargetMetric::*;
    let before = &comparison.baseline;
    let after = &comparison.selected;
    let exact = |n| {
        if n == target.size {
            MatchesTarget
        } else {
            DiffersFromTarget
        }
    };
    let mut rows = vec![TargetRow {
        metric: Size,
        limit: target.size,
        before: Some(before.member_count),
        after: Some(after.member_count),
        unknown_before: 0,
        unknown_after: 0,
        before_assessment: exact(before.member_count),
        assessment: exact(after.member_count),
        breach: None,
    }];
    for (metric, dimension, limit) in [
        (Provider, Dimension::Provider, target.group_cap),
        (DataCenter, Dimension::DataCenter, target.group_cap),
        (
            RegisteredOwner,
            Dimension::RegisteredOwner,
            target.group_cap,
        ),
        (
            RegisteredCountry,
            Dimension::RegisteredCountry,
            target.country_cap,
        ),
    ] {
        let a = &before.distributions[&dimension];
        let b = &after.distributions[&dimension];
        let assess = |row: &Distribution| {
            if matches!(metric, RegisteredCountry | RegisteredOwner) {
                return IdentityUnresolved;
            }
            // Without membership evidence for the exception class, even a
            // large registered group may be permitted under the cited clause.
            if target.exception.is_some() {
                return ExceptionUnresolved;
            }
            assess_cap(row.largest, row.unknown, limit)
        };
        let (prior, next) = (assess(a), assess(b));
        let breach = match (prior, next) {
            (ExceedsLimit, ExceedsLimit) if a.unknown == 0 && b.unknown == 0 => {
                match b.largest.cmp(&a.largest) {
                    std::cmp::Ordering::Greater => Some(BreachChange::Worsened),
                    std::cmp::Ordering::Equal => Some(BreachChange::Unchanged),
                    std::cmp::Ordering::Less => Some(BreachChange::Improved),
                }
            }
            (ExceedsLimit, AtLimit | WithinLimit) => Some(BreachChange::Resolved),
            (AtLimit | WithinLimit, ExceedsLimit) => Some(BreachChange::New),
            _ => None,
        };
        rows.push(TargetRow {
            metric,
            limit,
            before: a.largest,
            after: b.largest,
            unknown_before: a.unknown,
            unknown_after: b.unknown,
            before_assessment: prior,
            assessment: next,
            breach,
        });
    }
    rows
}

fn assess_cap(known: Option<u32>, unknown: u32, cap: u32) -> Assessment {
    use Assessment::*;
    let lower = known.unwrap_or(0);
    let upper = lower + unknown;
    if lower > cap {
        ExceedsLimit
    } else if lower == cap && upper == cap {
        AtLimit
    } else if upper <= cap {
        WithinLimit
    } else {
        DataIncomplete
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    const SUMMARY: &str = "| Subnet Type | # Subnets | # Nodes in subnet | Total | SEV | Subnet limit NP, DC, DC Provider | Subnet limit country |
| --- | --- | --- | --- | --- | --- | --- |
| NNS | 1 | 40 | 40 | no | 1 (with exception for DFINITY nodes) | 3 |
| **Total** | **1** | | **40** | | | |";
    const MOTION: &str = "This motion proposes to replace the current subnet target topology with the revised and consolidated target topology set out in the summary, comprising 1 subnets and 40 nodes.";

    #[test]
    fn numbers_come_from_the_adopted_table_and_qualifiers_are_validated() {
        let rule = parse_nns_target(MOTION, SUMMARY).unwrap();
        assert_eq!((rule.size, rule.country_cap, rule.group_cap), (40, 3, 1));
        assert!(rule.exception.is_some());
        assert_eq!(
            parse_nns_target(MOTION, &SUMMARY.replace("| 3 |", "| 8 |"))
                .unwrap()
                .country_cap,
            8
        );
        assert!(
            parse_nns_target(MOTION, &SUMMARY.replace("DFINITY nodes", "other nodes")).is_none()
        );
        assert!(parse_nns_target(MOTION, &SUMMARY.replace("| 3 |", "| 2–3 |")).is_none());
        assert!(parse_nns_target("", SUMMARY).is_none());
        assert!(parse_nns_target(MOTION, &format!("{SUMMARY}\n\n{SUMMARY}")).is_none());
    }

    #[test]
    fn partial_bounds_require_an_upper_bound_for_compliance() {
        assert_eq!(assess_cap(Some(4), 10, 3), Assessment::ExceedsLimit);
        assert_eq!(assess_cap(Some(2), 2, 3), Assessment::DataIncomplete);
        assert_eq!(assess_cap(None, 4, 3), Assessment::DataIncomplete);
        assert_eq!(assess_cap(Some(1), 1, 3), Assessment::WithinLimit);
        assert_eq!(assess_cap(Some(3), 1, 3), Assessment::DataIncomplete);
    }
}
