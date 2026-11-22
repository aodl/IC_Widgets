# Evidence collection operations

## Probe admission and recovery

The reviewed M0 baseline is `6a6330c181d6697649da3779d1eb11a6cb729ac0`. The original `scripts/test-m0.sh` ran locally with eight unit tests and three PocketIC tests passing. M1 checks its committed Candid interface against the frozen M0 service and compiles that commit for PocketIC's old-to-new upgrade test.

`start_probe_with_limits` accepts one controller-authorized job. The original `start_probe` uses the published default limits. `probe_budget` provides typed stop reasons and a durable ledger. The default caps are 4 trillion cycles reserved, 64 calls, two attempts per work item, 32 MiB of raw replies, 64 slices and 15 minutes. One call is dispatched per slice. A watchdog uses a 90-second lease and bounded waits use at most 30 seconds. Each reply is bounded by the replicated 2 MiB transport limit.

Call admission debits `ic0.cost_call` without crediting refunds. That API covers the maximum network reply and callback price for the call. Each dispatch also reserves a local allowance for scheduling, durable writes and processing outside the callback. Admission uses the larger of cumulative reservations or the maximum observed balance decrease and leaves a 50-billion-cycle liquid-balance margin above the next reservation. The system also enforces its freezing threshold. The ledger measures callback instructions and samples the canister balance. The ceiling is an admission policy. Platform storage rent, timer overhead, external top-ups, upgrades and asynchronous cycle refunds prevent attributing every billed cycle precisely to one job. [IC cycle-cost interface](https://docs.internetcomputer.org/references/ic-interface-spec/canister-interface/#cycle-cost-calculation)

After upgrade the new timer resumes queued work. A persisted in-flight attempt consumes its reservation and its attempt count. Recovery fences the old generation before retrying. An interrupted final attempt stops the diagnostic job. A transport rejection is recorded before deciding whether it warrants another call. The callback and receipt are committed in a single replica message.

Memory IDs 0–3 retain the original M0 encoding and structure. The separate budget ledger at ID 4 uses a format-tagged value. A legacy job's existing receipts are kept byte-for-byte. The ledger derives a conservative reservation for receipted calls and the outstanding attempt during migration. M0 did not record earlier interrupted attempts or exact historical overhead, so its inferred reservation and observed balance delta have separate provenance.

## Mainnet gate

Deployment and cycle transfer require explicit approval for a funded application canister, its subnet, the authorized identity, install or upgrade mode, the build hash and maximum reserved cycles. Record certified controller/module state, selected proposal and subnet IDs, maximum duration and call count, and the intended receipts before executing. Follow the [M0 runbook](M0.md#authorized-live-verification) with the budgeted probe entry point. Preserve existing evidence through upgrades. An owner-controlled pause and evidence export precede any cleanup.
