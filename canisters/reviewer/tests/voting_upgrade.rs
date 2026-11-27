use std::{
    fs,
    path::{Path, PathBuf},
    time::Duration,
};

use candid::{CandidType, Principal, decode_one, encode_args, encode_one};
use nexus_domain::{Hash, sha256};
use nexus_reviewer::{
    CollectionStatus, EvidenceManifest, Limits, RegistryStatus, ReplyPage, SourceObservation,
    Sources,
};
use pocket_ic::{CanisterSettings, PocketIc, PocketIcBuilder};
use serde::{Deserialize, de::DeserializeOwned};

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

#[derive(CandidType)]
struct StoreAsset {
    key: String,
    content_type: String,
    content_encoding: String,
    content: Vec<u8>,
    sha256: Option<Vec<u8>>,
}

#[derive(CandidType)]
struct HttpRequest {
    method: String,
    url: String,
    headers: Vec<(String, String)>,
    body: Vec<u8>,
    certificate_version: Option<u16>,
}

#[derive(CandidType, Deserialize)]
struct HttpResponse {
    status_code: u16,
    headers: Vec<(String, String)>,
    body: Vec<u8>,
}

struct FrontendRehearsal {
    id: Principal,
    old_wasm: Vec<u8>,
    new_wasm: Vec<u8>,
    files: Vec<(&'static str, Vec<u8>)>,
    settings: Vec<u8>,
}

impl FrontendRehearsal {
    fn start(pic: &PocketIc, directory: &Path, primary: Principal, recovery: Principal) -> Self {
        let old_wasm = fs::read(directory.join("deployed-frontend.wasm.gz")).unwrap();
        let new_wasm = fs::read(directory.join("frontend.wasm.gz")).unwrap();
        let id = pic.create_canister_on_subnet(
            Some(primary),
            Some(CanisterSettings {
                controllers: Some(vec![primary, recovery]),
                ..Default::default()
            }),
            pic.topology().get_app_subnets()[0],
        );
        pic.install_canister(
            id,
            old_wasm.clone(),
            encode_args(()).unwrap(),
            Some(primary),
        );
        let files = [
            ("/index.html", "text/html"),
            ("/app.js", "text/javascript"),
            ("/styles.css", "text/css"),
        ]
        .into_iter()
        .map(|(key, content_type)| {
            let content = fs::read(directory.join("legacy-assets").join(&key[1..])).unwrap();
            pic.update_call(
                id,
                primary,
                "store",
                encode_one(StoreAsset {
                    key: key.into(),
                    content_type: content_type.into(),
                    content_encoding: "identity".into(),
                    sha256: Some(sha256(&content).to_vec()),
                    content: content.clone(),
                })
                .unwrap(),
            )
            .unwrap();
            (key, content)
        })
        .collect();
        let settings =
            encode_one(&pic.canister_status(id, Some(primary)).unwrap().settings).unwrap();
        let frontend = Self {
            id,
            old_wasm,
            new_wasm,
            files,
            settings,
        };
        frontend.verify_legacy(pic, primary);
        frontend
    }

    fn request(&self, pic: &PocketIc, path: &str, host: &str) -> HttpResponse {
        decode_one(
            &pic.query_call(
                self.id,
                Principal::anonymous(),
                "http_request",
                encode_one(HttpRequest {
                    method: "GET".into(),
                    url: path.into(),
                    headers: vec![("Host".into(), host.into())],
                    body: vec![],
                    certificate_version: Some(2),
                })
                .unwrap(),
            )
            .unwrap(),
        )
        .unwrap()
    }

    fn verify_module(&self, pic: &PocketIc, controller: Principal, wasm: &[u8]) {
        let status = pic.canister_status(self.id, Some(controller)).unwrap();
        assert_eq!(status.module_hash, Some(sha256(wasm).to_vec()));
        assert_eq!(encode_one(&status.settings).unwrap(), self.settings);
    }

    fn verify_legacy(&self, pic: &PocketIc, controller: Principal) {
        self.verify_module(pic, controller, &self.old_wasm);
        for (path, content) in &self.files {
            let response = self.request(pic, path, "certified.localhost");
            assert_eq!(response.status_code, 200);
            assert_eq!(&response.body, content);
        }
    }

