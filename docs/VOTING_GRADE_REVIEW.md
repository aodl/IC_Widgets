# Voting-grade subnet membership review

## Legacy parity

The reference paths below refer to `Reference.zip`. The staging baseline is the code at `4ee610c2239d60c240d25e52d821041414e81e56`.

| Legacy capability | Reference | Staging baseline | This implementation |
| --- | --- | --- | --- |
| Proposal links, visible proposer rationale and exact add/remove lists | Razor proposal cards and final payload details | Proposal ID, action, status and node IDs | Links and observed Governance text, with the executable payload handled independently |
| Before/after members and many proposals affecting a subnet | C# `Existing`, `After`, proposal grouping | Pinned membership, independent proposals and both orders | Retains both orders, separate affected subnets and selectable intermediate stages across all review panels |
| Cross-subnet untargeted removals | C# expands assignments from the fleet list | Checks all listed subnet records for untargeted removals | Preserves broad membership coverage. Detailed geography is scoped to each affected subnet |
| Candidate already assigned, repeated instructions, overlapping pending changes | C# API assignment and CSV open-proposal lookup | Actual assignment and selected-step conflicts where evidenced | Existing concrete conflicts and assignment coverage are prominent. Other open proposals are outside the selected analysis |
| Cordoning and decommissioning alerts | C# searches summaries for “cordoned” and includes historical exceptions and a manual DC list | No authoritative cordon check | Displays Governance rationale as a claim. Verifies whether a named DC loses its last registered member in the selected subnet. Independent cordoning or retirement status is unavailable |
| Hardware generation, domain, OS and replica compatibility | C# IP/hostname CSV, hardware generation labels, selected OS/reward/release diagnostics | Candidate reward-type and SEV checks | Registered reward type, chip ID presence and pinned subnet rules; keeps simulator findings. Hardware generation/version compatibility beyond modeled Registry rules needs additional evidence |
| Unassigned, down and degraded views, health by provider | Razor fleet tables and C# API classifications | Node Performance counter snapshots and incomplete assignment coverage | Independent Node Performance is retained. The review distinguishes no assignment found from unassigned. Health assertions in proposal text are identified as claims |
| Distinct count of continents, countries, DCs, owners, providers and operators | C# characteristic count functions and Razor HTML/Markdown | Pure Rust support existed; no live topology input | Same six dimensions at the pinned version. A seventh registered locality dimension supports a limited comparison with proposer labels |
| Min/mean/max group size, changed duplicates and largest concentration | C# duplicate count functions, Razor tables | Distribution engine only | Before/after group sizes, percentages of all members, unknown counts and all entity deltas from the same data used for export |
| Nakamoto/limits and independent-party/DFINITY warnings | C# continent Nakamoto helper and Razor references to motion 137147, manual provider clusters and DFINITY name filters | Thresholds in pure engine, unavailable in live preview | Both explicit threshold conventions, per-dimension changes and largest-share increases. Common control, recovery capability and compliance with the motion require evidence beyond a label |
| Geographic distance and inferred disaster-resilience comments | C# pairwise distance based on IP locations and Razor interpretation | Pure engine only | Distances from registered DC GPS, including co-located pairs and explicit denominator. Reviewer can assess trade-offs without an overall verdict |
| Country discrepancies, reverse geocoding, IPv6 cache, country display | `IpLocation.cs`, `GeoName`, C# discrepancies and Razor black lines | Registered geography parsing in the engine | Geographic claims use registered region labels and valid GPS. An independent comparison with physical location is unavailable |
| Map colours, popups, co-located points, bounds and country fills | Razor Mapbox layers and node markers | No map | Bundled world land outlines, colour/role labels, clusters, keyboard-accessible marker details, zoom, pan, role filters and PNG export. Country changes stay in the distribution table |
| Alternative unassigned candidates and worldwide analyses | C# eligibility heuristic, provider stats, IP prefix clustering and DFINITY/US tables, map candidate layer | Outside Membership | Scoped findings preserve necessary evidence limits. Fleet-wide alternatives, clustering inference and unrelated reports are out of scope |
| Copyable forum review, commentary placeholders, map and member reference | Razor `# Proposal … Review`, `VOTE`, `TLDR`, map placeholder and member tables | No export | Editable vote and TLDR, preview, clipboard and file download, factual shared tables, and a field for the forum-uploaded map URL. Publication remains manual |
| Sources, dates and reproducibility | Razor source disclaimer and cached input files | Pinned version, Governance observations, advanced hashes | Captured observation provenance and advanced receipts per stage. Recorded fixture bytes are separate from the mainnet runtime |

## Interpretation

