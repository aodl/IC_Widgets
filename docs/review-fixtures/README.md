# Historical review fixtures

Start the ordinary Network Nexus frontend and reviewer against committed local inputs.

```bash
./scripts/dev-review-fixture.sh --case nns-144954-recorded-open
```

Open the printed URL and click **Review**. The **Replay scenario** menu switches between preloaded contexts and fills the proposal IDs. Wait for the new page before clicking **Review**. The replay uses the same staged review, map, policy comparison and export as the ordinary application. Each menu entry has an isolated local reviewer and source-canister instance. Switching pages supersedes the old browser session and never changes another case’s records.

The launcher defaults to port 4971. Use `--port PORT` for a separate project or add `--single` to provision only the starting case. Use the printed `dfx stop` command to stop the isolated replica. Starting again creates a fresh project under `.local/review-fixtures.*`. Once stopped, the specific printed project directory can be removed.

Provision the pinned Rust toolchain, Wasm target, DFX 0.31, `codex_local` identity, Protobuf compiler, `candid-extractor` 0.1.6 and Node dependencies before going offline. Run `dfx cache install`, `cargo fetch --locked` and `npm --prefix web ci` during setup. The launcher builds with `cargo --offline`, uses caching across selections, and requires the existing DFX runtime. If `POCKET_IC_BIN` is configured, it checks for the prepared 14.0.0 executable. Browser replay uses the DFX-bundled local replica. Focused Rust integration tests use the separately prepared PocketIC server.

The browser signs its local updates with a fresh in-memory identity. The launcher uses a reviewer feature that accepts these identities only when Governance and Registry both point to the same explicit noncanonical fixture source. Ordinary local-fixture tests still exercise the pilot admission path. The production build rejects source overrides, the fixture loader requires a local controller, and the production frontend bundle excludes the menu and corpus.

## Evidence matrix

The [catalogue](../../tests/source-fixture/data/catalogue.json) indexes 25 exact public API response bodies and their original receipts. The [case manifests](../../tests/source-fixture/data/historical/replays.json) distinguish executable-action source, Registry baseline and lifecycle. [Expected states](../../tests/source-fixture/data/historical/expected.json) specify full member sets and changes for each order and step. Synthetic sets were computed offline from the declared fixture rosters and action vectors, independently of the production simulation.

| Examples | Available coverage | Evidence limits |
|---|---|---|
| 144954 recorded Open | Full resolver, map, policy and export. The subnet retains 39 of 40 members in a one-for-one replacement. One of 96 memberships is checked. | Recorded pre-execution review snapshot at Registry 66,013, selected records only. The role binding is a synthetic `nns_subnet_id` supplement. The actual execution the following day belongs to a separate indexed observation. |
| 144954 terminal and fault variants | Indexed Executed state, slow locations, missing shared coordinates, rejected location reads and phase-triggered Governance changes | Replay timing and intentional faults are local. The repository’s original Open reply, Registry and provenance files retain their exact bytes. |
| 144940, 135053, 142931, 132483 | Multi-node swap, empty removal vector, empty addition vector, unequal counts, constructed Adopted variant | Indexed action re-encoded as fixture Candid over a synthetic Registry and a declared lifecycle transformation. |
| 85612 and 85622 | Both hypothetical orders, each intermediate state and exact full principals | Synthetic rosters supply the function-13 target. The source records describe separate executed proposals in the order 85612 then 85622. |
| 140988 and 139792 | Failed and Rejected terminal states. An absent outgoing node rejects the constructed prospective 140988 variant | The raw captures preserve the supplied failure reason and terminal statuses. |
| 132102 | Synthetic one-subnet, two-subnet, zero-match and incomplete-list variants | The action supplies three nodes, with no target subnet. The distribution is constructed. The pinned mutation removes matches from listed memberships and can perform a no-op. |
| 134902, 134993/134994, 140279/140280, 130714, 135310, 144909 | Boundary payload classification, original statuses and failure text, version deployments distinguished from pool membership, and distinct boundary and NodeRecord keys | Payload and state tests only. The browser and production resolver provide no Boundary widget or historical pool reconstruction. The indexed execution order for the second pair is 140280 then 140279. |
| 142743, 48615, 144681, 143100, 144850, 144865, 144939 | Adjacent payloads and classification guard cases. 48615 retains a missing failure reason. 143100 retains null replacement nodes. | The 144939→144954 cross-subnet dependency has no replay. Bounded API queries for SplitSubnet and MergeSubnets returned no indexed cases. |

Synthetic data-center coordinates and provider associations are local constructions. An explicitly missing key and an uncaptured key use different wire outcomes. Synthetic versions 99 and 100 exercise older record mutations at the pinned version. The chunk cases use byte-addressed synthetic data, with an explicitly corrupted variant. The recorded policy reply for #143190 is a selected reference. Current policy applicability and later amendments remain unverified.

