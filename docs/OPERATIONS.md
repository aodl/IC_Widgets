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

## First mainnet verification

Start with one already funded, dedicated, empty canister on a conventional 13-node application subnet. The run installs only the reviewer and uses the existing one-shot diagnostic. It leaves the production collector disabled and pauses at the configured limits. The first two Registry pages are diagnostic evidence. Publication of a production Registry version still requires the complete replay.

Approve the staging canister and subnet principals, the existing controller's DFX identity name and public principal, the exact compressed reviewer module SHA-256, and one UTC start window for one install and one probe. The proposed target is real membership proposal `144942` and its subnet `o3ow2-2ipam-6fcjo-3j5vt-fzbge-2g7my-5fz2m-p4o2t-dwlc4-gt2q7-5ae` for both the Registry join and the remote metrics call. Use a different owner-approved conventional subnet for the remote call if that is the staging subnet. The caller's own subnet is automatically sampled. Approval covers status reads and evidence export on that canister. Creation, funding, upgrades of existing code, continuous collection and controller changes require separate authorization.

### Limits and cost

| Limit | Proposed value |
|---|---:|
| Starts | One start inside the approved UTC window |
| Admission ceiling | 1,200,000,000,000 cycles |
| Dispatches and slices | 24 each, including fallback requests and overlap reads |
| Attempts | One per request |
| Stored reply budget | 16 MiB total, with a 2 MiB per-reply transport bound |
| Admission expiry | 300 seconds after the canister records job start |
| In flight | One call with a 30-second timeout and 90-second lease watchdog |
| Metrics window | Seven days preceding the approved start window |

The job expires automatically and the budget never renews. The shell enforces the approved UTC dispatch window. The canister enforces the one-shot 300-second lifetime from the recorded on-chain start across timers and upgrades. Budget admission stops at the earliest of completion, deadline, call, byte, slice or cycle limit, or the balance floor. An already dispatched call may finish and write its receipt after admission expires. Poll gently until it reaches a terminal state. Stop the operator workflow on an unexpected subnet, module, controller or source result. A budget-limited run is partial evidence. It requires fresh authorization to run again.

Local PocketIC observed roughly 4.35 billion total cycles for the 23-receipt synthetic join, including upgrade and polling. A local DFX rehearsal completed 20 calls in 32 seconds under the proposed configuration. It reserved 847.0 billion, retained 358,121 response bytes, recorded 147.6 million instructions and showed about 1.34 billion between the initial and settled balances. A separate rehearsal stopped at the cycle ceiling after reserving 720.0 billion across 17 calls under a 750 billion cap. At about 42.35 billion per admission, 24 similar admissions would reserve about 1.02 trillion. The proposed 1.2 trillion ceiling leaves a margin on that basis.

The platform's `cost_call` estimates the maximum transmission and callback costs and the probe also adds 250 million per slice. On a standard 13-node subnet two 1.3 MiB replies alone would account for about 2.7 billion transmission cycles at 1,000 cycles per byte. Actual decoding, callback and storage costs remain unmeasured on the live path. A larger or SEV subnet requires a revised estimate and authorization. [Cycle costs](https://docs.internetcomputer.org/references/cycle-costs/) · [System cost API](https://docs.internetcomputer.org/references/ic-interface-spec/canister-interface/#cycle-cost-calculation)

The admission ceiling governs the probe's source dispatches. Record installation, operator ingress, archive export and idle rent separately. A canister should have at least 1.3 trillion liquid cycles above its platform freezing requirement after installation to give the probe adequate headroom. The code also enforces its own 50-billion liquid balance margin above each admission. Do not top up automatically if preflight fails.

### Build and verify target

Run from the repository root. Reserve a new local directory for the run. Supply the approved values in the shell. Before approval, run only the local build and read-only certified metadata checks.