The first response still reads Governance and the scoped membership evidence with the original safeguards. It provides a usable preview even when the detailed analysis is never started. “Load detailed analysis” runs the second stage for the selected subnet and membership state. Each page accepts up to 24 distinct keys at exactly the preview’s Registry version and uses the existing eight-call batches, 120-second per-request deadline, bounded source waits, byte and call limits, and liquid-cycle floor. The browser walks nodes, distinct operators and distinct data centers. Provider principals come from the node-operator record. It renders an initial comparison after the operator reads and updates it after data-center reads. This involves no durable work, new canisters or new Registry collection. Node Performance continues to use its existing interface. As with the fast preview, a source page occupies the reviewer’s shared on-demand admission slot until it settles.

Detailed aggregation runs in a replicated update under the same pilot/controller authorization and on-demand admission slot. The calculation takes no source dependency, makes no stable writes and accepts at most 256 KiB of Candid input, 128 distinct members per state and 256 records per kind. The input contains the Registry version, subnet, membership preview revision, both membership vectors and the typed evidence. The backend checks that all supplied mutation stamps fit the pin and returns the analysis version and SHA-256 of the exact Candid argument bytes. The browser checks this digest before using the result for tables, maps or Markdown. Those outputs all use the snapshot submitted for that result, including when later reads or a later calculation fail.

The replicated result attests to calculation over the submitted inputs. Registry and Governance observations, recorded separately in the preview and paginated source receipts, provide the evidence for their origin. The Membership preview still controls proposal simulation and assignment coverage. Missing records remain unknown. Data-center IDs can still be available in operator records when owners and coordinates are missing. Explicit retry targets failed pages and calculations. Metadata enrichment leaves the checked-subnet count as observed in the preview.

