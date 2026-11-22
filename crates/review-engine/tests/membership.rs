use std::collections::{BTreeMap, BTreeSet};

use candid::Principal;
use nexus_review_engine::{metrics::*, *};

fn id(n: u8) -> Principal {
    Principal::from_slice(&[n, 2])
}
fn stamp(hash: Option<[u8; 32]>) -> RecordStamp {
    RecordStamp {
        mutation_version: 9,
        mutation_time: Some(700),
        page_observation: 7,
        chunk_observations: vec![],
        value_hash: hash,
    }
}
fn present<T>(value: T) -> Record<T> {
    Record::Present {
        value,
        stamp: stamp(Some([7; 32])),
    }
}
fn baseline() -> RegistryBaseline {
    let node = |operator| {
        present(Node {
            operator: Some(id(operator)),
            reward_type: None,
            has_chip_id: false,
        })
    };
    let operator = |provider, dc: &str| {
        present(Operator {
            provider: Some(id(provider)),
            data_center: dc.into(),
        })
    };
    let dc = |owner: &str, region: &str, longitude| {
        present(DataCenter {
            registered_owner: owner.into(),
            registered_region: region.into(),
            coordinates: Coordinates::from_degrees(0.0, longitude),
        })
    };
    RegistryBaseline {
        version: 10,
        complete: true,
        roster: present(vec![id(50), id(51)]),
        subnets: BTreeMap::from([
            (
                id(50),
                present(Subnet {
                    members: vec![id(1), id(2)],
                    kind: 1,
                    sev_enabled: false,
                }),
            ),
            (
                id(51),
                present(Subnet {
                    members: vec![id(4), id(5)],
                    kind: 2,
                    sev_enabled: false,
                }),
            ),
            (id(52), Record::Missing),
        ]),
        nodes: BTreeMap::from([
            (id(1), node(40)),
            (id(2), node(40)),
            (id(3), node(41)),
            (id(4), node(41)),
            (id(5), node(42)),
            (id(6), Record::Missing),
            (id(7), Record::Deleted(stamp(None))),
        ]),
        operators: BTreeMap::from([
            (id(40), operator(20, "Alpha")),
            (id(41), operator(21, "beta")),
            (id(42), Record::Missing),
        ]),
        data_centers: BTreeMap::from([
            (
                "alpha".into(),
                dc("Registered A", "Europe, CHE, Zurich", 0.0),
            ),
            (
                "beta".into(),
                dc("Registered B", "Unrecognized,ZZ,Unknown", 90.0),
            ),
        ]),
        boundaries: (1..=7).map(|n| (id(n), Record::Missing)).collect(),
    }
}

fn proposal(id: u64, action: MembershipAction) -> Capture {
    let function = match action {
        MembershipAction::Add { .. } => 2,
        MembershipAction::Remove { .. } => 13,
        MembershipAction::Change { .. } => 31,
    };
    Capture::Full(Proposal {
        evidence: ProposalEvidence {
            id,
            observation: 33 + id,
            observed_at_nanos: 1_000_000_000_000,
            raw_hash: [1; 32],
            payload_hash: [2; 32],
            decoder: "fixture".into(),
            function,
            lifecycle_status: 1,
            executed_at_seconds: None,
        },
        action,
    })
}

fn add(nodes: &[u8]) -> Capture {
    proposal(
        1,
        MembershipAction::Add {
            subnet: id(50),
            nodes: nodes.iter().copied().map(id).collect(),
        },
    )
}
fn remove(nodes: &[u8]) -> Capture {
    proposal(
        2,
        MembershipAction::Remove {
            nodes: nodes.iter().copied().map(id).collect(),
        },
    )
}
fn change(add: &[u8], remove: &[u8]) -> Capture {
    proposal(
        3,
        MembershipAction::Change {
            subnet: id(50),
            add: add.iter().copied().map(id).collect(),
            remove: remove.iter().copied().map(id).collect(),
        },
    )
}

fn run(baseline: RegistryBaseline, proposals: Vec<Capture>) -> Review {
    analyze(
        &ReviewInput::build(
            baseline,
            proposals,
            ScenarioSelection::All,
            Policy::V1,
            None,
            None,
        )
        .unwrap(),
    )
}

fn scenario(review: &Review, id: ScenarioId) -> &Scenario {
    review.scenarios.iter().find(|row| row.id == id).unwrap()
}

