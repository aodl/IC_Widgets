# Subnet Activity and review checks

The frozen implementation is `5aeece635652ddccdfbb87ae2a2a4ac892670e96`. [Initial hosted run for the exact source](https://github.com/aodl/IC_Widgets/actions/runs/46074044777) · [Separate catalogue production release](https://github.com/aodl/IC_Widgets/tree/5f0f11ef98a99a4983a2b6015917f8b3fc911b34/docs/release-candidates/catalogue-4cdb714/production) Activity adds a new optional review response field and a bounded reviewer update. The production reviewer still uses its canonical Governance, Registry and management sources. The legacy collector and stable-state schema are unchanged.

## Governance observation

Subnet Activity uses one descending discovery scan across public topics for Open and Adopted proposals. Adopted rows require no execution or failure observation. The overview lists supported Membership proposals and known interactions without starting their Registry reviews. Opening a review runs one all-topic scan for the selected proposal IDs together. It checks exact requested incoming and outgoing principals against a per-request index of other proposals. Findings retain separate roles for supported executable payloads and exact principal text in titles, summaries and motion bodies.

The scan requests public Open and Adopted proposals without topic or reward-status filters. It starts at ten results per page, advances with the smallest observed proposal ID as an exclusive cursor, and may reduce the page size on a response-size rejection. An observed empty page establishes pagination completion. There are up to 14 page attempts, a two-minute request deadline and a 4 MiB source-reply budget. A scan spans an observation window, so proposals can change lifecycle or arrive while it runs. Hydration uses the later observed lifecycle and counts rows that leave scope. Executed or failed proposals are excluded, even if their reward status still accepts votes.

An omitted action or empty executable payload is eligible for a separate `get_proposal_info` read. Hydration covers up to 72 proposals in batches of eight, independent of the number of selected nodes. The executable decoder recognizes membership functions 2, 13 and 31, create-subnet function 1, Registry node removal 18 and API boundary-node functions 43, 44, 46 and 47. Other executable actions count as unsupported. Their available proposal text remains searchable. A result can report completeness only after pagination completes and the scan has no source issues, unsupported actions, missing or malformed payloads, or findings omitted by the 256-result cap.

Text matching checks proposal title, summary and supported motion body. It splits on characters other than ASCII letters, digits and hyphens, then compares complete case-folded tokens to the requested canonical principals. Abbreviations and substrings do not match. A text match only establishes that the principal appears in the available text. An executable match identifies a principal in a supported decoded node field. The report keeps these roles distinct.

The selected review keeps its original Registry pin, calculation and final lifecycle check. Discovery has its own timestamps, source receipts and coverage. Findings warrant inspection by the reviewer and carry no voting inference.

## Instruction integrity and transition model

The reviewer reports duplicate raw Add and Remove principals, overlap and evidence for preconditions while preserving the original simulator. Each simulated transition compares the immediately preceding unique roster with the next unique roster. The before-state treats effective departures as unavailable and the proposed state treats effective arrivals as unsynchronized. For each side the remaining fault budget is `floor((N - 1) / 3) - modeled unavailable`. The smaller value applies. A margin of one means one additional fault is tolerable and two would exceed the budget. Zero means the next fault exceeds it. A negative margin means the budget is already exceeded.

For unequal changes, let `B` and `P` be the unique before/proposed member sets. Evaluate `f(|B|) - |B \ P|` for departing members in the before-state and `f(|P|) - |P \ B|` for not-yet-synchronized arrivals in the proposed state. The reported margin is the minimum. Effective differences exclude duplicate instructions and account for overlap using the simulator’s existing outcome. Equal-size replacement of `R` members reduces to `f(N) - R`.

For combined proposals the current check evaluates each affected subnet against the immediately preceding simulated membership in each order. Earlier arrivals that remain in that roster are treated as available at the next step. If they are still synchronizing, consecutive transitions can overlap and the reported per-step margin can overstate the remaining fault budget. The implementation has no synchronization-time evidence and does not carry earlier unavailable arrivals into later steps. The combined figures apply only to the modeled individual steps.

The resilience result is conditional on the modeled availability assumptions and is separate from concentration thresholds. It does not establish observed health or actual liveness. Targeted Registry review sometimes leaves incoming assignment outside the searched roster unresolved. In that case the margin is unavailable. The review retains the precondition and scope limitation.

## Cases and evidence

Three additional interactive catalogue cases use synthetic Governance and Registry evidence. They cover the 13-node examples, executable and textual references across topics, adopted and executed branches, missing payloads, duplicate and overlapping instructions, and both orders of a growth/shrink sequence. Historical cases without recorded discovery explicitly mark the cross-proposal check incomplete. See the [read-only sample of five Open mainnet proposals](governance-2026-11-27/README.md) for unbundled development evidence captured before their lifecycle changed.

Connected proposal-view Performance follows the exact before/proposed union by default. The producer offers explicit alternatives without the connected consumer broadening the request. See [composed view scope](../COMPOSED_VIEWS.md).

The capture generator accepts case IDs after the output filename. Regenerate batches against separate disposable reviewer installs to stay within the public request allowance. Combine their case maps only when the generated versions and input fingerprints match.

## Replicated verification

The first hosted run stopped at native Clippy because the independent corpus test had no path for the new synthetic fixture records. The review branch updates that test to validate omitted list payloads and use the same synthetic proposal decoder as the fixture. The branch also uses an equivalent Option conversion in the existing subnet snapshot resolver to satisfy Clippy. The report, calculations, fixture runtime and public interface retain the frozen functionality. [Review branch workflow runs](https://github.com/aodl/IC_Widgets/actions/workflows/check.yml?query=branch%3Acodex%2Fsubnet-activity)

The historical replay suite passed through the source fixture and production-source protection. The accepted comparison outputs matched the published catalogue across all 12 earlier interactive cases. The three new cases returned the following results from the disposable reviewer.

| Synthetic case | Remaining modeled margin | Governance discovery |
| --- | --- | --- |
| Three replacements, 13 members | 1 | Four exact references, including a textual motion and executable relationships in other topics. Two Adopted proposals listed. |
| Four replacements, 13 members | 0 | Pagination settled. One executable payload stayed missing after hydration, so discovery remained incomplete. |
| Combined growth and shrinkage, 6 before | A then B gives 0 and −1. B then A gives −2 and −1. | Raw duplicate Add and Remove principals and their overlap survive the simulation. |

Each selected discovery fixture used four Governance reads and zero Registry reads.

The [composed-view rehearsal](evidence/composition.json) verified 22 certified responses and exercised the same independent map for all three views. It inspected the exact Performance principals sent for the existing 40-node roster, the 41-node 144954 union and the seven-node 144940 union. The explicit 144940 proposed filter sent five principals. The generic host required no changes.

The [network-restricted Chromium run](evidence/catalogue.json) verified 111 certified gateway responses and all 40 catalogue entries. Interactive test cases made zero reviewer requests and the suite made zero external application requests. The same run exercised Subnet Activity and its Review action against the disposable reviewer. The [overview capture](evidence/subnet-activity.png), [cross-proposal references](evidence/review-checks-three-replacements.png), [zero-margin and incomplete-discovery warnings](evidence/review-checks-four-replacements.png) and the generated review ZIPs for [three replacements](evidence/review-checks-three-replacements.zip), [four replacements](evidence/review-checks-four-replacements.zip) and [combined steps](evidence/review-checks-combined.zip) show the results. The 32 frontend tests also passed.