For conventional subnet kinds, the strict one-third coefficient is the fewest descending groups reaching `floor(n/3) + 1`. The separate fault-budget column uses `floor((n-1)/3) + 1`. These can differ when the member count is divisible by three. A dimension without full coverage does not produce a coefficient. The map and distances use DC coordinates; co-located node pairs have distance zero. Registering the same owner label or locality does not establish common control or physical location. Distances and shares describe effects in different dimensions and are presented separately. The DRE comparator uses descending groups and a strict one-third threshold. [DRE method](https://dfinity.github.io/dre/decentralization.html), [pinned DRE calculator](https://github.com/dfinity/dre/blob/79066127f58c852eaf4adda11610e815a426878c/rs/decentralization/src/nakamoto/mod.rs).

The self-contained map uses Natural Earth 1:110 million land geometry at tag `v5.1.2`, rescaled for browser use by rounding coordinates to two decimals. Geographic evidence always uses the separately supplied Registry GPS, unaffected by the map simplification. [Natural Earth data](https://github.com/nvkelso/natural-earth-vector/blob/v5.1.2/geojson/ne_110m_land.geojson), [public-domain terms](https://www.naturalearthdata.com/about/terms-of-use/).

## Proposal 144954 evidence

`tests/source-fixture/data/144954/` contains the replica-signed public query replies, preserved as reply payload bytes, and per-record observation times and SHA-256 hashes. The test fixture replays these replies through the regular Candid and protobuf readers. The direct capture used the canonical Registry and Governance canisters and the standard IC agent. `get_value` was pinned to **66,013**. The Governance capture observed status **Open** at **2026-11-25 13:08:13.589 UTC**. PocketIC receipt timestamps describe the local replay; use the capture manifest for original source times. The captured payload matches the earlier live payload, SHA-256 `f2875737ce603f9f03b65366f23abd880fdba50e42e7f685ee2dbfb3815db37b`. The replay checks 1 of 96 listed subnets, with no finding that the incoming node is free across the other 95.

The selected step replaces `tg4ec-b2g4p-h42kd-k7zvb-6rls2-i2q7l-gtr4h-ymr6v-rrez4-w6fao-oqe` with `kaoz3-4okcl-24amq-v5y4k-vim56-4njvo-fwvyk-v4grq-kuqum-7zm3p-4qe` in `tdb26-jop6k-aogll-7ltgs-eruif-6kk7m-qpktf-gdiqx-mxtrf-vb5e6-eqe`. The baseline and hypothetical state each have 40 members, with 39 retained. At the pinned snapshot, the last `zh2` member leaves this subnet under the simulation. The count at `sh1` rises from 2 to 3. Registered owner labels show Everyware going from 1 to 0 and Digital Realty going from 2 to 3. Data-center and registered-owner Nakamoto coefficients each fall from 13 to 12 at a 14-node threshold. These are findings about the target subnet and its registrations. The decommissioning and health statements are the proposer’s. [Proposal 144954](https://dashboard.internetcomputer.org/proposal/144954).

| Registered dimension | Known groups | Largest group | Strict one-third Nakamoto coefficient |
| --- | --- | --- | --- |
| Continent | 6 → 6 | 17 → 17 | 1 → 1 |
| Country | 24 → 24 | 3 → 3 | 5 → 5 |
| Data center | 39 → 38 | 2 → 3 | 13 → 12 |
| Data-center owner | 39 → 38 | 2 → 3 | 13 → 12 |
| Node provider | 38 → 38 | 3 → 3 | 12 → 12 |
| Node operator | 39 → 38 | 2 → 3 | 13 → 12 |
| Area (third component of registered region) | 31 → 31 | 3 → 3 | 6 → 6 |

There are usable GPS coordinates for all 40 members in each state. All 780 pairs contribute to each calculation. The shortest distance stays at 0 km, the mean moves from 7,367.029 km to 7,361.847 km, and the longest stays at 19,461.421 km. Switzerland changes from 3 members to 2, and Sweden from 2 to 3. The provider is the same for both nodes. The operator changes to one already represented by 2 members. Both changed nodes have registered reward type 1.1 and no registered chip ID. These fields describe registration, with eligibility checked separately by the simulator.

The five printed DRE dimension values match the independent Registry grouping at a 14-node threshold. Using the five printed dimensions plus node operator independently reproduces the published mean (10.33 → 9.83) and mean log₂ (3.2655 → 3.2078) to the published precision. Node operator is an inferred sixth dimension. The proposal does not identify its exact full input and normalization. Registered owners and area labels are Registry strings. Country codes are normalized using the pinned ISO list.

## Reproduction and proposed deployment

Run `./scripts/test-m0.sh` for Rust, PocketIC, upgrade compatibility and Candid, then `npm --prefix web test`. The exact deployed-artifact rehearsal additionally takes `NEXUS_REHEARSAL_OLD` pointing to the compressed artifact SHA-256 `cf4eae5eaa8b56adf2c78cc6a7ec0af5cc9648db69cbccfb17d92e48da1dc1c3`. Set `POCKET_IC_BIN` to the PocketIC 14 server when required and run `cargo test --locked -p nexus-reviewer --test voting_upgrade -- --ignored --nocapture` after the suite has built both fixture and production Wasms. It seeds a synthetic record stream to cursor 4,270 with target 65,958 and compares settings, disabled collector state, manifest and retained evidence across the upgrade. The mainnet checkpoint is outside the rehearsal.

The Chromium smoke driver is `web/browser-voting-review.mjs`. It expects an isolated local DFX project on port 4966 with aliases `fixture`, `reviewer` and `frontend`, the test source Wasm running `load_voting_reference`, the reviewer built with `local-fixtures` and configured to call the fixture for both sources, and the frontend built with `DFX_NETWORK=local` and the local reviewer ID. It grants access to the browser's generated principal, tests review, export, scope transfer and standalone Performance, and writes browser captures. Invoke it as `node web/browser-voting-review.mjs /path/to/local/project /path/to/output` with Chromium and Playwright installed. The [144954 artifact index](review-artifacts/README.md) links the selected scenario’s generated Markdown, map, screenshots, exact calculation input and stage measurements.

Future deployment requires separate authorization. Build the reviewer with Rust `1.96.0` and the locked dependencies. Exclude `local-fixtures`. Build the frontend with `CANISTER_ID_REVIEWER=s34gv-3qaaa-aaaar-qcifa-cai` and production trust. Verify the release checksums, stage both artifacts, and verify controller sets, installed hashes, cycles and the disabled collector with cursor 4,270, target 65,958 and retained evidence. Compare to the signed-off mainnet record before any upgrade. The authorized backend install would be an upgrade from the exact audited Wasm and the asset sync would use a separate DFX project with a single `frontend` assets entry whose ID is `s45ab-wiaaa-aaaar-qcifq-cai`.

```bash
# Procedure for a separately authorized deployment.
sha256sum --check SHA256SUMS
dfx canister install --network ic --identity codex_local --mode upgrade \
  --wasm reviewer.wasm.gz s34gv-3qaaa-aaaar-qcifa-cai

cd frontend-only
mkdir -p assets
tar -xzf ../frontend-assets.tar.gz -C assets
jq -e '.canisters | keys == ["frontend"]' dfx.json
test "$(dfx canister id --network ic frontend)" = s45ab-wiaaa-aaaar-qcifq-cai
dfx canister install --network ic --identity codex_local \
  --mode upgrade --no-asset-upgrade frontend
```

Between the two operations, verify the new backend module and all checkpoint and settings invariants. Compare the certified frontend assets with the release bundle after synchronization.

For a live acceptance test, verify that the chosen proposal still supports prospective Membership review. Record the controller-observed balance, collector state, checkpoint and retained evidence before starting. Open the frontend in a fresh tab, enter the proposal ID and select **Review**. Record browser elapsed time and the source receipt counts, reply sizes, instructions, batch reservations and page outcomes. Wait for the request to settle before measuring the balance difference. Keep any failure in the record.

Check the selected scenario and pin in the decentralisation tables, map and PNG. Compare the copied Markdown with the displayed figures and verify the downloaded input’s SHA-256 against its published digest. Compare to the 66,013 reference where the new observations support equivalent metadata and membership, and explain any evidence changes. Finish by confirming that the collector remains disabled with no lease and that the checkpoint and evidence are preserved. A production incompatibility can be recovered with separately authorized upgrades using the prior compressed reviewer Wasm and frontend bundle after checking evidence compatibility.