#[test]
fn exact_change_and_registered_topology() {
    let review = run(baseline(), vec![change(&[3], &[2])]);
    let scenario = scenario(&review, ScenarioId::A);
    let view = &scenario.subnets[&id(50)];
    let before = &view.baseline;
    let after = view.after_steps[0].as_ref().unwrap();
    assert_eq!(after.members, [id(3), id(1)]);
    assert_eq!(after.added, [id(3)]);
    assert_eq!(after.removed, [id(2)]);
    assert_eq!(after.retained, [id(1)]);
    assert_eq!(after.net_change, 0);
    assert_eq!(before.distances.minimum_metres, Some(0));
    assert_eq!(after.distances.valid_pairs, 1);
    assert_eq!(after.distances.maximum_metres, Some(10_016_183));
    assert_eq!(
        after.distributions[&Dimension::RegisteredCountry].unknown,
        1
    );
    assert_eq!(
        after.distributions[&Dimension::RegisteredCountry].groups
            [&Group::RegisteredLabel("CH".into())],
        1
    );
    assert_eq!(
        after.distributions[&Dimension::RegisteredCountry]
            .greater_than_one_third
            .as_ref()
            .unwrap()
            .groups_to_reach,
        None
    );
    assert!(
        !review
            .manifest
            .registry
            .contains_key(&RegistryKey::Node(id(5)))
    );
    assert!(
        review
            .manifest
            .registry
            .contains_key(&RegistryKey::Subnet(id(51)))
    );
}

#[test]
fn both_orders_show_independent_and_intermediate_memberships() {
    let review = run(baseline(), vec![add(&[3]), remove(&[2])]);
    for which in [
        ScenarioId::A,
        ScenarioId::B,
        ScenarioId::AThenB,
        ScenarioId::BThenA,
    ] {
        assert!(scenario(&review, which).completed);
    }
    let ab = &scenario(&review, ScenarioId::AThenB).subnets[&id(50)];
    let ba = &scenario(&review, ScenarioId::BThenA).subnets[&id(50)];
    assert_eq!(ab.after_steps[0].as_ref().unwrap().member_count, 3);
    assert_eq!(ba.after_steps[0].as_ref().unwrap().member_count, 1);
    assert_eq!(ab.after_steps[1], ba.after_steps[1]);
    let dist = &ab.after_steps[0].as_ref().unwrap().distributions[&Dimension::Provider];
    assert_eq!(
        dist.greater_than_one_third.as_ref().unwrap().nodes_required,
        2
    );
    assert_eq!(
        dist.fault_budget_plus_one.as_ref().unwrap().nodes_required,
        1
    );
    assert!(
        review
            .findings
            .iter()
            .any(|f| f.code == FindingCode::DifferentIntermediateStates)
    );
}

#[test]
fn membership_rules_preserve_order_and_reject_invalid_steps() {
    for (request, code) in [
        (add(&[2]), FindingCode::DuplicateResultingMembership),
        (add(&[3, 1, 3]), FindingCode::DuplicateResultingMembership),
        (add(&[4]), FindingCode::AssignedElsewhere),
        (add(&[6]), FindingCode::MissingNode),
        (add(&[7]), FindingCode::DeletedNode),
        (change(&[3], &[4]), FindingCode::RemovalOutsideTarget),
        (change(&[1, 2], &[1, 2]), FindingCode::EmptyResultingSubnet),
    ] {
        let report = run(baseline(), vec![request, remove(&[2])]);
        let ab = scenario(&report, ScenarioId::AThenB);
        assert!(!ab.completed);
        assert_eq!(ab.steps[0].outcome, StepOutcome::Rejected);
        assert!(ab.steps[0].findings.iter().any(|f| f.code == code));
        assert!(matches!(
            ab.steps[1].outcome,
            StepOutcome::Skipped { failed_step: 0 }
        ));
        assert!(ab.subnets[&id(50)].after_steps.iter().all(Option::is_none));
    }
    let report = run(baseline(), vec![add(&[1, 1])]);
    assert!(scenario(&report, ScenarioId::A).completed);
    let report = run(baseline(), vec![change(&[2], &[2])]);
    let a = scenario(&report, ScenarioId::A);
    assert_eq!(
        a.subnets[&id(50)].after_steps[0].as_ref().unwrap().members,
        [id(1)]
    );
    assert!(
        a.steps[0]
            .findings
            .iter()
            .any(|f| f.code == FindingCode::OverlappingInstructionsRemovalWins)
    );
}