The original 144954 Governance reply was observed at 13:08:13.589 UTC on 25 November 2026. The separate policy reply was observed at 07:24:41.619 UTC on 26 November. PocketIC starts from the manifest clock and advances deterministically. Interactive replica receipt times are local observations. Both paths preserve original source payload timestamps and replay provenance.

## Verification commands

```bash
python3 scripts/check-review-corpus.py
./scripts/test-m0.sh
npm --prefix web test
CANISTER_ID_REVIEWER=aaaaa-aa npm --prefix web run build

# After the Wasms and named PocketIC executable have been prepared
POCKET_IC_BIN="$PWD/.local/pocket-ic-14/pocket-ic-server" NEXUS_M0_TEST=1 \
  cargo test --locked -p nexus-reviewer --test historical_replay -- --ignored --nocapture

# With Playwright available and the full menu project running
node web/browser-historical-replay.mjs /absolute/local-project /absolute/output
```

The browser driver denies every nonlocal origin. It opens the menu, runs recorded and constructed reviews, inspects changed nodes, checks terminal execution, holds a location request, tests returning to an already calculated subnet and verifies export against the calculation input digest.

The existing regular CI validates the raw corpus, runs the named PocketIC matrix and checks the production bundle. Initial dependency installation and preparation of CI system-canister Wasms are separate from replay. The corpus validator and replay perform no indexed API calls or live Registry fetches.

The starter pack’s discovery experiments used identical filters across pages and carried the returned `max_proposal_index` unchanged. The API returns that marker separately from both identifiers in each proposal row. The catalogue uses the NNS `proposal_id` and preserves only the reviewed captures. [API schema](https://ic-api.internetcomputer.org/api/v3/openapi.json)

## Browser captures

- [Recorded NNS replacement on desktop](artifacts/recorded-desktop.png) and [at 390 pixels](artifacts/recorded-mobile.png)
- [A held location request](artifacts/loading-locations.png), [missing coordinates after settlement](artifacts/missing-locations.png) and [an executed proposal](artifacts/executed-terminal.png)
- [The removal-first intermediate state](artifacts/constructed-intermediate.png)
- [Exported Markdown](artifacts/recorded-review.md), [exact calculation input](artifacts/recorded-calculation.didbin) and [checksums](artifacts/SHA256SUMS)

The six-case replay walkthrough and eleven existing browser scenarios passed. The recorded review matched the exported calculation digest and showed 41 mapped points across both membership states. Holding a reply kept the coordinates in the pending count. The missing shared coordinates left 38 of 41 points mapped after settlement. Returning to the calculated subnet reused its comparison and delayed export until final Governance verification. The replay walkthrough attempted zero nonlocal requests.

The focused PocketIC matrix passed all 23 named cases and preserved the Registry and collection checkpoints. These measurements cover its preview update after loading the fixture. They use local PocketIC pricing and exclude policy comparison and browser enrichment.

| Case | Source calls | Reply bytes | Reviewer instructions | PocketIC cycles |
|---|---:|---:|---:|---:|
| 144954 recorded Open at Registry 66,013 | 9 | 30,793 | 36,128,255 | 128,718,875 |
| Separate 85612 and 85622 at synthetic Registry 100 | 11 | 3,106 | 22,032,297 | 97,848,001 |
| 144909 rejected as an unsupported Membership action | 1 | 815 | 841,775 | 20,313,676 |

The upstream contracts used here are pinned source semantics. The deployed Registry versions that executed these historical proposals remain unverified. [Governance numeric functions](https://github.com/dfinity/ic/blob/ec91fdf7729bcac13251f12d27014ac3e944ffb3/rs/nns/governance/proto/ic_nns_governance/pb/v1/governance.proto) · [Function 13](https://github.com/dfinity/ic/blob/ec91fdf7729bcac13251f12d27014ac3e944ffb3/rs/registry/canister/src/mutations/do_remove_nodes_from_subnet.rs) · [Function 31](https://github.com/dfinity/ic/blob/ec91fdf7729bcac13251f12d27014ac3e944ffb3/rs/registry/canister/src/mutations/do_change_subnet_membership.rs) · [Boundary add](https://github.com/dfinity/ic/blob/00e4d8e3ee6081c1862e6119d63cffa76bd4af3d/rs/registry/canister/src/mutations/do_add_api_boundary_nodes.rs) · [Boundary removal](https://github.com/dfinity/ic/blob/00e4d8e3ee6081c1862e6119d63cffa76bd4af3d/rs/registry/canister/src/mutations/do_remove_api_boundary_nodes.rs) · [Boundary invariants, including optional IPv4](https://github.com/dfinity/ic/blob/00e4d8e3ee6081c1862e6119d63cffa76bd4af3d/rs/registry/canister/src/invariants/api_boundary_node.rs)
