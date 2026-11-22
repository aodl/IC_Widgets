# Network Nexus M1 acceptance report

## Delivered surface

- `diagnostics.rs`, `budget.rs` and `store.rs` preserve and budget the M0 probe. Memory IDs 0–3 keep their encodings. ID 4 supplies a separate format-tagged ledger.
- `ingestion.rs` owns one production dispatch lease and restores timers after upgrade. `evidence.rs` provides immutable source observations, content-addressed bytes and a bounded manifest.
- `registry_sync.rs` and `crates/ic-sources/src/projection.rs` implement fixed-target replay, chunk verification, publication and versioned reads for inventory, provider joins and assignments.
- `governance_archive.rs` retains full proposals, executable hashes, proposer claims and changed lifecycle observations.
- `metrics_archive.rs` retains subnet-scoped blockmaking samples, raw replies, gap and conflict evidence and per-subnet due times. Both application and remote source paths use the native management method.
- `reviewer.did`, the required CI workflow, the historical M0 interface and the shared PocketIC harness verify compatible builds. No source inputs are required from the ignored archives.

## Decisions

| Decision | Alternative considered and why it was rejected |
|---|---|
| Store sparse Registry history and gate it behind one publication version | Full materialized snapshots at every version multiply storage. A latest-only cache loses point-in-time inputs and historical joins. |
| Use the delivered cursor with a frozen bootstrap target | Tracking the reported head alone skips mutations. Replaying to a moving target makes initial completeness hard to judge. |
| Preserve one raw Governance or metrics reply and index related captures and samples | Separate duplicate storage of executable bytes or each node row would duplicate evidence. Reconstructing original rows from transformed data would lose wire provenance. |
| Share a serial dispatcher across independent durable workers | Extending the diagnostic step machine would entangle ongoing collection and operator probes. Separate source canisters and external schedulers add operational dependencies. |
| Bound retention by stable allocation and pause on pressure | Evicting evidence automatically before review references and retention policy exist could make an approved result irreproducible. |

## Verification

```bash
cargo fmt --all --check
cargo clippy --locked --workspace --all-targets --all-features -- -D warnings
cargo clippy --locked --workspace --target wasm32-unknown-unknown --all-features -- -D warnings
./scripts/test-m0.sh
```

The integration runner verifies the vendor SHA-256 manifest, builds the original M0 and current fixture Wasms in isolated target paths, and builds production Wasm. It requires Candid tooling, regenerates the interface, compares the committed file and checks compatibility with M0. The original M0 baseline rerun passed 8 unit and 3 integration tests. The full M1 suite adds four unit tests and four integration tests for a total of 12 unit and 7 PocketIC tests. The local old fixture SHA-256 was `d2e9a5c5da0ba4bccc368b5515c2f7724053b01ae288db0754c4c8aed89ec96c`.

The old-to-new upgrade test compared the original receipt and raw reply bytes after upgrade. A separate test held a real cross-subnet request outstanding while upgrading the old Wasm. Recovery charged the original attempt, retried once and committed one response. The suite exercised low cycles, exhausted cycle, call, byte, deadline and storage limits, staged Registry recovery, and a failed chunk followed by a successful repair. The native metrics test recorded three populated local samples before upgrade and four afterward, with four on the remote subnet. The resumed request used the previous native timestamp inclusively. It returned 279 bytes. In the fixture, bringing the collector up and polling its first successful and failed metrics statuses consumed about 376 million cycles, including Registry and Governance work in the same run. The original overlapping sample retained its hash and observation ID. An invalid subnet recorded its own rejection while valid subnets progressed. A separate stable-storage test covered conflicting overlap, missing days, changes in row presence and decreases in cumulative counters.

See the [Registry throughput and bootstrap analysis](EVIDENCE.md#bootstrap-sizing) for measured instructions, cycles, wire bytes and allocation. The transport sizing scenario of 90–350 billion cycles relies on three direct page samples and local pricing. The end-to-end live bootstrap and the live daily collection cost remain unmeasured.

## Source capability matrix

| Capability | Local evidence | Live evidence |
|---|---|---|
| Governance list, omission threshold, full lookup and missing ID | Verified with the released Wasm in PocketIC. Archive lifecycle and oversized cases passed against controlled wire responses. | Application-canister route blocked by deployment authorization. |
| Registry head, delivered cursor and ordered same-version writes | Verified with pinned Wasm and staged wire fixture. | Direct anonymous query verified at head 65,925. A pinned value matched the first wire entry at 33,019. Application-canister route blocked. |
| Registry joins and historical values | Verified on fixture and decoded across three direct production Registry sample pages. | Direct pinned spot read verified. Live projection bootstrap unverified. |
| Registry chunks | Verified locally, including more than four chunks and a hash mismatch. | Unverified. The anonymous page samples contained no selected chunked record. |
| Management `subnet_info` | Verified with native PocketIC same-subnet and cross-subnet replies. | Application-canister route blocked. |
| Management `node_metrics_history` | Verified with populated and empty native histories. Inclusive overlap, sparse rows, conflicts and gaps tested. | Application-canister route blocked. Fleet response sizes, retention and experimental schema limits remain unverified. |
| Exact uptime, independent IP geolocation and beneficial ownership | Unsupported by the evidence foundation. | No source established. |

The tested local production Wasm is 2,750,634 bytes with SHA-256 `c894e35b7d3fd74e7dc8153027d87260500004705d7e6d6b5187608111a9a700`. Its deterministic gzip install candidate is 577,929 bytes with SHA-256 `80c0ca61bd062f87393434490c1c690f8610c3fd55d43d0ee3bf21edd90c369f`. An authorized install should pin the compressed artifact actually supplied to the IC.

The [authorization and execution plan](OPERATIONS.md#live-verification-plan) lists the exact outstanding live steps. It requires an assigned funded application canister ID and subnet, an already authorized controller identity, the install mode, allowed cycles and duration, and selected proposal and subnet IDs.

## M2 sequence

1. Load a complete Registry version and the selected one or two archived proposal captures. Validate supported action payloads and source evidence.
2. Implement pure membership transitions, both orderings, typed errors, intermediate states and touched-node sets.
3. Generate registered geography and concentration summaries with explicit unknowns, plus a review revision bound to the source manifest.
4. Resolve the exact typed node scope consumed by the performance widget. Derive blockmaking measures from the subnet-specific archive with explicit continuity and coverage.

The frontend and public result certification are later work.

## Review checkpoints

- `b5d7d1e` — Probe hardening, migration tests and CI.
- `7a523fe` — Registry projection and shared evidence storage.
- `d619eba` — Governance capture and lifecycle archive, with isolated CI build paths.
- The feature branch tip adds the metrics archive and this report. [Feature branch](https://github.com/aodl/IC_Widgets/tree/codex/m1-evidence-foundation)
