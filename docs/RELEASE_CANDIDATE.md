# Production release candidate

The standalone Membership candidate is frozen at `b8014c8d264928a3ed8f16338fb5d4dc9a494489`. The exact install packages, manifests and verification transcripts are published with PR #10. [Release evidence and downloads](release-candidates/membership-b8014c8/README.md)

The certified mainnet observations on 27 November 2026 used the pinned IC root and a read-only protocol call. Both canisters reported the same existing controller set. The observed module hashes matched the SHA-256 of the previously installed gzip packages retained for rollback.

| Canister | Current ID | Certified UTC | Installed module SHA-256 |
| --- | --- | --- | --- |
| Reviewer | `s34gv-3qaaa-aaaar-qcifa-cai` | 16:29:30.015 | `a0e5ee28c0e4e42f215411f825d02b7ac65f2285794a371bf598fb2755e2eec9` |
| Frontend | `s45ab-wiaaa-aaaar-qcifq-cai` | 16:29:28.256 | `04e565b3425fe7510ee16b02adcfe3f01abc9a2725c82a21cb08969241debd62` |

The observed controllers were `amzih-bssz4-twanl-zf6nr-bqsnn-d7rlt-eerbc-oe7vv-uggn5-3naqo-3ae` and `zkkkd-i34qc-367ln-e2u7o-ezznu-dkfqh-gtfvz-cviph-6qa4v-evtfs-wqe`.
A second certified observation at 17:02 UTC matched both module hashes, principals and controller sets.

## Reviewer compatibility

The deployed reviewer hash identifies the archived PR #9 package from `88c0ef9594d45cbcbd7d3969414c5a28857cf443`. Public Candid metadata was unavailable. The interface was extracted from the Wasm whose install-package hash matched the certified observation. The deployed Wasm lacks the `compare_membership_context` and `membership_registry_role` updates required by the new frontend. The candidate interface passes Candid's backward compatibility check against the deployed interface. The reverse check rejects the missing method. The old frontend calls the existing policy, preview, detail, finalization and performance updates. [PR #9](https://github.com/aodl/IC_Widgets/pull/9)

## Prepare the release artifacts

Source revision `b8014c8d264928a3ed8f16338fb5d4dc9a494489` pins the production modules and their build inputs. Prepare the locked npm and Cargo dependencies and make `didc` and `candid-extractor` available. The verification command builds the two production canisters twice in independent clean source and target directories, checks the protobuf schema checksums and the extracted Candid, and compares the raw and gzip bytes. Run it with a fresh output directory.

```bash
CANISTER_ID_REVIEWER=s34gv-3qaaa-aaaar-qcifa-cai \
  ./scripts/verify-release-candidate.sh b8014c8d264928a3ed8f16338fb5d4dc9a494489 .local/release-candidate/release
```

The evidence directory contains the two builds, exact Candid interfaces, build log, tool versions and `SHA256SUMS`. The production reviewer build uses the default feature set and canonical sources. The release compiler wrapper maps each temporary source and generated Protobuf path to a stable name so diagnostic locations in the Wasm do not depend on the temporary directories. The frontend embeds the production reviewer principal and uses the SDK's pinned mainnet root. Use the hashes of the exact gzip bytes for the proposed installs. [Raw-host behavior](EMBEDDED_FRONTEND.md#raw-gateway-requests)

| Canister artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| Frontend raw Wasm | 1,873,295 | `c77bc8d6cbf7909b987a884f3a0cb1cd6a64a4a56729f6982aab59b7d3e344b1` |
| Frontend gzip install package | 707,373 | `d3c27e678ff4313972a781abafbd2ed8ef31f2824cd0b77adb85f02411cf73cc` |
| Reviewer raw Wasm | 4,849,960 | `92cbdb1bd873f1e1db7b8a7eb937355f90c165082a7a00fbb8dfb82d58e95703` |
| Reviewer gzip install package | 918,015 | `bb0b3cf4d08267f1262eac26d6cde1d34b2e0b8f0331d525dd7faaab0efe21db` |

Both independent builds produced identical raw Wasm, gzip and extracted Candid files. The build environment used Rust 1.96.0, Node 24.15.0, Protobuf 3.12.4 and GNU gzip 1.10.

## Rehearsal evidence

The exact production frontend gzip matched its installed module hash on a disposable replica. The IC HTTP gateway delivered 11 independently verified v2 responses. GET and HEAD on the raw homepage and GET on both raw hashed assets returned empty 403 responses with no-store. PocketIC returned its own response verification error for the bare raw alias. Neither path served application assets. The restricted Chromium workflow on the embedded local profile completed proposal 144954 with ten reviewer calls, zero additional map or report calls and zero external requests.

The paired PocketIC rehearsal installed the two hash-matched legacy packages, upgraded the reviewer first and the frontend second, then restored the frontend first and the reviewer second. Both canisters kept their IDs and controller settings. It verified the three original frontend asset bodies after rollback. The reviewer retained the synthetic Registry cursor at 4,270, target 65,958, all nine fixture receipts and the retained 1,434-byte Governance reply. Its 1,793 stable pages were preserved, and the collector remained disabled and without a lease across the simulated 24-hour check. The exact candidate reviewer also ran the recorded Membership case against canonical system-canister IDs in a disposable replica. The new role and comparison calls, the legacy policy comparison, and final Governance verification passed. These tests use synthetic or recorded evidence.

## Proposed upgrade and rollback

1. Before an authorized change, recheck both certified module hashes, IDs and controllers. Retain the byte-matched prior gzip packages, certified frontend assets, and the reviewer checkpoint, collection state and evidence manifest. Check that the legacy collector remains stopped and that the recorded checkpoint agrees with the preflight observation.
2. Upgrade the existing reviewer in place using the exact candidate gzip with no upgrade arguments. Verify the installed package hash, controller settings, checkpoint and retained evidence. Check the legacy frontend with the upgraded reviewer and verify the candidate reviewer methods.
3. Upgrade the existing standard asset frontend in place to the exact embedded gzip using its normal upgrade hook. Check the installed package hash and controllers. Check the certified HTML and hashed assets, and verify the raw host refuses assets. Exercise Membership through the certified URL. A DFX frontend install prompts about the legacy asset-management methods being removed.
4. If both packages need rollback, upgrade the frontend back to the exact standard asset gzip first. Confirm the old certified asset bodies while the compatible candidate reviewer is still installed. Upgrade the reviewer back to its exact PR #9 gzip. Confirm the two hashes, controllers, reviewer checkpoint and retained evidence again. Both directions use in-place upgrades that preserve stable storage.

Use the exact artifact paths for these upgrades. An ordinary DFX rebuild can produce a different install package. After a reviewer upgrade or rollback, reload the frontend and start a fresh review. Active review sessions are transient and do not survive reviewer Wasm replacement.

This procedure retains the existing canister IDs, controllers, reviewer stable state and legacy asset storage. Artifacts are prepared for a separately authorized release. All rehearsal installs and upgrades use disposable local replicas. [Certified production URL](https://s45ab-wiaaa-aaaar-qcifq-cai.icp.net/) · [Public development preview](https://treaty-database-sizes-enforcement.trycloudflare.com/)
