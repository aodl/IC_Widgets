# Production latency baseline

The human assessment at 1348 × 926 observed useful widget content starting around 514 px down the page. Cold Activity took approximately 80 seconds after pressing Load activity. Membership took approximately 53 seconds on proposal 145075 and 52 seconds on 145074.

The already published 145075 smoke-test ZIP independently records 60 source receipts across 56.173 seconds between the first and last receipt. The comparison itself is an additional reviewer call. The UI timer and first-to-last receipt measurement have different boundaries. [Production review ZIP](https://github.com/aodl/IC_Widgets/blob/c1b437eadc7a73076ccc4c5caafd30b0f3c7535e/docs/composed-view/first-hosted-production-20261128/evidence/live-review.zip)

| Stage | Receipts | UTC interval |
| --- | ---: | --- |
| Membership preview Governance | 2 | 15:50:14.330 to 15:50:31.061 |
| Membership preview Registry | 11 | 15:50:17.025 to 15:50:28.378 |
| Node registrations | 15 | 15:50:37.143 to 15:50:43.091 |
| Operator/provider registrations | 15 | 15:50:49.800 to 15:50:52.723 |
| Data-center registrations | 15 | 15:50:57.040 to 15:51:00.121 |
| Pinned role | 1 | 15:51:04.012 |
| Selected-proposal final Governance verification | 1 | 15:51:10.503 |

The dated receipt windows identify cold latency in source acquisition and sequential request settlement. A new frontend cannot remove that work on a fresh verified comparison. The candidate eliminates full acquisitions triggered by presentation edits, reuses recent Activity directly, defers optional Performance until required work settles, and preserves a prior review summary during a revisit. It leaves Registry caching and cross-widget reuse of pending-proposal observations for a separate reviewer change. The exact-version Registry cache would need bounded in-canister retention and first-observation receipts carried forward. The existing per-caller reviewer context is replaced on a different selection, so an in-memory previous summary cannot safely authorize a report.
