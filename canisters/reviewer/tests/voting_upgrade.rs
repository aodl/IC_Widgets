use std::{fs, path::Path, time::Duration};

use candid::{CandidType, Principal, decode_one, encode_args, encode_one};
use nexus_domain::{Hash, sha256};
use nexus_reviewer::{
    CollectionStatus, EvidenceManifest, Limits, RegistryStatus, ReplyPage, SourceObservation,
    Sources,
};
use pocket_ic::{CanisterSettings, PocketIc, PocketIcBuilder};
use serde::de::DeserializeOwned;

fn call<T: CandidType + DeserializeOwned>(
    pic: &PocketIc,
    target: Principal,
    controller: Principal,
    method: &str,
    args: Vec<u8>,
) -> T {
    let reply = pic
        .update_call(target, controller, method, args)
        .unwrap_or_else(|err| panic!("{method}: {err:?}"));
    decode_one(&reply).unwrap_or_else(|err| panic!("{method}: {err:?}"))
}

#[test]
#[ignore = "requires the exact previously deployed compressed Wasm; see docs/VOTING_GRADE_REVIEW.md"]
fn exact_deployed_module_preserves_paused_checkpoint_on_upgrade() {
    let old = fs::read(std::env::var("NEXUS_REHEARSAL_OLD").unwrap()).unwrap();
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let new = fs::read(root.join(".local/reviewer-production.wasm.gz")).unwrap();
    let sources = Sources::canonical();
    let fixture =
        fs::read(root.join("target/wasm32-unknown-unknown/release/nexus_source_fixture.wasm"))
            .unwrap();
    let pic = PocketIcBuilder::new()
        .with_nns_subnet()
        .with_application_subnet()
        .build();
    for id in [sources.registry, sources.governance] {
        pic.create_canister_with_id(None, None, id).unwrap();
        pic.install_canister(id, fixture.clone(), encode_args(()).unwrap(), None);
    }
    call::<()>(
        &pic,
        sources.registry,
        Principal::anonymous(),
        "set_registry_mode",
        encode_one(7u8).unwrap(),
    );
    let primary =
        Principal::from_text("amzih-bssz4-twanl-zf6nr-bqsnn-d7rlt-eerbc-oe7vv-uggn5-3naqo-3ae")
            .unwrap();
    let recovery =
        Principal::from_text("zkkkd-i34qc-367ln-e2u7o-ezznu-dkfqh-gtfvz-cviph-6qa4v-evtfs-wqe")
            .unwrap();
    let reviewer = pic.create_canister_on_subnet(
        Some(primary),
        Some(CanisterSettings {
            controllers: Some(vec![primary, recovery]),
            compute_allocation: Some(0u64.into()),
            memory_allocation: Some(0u64.into()),
            freezing_threshold: Some(2_592_000u64.into()),
            reserved_cycles_limit: Some(5_000_000_000_000u64.into()),
            wasm_memory_limit: Some(3_221_225_472u64.into()),
            wasm_memory_threshold: Some(0u64.into()),
            ..Default::default()
        }),
        pic.topology().get_app_subnets()[0],
    );
    let expected_old = sha256(&old);
    assert_eq!(
        expected_old
            .iter()
            .map(|value| format!("{value:02x}"))
            .collect::<String>(),
        "cf4eae5eaa8b56adf2c78cc6a7ec0af5cc9648db69cbccfb17d92e48da1dc1c3"
    );
    let expected_new = sha256(&new);
    pic.install_canister(
        reviewer,
        old,
        encode_one::<Option<Sources>>(None).unwrap(),
        Some(primary),
    );
    assert_eq!(
        pic.canister_status(reviewer, Some(primary))
            .unwrap()
            .module_hash,
        Some(expected_old.to_vec())
    );
    let empty = || encode_args(()).unwrap();
    let registry = || {
        call::<Result<RegistryStatus, String>>(&pic, reviewer, primary, "registry_status", empty())
            .unwrap()
    };
    let collection = || {
        call::<Result<CollectionStatus, String>>(
            &pic,
            reviewer,
            primary,
            "collection_status",
            empty(),
        )
        .unwrap()
    };
    let observation = |id| {
        call::<Result<SourceObservation, String>>(
            &pic,
            reviewer,
            primary,
            "source_observation",
            encode_one(id).unwrap(),
        )
    };
    let blob = |hash: Hash| {
        call::<Result<ReplyPage, String>>(
            &pic,
            reviewer,
            primary,
            "evidence_bytes",
            encode_args((hash, 0u32)).unwrap(),
        )
        .unwrap()
    };
    call::<Result<(), String>>(
        &pic,
        reviewer,
        primary,
        "configure_collection_storage",
        encode_one(Some(3_072u64)).unwrap(),
    )
    .unwrap();
    let expiry = pic.get_time().as_nanos_since_unix_epoch() + 600_000_000_000;
    call::<Result<(), String>>(
        &pic,
        reviewer,
        primary,
        "authorize_verification",
        encode_args((
            expiry,
            Limits {
                cycle_ceiling: 2_800_000_000_000,
                calls: 24,
                attempts: 1,
                raw_bytes: 18_874_368,
                slices: 160,
                duration_secs: 600,
            },
        ))
        .unwrap(),
    )
    .unwrap();
    for _ in 0..100 {
        let status = registry();
        assert!(status.block.is_none());
        if status.ingested_through >= 4_270 {
            break;
        }
        pic.advance_time(Duration::from_secs(2));
        for _ in 0..4 {
            pic.tick();
        }
    }
    assert_eq!(registry().ingested_through, 4_270);
    pic.advance_time(Duration::from_secs(601));
    for _ in 0..8 {
        pic.tick();
    }
    let before = registry();
    let before_collection = collection();
    assert_eq!(before.ingested_through, 4_270);
    assert_eq!(before.bootstrap_target, Some(65_958));
    assert_eq!(before.published, None);
    assert!(before.staging.is_none() && before.block.is_none());
    assert!(!before_collection.enabled && before_collection.in_flight.is_none());
    assert_eq!(before_collection.verification_expires_at, Some(expiry));
    assert_eq!(before_collection.storage_page_ceiling, 3_072);
    let ids: Vec<_> = (1..=before_collection.last_observation).collect();
    let read_manifest = |reader| {
        call::<Result<EvidenceManifest, String>>(
            &pic,
            reviewer,
            reader,
            "evidence_manifest",
            encode_args((None::<u64>, ids.clone())).unwrap(),
        )
        .unwrap()
    };
    let manifest = read_manifest(primary);
    assert_eq!(manifest.observations.len(), ids.len());
    assert_eq!(observation(1u64).unwrap().method, "get_latest_version");
    let registry_receipt = observation(before.last_observation.unwrap()).unwrap();
    assert_eq!(registry_receipt.method, "get_changes_since");
    let retained = manifest
        .observations
        .iter()
        .find(|row| row.method == "get_proposal_info")
        .expect("retained full Governance reply");
    let hash = retained.raw_hash.unwrap();
    let before_blob = blob(hash);
    assert_eq!(sha256(&before_blob.bytes), hash);
    assert_eq!(before_blob.next_offset, None);
    let status_before = pic.canister_status(reviewer, Some(primary)).unwrap();
    assert_eq!(status_before.settings.controllers.len(), 2);
    assert!(status_before.settings.controllers.contains(&primary));
    assert!(status_before.settings.controllers.contains(&recovery));

    pic.upgrade_canister(reviewer, new, empty(), Some(primary))
        .unwrap();
    let after = pic.canister_status(reviewer, Some(recovery)).unwrap();
    assert_eq!(after.module_hash, Some(expected_new.to_vec()));
    assert_eq!(
        encode_one(&after.settings).unwrap(),
        encode_one(&status_before.settings).unwrap()
    );
    assert_eq!(
        after.memory_metrics.stable_memory_size,
        status_before.memory_metrics.stable_memory_size
    );
    for (elapsed, rounds) in [(2, 8), (86_401, 12)] {
        pic.advance_time(Duration::from_secs(elapsed));
        for _ in 0..rounds {
            pic.tick();
        }
        assert_eq!(
            encode_one(registry()).unwrap(),
            encode_one(&before).unwrap()
        );
        assert_eq!(
            encode_one(collection()).unwrap(),
            encode_one(&before_collection).unwrap()
        );
        assert_eq!(
            encode_one(read_manifest(recovery)).unwrap(),
            encode_one(&manifest).unwrap()
        );
        assert_eq!(
            encode_one(blob(hash)).unwrap(),
            encode_one(&before_blob).unwrap()
        );
        assert!(observation(before_collection.last_observation + 1).is_err());
    }
    println!(
        "Exact old and new compressed artifacts verified. Cursor {}, target {}, unpublished. All {} fixture observations (including head 1 and last Registry observation {}), a {}-byte Governance blob, full controller settings and {} stable pages preserved. Collector remained disabled and without a lease across 24h.",
        before.ingested_through,
        before.bootstrap_target.unwrap(),
        ids.len(),
        registry_receipt.id,
        before_blob.bytes.len(),
        before_collection.allocated_pages,
    );
}