#[test]
fn removal_spans_subnets_and_keeps_unknown_candidates_visible() {
    let report = run(baseline(), vec![remove(&[2, 4, 6, 7, 7])]);
    let a = scenario(&report, ScenarioId::A);
    assert!(a.completed);
    assert_eq!(
        a.subnets.keys().copied().collect::<Vec<_>>(),
        [id(50), id(51)]
    );
    assert!(
        a.findings
            .iter()
            .any(|f| f.registry.contains(&RegistryKey::Operator(id(42))))
    );
    assert!(
        a.steps[0]
            .findings
            .iter()
            .any(|f| f.code == FindingCode::UnaffectedRemovalCandidate && f.nodes == [id(7)])
    );
    let ScopeState::Resolved(scope) = report.scope(ScenarioId::A, id(51)) else {
        panic!("affected subnet");
    };
    assert!(
        scope.nodes()[&id(7)]
            .roles
            .contains(&NodeRole::MentionedForRemoval)
    );
    assert!(scope.nodes()[&id(4)].roles.contains(&NodeRole::NetRemoved));
    assert!(scope.nodes()[&id(5)].roles.contains(&NodeRole::Retained));
    assert!(!scope.nodes().contains_key(&id(1)));
}

#[test]
fn manifests_validate_dependencies_capture_kind_and_previous_registry_state() {
    let build = |baseline, proposal| {
        ReviewInput::build(
            baseline,
            vec![proposal],
            ScenarioSelection::All,
            Policy::V1,
            None,
            None,
        )
    };
    let mut incomplete = baseline();
    incomplete.complete = false;
    assert_eq!(
        build(incomplete, add(&[3])).unwrap_err(),
        ReviewError::IncompleteBaseline(10)
    );
    assert_eq!(
        build(baseline(), Capture::Missing(1)).unwrap_err(),
        ReviewError::MissingProposal(1)
    );
    assert_eq!(
        build(
            baseline(),
            Capture::Malformed {
                id: 1,
                observation: 3
            }
        )
        .unwrap_err(),
        ReviewError::MalformedPayload {
            id: 1,
            observation: 3
        }
    );
    assert_eq!(
        build(
            baseline(),
            Capture::Unsupported {
                id: 1,
                function: Some(18),
                observation: 3
            }
        )
        .unwrap_err(),
        ReviewError::UnsupportedAction {
            id: 1,
            function: Some(18),
            observation: 3
        }
    );
    let mut unjoined = baseline();
    unjoined.data_centers.remove("beta");
    assert_eq!(
        build(unjoined, add(&[3])).unwrap_err(),
        ReviewError::UnavailableRecord(RegistryKey::DataCenter("beta".into()))
    );
    let mut request = add(&[3]);
    let Capture::Full(executed) = &mut request else {
        unreachable!()
    };
    executed.evidence.lifecycle_status = 4;
    executed.evidence.executed_at_seconds = Some(100);
    let report = run(baseline(), vec![request.clone()]);
    let a = scenario(&report, ScenarioId::A);
    assert!(
        a.steps[0]
            .findings
            .iter()
            .any(|f| f.code == FindingCode::HistoricalBaselineUnavailable)
    );
    let proof = HistoricalHead {
        version: 10,
        observation: 6,
        observed_at_nanos: 98_000_000_000,
        raw_hash: [4; 32],
    };
    let report = analyze(
        &ReviewInput::build(
            baseline(),
            vec![request],
            ScenarioSelection::A,
            Policy::V1,
            Some(proof),
            None,
        )
        .unwrap(),
    );
    assert!(
        scenario(&report, ScenarioId::A).steps[0]
            .findings
            .iter()
            .any(|f| f.code == FindingCode::EarlierBaselineHypothesis)
    );
}

