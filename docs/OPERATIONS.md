# Evidence collection operations

## Probe admission and recovery

The reviewed M0 baseline is `6a6330c181d6697649da3779d1eb11a6cb729ac0`. The original `scripts/test-m0.sh` ran locally with eight unit tests and three PocketIC tests passing. M1 checks its committed Candid interface against the frozen M0 service and compiles that commit for PocketIC's old-to-new upgrade test.

`start_probe_with_limits` accepts one controller-authorized job. The original `start_probe` uses the published default limits. `probe_budget` provides typed stop reasons and a durable ledger. The default caps are 4 trillion cycles reserved, 64 calls, two attempts per work item, 32 MiB of raw replies, 64 slices and 15 minutes. One call is dispatched per slice. A watchdog uses a 90-second lease and bounded waits use at most 30 seconds. Each reply is bounded by the replicated 2 MiB transport limit.

Call admission debits `ic0.cost_call` without crediting refunds. That API covers the maximum network reply and callback price for the call. Each dispatch also reserves a local allowance for scheduling, durable writes and processing outside the callback. Admission uses the larger of cumulative reservations or the maximum observed balance decrease and leaves a 50-billion-cycle liquid-balance margin above the next reservation. The system also enforces its freezing threshold. The ledger measures callback instructions and samples the canister balance. The ceiling is an admission policy. Platform storage rent, timer overhead, external top-ups, upgrades and asynchronous cycle refunds prevent attributing every billed cycle precisely to one job. [IC cycle-cost interface](https://docs.internetcomputer.org/references/ic-interface-spec/canister-interface/#cycle-cost-calculation)

After upgrade the new timer resumes queued work. A persisted in-flight attempt consumes its reservation and its attempt count. Recovery fences the old generation before retrying. An interrupted final attempt stops the diagnostic job. A transport rejection is recorded before deciding whether it warrants another call. The callback and receipt are committed in a single replica message.

Memory IDs 0–3 retain the original M0 encoding and structure. The separate budget ledger at ID 4 uses a format-tagged value. A legacy job's existing receipts are kept byte-for-byte. The ledger derives a conservative reservation for receipted calls and the outstanding attempt during migration. M0 did not record earlier interrupted attempts or exact historical overhead, so its inferred reservation and observed balance delta have separate provenance.

## Mainnet gate

Deployment and cycle transfer require explicit approval for a funded application canister, its subnet, the authorized identity, install or upgrade mode, the build hash and maximum reserved cycles. Record certified controller/module state, selected proposal and subnet IDs, maximum duration and call count, and the intended receipts before executing. Follow the [M0 runbook](M0.md#authorized-live-verification) with the budgeted probe entry point. Preserve existing evidence through upgrades. An owner-controlled pause and evidence export precede any cleanup.

## Production collection budget

`configure_collection` takes an explicit controller policy or pauses collection with `null`. One durable lease owns the production dispatcher. A superseded replica callback can still arrive after recovery. Its reservation remains charged and the generation fence prevents a second commit. The probe and collector cannot dispatch concurrently. A controller can pause while a call drains. Continuous collection starts a new operating window after 24 hours, relative to the start of the previous window. Each window has independently configured cycle, raw input, call and slice allowances. A new window keeps source progress and staged data.

For a bounded verification run, use `authorize_verification(expires_at, limits)`. The absolute expiry is in Unix nanoseconds, must be in the future, and must fit within the duration limit of at most 24 hours. Cycle reservations, admitted calls, raw bytes and slices are lifetime allowances. Exhausting a lifetime allowance stops the run. A liquid-balance or storage block may clear before expiry within the same ledger. Expiry prevents new admissions, including after a timer has fired, an upgrade, or the next day. An already admitted callback can commit within its reservation after expiry. Lease recovery still fences a stale callback. Only a new controller authorization or explicit continuous configuration can dispatch more calls. `collection_status` reports the verification expiry, the durable ledger and any terminal stop.

Call and slice counts bound scheduler admissions, including retries. Cycle admission uses `cost_call`, a local allowance and observed balance decreases as described for the probe. Storage rent, idle timers, deployment, chain accounting and delayed balance changes cannot be attributed exactly to this run.

The production stable allocation ceiling is approximately 2 GiB with a 64 MiB headroom allowance. The scheduler checks allocated stable pages before each slice. A controller can lower the ceiling for a planned run, and `collection_status` reports the effective ceiling. Existing evidence remains readable when admission is paused, and ongoing IC storage charges still apply. The collector stores complete sources within their supported limits and holds work on deterministic failures. Registry pages are capped at 40,000 incoming mutations and 8,192 retained staging rows. Large selected records are capped at 16 verified chunks and 16 MiB reconstructed. These are local ceilings. `configure_registry_limits` sets lower caps for an agreed run. It can raise a cap up to the ceiling without changing the Registry request. The pinned source accepts a cursor and chooses how much it returns.

`registry_status.block` identifies the source method and arguments through its observation, the replay cursor, the delivered range when available, the staged key when available, and the recovery class. A limit failure requires raising that cap before `retry_registry` accepts it. A transient failure gets bounded automatic attempts, followed by explicit controller retry. Source lookup errors and chunk hash mismatches can be retried after checking the source. An incompatible chunk reply schema follows the adapter-upgrade path. A deterministic format or hard-limit incompatibility remains blocked until a compatible adapter explicitly advances the recovery revision. All cases preserve the publication pointer and any previously completed staged rows.

## Live verification plan

Before authorizing a deployment, record the assigned canister ID and application subnet. Read its current module hash and controller set through certified IC metadata. Confirm the recovery controller and the allowed installer identity by name. Record the production Wasm SHA-256, selected public membership proposal, and two conventional replica subnet IDs. Use install only for an empty assigned canister. For an existing M0 canister use upgrade and verify its schema and evidence before and after. A preserved canister snapshot or owner-approved backup can supplement an upgrade plan.

Build the production Wasm without the fixture feature and record its hash. The preflight below is read-only. Execute the install or upgrade commands only within the owner's explicit scope.

```bash
cargo build --locked --release --target wasm32-unknown-unknown -p nexus-reviewer
mkdir -p .local
gzip -n -c target/wasm32-unknown-unknown/release/nexus_reviewer.wasm > .local/reviewer-mainnet.wasm.gz
sha256sum target/wasm32-unknown-unknown/release/nexus_reviewer.wasm .local/reviewer-mainnet.wasm.gz
dfx canister info --network ic --identity "$NEXUS_DEPLOYER" "$NEXUS_CANISTER"
```

Once authorized, use the reviewed mode against the assigned target. An M0 upgrade uses empty Candid arguments. An empty install uses `(null)` for production source defaults.

```bash
dfx canister install --network ic --identity "$NEXUS_DEPLOYER" \
  --mode "$NEXUS_APPROVED_MODE" --argument "$NEXUS_APPROVED_ARGS" \
  --wasm .local/reviewer-mainnet.wasm.gz "$NEXUS_CANISTER"
dfx canister call --network ic --identity "$NEXUS_DEPLOYER" --update \
  --candid canisters/reviewer/reviewer.did "$NEXUS_CANISTER" start_probe_with_limits \
  --argument-file "$NEXUS_APPROVED_PROBE_ARGS"
```

The approved argument file contains a `ProbeRequest` and explicit `Limits` in Candid. A candidate small run uses 20 calls, two attempts per item, 24 MiB raw bytes, 20 slices and 10 minutes. Replace the named placeholders with the approved values before using the following template.

```candid
(
  record {
    proposal_id = opt (NEXUS_PROPOSAL : nat64);
    registry_subnet = opt principal "NEXUS_REGISTRY_SUBNET";
    remote_subnet = opt principal "NEXUS_REMOTE_SUBNET";
    metrics_start_nanos = 0 : nat64;
  },
  record {
    cycle_ceiling = NEXUS_APPROVED_CYCLES : nat;
    calls = 20 : nat32;
    attempts = 2 : nat8;
    raw_bytes = 25_165_824 : nat64;
    slices = 20 : nat32;
    duration_secs = 600 : nat32;
  },
)
```

The owner sets the cycle ceiling after accounting for `cost_call` reservations and authorizes any balance top-up separately. Scope the calls to the agreed proposal and subnets. Prefer the local diagnostic canister on a conventional application subnet. Record each receipt's source argument, time, SHA-256, wire byte count and cycle snapshots. Record actual source module hashes and subnet context around the test.

Confirm populated same- and cross-subnet history and inclusive overlap, Governance full payloads and lifecycle, and two nonempty Registry pages with the delivered cursor. Check for a live chunked selected-family mutation within an approved window and record availability. Compare native results and budgets with the local matrix. If production-path collection is separately authorized, use a fresh, reviewed scheduler state and the bounded verification authorization with absolute expiry and separate lifetime limits. Inspect its pending work first. The production worker may schedule Registry, Governance discovery and rostered metrics. For a run restricted to named proposals and subnets, use the diagnostic probe with approved arguments. Verify stable pointers and export required evidence before cleanup. The M0 baseline receipts require an approved upgrade rather than replacement. No deployed application canister has been used for these probes.
