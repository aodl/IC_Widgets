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
