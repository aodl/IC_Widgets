# Clear review local verification

## Recorded review

The local replay used membership proposal 144954, Registry 66,013 and the recorded Governance reply for policy motion 143190. A synthetic fixture role record binds this subnet to the NNS at the same pin. The observed motion status was Executed. This records a selected policy comparison with separate Governance and Registry observations. [Source manifest](SOURCES.md)

One Review action selected the configured policy reference with the reference field blank. Membership stayed at **40**, with one addition and one removal, and matched the sourced 40-node target. The table named **sh1** and **Digital Realty**, each at **3 (+1)**, and showed **zh2** at **0 (−1)**. The incoming and outgoing nodes share one recorded provider principal. Provider and facility groups above the ordinary cap depend on an unresolved exception. Registered country labels and owner names leave the country and DC-provider checks unresolved. Assignment checks covered **1 of 96** listed subnets. The final status was **Finished with gaps**.

The inspector showed the three resulting sh1 members, the **7.5% (+2.5 percentage points)** largest facility share and **12 (−1) groups** reaching the **14-node** threshold. The Markdown includes changed coefficients and a comparison of the proposer’s stated coefficients with the replicated values. Selecting a group highlighted its nodes on the map and kept the subnet denominator. The downloaded PNG and Markdown identify the accepted scenario and calculation. Chromium independently matched the exact calculation input SHA-256 and the raw Governance reply hash. [Markdown](artifacts/144954-review.md) · [Map PNG](artifacts/144954-map.png) · [Calculation input](artifacts/144954-calculation.didbin) · [Policy reply](artifacts/143190-governance.didbin) · [Checksums](artifacts/SHA256SUMS)

## Feedback and layout

| Viewport | Map canvas top | Page-wide overflow |
|---|---:|---|
| 1366 × 900 | 475 px | None |
| 1024 × 900 | 488 px | None |
| 390 × 844 | 600 px | None |
| 320 × 700 | 655 px | None |

The map appears before detail content. At 320 px only its upper portion is visible in the first viewport. The measurements include the local-fixture notice. [Desktop](artifacts/144954-1366.png) · [390 px](artifacts/144954-390.png) · [320 px](artifacts/144954-320.png) · [Held location page](artifacts/144954-loading.png)

Eleven controlled browser cases covered pending locations, Stop, supersession, failed metadata and targeted retry, required conflict, recorded execution, changed lifecycle, an unavailable final Governance read, a changed final action, selected-subnet enrichment and both proposal orders. In the held-page case, the first location request showed zero settled records and 41 pending locations. The shared missing sh1 coordinates reduced final mapping coverage to **38/41** and left its recorded grouping available. The open inspector and camera kept their selection and zoom. During retry, the previously accepted comparison remained visible with its retry label. A temporary final Governance failure kept the view provisional and required only a new verification call. Confirmed lifecycle and action changes blocked the result and export. The multi-subnet case read 50 node keys initially and reached 100 only after the second subnet was explicitly selected. The paired case settled six comparisons with shared record reads and exposed 51 versus 49 members at the selected intermediate steps.

Chromium also checked that the timer stops, help responds to hover, focus, click and Escape, and the inspector copies the full principal. The no-external-origin test denied all nonlocal requests and encountered none. The independent Performance route returned separate source receipts.

## Recorded local request measurements

One Review click showed membership after **1.575 s** and settled after **13.174 s**. Browser phase wall times were **1.291 s** for policy and role acquisition and **1.263 s** for the final Governance check. The canister receipt clocks reported zero elapsed milliseconds for these local source stages. These fixture measurements include browser and local replica work and provide no production latency estimate.

| Stage | Source calls | Reply bytes | Reviewer instructions |
|---|---:|---:|---:|
| Preview | 9 | 30,793 | 38,216,323 |
| Node registrations | 41 | 7,936 | 9,755,452 |
| Operators | 39 | 4,314 | 8,660,691 |
| Data centers | 39 | 2,159 | 6,684,462 |
| Selected policy and pinned role | 2 | 9,868 | 10,753,592 |
| Final Governance check | 1 | 12,764 | 9,064,198 |

This run used six detail-page updates and one replicated comparison with zero source calls. It recorded no failed reads. The forced-failure scenario retried one failed location key and reused the successful policy observation. The final lifecycle-change scenario blocked export even though the previous comparison had returned.

## Verification gates

- Thirteen frontend unit tests, the production frontend build, the recorded Chromium walkthrough and eleven Chromium scenarios passed.
- Thirty-seven Rust workspace tests and thirteen PocketIC tests passed via `./scripts/test-m0.sh`. The suites cover per-group breach transitions with an unchanged maximum, ordinary bounds and unresolved exceptions, and rejection of altered contextual metadata, mutation version, subnet kind, pinned version, policy digest and membership state.
- Host and Wasm Clippy, Rust formatting, pinned-source checks, generated Candid and JS binding checks, and Candid compatibility with the previous reviewer interface passed.
- The production release files and source commit are pinned by checksums. [Release notes and hashes](release/README.md)

## Exact-module upgrade rehearsal

The read-only mainnet check confirmed the deployed compressed module hash `9efc41f0c29ae1280522e6bf459a6f2c122ad24e7aff8a24c0367f73d7cbe9ec` and the two controller principals used in the rehearsal. PocketIC installed the matching archived artifact and upgraded to the exact candidate gzip `c117d3b1fb6b837fbf143cdc55a22c4e48137f7653b505daa71ae6b49ede0fde`.

The synthetic checkpoint stayed at **4,270 of 65,958**, unpublished. The test compared controller settings, stable memory size, disabled collector state, all nine source observations and the retained 1,434-byte Governance reply before and after the upgrade. No collection lease or new observation appeared across 24 simulated hours. This verifies upgrade compatibility against seeded state. The live checkpoint and collector were outside the read-only check. [Rehearsal command](release/README.md)

The uncoached owner walkthrough, full accessibility conformance and production timing remain open. The prototype and these local fixtures establish their respective observed behaviours. [Uncoached review worksheet](README.md#uncoached-walkthrough)
