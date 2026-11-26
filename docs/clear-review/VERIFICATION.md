# Clear review local verification

## Recorded review

The local replay used membership proposal 144954, Registry 66,013 and the recorded Governance reply for policy motion 143190. A synthetic fixture role record binds this subnet to the NNS at the same pin. The observed motion status was Executed. This records a selected policy comparison with separate Governance and Registry observations. [Source manifest](SOURCES.md)

Membership remained at **40**, with one added node and one removed node. The replicated result reported **Matches target** for the sourced 40-node size target. The largest recorded facility and DC owner groups each showed **3 (+1)**. Provider and country-label maxima remained **3**. Provider and facility assessments remain **Exception unresolved**. Owner and country-label assessments remain **Identity unresolved**. Assignment coverage remained **1 of 96**, so the final work status was **Finished with gaps**.

The browser inspected the three resulting sh1 members, the **7.5% (+2.5 percentage points)** largest facility share and **12 (−1) groups** reaching the separate **14-node** threshold. Selecting a group highlighted its nodes on the map and kept the subnet denominator. The downloaded PNG and Markdown identify the accepted scenario and calculation. Chromium independently matched the exact calculation input SHA-256 and the raw Governance reply hash. [Markdown](artifacts/144954-review.md) · [Map PNG](artifacts/144954-map.png) · [Calculation input](artifacts/144954-calculation.didbin) · [Policy reply](artifacts/143190-governance.didbin) · [Checksums](artifacts/SHA256SUMS)

## Feedback and layout

| Viewport | Map canvas top | Page-wide overflow |
|---|---:|---|
| 1366 × 900 | 461 px | None |
| 1024 × 900 | 452 px | None |
| 390 × 844 | 539 px | None |
| 320 × 700 | 662 px | None |

The map appears before detail content. At 320 px only its upper portion is visible in the first viewport. The measurements include the local-fixture notice. [Desktop](artifacts/144954-1366.png) · [390 px](artifacts/144954-390.png) · [320 px](artifacts/144954-320.png) · [Held location page](artifacts/144954-loading.png)

All eight controlled browser cases passed. They covered a held location page showing zero settled records, the open inspector changing from Loading to recorded evidence, Stop waiting for an accepted call, late-response supersession, targeted same-version retry, required conflict, observed execution and a lifecycle change during enrichment, and both proposal orders with shared records. The held fixture's missing sh1 coordinates affected all three member points and left the registered group evidence usable. The paired case settled six comparisons and showed 51 versus 49 members in the selected intermediate states.

Chromium also checked that the timer stops, help responds to hover, focus, click and Escape, and the inspector copies the full principal. The no-external-origin test denied all nonlocal requests and encountered none. The independent Performance route returned separate source receipts.

## Recorded local request measurements

One Review click showed membership after **1.709 s** and settled after **13.954 s**. Browser phase wall times were **1.353 s** for policy and role acquisition and **1.304 s** for the final Governance check. The canister receipt clocks reported zero elapsed milliseconds for these local source stages. These fixture measurements include browser and local replica work and provide no production latency estimate.

| Stage | Source calls | Reply bytes | Reviewer instructions |
|---|---:|---:|---:|
| Preview | 9 | 30,793 | 37,004,622 |
| Node registrations | 41 | 7,936 | 9,481,522 |
| Operators | 39 | 4,314 | 8,214,142 |
| Data centers | 39 | 2,159 | 6,066,302 |
| Selected policy and pinned role | 2 | 9,868 | 10,752,736 |
| Final Governance check | 1 | 12,764 | 9,042,915 |

This run used six detail-page updates and one replicated comparison with zero source calls. It recorded no failed reads. The forced-failure scenario retried one failed location key and reused the successful policy observation. The final lifecycle-change scenario blocked export even though the previous comparison had returned.

## Verification gates

- Twelve frontend tests and the production frontend build passed. Chromium passed the recorded walkthrough and eight controlled scenarios.
- Rust workspace and PocketIC suites, host and Wasm Clippy, formatting, pinned-source checks, production Wasm, generated interface and JS binding reproduction, and Candid compatibility with the prior reviewer interface passed.
- The production release files and source commit are pinned by checksums. [Release notes and hashes](release/README.md)

The uncoached owner walkthrough, full accessibility conformance and production timing remain open. The prototype and these local fixtures establish their respective observed behaviours. [Uncoached review worksheet](README.md#uncoached-walkthrough)