```bash
export NEXUS_CANISTER NEXUS_SUBNET NEXUS_DEPLOYER NEXUS_CONTROLLER NEXUS_APPROVED_WASM_SHA
export NEXUS_WINDOW_START NEXUS_WINDOW_END NEXUS_REMOTE
export NEXUS_RUN=.local/staging-verification-01
mkdir -p "$NEXUS_RUN"
git rev-parse HEAD > "$NEXUS_RUN/revision.txt"
cargo build --locked --release --target wasm32-unknown-unknown -p nexus-reviewer
gzip -n -c target/wasm32-unknown-unknown/release/nexus_reviewer.wasm > "$NEXUS_RUN/reviewer.wasm.gz"
sha256sum target/wasm32-unknown-unknown/release/nexus_reviewer.wasm "$NEXUS_RUN/reviewer.wasm.gz" |
  tee "$NEXUS_RUN/wasm.sha256"
dfx canister info --network ic --identity anonymous "$NEXUS_CANISTER" |
  tee "$NEXUS_RUN/before-info.txt"
test "$(dfx identity get-principal --identity "$NEXUS_DEPLOYER")" = "$NEXUS_CONTROLLER"
npm --prefix web ci
(
  cd web
  node --input-type=module <<'JS'
import { HttpAgent } from '@icp-sdk/core/agent';
const { NEXUS_CANISTER, NEXUS_SUBNET } = process.env;
const agent = await HttpAgent.create({ host: 'https://icp-api.io', shouldFetchRootKey: false });
const subnet = (await agent.getSubnetIdFromCanister(NEXUS_CANISTER)).toText();
const nodes = (await agent.fetchSubnetKeys(NEXUS_CANISTER)).size;
console.log(JSON.stringify({ subnet, nodes }));
if (subnet !== NEXUS_SUBNET || nodes !== 13) process.exit(1);
JS
) | tee "$NEXUS_RUN/subnet.json"
```

Use `set -euo pipefail` in the operator's shell. Confirm the certified pre-install metadata lists the authorized controller and no module. Confirm the approved placement is conventional non-SEV from the provisioning record. `dfx identity get-principal` emits only the public identity. The compressed hash must match the uploaded bytes and the certified installed module hash. [IC installed hash definition](https://docs.internetcomputer.org/references/ic-interface-spec/abstract-behavior/)

### Authorized install and one-shot probe

Run only after explicit approval, with the exact approved principals and start window. Use `--mode install` on the empty target. The read methods here use replicated updates and consume bounded operator ingress in addition to the probe budget.

```bash
check_window() {
  local now
  now="$(date -u +%s)"
  test "$now" -ge "$(date -u -d "$NEXUS_WINDOW_START" +%s)" &&
    test "$((now + 305))" -le "$(date -u -d "$NEXUS_WINDOW_END" +%s)"
}
check_window
printf '%s  %s\n' "$NEXUS_APPROVED_WASM_SHA" "$NEXUS_RUN/reviewer.wasm.gz" | sha256sum -c -
dfx canister install --network ic --identity "$NEXUS_DEPLOYER" --mode install \
  --wasm "$NEXUS_RUN/reviewer.wasm.gz" --argument '(null)' "$NEXUS_CANISTER"
dfx canister info --network ic --identity anonymous "$NEXUS_CANISTER" |
  tee "$NEXUS_RUN/installed-info.txt"
grep -Fx "Module hash: 0x$NEXUS_APPROVED_WASM_SHA" "$NEXUS_RUN/installed-info.txt"
dfx canister status --network ic --identity "$NEXUS_DEPLOYER" "$NEXUS_CANISTER" |
  tee "$NEXUS_RUN/pre-probe-status.txt"

NEXUS_TARGET=o3ow2-2ipam-6fcjo-3j5vt-fzbge-2g7my-5fz2m-p4o2t-dwlc4-gt2q7-5ae
# Set NEXUS_REMOTE, NEXUS_WINDOW_START and NEXUS_WINDOW_END to the approved values.
test "$NEXUS_REMOTE" != "$NEXUS_SUBNET"
NEXUS_FROM_NS="$(date -u -d "$NEXUS_WINDOW_START" +%s)"000000000
NEXUS_FROM_NS="$((NEXUS_FROM_NS - 7 * 86400 * 1000000000))"
cat > "$NEXUS_RUN/probe.args" <<ARGS
(
  record {
    proposal_id = opt (144942 : nat64);
    registry_subnet = opt principal "$NEXUS_TARGET";
    remote_subnet = opt principal "$NEXUS_REMOTE";
    metrics_start_nanos = $NEXUS_FROM_NS : nat64;
  },
  record {
    cycle_ceiling = 1_200_000_000_000 : nat;
    calls = 24 : nat32;
    attempts = 1 : nat8;
    raw_bytes = 16_777_216 : nat64;
    slices = 24 : nat32;
    duration_secs = 300 : nat32;
  },
)
ARGS
check_window
dfx canister call --network ic --identity "$NEXUS_DEPLOYER" --update \
  --candid canisters/reviewer/reviewer.did --output json "$NEXUS_CANISTER" \
  start_probe_with_limits --argument-file "$NEXUS_RUN/probe.args" |
  tee "$NEXUS_RUN/start.json"
NEXUS_JOB="$(jq -er .Ok "$NEXUS_RUN/start.json")"
```

Confirm the second controller/module read and balance before invoking the start. The diagnostic also runs bounded Governance list and missing-ID checks. It requests Registry changes at cursor zero, advances by the actual delivered cursor for the second page, and reads the subnet list at the captured head and immediately before the list record's last mutation when that history exists. It requests a known subnet and its node/operator/data-center records. Chunk checks and inclusive metrics overlaps share the same total limits. Responses that exceed the ceiling or fail decoding remain explicit evidence.

