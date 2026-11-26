# Implementation status

## Historical review fixtures

The local launcher serves the ordinary frontend and reviewer with a named scenario selector. It uses the recorded 144954 snapshot and indexed actions adapted to explicit synthetic Registry and lifecycle cases. Boundary actions have offline payload coverage. [Setup and evidence matrix](review-fixtures/README.md)

## Factual composition and individual-node map

Membership reports completion separately from evidence coverage and compares exact registered groups without selecting a policy motion. The map shows one marker per located node, with registered facility enclosures and connectors for displaced markers. PNG uses the same scene. The pinned Registry establishes the NNS role, and Governance is checked again after enrichment. [Walkthrough and source scope](clear-review/README.md)

## On-demand membership and performance

Membership now resolves the target subnets and proposal-candidate records at a pinned Registry version. An untargeted removal still resolves every listed subnet membership. The result identifies the checked and total listed subnet counts and distinguishes known assignments from unknown assignments. The same simulation calculates both execution orders and retains the final Governance recheck. Node Performance can use the preview's scope as a filter. [Architecture](ARCHITECTURE.md) · [Local use](../web/README.md)

### First mainnet run

Proposal 144954 pinned Registry version 66,005. The request ended at `Deadline` after 119.822 seconds on-canister, 237 source calls, 71,065 reply bytes, 263.54 million reviewer instructions and a settled decrease of 4.254 billion cycles. Governance replied 2.363 seconds after the start. The final eight data-center reads expired, before the Governance recheck. The retained excerpt gives exact method totals and the final batch, without the intermediate receipt timestamps. The stage split uses the earlier 95-subnet roster observation, the 40 members implied by the proposer's table plus one addition, and the table's ordered data-center names. Times allocate the remaining observed time proportionally across reconstructed batches.

| Stage | Calls | Sequential batches | Approx. elapsed |
|---|---:|---:|---:|
| Governance and Registry head | 2 | 2 | 6 s |
| Subnet roster and memberships | ~96 | ~13 | 45 s |
| Node and API-boundary records | ~82 | ~12 | 41 s |
| Operator records | ~41 | ~6 | 21 s |
| Data-center records | ~16 | ~2 | 7 s |
| Registry chunks | 0 | 0 | 0 s |

The executable Governance payload, Registry pin and target memberships support the membership calculation. The roster confirms targets and bounds assignment coverage. Other listed memberships and candidate node and API-boundary records strengthen checks for assignments, existence and eligibility. In the old request, retained-node records also supported validation of resulting members. Operator and data-center reads supplied provider, concentration and geography data. The scoped preview leaves retained-node eligibility and assignments outside checked subnets unverified.

### Revised local preview measurements

Cross-subnet PocketIC with a synthetic 24-subnet roster and automatic rounds. The replacement read one 50-member subnet and two candidates. The pair included an untargeted removal and evaluated both orders against the same 24-subnet footprint.

| Case | Calls | Batches | Reply bytes | Wall time | Instructions | Settled cycles |
|---|---:|---:|---:|---:|---:|---:|
| Targeted replacement | 9 | 7 | 3,315 | 1.46 s | 17.88 M | 82.48 M |
| Pair with untargeted removal | 34 | 9 | 39,897 | 1.57 s | 104.71 M | 344.15 M |
| Untargeted removal across two affected subnets | 32 | 9 | 39,357 | 1.48 s | 58.67 M | 284.72 M |

Replacement measurements from a temporary instrumented Wasm. Stage latency comes from replica timestamps. Read-stage instructions cover dispatch and receipt processing. Decoding between stages and final response measurement contribute to the request total. Stage cycle deltas are sampled during the request and charges can settle in a later stage.

| Stage | Calls | Reply bytes | Replica time | Instructions | Sampled cycle delta |
|---|---:|---:|---:|---:|---:|
| Initial Governance | 1 | 349 | 120 ms | 97,403 | 5.73 M |
| Registry head | 1 | 2 | 118 ms | 57,225 | 5.94 M |
| Subnet roster | 1 | 751 | 113 ms | 147,143 | 6.11 M |
| Target membership | 1 | 1,570 | 116 ms | 269,724 | 7.31 M |
| Candidate node records | 2 | 94 | 122 ms | 144,661 | 11.52 M |
| Candidate API boundaries | 2 | 200 | 149 ms | 151,578 | 11.17 M |
| Governance recheck | 1 | 349 | 117 ms | 103,937 | 5.90 M |
| Analysis and scope assembly | 0 | 0 | Same round | 10,252,215 | Charged at settlement |