    fn upgrade_and_rollback(&self, pic: &PocketIc, primary: Principal, recovery: Principal) {
        pic.upgrade_canister(
            self.id,
            self.new_wasm.clone(),
            encode_args(()).unwrap(),
            Some(primary),
        )
        .unwrap();
        self.verify_module(pic, recovery, &self.new_wasm);
        let response = self.request(pic, "/", "certified.localhost");
        assert_eq!(response.status_code, 200);
        assert!(
            response
                .headers
                .iter()
                .any(|(name, _)| name.eq_ignore_ascii_case("IC-Certificate"))
        );
        assert_ne!(response.body, self.files[0].1);
        let id = self.id;
        for host in [
            format!("{id}.raw.icp.net"),
            format!("{id}.raw.icp0.io"),
            format!("{id}.raw.ic0.app"),
            format!("{id}.RAW.ICP.NET.:443"),
            "raw.icp.net".into(),
            "raw.icp0.io".into(),
            "raw.ic0.app".into(),
        ] {
            let refusal = self.request(pic, "/", &host);
            assert_eq!(refusal.status_code, 403, "{host}");
            assert!(refusal.body.is_empty());
        }
        pic.upgrade_canister(
            self.id,
            self.old_wasm.clone(),
            encode_args(()).unwrap(),
            Some(primary),
        )
        .unwrap();
        self.verify_legacy(pic, recovery);
        println!(
            "Frontend upgraded second and rolled back first. Host refusal and all three prior asset bodies verified."
        );
    }
}

#[test]
#[ignore = "requires the exact previously deployed compressed Wasm; see docs/VOTING_GRADE_REVIEW.md"]
fn exact_deployed_module_preserves_paused_checkpoint_on_upgrade() {
    let old = fs::read(std::env::var("NEXUS_REHEARSAL_OLD").unwrap()).unwrap();
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let new = fs::read(
        std::env::var_os("NEXUS_REHEARSAL_NEW")
            .map(PathBuf::from)
            .unwrap_or_else(|| root.join(".local/reviewer-production.wasm.gz")),
    )
    .unwrap();
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
    let frontend = std::env::var_os("NEXUS_REHEARSAL_FRONTEND_DIR")
        .map(|dir| FrontendRehearsal::start(&pic, Path::new(&dir), primary, recovery));
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
    let deployed = std::env::var("NEXUS_REHEARSAL_MODULE_SHA256").unwrap_or_else(|_| {
        "cf4eae5eaa8b56adf2c78cc6a7ec0af5cc9648db69cbccfb17d92e48da1dc1c3".into()
    });
    assert_eq!(
        expected_old
            .iter()
            .map(|value| format!("{value:02x}"))
            .collect::<String>(),
        deployed
    );
    let expected_new = sha256(&new);
    pic.install_canister(
        reviewer,
        old.clone(),
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
    let verify_retained_state = || {
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
    };
    for (elapsed, rounds) in [(2, 8), (86_401, 12)] {
        pic.advance_time(Duration::from_secs(elapsed));
        for _ in 0..rounds {
            pic.tick();
        }
        verify_retained_state();
    }
    if let Some(frontend) = frontend {
        frontend.verify_legacy(&pic, recovery);
        frontend.upgrade_and_rollback(&pic, primary, recovery);
        verify_retained_state();
        pic.upgrade_canister(reviewer, old, empty(), Some(primary))
            .unwrap();
        let rolled_back = pic.canister_status(reviewer, Some(recovery)).unwrap();
        assert_eq!(rolled_back.module_hash, Some(expected_old.to_vec()));
        assert_eq!(
            encode_one(&rolled_back.settings).unwrap(),
            encode_one(&status_before.settings).unwrap()
        );
        assert_eq!(
            rolled_back.memory_metrics.stable_memory_size,
            status_before.memory_metrics.stable_memory_size
        );
        verify_retained_state();
        println!(
            "Restored exact prior reviewer. Controller settings, stable pages, checkpoint and retained evidence matched."
        );
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