### Stop, export and assess

Poll `probe_status` no more than about once every ten seconds until `completed_at_nanos` is present and `in_flight` is false. Confirm that its caller subnet agrees with preflight. Record the post-probe canister status before exporting so export traffic stays separate from the balance delta.

```bash
dfx canister call --network ic --identity "$NEXUS_DEPLOYER" --update \
  --candid canisters/reviewer/reviewer.did --output json "$NEXUS_CANISTER" \
  probe_status "($NEXUS_JOB : nat64)" | tee "$NEXUS_RUN/progress.json"
# After the terminal status
dfx canister status --network ic --identity "$NEXUS_DEPLOYER" "$NEXUS_CANISTER" \
  > "$NEXUS_RUN/post-probe-status.txt"
python3 scripts/export-probe.py --network ic --identity "$NEXUS_DEPLOYER" \
  "$NEXUS_CANISTER" "$NEXUS_JOB" "$NEXUS_RUN/receipts"
for receipt in "$NEXUS_RUN"/receipts/[0-9][0-9].json; do
  if jq -e '.method == "get_changes_since"' "$receipt" >/dev/null && test -f "${receipt%.json}.reply"; then
    cargo run --locked -q -p nexus-ic-sources --example check_registry_page -- \
      "${receipt%.json}.request" "${receipt%.json}.reply"
  fi
done | tee "$NEXUS_RUN/registry-decode.txt"
dfx canister status --network ic --identity "$NEXUS_DEPLOYER" "$NEXUS_CANISTER" \
  > "$NEXUS_RUN/post-export-status.txt"
```

Keep the bundle under Git-ignored `.local`. Export verifies every retained response length and SHA-256. Record the pinned decoder revision, exact arguments and source identities, start and callback timestamps, rejects, raw and selected byte counts, instructions, admission reservations, and initial, terminal and post-export balances. Per-callback balance deltas are timing samples. The whole-run delta includes scheduling and ingress. Source canisters' certified module hashes can be recorded anonymously with `dfx canister info`.

Accept a supported payload with matching proposal ID, populated contiguous Registry pages whose second request follows the delivered cursor, and a successful historical value at an earlier requested version. Require successful caller and remote management samples to establish deployed coverage for both subnets. Verify the inclusive overlap where a first sample is present. Mark empty, rejected, unsupported, malformed and budget-limited checks individually. After the terminal export, leave the dedicated canister idle. No bootstrap is started by this procedure.

### First real review after the probe

Use the probe and the [bootstrap estimates](EVIDENCE.md#bootstrap-sizing) to choose a separate bounded collection allowance. Enable only the needed collection window and wait for a fully published Registry baseline. Capture the selected proposal by ID with the production Governance archive. The diagnostic receipt and the archive serve different purposes. An open proposal can use that completed version as a prospective baseline. An executed proposal requires an explicitly selected hypothetical baseline unless separate evidence establishes the historical before-state. Persist one completed revision and open it in the asset-canister frontend. Plan its mainnet deployment separately. The metrics panel can show explicit unavailability if the resolved subnet lacks a trustworthy archived sample.

## Upgrade verification

For the focused PocketIC migration test, build the pinned M1 (`ffd7172`) and M2 (`a251368`) fixture reviewers from Git archives. Use separate Cargo target directories to avoid reusing artifacts from a different revision. Put each fixture at `.local/upgrade-m1/reviewer.wasm` or `.local/upgrade-m2/reviewer.wasm`.

```bash
for choice in m1:ffd7172 m2:a251368; do
  name="${choice%%:*}"; revision="${choice#*:}"
  directory="$PWD/.local/upgrade-$name"
  mkdir -p "$directory/source"
  git archive "$revision" | tar -x -C "$directory/source"
  (cd "$directory/source" && CARGO_TARGET_DIR="$directory/target" \
    cargo build --locked --release --target wasm32-unknown-unknown -p nexus-reviewer --features local-fixtures)
  cp "$directory/target/wasm32-unknown-unknown/release/nexus_reviewer.wasm" "$directory/reviewer.wasm"
done
export DFX_IDENTITY=codex_local NEXUS_M0_TEST=1
export POCKET_IC_BIN="$PWD/.local/pocket-ic-14/pocket-ic-server"
cargo test --locked -p nexus-reviewer --test upgrade -- --ignored
```

The normal PocketIC suite provides the current fixture in `.local/reviewer-fixture.wasm`. The focused test archives observations in the M1 canister, builds a persisted revision after upgrading to M2, then upgrades to the widget and compares the retained evidence and review.
