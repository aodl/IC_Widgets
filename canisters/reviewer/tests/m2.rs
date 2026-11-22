mod support;

use candid::{Principal, decode_one, encode_args, encode_one};
use nexus_domain::Hash;
use nexus_review_engine::{NodeRole, Review, ScenarioId, ScenarioSelection};
use nexus_reviewer::{
    COLLECTION_LIMITS, CompletedReview, Limits, PerformancePage, PerformanceRequest, ReplyPage,
    ReviewJob, ReviewJobState, ReviewRequest, ScopeCursor, ScopePage, ScopeRequest,
    SelectedProposal, Sources,
};
use pocket_ic::PocketIcBuilder;
use support::{advance, call, enabled, wasm};

fn principal(kind: u8, index: u16) -> Principal {
    let mut bytes = [kind; 29];
    bytes[..2].copy_from_slice(&index.to_be_bytes());
    bytes[28] = 2;
    Principal::from_slice(&bytes)
}

#[test]
#[ignore = "run through scripts/test-m0.sh to build Wasm and start PocketIC"]
fn review_waits_resolves_and_serves_immutable_scopes_across_upgrade() {
    assert!(enabled());
    let pic = PocketIcBuilder::new()
        .with_nns_subnet()
        .with_application_subnet()
        .build();
    let topology = pic.topology();
    let fixture = pic.create_canister_on_subnet(None, None, topology.get_nns().unwrap());
    let reviewer = pic.create_canister_on_subnet(None, None, topology.get_app_subnets()[0]);
    let source = wasm("target/wasm32-unknown-unknown/release/nexus_source_fixture.wasm");
    let binary = wasm(".local/reviewer-fixture.wasm");
    pic.install_canister(fixture, source, encode_args(()).unwrap(), None);
    pic.install_canister(
        reviewer,
        binary.clone(),
        encode_one(Some(Sources {
            registry: fixture,
            governance: fixture,
        }))
        .unwrap(),
        None,
    );
    call::<()>(&pic, fixture, "set_registry_mode", encode_one(6u8).unwrap());
    call::<()>(
        &pic,
        fixture,
        "enable_proposal_fixture",
        encode_args(()).unwrap(),
    );
    let request = ReviewRequest {
        registry_version: 5,
        proposals: [93, 92]
            .into_iter()
            .map(|id| SelectedProposal {
                id,
                observation: None,
            })
            .collect(),
        scenario: ScenarioSelection::All,
        request_missing: true,
        hypothetical_executed: None,
    };
    let submit = |request: &ReviewRequest| {
        call::<Result<Hash, String>>(
            &pic,
            reviewer,
            "request_membership_review",
            encode_one(request).unwrap(),
        )
        .unwrap()
    };
    let key = submit(&request);
    assert_eq!(submit(&request), key);
    let progress = || {
        call::<Result<ReviewJob, String>>(
            &pic,
            reviewer,
            "advance_membership_review",
            encode_one(key).unwrap(),
        )
        .unwrap()
    };
    assert!(matches!(progress().state,
        ReviewJobState::Waiting { proposals, registry: true } if proposals == [93, 92]));
    pic.upgrade_canister(reviewer, binary.clone(), encode_args(()).unwrap(), None)
        .unwrap();
    assert!(matches!(
        progress().state,
        ReviewJobState::Waiting { registry: true, .. }
    ));
    let collect = |limits: Option<Limits>| {
        call::<Result<(), String>>(
            &pic,
            reviewer,
            "configure_collection",
            encode_one(limits).unwrap(),
        )
        .unwrap()
    };
    let removal_key = submit(&ReviewRequest {
        proposals: vec![SelectedProposal {
            id: 91,
            observation: None,
        }],
        ..request.clone()
    });
    let removal_progress = || {
        call::<Result<ReviewJob, String>>(
            &pic,
            reviewer,
            "advance_membership_review",
            encode_one(removal_key).unwrap(),
        )
        .unwrap()
    };
    assert!(matches!(
        removal_progress().state,
        ReviewJobState::Waiting { .. }
    ));
    collect(Some(COLLECTION_LIMITS));

    let before = pic.cycle_balance(reviewer);
    let revision = (0..100)
        .find_map(|_| {
            advance(&pic);
            match progress().state {
                ReviewJobState::Complete(revision) => Some(revision),
                ReviewJobState::Blocked(_) => panic!("fixture review blocked"),
                _ => None,
            }
        })
        .expect("archived evidence became available");
    let removal_revision = (0..50)
        .find_map(|_| {
            advance(&pic);
            match removal_progress().state {
                ReviewJobState::Complete(revision) => Some(revision),
                ReviewJobState::Blocked(_) => panic!("multi-subnet removal blocked"),
                _ => None,
            }
        })
        .expect("multi-subnet removal completed");
    collect(None);
    let mut contents = vec![];
    let mut offset = 0u32;
    loop {
        let page = call::<Result<ReplyPage, String>>(
            &pic,
            reviewer,
            "membership_review_page",
            encode_args((revision, offset)).unwrap(),
        )
        .unwrap();
        contents.extend(page.bytes);
        if let Some(next) = page.next_offset {
            offset = next;
        } else {
            break;
        }
    }
    let report: Review = decode_one(&contents).unwrap();
    assert_eq!(report.revision, revision);
    assert_eq!(report.manifest.registry_version, 5);
    assert_eq!(
        report
            .manifest
            .proposals
            .iter()
            .map(|p| p.id)
            .collect::<Vec<_>>(),
        [93, 92]
    );
    assert_eq!(report.scenarios.len(), 4);
    assert!(report.scenarios.iter().all(|scenario| scenario.completed));

    pic.upgrade_canister(reviewer, binary, encode_args(()).unwrap(), None)
        .unwrap();
    assert!(matches!(progress().state, ReviewJobState::Complete(saved) if saved == revision));
    let subnet = principal(22, 0);
    let scoped = |roles, nodes, cursor| {
        call::<Result<ScopePage, String>>(
            &pic,
            reviewer,
            "membership_review_scope",
            encode_one(ScopeRequest {
                revision,
                subnet,
                scenario: ScenarioId::AThenB,
                roles,
                nodes,
                cursor,
            })
            .unwrap(),
        )
    };
    let ScopePage::Nodes {
        identity,
        rows,
        selection,
        next,
    } = scoped(None, None, None).unwrap()
    else {
        panic!("expected an archived subnet scope");
    };
    assert_eq!(identity.review_revision, revision);
    assert_eq!(identity.ordered_proposals, [93, 92]);
    assert_eq!(rows.len(), 64);
    assert!(next.is_some());
    let candidate = principal(21, 1201);
    let ScopePage::Nodes { rows, .. } = scoped(Some(vec![NodeRole::NetAdded]), None, None).unwrap()
    else {
        panic!("expected the added node");
    };
    assert_eq!(rows[0].0, candidate);
    assert_eq!(rows.len(), 1);
    assert!(
        scoped(
            Some(vec![NodeRole::NetAdded]),
            None,
            Some(ScopeCursor {
                selection,
                after: candidate
            })
        )
        .is_err()
    );
    let ScopePage::Nodes { rows, .. } = scoped(None, Some(vec![]), None).unwrap() else {
        panic!("expected an empty resolved scope");
    };
    assert!(rows.is_empty());
    let outsider = Principal::from_slice(&[77, 2]);
    let public = |method, args| pic.update_call(reviewer, outsider, method, args).unwrap();
    let before_reads = pic.cycle_balance(reviewer);
    let listed: Vec<CompletedReview> =
        decode_one(&public("list_completed_reviews", encode_args(()).unwrap())).unwrap();
    assert_eq!(listed.len(), 2);
    assert!(listed.iter().any(|row| row.proposals == [93, 92]));
    assert!(listed.iter().any(|row| row.proposals == [91]));
    let fetched: Result<Review, String> = decode_one(&public(
        "read_membership_review",
        encode_one(revision).unwrap(),
    ))
    .unwrap();
    assert_eq!(fetched.unwrap(), report);
    let performance = |revision, subnet, scenario, nodes, cursor, timestamp| {
        decode_one::<Result<PerformancePage, String>>(&public(
            "read_membership_performance",
            encode_one(PerformanceRequest {
                scope: ScopeRequest {
                    revision,
                    subnet,
                    scenario,
                    roles: None,
                    nodes,
                    cursor,
                },
                timestamp,
            })
            .unwrap(),
        ))
        .unwrap()
    };
    let perf = performance(revision, subnet, ScenarioId::AThenB, None, None, None).unwrap();
    let read_cycles = before_reads - pic.cycle_balance(reviewer);
    assert!(perf.sample.is_none());
    assert!(perf.rows.is_empty());
    let ScopePage::Nodes {
        rows,
        selection,
        next,
        ..
    } = perf.scope
    else {
        panic!("available scope")
    };
    assert_eq!(rows.len(), 64);
    let cursor = || {
        Some(ScopeCursor {
            selection,
            after: next.unwrap(),
        })
    };
    let page = performance(revision, subnet, ScenarioId::AThenB, None, cursor(), None).unwrap();
    assert!(page.sample.is_none());
    assert!(
        matches!(page.scope, ScopePage::Nodes { rows: rest, next: None, .. }
        if rest.len() == 7 && rest.iter().all(|(node, _)| !rows.iter().any(|(first, _)| first == node)))
    );
    assert!(
        performance(
            revision,
            subnet,
            ScenarioId::AThenB,
            None,
            cursor(),
            Some(1)
        )
        .is_err()
    );
    assert!(performance(revision, subnet, ScenarioId::BThenA, None, cursor(), None).is_err());
    let empty = performance(
        revision,
        subnet,
        ScenarioId::AThenB,
        Some(vec![]),
        None,
        None,
    )
    .unwrap();
    assert!(matches!(empty.scope, ScopePage::Nodes { rows, .. } if rows.is_empty()));
    assert!(empty.sample.is_none());

    let other = principal(22, 1);
    for (target, member, outsider) in [
        (subnet, principal(21, 1), principal(21, 80)),
        (other, principal(21, 80), principal(21, 1)),
    ] {
        let perf = performance(removal_revision, target, ScenarioId::A, None, None, None).unwrap();
        assert!(matches!(perf.scope, ScopePage::Nodes { identity, rows, .. }
            if identity.target_subnet == target && rows.iter().any(|(node, _)| *node == member)
                && rows.iter().all(|(node, _)| *node != outsider)));
    }
    let missing = performance(
        removal_revision,
        principal(22, 2),
        ScenarioId::A,
        None,
        None,
        None,
    )
    .unwrap();
    assert!(matches!(missing.scope, ScopePage::Unavailable(_)));
    assert!(missing.sample.is_none());
    let denied: Result<Hash, String> = decode_one(&public(
        "request_membership_review",
        encode_one(&request).unwrap(),
    ))
    .unwrap();
    assert!(matches!(denied, Err(error) if error.contains("controller")));
    let denied: Result<ReviewJob, String> = decode_one(&public(
        "advance_membership_review",
        encode_one(key).unwrap(),
    ))
    .unwrap();
    assert!(matches!(denied, Err(error) if error.contains("controller")));
    println!(
        "public catalogue, typed report and empty scoped archive read: {read_cycles} PocketIC cycles"
    );
    println!(
        "membership fixture: {} report bytes, {} cycles including fixture ingestion, review and upgrade",
        contents.len(),
        before - pic.cycle_balance(reviewer)
    );
}
