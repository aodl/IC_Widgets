# Verification of the replicated voting-grade review

## Reference replay

The [capture manifest](../../tests/source-fixture/data/144954/capture.json) records the original Registry and Governance observations. The published browser artifacts use proposal 144954, subnet `tdb26`, scenario A independently, final step, and Registry version 66,013. Governance was originally observed Open on 25 November 2026 at 13:08:13.589 UTC. Displayed request times describe the local replay. The [downloaded Candid arguments](144954/calculation.didbin) match the digest in the [generated Markdown](144954/review.md).

The scoped preview simulated 40 → 40 members with 39 retained and checked 1 of 96 listed subnets. The last registered `zh2` member leaves the target subnet. The `sh1` data center and Digital Realty registered owner label each go from 2 to 3 members. The data-center, registered-owner and node-operator coefficients each fall from 13 to 12 at a 14-node threshold. The operator and owner are separate dimensions. The [methodology](../VOTING_GRADE_REVIEW.md) gives the complete comparisons and source limitations.

## Cross-subnet PocketIC measurements

The replay exercised the Candid entry points with a source canister on a separate subnet. The table sums the individual requests in each stage. Settled cycles are measured canister balance deltas. Peak reservation is the highest individual source batch reservation, distinct from spend.

| Stage | Source calls | Source bytes | Wall time | Instructions | Peak batch reservation (cycles) | Settled cycles |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Fast preview | 9 | 30,793 | 138 ms | 34,949,777 | 84,205,020,000 | 127,557,649 |
| Node registrations (2 pages, 6 batches) | 41 | 7,936 | 162 ms | 9,015,715 | 336,820,032,000 | 257,129,192 |
| Operators (2 pages, 5 batches) | 39 | 4,314 | 205 ms | 8,171,477 | 336,820,104,000 | 242,382,905 |
| Replicated comparison before data centers | 0 | 0 | 26 ms | 10,004,529 | 0 | 45,492,398 |
| Data centers (2 pages, 5 batches) | 39 | 2,159 | 151 ms | 6,045,784 | 336,819,609,000 | 233,452,323 |
| Replicated comparison with complete inputs | 0 | 0 | 31 ms | 17,988,450 | 0 | 61,538,750 |
| Total | 128 | 45,202 | 713 ms | 86,175,732 | 336,820,104,000 | 967,553,217 |

The replay used 119 detailed Registry calls and zero chunk reads. Both comparison updates consumed cycles and made zero source calls. Production latency and cycle consumption will be measured during the separately authorized browser acceptance test.

## Checks

- PocketIC verified pilot access, rejection of anonymous and unauthorized calls, absence of a public comparison query, rejection of an oversized payload and out-of-pin records, exact argument digests and distinct hashes for partial and full evidence. Geographic data can remain unavailable while provider and data-center results remain available. The delayed enrichment case preserves the independent preview.
- Chromium verified the shared table and Markdown values, exact Candid input digest, clipboard and PNG exports, all three map roles, zoom, keyboard interaction, and independent Node Performance. Changing the selected phase cleared the previous comparison, map and Markdown provenance. Returning restored the corresponding calculation and map link. The certified local replica completed the preview in **1.939 seconds** and enrichment in **12.252 seconds**, with a 1200 × 620 map and screenshots at 1360 px and 400 px.
- The exact previously deployed reviewer Wasm upgraded to the exact [candidate reviewer](release/reviewer.wasm.gz) in PocketIC. The rehearsal preserved cursor **4,270**, target **65,958**, the controller settings, disabled collector, 1,793 stable pages, nine synthetic observations and a 1,420-byte retained Governance reply across a simulated day. The previous module hash was `cf4eae5eaa8b56adf2c78cc6a7ec0af5cc9648db69cbccfb17d92e48da1dc1c3`.

The [draft PR checks](https://github.com/aodl/IC_Widgets/pull/5/checks) report hosted formatting, Clippy, Rust and PocketIC suites, Candid compatibility and frontend verification. All deployment work in this report is build or local rehearsal.
