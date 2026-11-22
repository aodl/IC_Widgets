# Implementation status

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

Executable record 18, unsupported actions and missing/malformed evidence have explicit outcomes. Executed captures may be evaluated hypothetically with an explicit controller opt-in and a pinned Registry version. The report labels that mode. Exact historical attribution remains deferred. The next slice is pinned metrics view aggregation, then certified reads and frontend proof verification before connecting the widgets. Mainnet source-capability verification remains gated.

The local delivery checks passed 24 Rust tests and nine PocketIC tests, including original-M0 upgrade recovery, the nonrenewable verification run, and the durable membership API flow. Formatting, host and Wasm Clippy, production Wasm, pinned ICP source hashes, generated Candid and compatibility with M0 and corrected M1 also passed. The M1 correction branch passed both GitHub Actions runs for the draft PR head.

## Subnet Membership widget

The `codex/membership-widget` branch adds the standard asset canister and a browser UI for completed revisions. Visitors can search by one or two proposal IDs, select a baseline revision and scenario, inspect registered membership and findings, and request the latest archived blockmaking observations through the resolved subnet scope. The bounded public read endpoints use replicated updates and leave preparation and collection under controller control. See [frontend operations](../web/README.md).