The previews issued zero operator, data-center and chunk calls in this fixture. Chunk reads remain supported for required records. A replay of the archived Governance reply for proposal 144942 produced its exact swap in nine calls against a synthetic Registry. In local Chromium the replacement returned in 4.00 seconds and the pair in 2.06 seconds, including the browser agent. The browser also verified both execution orders and the linked and standalone Node Performance views.

The temporary 12-call experiment used the same call counts. It reduced the 24-subnet reads from three batches to two and raised their peak reservation from 336.82 billion to 505.23 billion cycles. The two broad requests had mixed end-to-end latency results. The targeted replacement already fit each stage in one batch. At the observed mainnet reservation, 12 comparable calls would require about 1.32 trillion cycles reserved plus the existing 50-billion liquid margin. The implementation keeps eight calls per batch and the 120-second deadline.

### Previous local measurements

The initial on-demand implementation used the broader topology path. Cross-subnet PocketIC measurements below use the synthetic 24-subnet Registry, except for proposal 144942 and the native metrics read. Wall times include the local test client. Settled cycle changes are measured on the reviewer under PocketIC pricing. The largest batch reservation was about 336.8 billion cycles. The membership tests left stable allocation unchanged.

| Case | Source calls | Source bytes | Candid reply bytes | Wall time | Reviewer instructions | Settled cycles |
|---|---:|---:|---:|---:|---:|---:|
| One add proposal | 138 | 47,569 | 51,401 | 4.13 s | 83.68 M | 887.37 M |
| Add and remove, both orders | 140 | 48,117 | 105,232 | 1.79 s | 148.80 M | 968.69 M |
| Multi-subnet removal | 236 | 55,270 | 90,468 | 3.29 s | 116.60 M | 1,456.04 M |
| Proposal 144942 with a synthetic two-member target | 19 | 15,673 | 7,637 | 0.71 s | 33.34 M | 164.19 M |
| Native remote blockmaking, standalone | 1 | 241 | 914 | 0.026 s | 0.58 M | 13.67 M |

Chromium on the local asset canister verified both execution orders, a linked 51-node filter, clearing that filter, and an independent blockmaking request. The pair review and the blockmaking request each took about 3.2 seconds from the browser. Browser traffic remained on the local replica.

The 144942 test replayed the archived 23 November Governance reply with SHA-256 `8c9845cc9bb67edc1c35f688b00170ccae0eb41f54e4abd8d90b00a1e5019ad3`. It verified the actual executable addition and removal against the fixture. The revised preview awaits a separately authorized mainnet measurement.

## M1 evidence foundation

The feature branch `codex/m1-evidence-foundation` builds on reviewed M0 commit `6a6330c181d6697649da3779d1eb11a6cb729ac0`. It adds one stable production scheduler and three source workers to the existing backend canister. Controller policy enables autonomous collection. Frontend widgets and the membership engine are M2 and later work.

| Checkpoint | Implementation and evidence |
|---|---|
| A — Hardening | Cycle, call, byte, retry, slice and deadline admission. Typed stops. Old-M0 Wasm upgrade from queued and outstanding work. CI with required Candid compatibility and source hashes. |
| B — Registry | Fixed bootstrap target, complete-page publication, sparse historical reads, verified chunk assembly, topology views and resumable partial stage. A 24-subnet, 1,200-node fixture and three anonymous Registry samples informed verification. |
| C — Governance | Full individual capture, separate lifecycle observations, bounded discovery and autonomous refresh. Tested listed omission, unsupported and malformed actions, unavailable replies and deduplication. |
| D — Metrics | Registry-rostered daily fetch, inclusive overlap, immutable raw evidence, conflict and gap markers, per-subnet failure handling and recovery. PocketIC returned populated native histories from the calling and remote subnets. |

## Live gate

