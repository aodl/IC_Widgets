mod support;

use candid::{Principal, encode_args, encode_one};
use nexus_domain::sha256;
use nexus_ic_sources::{
    projection::{Details, RecordKey},
    registry::{self, wire::registry::node_operator::v1::NodeOperatorRecord},
};
use nexus_reviewer::{
    Assignment, COLLECTION_LIMITS, CollectionStatus, EvidenceManifest, Limits, ProviderPage,
    RecordAt, RegistryLimit, RegistryLimits, RegistryRecovery, RegistryStatus, ReplyPage,
    SourceObservation, SourceStatus, Sources, Stop,
};
use pocket_ic::{PocketIc, PocketIcBuilder};
use prost::Message;
use std::time::Duration;
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

#[test]
#[ignore = "run through scripts/test-m0.sh to build Wasm and start PocketIC"]
fn verification_expiry_fences_delayed_callbacks_and_survives_upgrade() {
    let pic = PocketIcBuilder::new()
        .with_nns_subnet()
        .with_application_subnet()
        .build();
    let topology = pic.topology();
    let app = topology.get_app_subnets()[0];
    let slow = wasm(".local/slow-source-fixture.wasm");
    let fixture = pic.create_canister_on_subnet(None, None, topology.get_nns().unwrap());
    let delay_target = pic.create_canister_on_subnet(None, None, app);
    pic.install_canister(delay_target, slow.clone(), encode_args(()).unwrap(), None);
    pic.install_canister(fixture, slow, encode_args(()).unwrap(), None);
    call::<()>(
        &pic,
        fixture,
        "set_delay_target",
        encode_one(delay_target).unwrap(),
    );
    let reviewer = pic.create_canister_on_subnet(None, None, app);
    let binary = wasm(".local/reviewer-fixture.wasm");
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
    let authorize = |offset: u64, limits| {
        let expiry = pic.get_time().as_nanos_since_unix_epoch() + offset * 1_000_000_000;
        call::<Result<(), String>>(
            &pic,
            reviewer,
            "authorize_verification",
            encode_args((expiry, limits)).unwrap(),
        )
    };
    assert!(
        authorize(
            120,
            Limits {
                duration_secs: 60,
                ..COLLECTION_LIMITS
            }
        )
        .is_err()
    );
    authorize(30, COLLECTION_LIMITS).unwrap();
    for _ in 0..6 {
        advance(&pic);
        if matches!(
            collection(&pic, reviewer).in_flight,
            Some(nexus_reviewer::Work::GovernanceList { .. })
        ) {
            break;
        }
    }
    let running = collection(&pic, reviewer);
    assert!(matches!(
        running.in_flight,
        Some(nexus_reviewer::Work::GovernanceList { .. })
    ));
    let admitted = running.usage.unwrap();

    pic.advance_time(Duration::from_secs(35));
    assert!(!collection(&pic, reviewer).enabled);
    pic.upgrade_canister(reviewer, binary.clone(), encode_args(()).unwrap(), None)
        .unwrap();
    for _ in 0..30 {
        pic.tick();
    }
    pic.advance_time(Duration::from_secs(86_401));
    for _ in 0..5 {
        advance(&pic);
    }
    pic.upgrade_canister(reviewer, binary, encode_args(()).unwrap(), None)
        .unwrap();
    for _ in 0..5 {
        advance(&pic);
    }
    let finished = collection(&pic, reviewer);
    assert!(!finished.enabled);
    assert_eq!(
        finished.verification_expires_at,
        running.verification_expires_at
    );
    assert!(finished.in_flight.is_none());
    let final_usage = finished.usage.unwrap();
    assert_eq!(final_usage.stop, Some(Stop::Deadline));
    assert_eq!(final_usage.calls, admitted.calls);
    assert_eq!(final_usage.cycles_reserved, admitted.cycles_reserved);
    assert_eq!(final_usage.started_at, admitted.started_at);
    assert_eq!(finished.last_observation, running.last_observation + 1);

    authorize(
        30,
        Limits {
            cycle_ceiling: 1,
            ..COLLECTION_LIMITS
        },
    )
    .unwrap();
    advance(&pic);
    let exhausted = collection(&pic, reviewer);
    assert!(!exhausted.enabled);
    assert_eq!(exhausted.usage.unwrap().stop, Some(Stop::CycleCeiling));
    assert_eq!(exhausted.usage.unwrap().calls, 0);
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
#[ignore = "run through scripts/test-m0.sh to build the two production Wasms"]
fn historical_operator_conflict_recovers_from_deployed_checkpoint() {
    assert!(enabled());
    let pic = PocketIcBuilder::new()
        .with_nns_subnet()
        .with_application_subnet()
        .build();
    let source = Sources::canonical();
    let fixture = wasm("target/wasm32-unknown-unknown/release/nexus_source_fixture.wasm");
    for id in [source.registry, source.governance] {
        pic.create_canister_with_id(None, None, id).unwrap();
        pic.install_canister(id, fixture.clone(), encode_args(()).unwrap(), None);
    }
    let mode = |value| {
        call::<()>(
            &pic,
            source.registry,
            "set_registry_mode",
            encode_one(value).unwrap(),
        )
    };
    mode(7u8);

    let reviewer = pic.create_canister_on_subnet(None, None, pic.topology().get_app_subnets()[0]);
    pic.add_cycles(reviewer, 10_000_000_000_000);
    let installed = wasm(&std::env::var("NEXUS_REGISTRY_BASELINE_WASM").unwrap());
    pic.install_canister(
        reviewer,
        installed.clone(),
        encode_one::<Option<Sources>>(None).unwrap(),
        None,
    );
    assert_eq!(
        pic.canister_status(reviewer, None).unwrap().module_hash,
        Some(sha256(&installed).to_vec())
    );

    let observe = |id| {
        call::<Result<SourceObservation, String>>(
            &pic,
            reviewer,
            "source_observation",
            encode_one(id).unwrap(),
        )
        .unwrap()
    };
    let record = |version, key| {
        call::<Result<RecordAt, String>>(
            &pic,
            reviewer,
            "registry_record",
            encode_args((version, key)).unwrap(),
        )
    };
    configure(&pic, reviewer, Some(COLLECTION_LIMITS));
    let before = until_registry(&pic, reviewer, |status| {
        status.ingested_through >= 4_270 || status.block.is_some()
    });
    configure(&pic, reviewer, None);
    assert_eq!(before.ingested_through, 4_270);
    assert_eq!(before.bootstrap_target, Some(65_958));
    assert_eq!(before.published, None);
    assert!(before.block.is_none());
    assert!(before.staging.is_none());
    let last_observation = before.last_observation.unwrap();
    let observation = observe(last_observation);
    let page_hash = |cursor| {
        sha256(
            &pic.query_call(
                source.registry,
                Principal::anonymous(),
                "get_changes_since",
                registry::changes_request(cursor),
            )
            .unwrap(),
        )
    };
    assert_eq!(observation.raw_hash, Some(page_hash(4_000)));

    let compatible = wasm(".local/reviewer-production.wasm.gz");
    let expected_module = sha256(&compatible);
    pic.upgrade_canister(reviewer, compatible, encode_args(()).unwrap(), None)
        .unwrap();
    assert_eq!(
        pic.canister_status(reviewer, None).unwrap().module_hash,
        Some(expected_module.to_vec())
    );
    assert!(!collection(&pic, reviewer).enabled);
    assert_eq!(
        encode_one(registry(&pic, reviewer)).unwrap(),
        encode_one(before).unwrap()
    );
    assert_eq!(
        encode_one(observe(last_observation)).unwrap(),
        encode_one(observation).unwrap()
    );
    assert!(record(4_270u64, RecordKey::SubnetList).is_err());
    configure(&pic, reviewer, Some(COLLECTION_LIMITS));
    let complete = until_registry(&pic, reviewer, |status| {
        status.published == Some(65_958) || status.block.is_some()
    });
    assert!(complete.blocked.is_none(), "{:?}", complete.blocked);
    assert_eq!(complete.ingested_through, 65_958);

    let identity = |kind, index| {
        let mut bytes = [kind; 29];
        bytes[..2].copy_from_slice(&[0, index]);
        bytes[28] = 2;
        Principal::from_slice(&bytes)
    };
    let operator = identity(23, 1);
    let other_operator = identity(23, 2);
    let provider = identity(24, 1);
    let key = RecordKey::Operator(operator);
    for (version, center) in [(48_020u64, "old-dc"), (65_852, "restored-dc")] {
        assert!(
            matches!(record(version, key.clone()).unwrap(), RecordAt::Present {
            details: Details::Operator { provider: Some(found), data_center, .. }, ..
        } if found == provider && data_center == center)
        );
    }
    let original = NodeOperatorRecord {
        node_operator_principal_id: other_operator.as_slice().to_vec(),
        node_provider_principal_id: provider.as_slice().to_vec(),
        dc_id: "unverified-dc".into(),
        ..Default::default()
    }
    .encode_to_vec();
    let hash = sha256(&original);
    for version in [48_021u64, 65_851] {
        let RecordAt::Opaque { evidence, reason } = record(version, key.clone()).unwrap() else {
            panic!("operator identity conflict must be opaque");
        };
        assert_eq!(reason, "operator record principal disagrees with key");
        assert_eq!(evidence.mutation_version, 48_021);
        assert_eq!(evidence.source_time, Some(480_210));
        assert_eq!(evidence.value_hash, Some(hash));
        let source_page = observe(evidence.page);
        assert_eq!(source_page.argument, registry::changes_request(47_270));
        assert_eq!(source_page.raw_hash, Some(page_hash(47_270)));
        assert_eq!(
            source_page.decoder_revision,
            nexus_ic_sources::projection::DECODER_REVISION
        );
    }
    let retained = call::<Result<ReplyPage, String>>(
        &pic,
        reviewer,
        "evidence_bytes",
        encode_args((hash, 0u32)).unwrap(),
    )
    .unwrap();
    assert_eq!(retained.bytes, original);
    assert_eq!(sha256(&retained.bytes), hash);
    assert_eq!(retained.next_offset, None);
    for (version, expected) in [
        (48_021u64, vec![other_operator]),
        (65_958, vec![operator, other_operator]),
    ] {
        let listed = call::<Result<ProviderPage, String>>(
            &pic,
            reviewer,
            "registry_provider",
            encode_args((version, provider, None::<String>)).unwrap(),
        )
        .unwrap();
        let mut operators: Vec<_> = listed.operators.into_iter().map(|(id, _)| id).collect();
        operators.sort_unstable();
        assert_eq!(operators, expected);
        assert_eq!(listed.next, None);
    }

    mode(8u8);
    pic.advance_time(Duration::from_secs(360));
    let corrupt = until_registry(&pic, reviewer, |status| status.block.is_some());
    assert_eq!(corrupt.ingested_through, 65_958);
    assert_eq!(corrupt.published, Some(65_958));
    assert!(
        corrupt
            .blocked
            .unwrap()
            .contains("duplicate subnet in Registry roster")
    );
    assert!(record(65_959u64, RecordKey::SubnetList).is_err());
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
    let retry =
        || call::<Result<(), String>>(&pic, reviewer, "retry_registry", encode_args(()).unwrap());
    let set_limits = |limits| {
        call::<Result<(), String>>(
            &pic,
            reviewer,
            "configure_registry_limits",
            encode_one(limits).unwrap(),
        )
        .unwrap()
    };
    set_limits(RegistryLimits {
        staged_mutations: 2,
        ..RegistryLimits::MAX
    });
    let before_cycles = pic.cycle_balance(reviewer);
    configure(&pic, reviewer, Some(COLLECTION_LIMITS));
    let over_limit = until_registry(&pic, reviewer, |s| s.block.is_some());
    let block = over_limit.block.unwrap();
    assert_eq!(block.cursor, 0);
    assert_eq!(block.version_range, Some((1, 4)));
    assert!(matches!(block.recovery, RegistryRecovery::IncreaseLimit {
        limit: RegistryLimit::StagedMutations, required
    } if required > 2));
    assert!(retry().is_err());
    assert!(registry(&pic, reviewer).published.is_none());
    set_limits(RegistryLimits::MAX);
    retry().unwrap();
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
    let failure = staged.block.as_ref().unwrap();
    assert_eq!(failure.recovery, RegistryRecovery::RepairSource);
    assert!(
        failure
            .record_key
            .as_ref()
            .unwrap()
            .starts_with("data_center_record_")
    );
    assert_eq!(failure.observation, bad.id);
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

    let mut provider_bytes = [24; 29];
    provider_bytes[..2].copy_from_slice(&1u16.to_be_bytes());
    provider_bytes[28] = 2;
    let provider = Principal::from_slice(&provider_bytes);
    let operators = call::<Result<nexus_reviewer::ProviderPage, String>>(
        &pic,
        reviewer,
        "registry_provider",
        encode_args((3u64, provider, None::<String>)).unwrap(),
    )
    .unwrap();
    assert_eq!(operators.operators.len(), 1);
    assert_eq!(operators.operators[0].1.mutation_version, 1);

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
    let block = malformed.block.unwrap();
    assert_eq!(block.version_range, Some((6, 6)));
    assert_eq!(block.recovery, RegistryRecovery::UpgradeAdapter);
    assert!(retry().is_err());
    for _ in 0..6 {
        advance(&pic);
    }
    assert_eq!(registry(&pic, reviewer).published, Some(5));
    assert!(record(6, RecordKey::Node(projected_node(1201))).is_err());
}

#[test]
#[ignore = "run through scripts/test-m0.sh to build Wasm and start PocketIC"]
fn governance_archive_keeps_wire_content_and_distinct_lifecycle() {
    use nexus_domain::MembershipAction;
    use nexus_reviewer::{
        ActionStatus, CapturePage, DiscoveryStatus, ProposalCapture, ProposalStatus, ReplyPage,
    };

    assert!(enabled());
    let pic = PocketIcBuilder::new()
        .with_nns_subnet()
        .with_application_subnet()
        .build();
    let topology = pic.topology();
    let fixture = pic.create_canister_on_subnet(None, None, topology.get_nns().unwrap());
    let reviewer = pic.create_canister_on_subnet(None, None, topology.get_app_subnets()[0]);
    let binary = wasm(".local/reviewer-fixture.wasm");
    pic.install_canister(
        fixture,
        wasm("target/wasm32-unknown-unknown/release/nexus_source_fixture.wasm"),
        encode_args(()).unwrap(),
        None,
    );
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
    call::<()>(
        &pic,
        fixture,
        "enable_proposal_fixture",
        encode_args(()).unwrap(),
    );
    configure(&pic, reviewer, Some(COLLECTION_LIMITS));
    let status = |id| {
        call::<Result<ProposalStatus, String>>(
            &pic,
            reviewer,
            "proposal_status",
            encode_one::<u64>(id).unwrap(),
        )
        .unwrap()
    };
    let until = |id, predicate: &dyn Fn(&ProposalStatus) -> bool| {
        for _ in 0..150 {
            advance(&pic);
            let current = status(id);
            if predicate(&current) {
                return current;
            }
        }
        panic!(
            "proposal {id} did not reach expected state, captures {}, latest {:?}",
            status(id).capture_count,
            status(id).last_status
        );
    };
    let capture = |id, observation| {
        call::<Result<ProposalCapture, String>>(
            &pic,
            reviewer,
            "proposal_archive",
            encode_args((id, observation)).unwrap(),
        )
        .unwrap()
    };
    let queue = |id| {
        call::<Result<(), String>>(
            &pic,
            reviewer,
            "capture_proposal",
            encode_one::<u64>(id).unwrap(),
        )
        .unwrap();
    };
    let initial = until(101, &|status| status.capture_count == 1);
    let initial_capture = capture(101u64, None::<u64>);
    assert!(matches!(
        initial_capture.action_status,
        ActionStatus::Membership
    ));
    assert_eq!(initial_capture.function, Some(31));
    let first_raw = call::<Result<ReplyPage, String>>(
        &pic,
        reviewer,
        "evidence_bytes",
        encode_args((initial_capture.raw_hash, 0u32)).unwrap(),
    )
    .unwrap();
    assert_eq!(
        nexus_domain::sha256(&first_raw.bytes),
        initial_capture.raw_hash
    );
    assert!(first_raw.bytes.len() > 1000);
    let action = call::<Result<MembershipAction, String>>(
        &pic,
        reviewer,
        "proposal_action",
        encode_args((101u64, None::<u64>)).unwrap(),
    )
    .unwrap();
    assert!(matches!(action, MembershipAction::Change { add, .. } if add.len() == 37));

    queue(101);
    queue(101);
    let repeated = until(101, &|status| {
        status.last_observation > initial.last_observation
    });
    assert_eq!(repeated.capture_count, 1);
    assert_eq!(repeated.last_capture, initial.last_capture);

    for (id, function) in [(99, 2), (98, 13), (97, 18), (96, 31)] {
        queue(id);
        until(id, &|status| status.capture_count == 1);
        let row = capture(id, None::<u64>);
        assert_eq!(row.function, Some(function));
        match id {
            97 => assert!(matches!(
                row.action_status,
                ActionStatus::UnsupportedFunction(18)
            )),
            96 => {
                assert!(matches!(
                    row.action_status,
                    ActionStatus::MalformedPayload(_)
                ));
                assert!(row.payload_hash.is_some());
            }
            _ => assert!(matches!(row.action_status, ActionStatus::Membership)),
        }
    }
    queue(95);
    until(95, &|status| status.capture_count == 1);
    assert!(matches!(
        capture(95, None::<u64>).action_status,
        ActionStatus::UnsupportedAction
    ));
    queue(94);
    until(94, &|status| {
        status.last_status == Some(SourceStatus::Oversized)
    });
    assert_eq!(status(94).capture_count, 0);
    queue(999);
    until(999, &|status| {
        status.last_status == Some(SourceStatus::Unavailable)
    });
    assert_eq!(status(999).capture_count, 0);

    call::<()>(
        &pic,
        fixture,
        "set_proposal_executed",
        encode_one(true).unwrap(),
    );
    pic.upgrade_canister(reviewer, binary, encode_args(()).unwrap(), None)
        .unwrap();
    pic.advance_time(std::time::Duration::from_secs(3600));
    until(101, &|status| status.capture_count == 2);
    let history = call::<Result<CapturePage, String>>(
        &pic,
        reviewer,
        "proposal_history",
        encode_args((101u64, None::<u64>)).unwrap(),
    )
    .unwrap();
    assert_eq!(history.rows.len(), 2);
    assert_eq!(history.rows[0].payload_hash, history.rows[1].payload_hash);
    assert_eq!(history.rows[0].lifecycle.status, 1);
    assert_eq!(history.rows[1].lifecycle.status, 4);
    assert_eq!(history.rows[1].lifecycle.decided_at_seconds, Some(120));
    assert_eq!(history.rows[1].lifecycle.executed_at_seconds, Some(130));
    let discovered = call::<Result<DiscoveryStatus, String>>(
        &pic,
        reviewer,
        "discovery_status",
        encode_args(()).unwrap(),
    )
    .unwrap();
    assert_eq!(discovered.high_watermark, Some(101));
}

#[test]
#[ignore = "run through scripts/test-m0.sh to build Wasm and start PocketIC"]
fn native_metrics_producer_resumes_per_subnet_and_preserves_overlap() {
    use nexus_ic_sources::management::{NodeMetricsHistoryArgs, NodeMetricsHistoryResult};
    use nexus_ic_sources::registry::wire::registry::subnet::v1::SubnetRecord;
    use nexus_reviewer::{MetricPage, MetricRows, MetricsRosterStatus, SubnetCollection};
    use pocket_ic::{SubnetBlockmakers, TickConfigs};
    use prost::Message;

    // Public Registry records exported by PocketIC's state-machine test harness.
    #[derive(Message)]
    struct LocalRegistry {
        #[prost(message, repeated, tag = "1")]
        records: Vec<LocalRecord>,
    }
    #[derive(Message)]
    struct LocalRecord {
        #[prost(string, tag = "1")]
        key: String,
        #[prost(uint64, tag = "2")]
        version: u64,
        #[prost(message, optional, tag = "3")]
        value: Option<LocalBytes>,
    }
    #[derive(Message)]
    struct LocalBytes {
        #[prost(bytes = "vec", tag = "1")]
        value: Vec<u8>,
    }
    use std::time::Duration;

    assert!(enabled());
    let state_dir =
        support::root().join(format!(".local/tmp/metrics-state-{}", std::process::id()));
    std::fs::create_dir_all(&state_dir).unwrap();
    let pic = PocketIcBuilder::new()
        .with_state_dir(state_dir.clone())
        .with_nns_subnet()
        .with_application_subnet()
        .build();
    let topology = pic.topology();
    let app = topology.get_app_subnets()[0];
    let nns = topology.get_nns().unwrap();
    let fixture = pic.create_canister_on_subnet(None, None, nns);
    let reviewer = pic.create_canister_on_subnet(None, None, app);
    let missing = Principal::from_slice(&[80, 80, 2]);
    let unsupported = Principal::from_slice(&[90, 90, 2]);
    let registry = std::fs::read(state_dir.join("registry.proto")).unwrap();
    let records = LocalRegistry::decode(registry.as_slice()).unwrap().records;
    let members = |subnet| {
        let key = format!("subnet_record_{subnet}");
        let entry = records
            .iter()
            .filter(|row| row.key == key)
            .max_by_key(|row| row.version)
            .unwrap();
        SubnetRecord::decode(entry.value.as_ref().unwrap().value.as_slice())
            .unwrap()
            .membership
            .into_iter()
            .map(|bytes| Principal::from_slice(&bytes))
            .collect::<Vec<_>>()
    };
    let app_nodes = members(app);
    let builder = app_nodes[0];
    let delayed = app_nodes[1];
    let remote_builder = members(nns)[0];
    let binary = wasm(".local/reviewer-fixture.wasm");
    pic.install_canister(
        fixture,
        wasm("target/wasm32-unknown-unknown/release/nexus_source_fixture.wasm"),
        encode_args(()).unwrap(),
        None,
    );
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
    call::<()>(
        &pic,
        fixture,
        "set_metrics_subnets",
        encode_one(vec![(app, 1i32), (nns, 2), (missing, 1), (unsupported, 5)]).unwrap(),
    );
    let add_blockmakers = || {
        pic.tick_with_configs(TickConfigs {
            blockmakers: Some(vec![
                SubnetBlockmakers {
                    subnet: app,
                    blockmaker: builder,
                    failed_blockmakers: vec![delayed],
                },
                SubnetBlockmakers {
                    subnet: nns,
                    blockmaker: remote_builder,
                    failed_blockmakers: vec![],
                },
            ]),
        });
    };
    for _ in 0..3 {
        add_blockmakers();
        pic.advance_time(Duration::from_secs(86_400));
    }
    add_blockmakers();

    // Read the native remote source before any archive or collector is enabled.
    let viewer = Principal::from_slice(&[86, 2]);
    call::<Result<(), String>>(
        &pic,
        reviewer,
        "set_on_demand_caller",
        encode_one(Some(viewer)).unwrap(),
    )
    .unwrap();
    let start = pic
        .get_time()
        .as_nanos_since_unix_epoch()
        .saturating_sub(4 * 86_400_000_000_000);
    let read = |nodes: Option<Vec<Principal>>| {
        let wall = std::time::Instant::now();
        let balance = pic.cycle_balance(reviewer);
        let raw = pic
            .update_call(
                reviewer,
                viewer,
                "node_performance_on_demand",
                encode_args((nns, start, nodes)).unwrap(),
            )
            .unwrap();
        let live = candid::decode_one::<
            Result<nexus_reviewer::LiveResponse<nexus_reviewer::LivePerformance>, String>,
        >(&raw)
        .unwrap()
        .unwrap();
        println!(
            "on-demand performance: {} calls, {} source bytes, {} Candid bytes, {} ms wall, {} instructions, {} settled cycles",
            live.usage.calls,
            live.usage.source_bytes,
            raw.len(),
            wall.elapsed().as_millis(),
            live.usage.instructions,
            balance - pic.cycle_balance(reviewer),
        );
        assert_eq!(live.registry_version, None);
        assert_eq!(live.usage.calls, 1);
        assert_eq!(live.receipts[0].method, "node_metrics_history");
        live.outcome.unwrap()
    };
    let direct = read(None);
    assert!(
        direct
            .samples
            .iter()
            .flat_map(|row| &row.node_metrics)
            .any(|row| row.node_id == remote_builder)
    );
    let narrowed = read(Some(vec![]));
    assert!(!narrowed.samples.is_empty());
    assert!(
        narrowed
            .samples
            .iter()
            .all(|row| row.node_metrics.is_empty())
    );

    let cfg_storage = |ceiling| {
        call::<Result<(), String>>(
            &pic,
            reviewer,
            "configure_collection_storage",
            encode_one::<Option<u64>>(ceiling).unwrap(),
        )
        .unwrap()
    };
    cfg_storage(Some(1));
    configure(&pic, reviewer, Some(COLLECTION_LIMITS));
    for _ in 0..4 {
        advance(&pic);
    }
    assert_eq!(
        collection(&pic, reviewer).usage.unwrap().stop,
        Some(Stop::StorageLimit)
    );
    assert_eq!(collection(&pic, reviewer).last_observation, 0);
    configure(&pic, reviewer, None);
    cfg_storage(None);
    let cycles_before = pic.cycle_balance(reviewer);
    configure(&pic, reviewer, Some(COLLECTION_LIMITS));

    let status = |subnet| {
        call::<Result<SubnetCollection, String>>(
            &pic,
            reviewer,
            "metrics_status",
            encode_one(subnet).unwrap(),
        )
        .unwrap()
    };
    let until = |subnet, predicate: &dyn Fn(&SubnetCollection) -> bool| {
        for _ in 0..180 {
            advance(&pic);
            let current = status(subnet);
            if predicate(&current) {
                return current;
            }
        }
        panic!(
            "metrics did not reach expected state for {subnet}: {:?}",
            status(subnet).last_status
        );
    };
    let first = until(app, &|state| state.last_success_at.is_some());
    until(nns, &|state| state.last_success_at.is_some());
    until(missing, &|state| state.last_status.is_some());
    assert!(matches!(
        status(missing).last_status,
        Some(SourceStatus::Rejected { .. })
    ));
    assert_eq!(status(missing).cursor, None);
    let roster = call::<Result<MetricsRosterStatus, String>>(
        &pic,
        reviewer,
        "metrics_roster",
        encode_args(()).unwrap(),
    )
    .unwrap();
    assert_eq!(roster.registry_version, Some(1));
    assert_eq!(roster.eligible_count, 3);
    assert_eq!(roster.unsupported, vec![unsupported]);
    assert!(status(unsupported).last_observation.is_none());

    let bootstrap_cycles = cycles_before - pic.cycle_balance(reviewer);
    let cursor = first
        .cursor
        .expect("native PocketIC history has completed samples");
    let window = |subnet| {
        call::<Result<MetricPage, String>>(
            &pic,
            reviewer,
            "metric_samples",
            encode_args((subnet, 0u64, u64::MAX, None::<u64>)).unwrap(),
        )
        .unwrap()
    };
    let failed_page = window(missing);
    assert!(failed_page.rows.is_empty());
    assert!(matches!(
        failed_page.collection.last_status,
        Some(SourceStatus::Rejected { .. })
    ));
    let initial = window(app);
    let first_count = initial.rows.len();
    let last_sample = initial.rows.last().unwrap().clone();
    assert!(last_sample.node_rows > 0);
    let data = call::<Result<MetricRows, String>>(
        &pic,
        reviewer,
        "metric_sample_rows",
        encode_args((app, cursor, None::<Principal>)).unwrap(),
    )
    .unwrap();
    assert_eq!(data.rows.len(), last_sample.node_rows as usize);
    assert!(
        data.rows
            .iter()
            .any(|row| row.node_id == builder || row.node_id == delayed)
    );
    let raw = call::<Result<nexus_reviewer::ReplyPage, String>>(
        &pic,
        reviewer,
        "evidence_bytes",
        encode_args((last_sample.raw_response_hash, 0u32)).unwrap(),
    )
    .unwrap();
    let restored: NodeMetricsHistoryResult = candid::decode_one(&raw.bytes).unwrap();
    assert_eq!(restored.last().unwrap().timestamp_nanos, cursor);

    pic.upgrade_canister(reviewer, binary, encode_args(()).unwrap(), None)
        .unwrap();
    pic.advance_time(Duration::from_secs(86_400 + 60));
    add_blockmakers();
    let next = until(app, &|state| {
        state.last_observation > first.last_observation
    });
    let observation = call::<Result<SourceObservation, String>>(
        &pic,
        reviewer,
        "source_observation",
        encode_one(next.last_observation.unwrap()).unwrap(),
    )
    .unwrap();
    let args: NodeMetricsHistoryArgs = candid::decode_one(&observation.argument).unwrap();
    assert_eq!(args.start_at_timestamp_nanos, cursor);
    let rows = window(app).rows;
    assert!(rows.len() > first_count);
    let overlap = rows
        .iter()
        .find(|sample| sample.timestamp_nanos == cursor)
        .unwrap();
    assert_eq!(overlap.observation, last_sample.observation);
    assert_eq!(overlap.sample_hash, last_sample.sample_hash);
    println!(
        "metrics native fixture: {} local samples before upgrade, {} after, {} remote after, last response {} bytes, {} cycles for initial collector and polling",
        first_count,
        rows.len(),
        window(nns).rows.len(),
        observation.raw_bytes.unwrap(),
        bootstrap_cycles,
    );
}
