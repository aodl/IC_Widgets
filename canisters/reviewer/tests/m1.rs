mod support;

use candid::{Principal, encode_args, encode_one};
use nexus_ic_sources::projection::{Details, RecordKey};
use nexus_reviewer::{
    Assignment, COLLECTION_LIMITS, CollectionStatus, EvidenceManifest, Limits, RecordAt,
    RegistryStatus, SourceObservation, SourceStatus, Sources, Stop,
};
use pocket_ic::{PocketIc, PocketIcBuilder};
use support::{advance, call, enabled, wasm};

fn collection(pic: &PocketIc, reviewer: Principal) -> CollectionStatus {
    call::<Result<CollectionStatus, String>>(
        pic,
        reviewer,
        "collection_status",
        encode_args(()).unwrap(),
    )
    .unwrap()
}

fn registry(pic: &PocketIc, reviewer: Principal) -> RegistryStatus {
    call::<Result<RegistryStatus, String>>(
        pic,
        reviewer,
        "registry_status",
        encode_args(()).unwrap(),
    )
    .unwrap()
}

fn configure(pic: &PocketIc, reviewer: Principal, limits: Option<Limits>) {
    call::<Result<(), String>>(
        pic,
        reviewer,
        "configure_collection",
        encode_one(limits).unwrap(),
    )
    .unwrap();
}

fn projected_node(index: u16) -> Principal {
    let mut bytes = [21; 29];
    bytes[..2].copy_from_slice(&index.to_be_bytes());
    bytes[28] = 2;
    Principal::from_slice(&bytes)
}

fn until_registry(
    pic: &PocketIc,
    reviewer: Principal,
    predicate: impl Fn(&RegistryStatus) -> bool,
) -> RegistryStatus {
    for _ in 0..180 {
        advance(pic);
        let status = registry(pic, reviewer);
        if predicate(&status) {
            return status;
        }
    }
    let last = registry(pic, reviewer);
    panic!(
        "Registry did not reach expected state: head {:?}, target {:?}, published {:?}, staged {:?}, blocked {:?}",
        last.observed_head,
        last.bootstrap_target,
        last.published,
        last.staging.map(|row| row.applied),
        last.blocked
    );
}

#[test]
#[ignore = "run through scripts/test-m0.sh to build Wasm and start PocketIC"]
fn fixed_registry_target_and_atomic_history_survive_upgrade() {
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
    let mode = |value| {
        call::<()>(
            &pic,
            fixture,
            "set_registry_mode",
            encode_one::<u8>(value).unwrap(),
        )
    };
    mode(2);
    configure(
        &pic,
        reviewer,
        Some(Limits {
            calls: 1,
            ..COLLECTION_LIMITS
        }),
    );
    until_registry(&pic, reviewer, |s| s.bootstrap_target == Some(3));
    for _ in 0..4 {
        advance(&pic);
    }
    assert_eq!(
        collection(&pic, reviewer).usage.unwrap().stop,
        Some(Stop::CallLimit)
    );
    assert_eq!(registry(&pic, reviewer).published, None);
    configure(&pic, reviewer, None);
    let before_cycles = pic.cycle_balance(reviewer);
    configure(&pic, reviewer, Some(COLLECTION_LIMITS));
    let staged = until_registry(&pic, reviewer, |s| s.blocked.is_some());
    assert_eq!(staged.bootstrap_target, Some(3));
    assert_eq!(staged.observed_head, Some(5));
    assert_eq!(staged.published, None);
    assert!(
        staged
            .staging
            .as_ref()
            .is_some_and(|stage| stage.applied > 0)
    );
    let bad = call::<Result<SourceObservation, String>>(
        &pic,
        reviewer,
        "source_observation",
        encode_one(staged.last_observation.unwrap()).unwrap(),
    )
    .unwrap();
    assert!(matches!(bad.status, SourceStatus::Integrity(_)));
    let record = |version, key| {
        call::<Result<RecordAt, String>>(
            &pic,
            reviewer,
            "registry_record",
            encode_args((version, key)).unwrap(),
        )
    };
    assert!(record(1u64, RecordKey::Node(projected_node(0))).is_err());

    pic.upgrade_canister(reviewer, binary, encode_args(()).unwrap(), None)
        .unwrap();
    let restored = registry(&pic, reviewer);
    assert_eq!(
        restored.staging.unwrap().applied,
        staged.staging.unwrap().applied
    );
    assert_eq!(restored.published, None);
    mode(1);
    call::<Result<(), String>>(&pic, reviewer, "retry_registry", encode_args(()).unwrap()).unwrap();
    let bootstrap = until_registry(&pic, reviewer, |s| s.published == Some(3));
    assert_eq!(bootstrap.ingested_through, 3);
    let boundary = RecordKey::ApiBoundary(projected_node(0));
    assert!(matches!(
        record(1, boundary.clone()).unwrap(),
        RecordAt::Present { .. }
    ));
    assert!(
        matches!(record(2, boundary).unwrap(), RecordAt::Deleted(row) if row.mutation_version == 2)
    );
    assert!(matches!(
        record(3, RecordKey::Node(projected_node(1201))).unwrap(),
        RecordAt::Missing
    ));
    let dc = match record(3, RecordKey::DataCenter("EXAMPLE".into())).unwrap() {
        RecordAt::Present {
            evidence,
            details: Details::DataCenter { id, .. },
        } => {
            assert_eq!(id, "example");
            assert!(evidence.chunks.len() > 4);
            evidence
        }
        _ => panic!("missing chunked data center"),
    };
    let manifest = call::<Result<EvidenceManifest, String>>(
        &pic,
        reviewer,
        "evidence_manifest",
        encode_args((Some(3u64), vec![dc.page, dc.page])).unwrap(),
    )
    .unwrap();
    assert_eq!(manifest.registry_version, Some(3));
    assert_eq!(manifest.observations.len(), 1);
    assert!(matches!(
        call::<Result<Assignment, String>>(
            &pic,
            reviewer,
            "registry_assignment",
            encode_args((3u64, projected_node(0))).unwrap()
        )
        .unwrap(),
        Assignment::Replica(_)
    ));

    let finished = until_registry(&pic, reviewer, |s| s.published == Some(5));
    let usage = collection(&pic, reviewer).usage.unwrap();
    println!(
        "registry fixture: {} versions, {} wire mutations, {} retained, {} raw input bytes, {} retained record bytes, {} instructions, {} cycles including polling and upgrade, {} stable pages",
        finished.ingested_through,
        finished.processed_mutations,
        finished.retained_mutations,
        finished.wire_bytes,
        finished.retained_value_bytes,
        usage.measured_instructions,
        before_cycles - pic.cycle_balance(reviewer),
        collection(&pic, reviewer).allocated_pages
    );
    assert!(matches!(
        record(5, RecordKey::Node(projected_node(1201))).unwrap(),
        RecordAt::Present { .. }
    ));
    assert!(matches!(
        record(3, RecordKey::Node(projected_node(1201))).unwrap(),
        RecordAt::Missing
    ));

    mode(4);
    pic.advance_time(std::time::Duration::from_secs(5 * 60));
    let malformed = until_registry(&pic, reviewer, |s| s.blocked.is_some());
    assert_eq!(malformed.published, Some(5));
    assert!(malformed.blocked.unwrap().contains("node_record_"));
    assert!(record(6, RecordKey::Node(projected_node(1201))).is_err());
}