Anonymous direct Registry development reads verified original pagination and atomic rewrite ordering. They supplied bootstrap size samples. The application-canister tests used PocketIC. No mainnet canister was installed or upgraded, no mainnet cycles were transferred, and no controllers were changed. The deployed application route, observed cost and freshness, and native source behavior over a live fleet await explicit authorization.

## References

- [M1 acceptance report](M1_REPORT.md)
- [Evidence contracts, storage format and sizing](EVIDENCE.md)
- [Job budgets, recovery and authorized verification plan](OPERATIONS.md)
- [Source pins](SOURCES.md)
- [Legacy parity](PARITY.md)

## M1 review corrections

The reviewed head was `b983938f7ce50e2b8b3210dc0ef0f7e3db23f5b2`. The collector now separates durable, absolute-expiry verification from recurring production windows. PocketIC held a real cross-subnet callback outstanding, crossed the absolute expiry and the next 24-hour window, and upgraded twice. The expired ledger kept its original call count and reservations until explicit reauthorization.

Metrics retain successful raw replies and classify empty, boundary-only, populated and missing-boundary responses. Registry recovery reports typed failures and required local limits, preserves staged work and gates deterministic adapter failures on an explicit recovery revision.

`./scripts/test-m0.sh` passed 13 unit and eight PocketIC tests, the original M0 Wasm upgrades, the production build, the pinned upstream hashes and M0 Candid compatibility. `didc check canisters/reviewer/reviewer.did .local/m1-reviewed.did` also passed against the reviewed M1 interface. Formatting and both host and Wasm Clippy checks passed.

## M2 membership review

M2 is developed on `codex/m2-membership-review` separately from PR #1. The pure engine validates scoped evidence, simulates functions 2, 13 and 31 with ordered membership, emits intermediate states for both proposal orders, and computes registered topology summaries. The bounded controller API waits for source evidence at a pinned Registry version, persists a review revision and serves it and its resolved scope across upgrades. The [M2 contract](M2.md) covers findings, evidence, scope, resource limits and the planned public-read contract.

Executable record 18, unsupported actions and missing/malformed evidence have explicit outcomes. Executed captures may be evaluated hypothetically with an explicit controller opt-in and a pinned Registry version. The report labels that mode. Exact historical attribution remains deferred. Mainnet source-capability verification remains gated.

The local delivery checks passed 24 Rust tests and nine PocketIC tests, including original-M0 upgrade recovery, the nonrenewable verification run, and the durable membership API flow. Formatting, host and Wasm Clippy, production Wasm, pinned ICP source hashes, generated Candid and compatibility with M0 and corrected M1 also passed. The M1 correction branch passed both GitHub Actions runs for the draft PR head.

## Subnet Membership widget

The `codex/membership-widget` branch adds the standard asset canister and a browser UI for completed revisions. Visitors can search by one or two proposal IDs, select a baseline revision and scenario, inspect registered membership and findings, and request the latest archived blockmaking observations through the resolved subnet scope. The bounded public read endpoints use replicated updates and leave preparation and collection under controller control. See [frontend operations](../web/README.md).

Performance pagination binds the archived sample timestamp, or its absence, to the review, scenario and subnet cursor. The first staging run uses the existing diagnostic with fresh one-shot limits. It verifies real proposal and Registry wire evidence and caller and remote metrics before any full Registry replay is considered. [Staging runbook](OPERATIONS.md#first-mainnet-verification) · [Current parity](PARITY.md)

## Historical Registry operator compatibility

The first live replay stopped on its approved call limit at cursor 4,270, with fixed target 65,958 still unpublished. Sampled historical replies contain well-formed operator records with embedded principals that conflict with their keys, first observed at 48,021. The adapter retains these versions as opaque, with the original key, bytes, hash and observation, and omits their unavailable provider and data-center relationships. Later valid replacements take effect at their own versions. Structural membership and roster errors still block publication.

The production-Wasm PocketIC regression upgrades a paused collector at cursor 4,270, verifies its retained evidence and publishes only after the fixed target is complete. A local replay applied 16 isolated live pages, including the page spanning 47,500–48,500 and the last sample through 65,378. This sampling exercise left the target unpublished. The staging upgrade, funding and next replay window each require approval.
