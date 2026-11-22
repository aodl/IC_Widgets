mod support;

use candid::{Principal, encode_args, encode_one};
use nexus_domain::{Hash, sha256};
use nexus_review_engine::{Review, ScenarioSelection};
use nexus_reviewer::{
    COLLECTION_LIMITS, Limits, ProposalCapture, RecordAt, RecordKey, RegistryStatus, ReplyPage,
    ReviewJob, ReviewJobState, ReviewRequest, SelectedProposal, Sources,
};
use pocket_ic::{PocketIc, PocketIcBuilder};
use support::{advance, call, wasm};

#[test]
#[ignore = "requires the original M1 and M2 fixture Wasms as described in the operations runbook"]
fn upgrade_m1_evidence_and_m2_reviews_to_widget() {
    assert!(support::enabled());
    let pic = PocketIcBuilder::new()
        .with_nns_subnet()
        .with_application_subnet()
        .build();
    let topology = pic.topology();
    let source = pic.create_canister_on_subnet(None, None, topology.get_nns().unwrap());
    let reviewer = pic.create_canister_on_subnet(None, None, topology.get_app_subnets()[0]);
    pic.install_canister(
        source,
        wasm("target/wasm32-unknown-unknown/release/nexus_source_fixture.wasm"),
        encode_args(()).unwrap(),
        None,
    );
    call::<()>(&pic, source, "set_registry_mode", encode_one(1u8).unwrap());
    call::<()>(
        &pic,
        source,
        "enable_proposal_fixture",
        encode_args(()).unwrap(),
    );
    pic.install_canister(
        reviewer,
        wasm(".local/upgrade-m1/reviewer.wasm"),
        encode_one(Some(Sources {
            registry: source,
            governance: source,
        }))
        .unwrap(),
        None,
    );
    call::<Result<(), String>>(
        &pic,
        reviewer,
        "capture_proposal",
        encode_one(93u64).unwrap(),
    )
    .unwrap();
    call::<Result<(), String>>(
        &pic,
        reviewer,
        "configure_collection",
        encode_one(Some(COLLECTION_LIMITS)).unwrap(),
    )
    .unwrap();
    let proposal_args = encode_args((93u64, None::<u64>)).unwrap();
    let captured = (0..120)
        .find_map(|_| {
            advance(&pic);
            let registry = call::<Result<RegistryStatus, String>>(
                &pic,
                reviewer,
                "registry_status",
                encode_args(()).unwrap(),
            )
            .unwrap();
            if registry.published != Some(5) {
                return None;
            }
            call::<Result<ProposalCapture, String>>(
                &pic,
                reviewer,
                "proposal_archive",
                proposal_args.clone(),
            )
            .ok()
        })
        .expect("M1 archived Registry and proposal evidence");
    call::<Result<(), String>>(
        &pic,
        reviewer,
        "configure_collection",
        encode_one::<Option<Limits>>(None).unwrap(),
    )
    .unwrap();

    let stored_proposal = replica_reply(&pic, reviewer, "proposal_archive", proposal_args.clone());
    let key = encode_args((2u64, RecordKey::SubnetList)).unwrap();
    let stored_registry =
        call::<Result<RecordAt, String>>(&pic, reviewer, "registry_record", key.clone());
    assert!(matches!(&stored_registry, Ok(RecordAt::Present { .. })));
    let stored_registry = encode_one(stored_registry).unwrap();
    let raw_args = encode_args((captured.raw_hash, 0u32)).unwrap();
    let stored_source =
        call::<Result<ReplyPage, String>>(&pic, reviewer, "evidence_bytes", raw_args.clone())
            .unwrap();
    assert_eq!(sha256(&stored_source.bytes), captured.raw_hash);
    assert_eq!(stored_source.next_offset, None);

    pic.upgrade_canister(
        reviewer,
        wasm(".local/upgrade-m2/reviewer.wasm"),
        encode_args(()).unwrap(),
        None,
    )
    .unwrap();
    assert_eq!(
        replica_reply(&pic, reviewer, "proposal_archive", proposal_args.clone()),
        stored_proposal
    );
    assert_eq!(
        encode_one(call::<Result<RecordAt, String>>(
            &pic,
            reviewer,
            "registry_record",
            key.clone(),
        ))
        .unwrap(),
        stored_registry
    );
    let request = ReviewRequest {
        proposals: vec![SelectedProposal {
            id: 93,
            observation: Some(captured.observation),
        }],
        registry_version: 5,
        scenario: ScenarioSelection::A,
        request_missing: false,
        hypothetical_executed: None,
    };
    let job = call::<Result<Hash, String>>(
        &pic,
        reviewer,
        "request_membership_review",
        encode_one(request).unwrap(),
    )
    .unwrap();
    let completed = call::<Result<ReviewJob, String>>(
        &pic,
        reviewer,
        "advance_membership_review",
        encode_one(job).unwrap(),
    )
    .unwrap();
    let ReviewJobState::Complete(revision) = completed.state else {
        panic!("M2 completed immutable review")
    };
    let report_args = encode_args((revision, 0u32)).unwrap();
    let exported = call::<Result<ReplyPage, String>>(
        &pic,
        reviewer,
        "membership_review_page",
        report_args.clone(),
    )
    .unwrap();
    assert_eq!(exported.next_offset, None);

    pic.upgrade_canister(
        reviewer,
        wasm(".local/reviewer-fixture.wasm"),
        encode_args(()).unwrap(),
        None,
    )
    .unwrap();
    assert_eq!(
        replica_reply(&pic, reviewer, "proposal_archive", proposal_args),
        stored_proposal
    );
    assert_eq!(
        encode_one(call::<Result<RecordAt, String>>(
            &pic,
            reviewer,
            "registry_record",
            key,
        ))
        .unwrap(),
        stored_registry
    );
    let raw =
        call::<Result<ReplyPage, String>>(&pic, reviewer, "evidence_bytes", raw_args).unwrap();
    assert_eq!(raw.bytes, stored_source.bytes);
    let page =
        call::<Result<ReplyPage, String>>(&pic, reviewer, "membership_review_page", report_args)
            .unwrap();
    assert_eq!(page.bytes, exported.bytes);
    let public = pic
        .update_call(
            reviewer,
            Principal::from_slice(&[77, 2]),
            "read_membership_review",
            encode_one(revision).unwrap(),
        )
        .unwrap();
    let report = candid::decode_one::<Result<Review, String>>(&public)
        .unwrap()
        .unwrap();
    assert_eq!(
        report,
        candid::decode_one::<Review>(&exported.bytes).unwrap()
    );
    assert_eq!(report.manifest.registry_version, 5);
}

fn replica_reply(pic: &PocketIc, reviewer: Principal, method: &str, args: Vec<u8>) -> Vec<u8> {
    pic.update_call(reviewer, Principal::anonymous(), method, args)
        .unwrap()
}