#[test]
fn scopes_only_narrow_and_keep_revision_and_step_identity() {
    // Removal first frees node 4 for addition to the other subnet.
    let report = run(baseline(), vec![add(&[4]), remove(&[4])]);
    let ScopeState::Resolved(ab) = report.scope(ScenarioId::AThenB, id(50)) else {
        panic!("rejected target scope");
    };
    let ScopeState::Resolved(ba) = report.scope(ScenarioId::BThenA, id(50)) else {
        panic!("valid target scope");
    };
    assert_eq!(ba.identity().ordered_proposals, [2, 1]);
    assert_eq!(ab.nodes()[&id(4)].steps[0].after, None);
    assert_eq!(ab.nodes()[&id(4)].steps[1].before, None);
    assert_eq!(ba.nodes()[&id(4)].steps[1].after, Some(true));
    assert_eq!(ab.intersect(&ba), Err(ScopeConflict));
    assert_eq!(compare_scopes(&ab, &ba), (&ab, &ba));
    let role_subset = ba.narrow_roles(&BTreeSet::from([NodeRole::NetAdded]));
    assert_eq!(
        role_subset.nodes().keys().copied().collect::<Vec<_>>(),
        [id(4)]
    );
    let empty = role_subset.narrow_nodes(&BTreeSet::from([id(1), id(6)]));
    assert!(empty.nodes().is_empty());
    assert!(
        empty
            .narrow_roles(&BTreeSet::from([NodeRole::NetAdded]))
            .nodes()
            .is_empty()
    );
    assert_eq!(role_subset.intersect(&ba).unwrap(), role_subset);
    let invalid = report.scope(ScenarioId::A, id(52));
    assert_eq!(
        invalid,
        ScopeState::Unavailable(ScopeUnavailable::SubnetOutsideReview)
    );
    assert_eq!(invalid.narrow_nodes(&BTreeSet::from([id(1)])), invalid);

    let changed = analyze(
        &ReviewInput::build(
            baseline(),
            vec![add(&[4]), remove(&[4])],
            ScenarioSelection::All,
            Policy {
                warn_on_largest_share_increase: false,
                ..Policy::V1
            },
            None,
            Some([11; 32]),
        )
        .unwrap(),
    );
    let ScopeState::Resolved(other) = changed.scope(ScenarioId::BThenA, id(50)) else {
        panic!("changed scope");
    };
    assert_ne!(report.revision, changed.revision);
    assert_eq!(ba.intersect(&other), Err(ScopeConflict));
    assert_eq!(run(baseline(), vec![add(&[4]), remove(&[4])]), report);
}

#[test]
fn boundary_and_hardware_checks_use_registered_state() {
    let mut r = baseline();
    r.boundaries.insert(id(3), present(()));
    for action in [add(&[3]), change(&[3], &[2])] {
        assert_eq!(
            scenario(&run(r.clone(), vec![action]), ScenarioId::A).steps[0].outcome,
            StepOutcome::Rejected
        );
    }
    r.boundaries.insert(id(3), Record::Missing);
    let Record::Present { value, .. } = r.subnets.get_mut(&id(50)).unwrap() else {
        unreachable!()
    };
    value.sev_enabled = true;
    let report = run(r, vec![add(&[3])]);
    assert!(
        scenario(&report, ScenarioId::A).steps[0]
            .findings
            .iter()
            .any(|f| f.code == FindingCode::MissingSevChipIdentity)
    );
}

#[test]
fn membership_set_invariants_for_all_small_valid_changes() {
    for add_mask in 0..8 {
        for remove_mask in 0..4 {
            let add: Vec<_> = (1..=3).filter(|n| add_mask & (1 << (n - 1)) != 0).collect();
            let remove: Vec<_> = (1..=2)
                .filter(|n| remove_mask & (1 << (n - 1)) != 0)
                .collect();
            let report = run(baseline(), vec![change(&add, &remove)]);
            let a = scenario(&report, ScenarioId::A);
            let expected: BTreeSet<_> = [1, 2]
                .into_iter()
                .chain(add)
                .filter(|n| !remove.contains(n))
                .map(id)
                .collect();
            if let StepOutcome::Applied { writes } = &a.steps[0].outcome {
                let members = &writes[&id(50)];
                let actual: BTreeSet<_> = members.iter().copied().collect();
                assert_eq!(actual, expected);
                assert_eq!(actual.len(), members.len());
                assert!(!actual.is_empty());
            } else {
                assert!(a.steps[0].findings.iter().any(|f| matches!(
                    f.code,
                    FindingCode::DuplicateResultingMembership | FindingCode::EmptyResultingSubnet
                )));
            }
        }
    }
}

