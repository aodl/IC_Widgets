# Implementation status

## On-demand membership and performance

The `codex/on-demand-membership` branch makes direct pinned reads the default widget workflow. A single bounded controller or delegated request resolves one or two proposal IDs and returns all applicable scenarios. It rechecks the proposal action and lifecycle before delivering the result. Required topology failures stop the review. The result distinguishes a listed subnet assignment, an API-boundary assignment, an absent node record and an assignment unknown outside listed subnets. Node Performance has its own management canister call and can accept the membership scope as a filter. No review is saved. [Architecture](ARCHITECTURE.md) · [Local use](../web/README.md)

Cross-subnet PocketIC measurements below use the synthetic 24-subnet Registry, except for proposal 144942 and the native metrics read. Wall times include the local test client. Settled cycle changes are measured on the reviewer under PocketIC pricing. The largest batch reservation was about 336.8 billion cycles. The membership tests left stable allocation unchanged.

| Case | Source calls | Source bytes | Candid reply bytes | Wall time | Reviewer instructions | Settled cycles |
|---|---:|---:|---:|---:|---:|---:|
| One add proposal | 138 | 47,569 | 51,401 | 4.13 s | 83.68 M | 887.37 M |
| Add and remove, both orders | 140 | 48,117 | 105,232 | 1.79 s | 148.80 M | 968.69 M |
| Multi-subnet removal | 236 | 55,270 | 90,468 | 3.29 s | 116.60 M | 1,456.04 M |
| Proposal 144942 with a synthetic two-member target | 19 | 15,673 | 7,637 | 0.71 s | 33.34 M | 164.19 M |
| Native remote blockmaking, standalone | 1 | 241 | 914 | 0.026 s | 0.58 M | 13.67 M |

Chromium on the local asset canister verified denied access before delegation, both execution orders, a linked 51-node filter, clearing that filter, and an independent blockmaking request. The pair review and the blockmaking request each took about 3.2 seconds from the browser. Browser traffic remained on the local replica.

The 144942 test replayed the archived 23 November Governance reply with SHA-256 `8c9845cc9bb67edc1c35f688b00170ccae0eb41f54e4abd8d90b00a1e5019ad3`. It verified the actual executable addition and removal against the fixture. Live Registry coverage, latency and pricing remain to be measured together. One separately approved verification could run one current open function-31 proposal on an owner-designated test canister with the reviewed artifact. Record the pinned version and evidence coverage, wall latency, calls, bytes, instructions and settled cycle delta. Use the on-demand limits and stop after that reply.

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
