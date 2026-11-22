mod support;

use candid::{Principal, decode_one, encode_args, encode_one};
use nexus_domain::Hash;
use nexus_review_engine::{NodeRole, Review, ScenarioId, ScenarioSelection};
use nexus_reviewer::{
    COLLECTION_LIMITS, Limits, ReplyPage, ReviewJob, ReviewJobState, ReviewRequest, ScopeCursor,
    ScopePage, ScopeRequest, SelectedProposal, Sources,
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
    call::<()>(&pic, fixture, "set_registry_mode", encode_one(1u8).unwrap());
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
    assert_eq!(rows.len(), 51);
    assert!(next.is_none());
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
    println!(
        "membership fixture: {} report bytes, {} cycles including fixture ingestion, review and upgrade",
        contents.len(),
        before - pic.cycle_balance(reviewer)
    );
}