#[test]
fn blockmaking_contract_preserves_coverage_and_scope() {
    let row = |proposed, failures| Observation::Row(Counters { proposed, failures });
    let mut edge = CounterEdge {
        node: id(1),
        previous_subnet: id(50),
        subnet: id(50),
        previous_timestamp: 1,
        timestamp: 2,
        previous: row(5, 2),
        current: row(5, 2),
        continuity: Continuity::SameEpoch,
    };
    assert_eq!(derive_interval(&edge), Interval::ZeroObservedOpportunities);
    edge.current = row(7, 3);
    assert_eq!(
        derive_interval(&edge),
        Interval::Observed {
            proposed: 2,
            failures: 1
        }
    );
    edge.current = row(1, 1);
    assert_eq!(derive_interval(&edge), Interval::CounterReset);
    edge.current = Observation::SparseOmission;
    assert_eq!(derive_interval(&edge), Interval::SparseOmission);
    edge.current = Observation::MissingSample;
    assert_eq!(derive_interval(&edge), Interval::MissingSample);
    edge.continuity = Continuity::Reappearance;
    assert_eq!(derive_interval(&edge), Interval::Reappearance);
    edge.previous_subnet = id(51);
    assert_eq!(derive_interval(&edge), Interval::SubnetTransition);
    let report = run(baseline(), vec![add(&[3])]);
    let scope = report.scope(ScenarioId::A, id(50));
    assert_eq!(
        scoped_interval(&scope, &edge),
        Ok(Interval::SubnetTransition)
    );
    assert_eq!(
        scoped_interval(&scope.narrow_nodes(&BTreeSet::new()), &edge),
        Err(MetricsUnavailable::OutOfScopeNode)
    );
    assert_eq!(
        scoped_interval(&report.scope(ScenarioId::A, id(52)), &edge),
        Err(MetricsUnavailable::ScopeUnavailable)
    );
}

#[test]
fn invalid_target_and_missing_dc_do_not_create_fallbacks() {
    let invalid = proposal(
        3,
        MembershipAction::Add {
            subnet: id(52),
            nodes: vec![id(3)],
        },
    );
    let report = run(baseline(), vec![invalid]);
    assert!(
        scenario(&report, ScenarioId::A).steps[0]
            .findings
            .iter()
            .any(|finding| finding.code == FindingCode::InvalidTarget)
    );
    assert_eq!(
        report.scope(ScenarioId::A, id(52)),
        ScopeState::Unavailable(ScopeUnavailable::SubnetOutsideReview)
    );

    let mut absent = baseline();
    absent.data_centers.insert("beta".into(), Record::Missing);
    let report = run(absent, vec![add(&[3])]);
    let a = scenario(&report, ScenarioId::A);
    let after = a.subnets[&id(50)].after_steps[0].as_ref().unwrap();
    assert_eq!(after.distributions[&Dimension::DataCenter].unknown, 0);
    assert_eq!(after.distributions[&Dimension::RegisteredOwner].unknown, 1);
    assert_eq!(after.distances.unknown_nodes, 1);
    assert!(
        a.findings
            .iter()
            .any(|finding| finding.registry == [RegistryKey::DataCenter("beta".into())])
    );
    assert_eq!(
        candid::decode_one::<Review>(&candid::encode_one(&report).unwrap()).unwrap(),
        report
    );
}

#[test]
fn evidence_policy_and_order_change_revision_independently() {
    let one = add(&[3]);
    let two = remove(&[2]);
    let build = |records, selected, policy, metrics| {
        ReviewInput::build(
            records,
            selected,
            ScenarioSelection::All,
            policy,
            None,
            metrics,
        )
        .unwrap()
    };
    let selected = vec![one.clone(), two.clone()];
    let original = build(baseline(), selected.clone(), Policy::V1, None);
    let mut updated = baseline();
    let Record::Present { stamp, .. } = updated.nodes.get_mut(&id(3)).unwrap() else {
        unreachable!()
    };
    stamp.page_observation += 1;
    for other in [
        build(updated, selected.clone(), Policy::V1, None),
        build(
            baseline(),
            selected.clone(),
            Policy {
                concentration_rule: ConcentrationRule::FaultBudgetPlusOne,
                ..Policy::V1
            },
            None,
        ),
        build(baseline(), selected, Policy::V1, Some([91; 32])),
        build(baseline(), vec![two, one], Policy::V1, None),
    ] {
        assert_ne!(other.manifest().revision(), original.manifest().revision());
    }
}
