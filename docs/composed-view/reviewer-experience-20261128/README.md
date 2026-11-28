# Reviewer experience release candidate

This candidate changes the Network Nexus host, Subnet Activity, Membership Inspector and Node Performance. IC Node Map continues serving its existing package. The shared reviewer and standalone IC Widgets frontend stay on their existing releases. No production changes were made.

The host keeps frames and accepted outputs through edits, view re-selection, layout changes, reordering and saving. It retains at most two views in memory and saves configuration separately. The prepared dashboard puts Activity, Membership and the map in the first desktop row. Editing is a separate mode. Narrow screens offer widget jump controls. Three columns is recorded as an optional preference on the existing two-column layout, so the previous host can reopen the same saved dashboard in two columns.

Activity starts on arrival, shows the last accepted observation and its age, and lists proposal titles, action types and voting deadlines. The inspector shows the source-attributed purpose, calculated membership changes, risk findings and a visible report action. Report generation requires the accepted calculation and selected-proposal Governance verification. Cross-proposal evidence can still be pending or incomplete. The frozen report records that qualification. Performance waits for the inspector’s initial cross-proposal source work and can retry the same bounded filter through the sandboxed button.

See the [composition and cache boundaries](../COMPOSED_VIEWS.md#reviewer-workflow) for storage, freshness and provenance.

## Deployment proposal

Use only the four exact gzip packages and their current canister IDs in the manifest. Upgrade Subnet Activity, Membership Inspector and Node Performance on the European application subnet, then upgrade the Network Nexus host on the Fiduciary subnet. Verify each installed digest and its certified assets. Check the prepared dashboard and a blank workspace, automatic discovery, one eligible review if available, report export and the exact Performance scope. If rollback is needed, restore the previous host first and then the changed widgets. The prior frontend packages remain at [the first hosted candidate](https://github.com/aodl/IC_Widgets/tree/580d94288909518ecf8c62294cd1b5e5f0c58dca/docs/composed-view/first-hosted-install-candidate). The communication protocol and public Candid interfaces are unchanged and the browser retains no review tokens in storage.

Recheck controller sets, placements, settings, cycle balances, approved install packages and rollback packages before any authorization. The read-only balance observations in this record are from 28 November 2026. With the original Fiduciary estimates of 784.63B cycles for refundable install prepayment, about 71.21B cycles for freezing reserve, and about 12.48B cycles of net install-window expenditure, the observed 902.30B-cycle balance would leave about 34B cycles above one fallback prepayment and the reserve after upgrade. That is roughly 14 days at the reported 2.37B daily idle burn. A delay or higher install cost reduces the margin. No funding conversion or transfer was performed.

The disposable rehearsal installed the four previous packages, upgraded in the proposed order, verified 23 certificate-v2 responses and exact-origin browser isolation, then restored and checked the previous digests in reverse order. The gateway proof used the exact production gzip packages and intercepted the expected IC protocol request before any mainnet traffic. [Gateway checks](evidence/gateway-verification.json) · [Upgrade and rollback](evidence/upgrade-rollback.log) · [Module status](evidence/upgrade-status.txt)

## Reproducing the packages

Use the exact revisions and catalogue in [the manifest](manifest.json). Prepare the locked dependencies with `npm --prefix web ci` in IC Widgets and the pinned Rust toolchains in both checkouts. Build the widget profiles `activity`, `inspector`, and `performance` with `scripts/build-frontend-wasm.sh`. Set `DFX_NETWORK=ic`, `CANISTER_ID_REVIEWER=s34gv-3qaaa-aaaar-qcifa-cai`, `IC_WIDGET_HOST_ORIGIN=https://5i3qr-tyaaa-aaaar-qcjaq-cai.icp.net` and the respective `IC_WIDGET_EMBED_VIEW`. Use `CARGO_INCREMENTAL=0` and leave replay variables unset.

For the Network Nexus host, build with `DFX_NETWORK=ic`, `CARGO_INCREMENTAL=0` and `NEXUS_HOST_CATALOGUE` set to the absolute path to this record’s `catalogue.json`. Run `cargo build --offline --locked --release --target wasm32-unknown-unknown` and compress `network_nexus_frontend.wasm` with `gzip -n -c`. Compare compressed bytes and the uncompressed Wasm against the manifest. [Build and interface verification](evidence/build-reproducibility.txt)

## Reviewer walkthrough

The fixture walkthrough covered opening the dashboard, automatic Activity, choosing a proposal, reading its stated purpose, inspecting the same independent map, preparing a review and adding a reviewer conclusion. Chromium read back the copied Markdown and downloaded a ZIP containing `review.md` and `map.png`. Frame identity, the selected review and accepted evidence survived presentation edits with zero additional reviewer calls. An actual click on the embedded Performance retry sent one request with the same 41 identities. The finite-scope regressions cover 41 related nodes for 144954, seven for 144940 and exactly five when Proposed is selected for 144940. Native blockmaking samples are unavailable on these subnet fixtures. The busy and superseded paths were tested with a bounded retry and cancellation.

## Timing interpretation

The previous production assessment observed about 80 seconds for cold Activity and 52–53 seconds for the two Membership calculations. Those timings are from mainnet. Browser timings below are from a disposable gateway with recorded evidence and fixture supplements. They bound frontend restoration and illustrate request ordering. They do not measure mainnet latency for the candidate. [Production receipt analysis](evidence/latency-baseline.md)

The earlier functional rehearsal, before visual polish, showed the cold progress state in 482 ms, accepted Activity in 956 ms, warm Activity after reload in 1.49 s, the authoritative proposer statement in 1.07 s, verified Membership in 4.28 s and a previous comparison summary on repeat selection in 157 ms. Performance settled in 5.75 s with an explicit source limitation. The Activity refresh took 5.09 s. The cold Activity receipt recorded six admitted source reads. A warm reload and presentation edits made zero new reviewer calls. [Measured trace](evidence/interaction-run-before-visual-polish.json)

Fresh verification still incurs sequential source work. The browser-local queue cache gives an immediate observation when available. Returning to a recent review gives a labelled prior comparison and retains its draft, while the inspector reacquires a valid reviewer context and fresh final verification. It does not export a new report from an older comparison summary.

The composed walkthrough with the final IC Widgets presentation recorded 1.20 s to cold progress, 3.13 s to Activity, 4.33 s to warm arrival including full page reload, 1.73 s to the proposer statement, 10.01 s to verified Membership, 12.36 s to a settled Performance source limitation, 3.16 s to Activity refresh, and 174 ms to restore the previous review summary. Warm reload and presentation edits each made zero new reviewer calls. Across the entire multi-case run there were 79 reviewer calls, including six final Governance checks. The browser verified 28 certified responses and observed zero unauthorized requests. [Final composed browser trace](evidence/composed-browser.json)

| Walkthrough captures | Evidence |
| --- | --- |
| Arrival | [Cold loading](evidence/screenshots/activity-cold-arrival.png) · [Warm queue](evidence/screenshots/activity-warm-arrival.png) |
| Review | [Desktop](evidence/screenshots/activity-review-desktop.png) · [Tablet](evidence/screenshots/review-tablet.png) · [390 px review navigation](evidence/screenshots/dashboard-mobile.png) |
| Editing and publication | [Dashboard editor](evidence/screenshots/dashboard-editing.png) · [Review editor](evidence/screenshots/review-export-editor.png) · [Generated review ZIP](evidence/144954-review.zip) |

The final IC Widgets browser walkthrough used Network Nexus `11eb4cca809517aa6f4687d02166cf5f57269179`. The release host adds one further reconciliation fix at the manifest revision. Host tests cover an unchanged typed value retaining its live revision after a saved document strips the transient field. The exact candidate and the previous host packages were checked with the same catalogue contract.

## Standalone and catalogue

The standalone gateway regression verified all 45 permanent catalogue routes, 126 certified responses, and the bundled cases with zero live reviewer calls and zero unauthorized requests. The November burst retained its incomplete one-page Governance observation. Queue navigation reached proposal 145076 in 1.05 s and verified its review in 4.68 s in the fixture, then returned to 145077. The standalone candidate build predates the final presentation-only queue and proposer excerpt polish. The standalone mainnet package stays on its production revision. [Catalogue and navigation trace](evidence/standalone-browser.json) · [Recorded burst](evidence/screenshots/recorded-burst-navigator.png) · [Resilience warning and report](evidence/screenshots/review-checks-four-replacements.png) · [Warning ZIP](evidence/review-checks-four-replacements.zip)

Network Nexus passed five JavaScript tests and its unrelated Palette browser workflow. IC Widgets passed 43 JavaScript tests. Both exact runtime revisions passed hosted CI. All disposable gateway processes were stopped. [Network Nexus CI](https://github.com/aodl/Network_Nexus/actions/runs/46172126454) · [IC Widgets CI](https://github.com/aodl/IC_Widgets/actions/runs/46171624365)
