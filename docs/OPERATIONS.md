# Evidence collection operations

## Probe admission and recovery

The reviewed M0 baseline is `6a6330c181d6697649da3779d1eb11a6cb729ac0`. The original `scripts/test-m0.sh` ran locally with eight unit tests and three PocketIC tests passing. M1 checks its committed Candid interface against the frozen M0 service and compiles that commit for PocketIC's old-to-new upgrade test.

`start_probe_with_limits` accepts one controller-authorized job. The original `start_probe` uses the published default limits. `probe_budget` provides typed stop reasons and a durable ledger. The default caps are 4 trillion cycles reserved, 64 calls, two attempts per work item, 32 MiB of raw replies, 64 slices and 15 minutes. One call is dispatched per slice. A watchdog uses a 90-second lease and bounded waits use at most 30 seconds. Each reply is bounded by the replicated 2 MiB transport limit.

Call admission debits `ic0.cost_call` without crediting refunds. That API covers the maximum network reply and callback price for the call. Each dispatch also reserves a local allowance for scheduling, durable writes and processing outside the callback. Admission uses the larger of cumulative reservations or the maximum observed balance decrease and leaves a 50-billion-cycle liquid-balance margin above the next reservation. The system also enforces its freezing threshold. The ledger measures callback instructions and samples the canister balance. The ceiling is an admission policy. Platform storage rent, timer overhead, external top-ups, upgrades and asynchronous cycle refunds prevent attributing every billed cycle precisely to one job. [IC cycle-cost interface](https://docs.internetcomputer.org/references/ic-interface-spec/canister-interface/#cycle-cost-calculation)

After upgrade the new timer resumes queued work. A persisted in-flight attempt consumes its reservation and its attempt count. Recovery fences the old generation before retrying. An interrupted final attempt stops the diagnostic job. A transport rejection is recorded before deciding whether it warrants another call. The callback and receipt are committed in a single replica message.

Memory IDs 0–3 retain the original M0 encoding and structure. The separate budget ledger at ID 4 uses a format-tagged value. A legacy job's existing receipts are kept byte-for-byte. The ledger derives a conservative reservation for receipted calls and the outstanding attempt during migration. M0 did not record earlier interrupted attempts or exact historical overhead, so its inferred reservation and observed balance delta have separate provenance.

## Mainnet gate

Deployment and cycle transfer require explicit approval covering the canister, subnet, identity, install mode, release hash, operating window and budget. Record certified controller and module state, the selected proposal and subnet IDs and the limits before execution. Use the budgeted diagnostic and export its evidence before cleanup.

## Production collection budget

`configure_collection` takes an explicit controller policy or pauses collection with `null`. One durable lease owns the production dispatcher. A superseded replica callback can still arrive after recovery. Its reservation remains charged and the generation fence prevents a second commit. The probe and collector cannot dispatch concurrently. A controller can pause while a call drains. Continuous collection starts a new operating window after 24 hours, relative to the start of the previous window. Each window has independently configured cycle, raw input, call and slice allowances. A new window keeps source progress and staged data.

For a bounded verification run, use `authorize_verification(expires_at, limits)`. The absolute expiry is in Unix nanoseconds, must be in the future, and must fit within the duration limit of at most 24 hours. Cycle reservations, admitted calls, raw bytes and slices are lifetime allowances. Exhausting a lifetime allowance stops the run. A liquid-balance or storage block may clear before expiry within the same ledger. Expiry prevents new admissions, including after a timer has fired, an upgrade, or the next day. An already admitted callback can commit within its reservation after expiry. Lease recovery still fences a stale callback. Only a new controller authorization or explicit continuous configuration can dispatch more calls. `collection_status` reports the verification expiry, the durable ledger and any terminal stop.

Call and slice counts bound scheduler admissions, including retries. Cycle admission uses `cost_call`, a local allowance and observed balance decreases as described for the probe. Storage rent, idle timers, deployment, chain accounting and delayed balance changes cannot be attributed exactly to this run.

The production stable allocation ceiling is approximately 2 GiB with a 64 MiB headroom allowance. The scheduler checks allocated stable pages before each slice. A controller can lower the ceiling for a planned run, and `collection_status` reports the effective ceiling. Existing evidence remains readable when admission is paused, and ongoing IC storage charges still apply. The collector stores complete sources within their supported limits and holds work on deterministic failures. Registry pages are capped at 40,000 incoming mutations and 8,192 retained staging rows. Large selected records are capped at 16 verified chunks and 16 MiB reconstructed. These are local ceilings. `configure_registry_limits` sets lower caps for an agreed run. It can raise a cap up to the ceiling without changing the Registry request. The pinned source accepts a cursor and chooses how much it returns.

`registry_status.block` identifies the source method and arguments through its observation, the replay cursor, the delivered range when available, the staged key when available, and the recovery class. A limit failure requires raising that cap before `retry_registry` accepts it. A transient failure gets bounded automatic attempts, followed by explicit controller retry. Source lookup errors and chunk hash mismatches can be retried after checking the source. An incompatible chunk reply schema follows the adapter-upgrade path. A deterministic format or hard-limit incompatibility remains blocked until a compatible adapter explicitly advances the recovery revision. All cases preserve the publication pointer and any previously completed staged rows.

## First mainnet verification

The staging backend `s34gv-3qaaa-aaaar-qcifa-cai` was reinstalled at 08:31 UTC on 23 November 2026. Certified metadata matched the approved compressed module hash `f5d7c280ce15f008e8095e26ab74d55aa5627e0a80a537fb2354ac411a92f32f` and the original controller set. Reinstall evidence is in `.local/staging-reinstall-20261123T082952Z/`. [Install modes](https://docs.internetcomputer.org/references/ic-interface-spec/management-canister/#ic-method-install_code)

The owner selected fiduciary subnet `pzp6e-ekpqk-3c5x7-2h6so-njoeq-mt45d-h3h6c-q3mxf-vpeq5-fk5o7-yae` and designated the existing controller's DFX identity `codex_local` for staging. Certified placement shows 34 node keys. The Registry record at head 65,932 shows 34 members and SEV disabled. The sample immediately before reinstall showed about 2.994 trillion cycles above the estimated freezing requirement. Remeasure before starting the probe. The ignored `.local/staging-subnet-2026-11-23/` and `.local/staging-readonly-*/` directories hold the earlier read-only evidence.

The authorized probe used reviewer revision `d645b0a57bee5204975c14b46216040f283e658a` on 23 November 2026. The operating window was 09:12:33 to 09:27:33 UTC. Job 1 ran from 09:13:13.670497929 to 09:14:50.371222148 UTC. All 21 replies passed hash checks. The two intentionally missing IDs returned explicit absence.

| Source | Verified live result |
|---|---|
| Governance | Three `list_proposals` calls and the individual `get_proposal_info` call succeeded. Proposal `144942` was open and returned a 124-byte function-31 membership-change payload with one addition and one removal. |
| Registry | `get_latest_version` and `get_changes_since` confirmed head 65,933 and delivered cursors 0 → 270 → 1,270. Versioned `get_value` resolved the subnet, node, operator and data center, and returned 94 historical subnets at version 65,912 versus 95 at head. |
| Management | `subnet_info` agreed on version 65,933 for both subnets. `node_metrics_history` returned seven daily samples per subnet, with 34 and 13 node rows per sample. Both inclusive overlaps matched. |

The settled balance fell from 3,118,098,156,823 to 3,107,580,590,848 cycles, a 10.52-billion-cycle decrease across the probe, polling, export and elapsed idle time. The 2.318 trillion cycles reserved for admission were a separate measurement. The run verified neither live chunk retrieval nor complete Registry publication. On-chain receipts remain intact. The ignored `.local/staging-probe-20261123T091233Z/` directory contains the verified export and measurements.

The commands below document the completed operation. Another probe, full Registry replay and continuous collection each require separate authorization.

### Limits and cost

| Limit | Staging value |
|---|---:|
| Starts | One start inside the approved UTC window |
| Admission ceiling | 2,800,000,000,000 cycles |
| Post-reinstall balance floor | 2,900,000,000,000 liquid cycles above the freezing requirement |
| Dispatches and slices | 24 each, including fallback requests and overlap reads |
| Attempts | One per request |
| Stored reply budget | 16 MiB total, with a 2 MiB per-reply transport bound |
| Admission expiry | 300 seconds after the canister records job start |
| In flight | One call with a 30-second timeout and 90-second lease watchdog |
| Metrics window | Seven days preceding the approved start window |

The job expires automatically and the budget never renews. The shell enforces the approved UTC dispatch window. The canister enforces the one-shot 300-second lifetime from the recorded on-chain start across timers and upgrades. Budget admission stops at the earliest of completion, deadline, call, byte, slice or cycle limit, or the balance floor. An already dispatched call may finish and write its receipt after admission expires. Poll gently until it reaches a terminal state. Stop the operator workflow on an unexpected subnet, module, controller or source result. A budget-limited run is partial evidence. It requires fresh authorization to run again.

The local 13-node DFX rehearsal completed 20 calls in 32 seconds. It recorded 847.0 billion cycles in admission reservations, retained 358,121 response bytes, measured 147.6 million instructions and settled about 1.34 billion cycles below its initial balance. A separate rehearsal stopped at the 750-billion-cycle admission ceiling after reserving 720.0 billion across 17 calls. The PocketIC synthetic join retained 23 receipts and used about 4.35 billion total cycles including upgrade and polling. [M0 measurements](M0.md#measurements-from-local-runs)

The local 13-node rehearsal reserved about 42.35 billion cycles per dispatch, including a fixed 250-million-cycle slice allowance. Scaling the remaining call component by 34/13 gives an estimate of about 110 billion cycles per dispatch and 2.65 trillion across 24. The 2.8-trillion ceiling covers that admission estimate. Record settled balance changes, including reinstall, polling, export and idle costs, separately from admissions. [Subnet pricing](https://docs.internetcomputer.org/references/subnet-types/#costs-by-subnet-type) · [System cost API](https://docs.internetcomputer.org/references/ic-interface-spec/canister-interface/#cycle-cost-calculation)

Stop if the post-reinstall balance fails the floor. Top-ups and limit increases need separate authorization.

### Build and verify target

Run from the repository root with `set -euo pipefail`. Reserve a new local run directory. Use the reviewed artifact with a matching SHA-256. Before final approval, use the read-only checks in this section.

The approved artifact was reproduced with the pinned toolchain using `cargo build --locked --release --target wasm32-unknown-unknown -p nexus-reviewer` and `gzip -n`. Generated protobuf diagnostic paths embed Cargo's target directory. Both a rebuild at the original target path and an isolated rebuild with those paths remapped to the original path produced the exact approved compressed digest. Check the digest before uploading.

```bash
export NEXUS_CANISTER=s34gv-3qaaa-aaaar-qcifa-cai
export NEXUS_SUBNET=pzp6e-ekpqk-3c5x7-2h6so-njoeq-mt45d-h3h6c-q3mxf-vpeq5-fk5o7-yae
export NEXUS_DEPLOYER=codex_local
export NEXUS_APPROVED_WASM_SHA=f5d7c280ce15f008e8095e26ab74d55aa5627e0a80a537fb2354ac411a92f32f
export NEXUS_RELEASE=d645b0a57bee5204975c14b46216040f283e658a
export NEXUS_RUN=.local/staging-verification-01
mkdir "$NEXUS_RUN"
test "$(cat .local/staging-prepared/revision.txt)" = "$NEXUS_RELEASE"
git rev-parse "$NEXUS_RELEASE" > "$NEXUS_RUN/revision.txt"
cp .local/staging-prepared/reviewer.wasm.gz "$NEXUS_RUN/reviewer.wasm.gz"
printf '%s  %s\n' "$NEXUS_APPROVED_WASM_SHA" "$NEXUS_RUN/reviewer.wasm.gz" | sha256sum -c -
dfx canister info --network ic --identity anonymous "$NEXUS_CANISTER" |
  tee "$NEXUS_RUN/before-info.txt"
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
if (subnet !== NEXUS_SUBNET || nodes !== 34) process.exit(1);
JS
) | tee "$NEXUS_RUN/subnet.json"

record_balance() (
  cd web
  node --input-type=module <<'JS'
import { HttpAgent } from '@icp-sdk/core/agent';
import { IDL } from '@icp-sdk/core/candid';
import { Principal } from '@icp-sdk/core/principal';
const id = Principal.fromText(process.env.NEXUS_CANISTER);
const agent = await HttpAgent.create({ host: 'https://icp-api.io', shouldFetchRootKey: false });
const request = IDL.Record({ canister_id: IDL.Principal });
const status = IDL.Record({
  cycles: IDL.Nat,
  reserved_cycles: IDL.Nat,
  idle_cycles_burned_per_day: IDL.Nat,
  settings: IDL.Record({ freezing_threshold: IDL.Nat }),
  status: IDL.Variant({ running: IDL.Null, stopping: IDL.Null, stopped: IDL.Null }),
});
const response = await agent.query('aaaaa-aa', {
  effectiveCanisterId: id, methodName: 'canister_status',
  arg: new Uint8Array(IDL.encode([request], [{ canister_id: id }])),
});
if (response.status !== 'replied') throw new Error(response.reject_message);
const [value] = IDL.decode([status], new Uint8Array(response.reply.arg));
const freezingEstimate = (value.settings.freezing_threshold * value.idle_cycles_burned_per_day + 86_399n) / 86_400n;
const liquidAboveFreezing = value.cycles - freezingEstimate;
console.log(JSON.stringify({
  ...value, freezingEstimate, liquidAboveFreezing,
  meetsProbeFloor: 'running' in value.status && liquidAboveFreezing >= 2_900_000_000_000n,
}, (_, item) => typeof item === 'bigint' ? item.toString() : item, 2));
JS
)
record_balance | tee "$NEXUS_RUN/before-balance.json"
```

Confirm the exact controller set and old module hash against the recorded certified preflight. Confirm the subnet remains non-SEV. The balance check estimates the freeze reserve by rounding up the reported daily idle burn over the configured threshold. It omits any offset from reserved cycles, which makes the gate conservative. The compressed hash must match the uploaded bytes and the certified installed module hash. [Management status fields](https://docs.internetcomputer.org/references/ic-interface-spec/management-canister/#ic-method-canister_status) · [IC installed hash definition](https://docs.internetcomputer.org/references/ic-interface-spec/abstract-behavior/)

### Reinstall procedure and record

The approved reinstall is complete. The procedure records what was done. The time and controller checks below are also used for the probe. Set `NEXUS_CONTROLLER` to the recorded public principal for `codex_local` and set `NEXUS_WINDOW_START` and `NEXUS_WINDOW_END` to the timestamps authorized for the operation. The DFX warning override is scoped to signed commands using the selected staging identity.

```bash
check_window() {
  local now
  now="$(date -u +%s)"
  test "$now" -ge "$(date -u -d "$NEXUS_WINDOW_START" +%s)" &&
    test "$((now + 305))" -le "$(date -u -d "$NEXUS_WINDOW_END" +%s)"
}
controller_set() {
  sed -n 's/^Controllers: //p' "$1" | tr ' ' '\n' | sort
}
```

```bash
jq -e --arg subnet "$NEXUS_SUBNET" '.subnet == $subnet and .nodes == 34' "$NEXUS_RUN/subnet.json" >/dev/null
test "$NEXUS_CANISTER" = s34gv-3qaaa-aaaar-qcifa-cai
test "$(dfx identity get-principal --identity "$NEXUS_DEPLOYER")" = "$NEXUS_CONTROLLER"
dfx canister info --network ic --identity anonymous "$NEXUS_CANISTER" |
  tee "$NEXUS_RUN/before-reinstall-info.txt"
grep -Fx 'Module hash: 0xcfcf6130432a040a40738627df65da65d0d5c57195c04d3bb147a848af6d8303' \
  "$NEXUS_RUN/before-reinstall-info.txt"
diff -u <(controller_set "$NEXUS_RUN/before-info.txt") <(controller_set "$NEXUS_RUN/before-reinstall-info.txt")
diff -u <(controller_set .local/staging-subnet-2026-11-23/target-info.txt) <(controller_set "$NEXUS_RUN/before-reinstall-info.txt")
controller_set "$NEXUS_RUN/before-reinstall-info.txt" | grep -Fx "$NEXUS_CONTROLLER"
record_balance | tee "$NEXUS_RUN/before-reinstall-balance.json"
check_window
printf '%s  %s\n' "$NEXUS_APPROVED_WASM_SHA" "$NEXUS_RUN/reviewer.wasm.gz" | sha256sum -c -
DFX_WARNING=-mainnet_plaintext_identity dfx canister install --network ic --identity "$NEXUS_DEPLOYER" --mode reinstall --yes \
  --wasm "$NEXUS_RUN/reviewer.wasm.gz" --argument '(null)' "$NEXUS_CANISTER"
dfx canister info --network ic --identity anonymous "$NEXUS_CANISTER" |
  tee "$NEXUS_RUN/installed-info.txt"
grep -Fx "Module hash: 0x$NEXUS_APPROVED_WASM_SHA" "$NEXUS_RUN/installed-info.txt"
diff -u <(controller_set "$NEXUS_RUN/before-reinstall-info.txt") <(controller_set "$NEXUS_RUN/installed-info.txt")
record_balance | tee "$NEXUS_RUN/post-reinstall-balance.json"
```

### Authorized one-shot probe

The first probe is complete. Any future approved run uses a fresh read-only preflight and verifies the installed hash and complete controller set against the reinstall record. Recheck the balance before sending the probe. Diagnostic reads use replicated updates and consume operator ingress.

```bash
jq -e --arg subnet "$NEXUS_SUBNET" '.subnet == $subnet and .nodes == 34' "$NEXUS_RUN/subnet.json" >/dev/null
test "$(dfx identity get-principal --identity "$NEXUS_DEPLOYER")" = "$NEXUS_CONTROLLER"
dfx canister info --network ic --identity anonymous "$NEXUS_CANISTER" |
  tee "$NEXUS_RUN/pre-probe-info.txt"
grep -Fx "Module hash: 0x$NEXUS_APPROVED_WASM_SHA" "$NEXUS_RUN/pre-probe-info.txt"
diff -u <(controller_set .local/staging-reinstall-20261123T082952Z/installed-info.txt) <(controller_set "$NEXUS_RUN/pre-probe-info.txt")
record_balance | tee "$NEXUS_RUN/pre-probe-status.json"
jq -e '.meetsProbeFloor == true' "$NEXUS_RUN/pre-probe-status.json" >/dev/null

NEXUS_TARGET=o3ow2-2ipam-6fcjo-3j5vt-fzbge-2g7my-5fz2m-p4o2t-dwlc4-gt2q7-5ae
NEXUS_REMOTE="$NEXUS_TARGET"
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
    cycle_ceiling = 2_800_000_000_000 : nat;
    calls = 24 : nat32;
    attempts = 1 : nat8;
    raw_bytes = 16_777_216 : nat64;
    slices = 24 : nat32;
    duration_secs = 300 : nat32;
  },
)
ARGS
check_window
DFX_WARNING=-mainnet_plaintext_identity dfx canister call --network ic --identity "$NEXUS_DEPLOYER" --update \
  --candid canisters/reviewer/reviewer.did --output json "$NEXUS_CANISTER" \
  start_probe_with_limits --argument-file "$NEXUS_RUN/probe.args" |
  tee "$NEXUS_RUN/start.json"
NEXUS_JOB="$(jq -er .Ok "$NEXUS_RUN/start.json")"
```

Confirm the second controller/module read and balance before invoking the start. The diagnostic also runs bounded Governance list and missing-ID checks. It requests Registry changes at cursor zero, advances by the actual delivered cursor for the second page, and reads the subnet list at the captured head and immediately before the list record's last mutation when that history exists. It requests a known subnet and its node/operator/data-center records. Chunk checks and inclusive metrics overlaps share the same total limits. Responses that exceed the ceiling or fail decoding remain explicit evidence.

### Stop, export and assess

Poll `probe_status` no more than about once every ten seconds until `completed_at_nanos` is present and `in_flight` is false. Confirm that its caller subnet agrees with preflight. Record the post-probe canister status before exporting so export traffic stays separate from the balance delta.

```bash
DFX_WARNING=-mainnet_plaintext_identity dfx canister call --network ic --identity "$NEXUS_DEPLOYER" --update \
  --candid canisters/reviewer/reviewer.did --output json "$NEXUS_CANISTER" \
  probe_status "($NEXUS_JOB : nat64)" | tee "$NEXUS_RUN/progress.json"
# After the terminal status
record_balance > "$NEXUS_RUN/post-probe-status.json"
DFX_WARNING=-mainnet_plaintext_identity python3 scripts/export-probe.py --network ic --identity "$NEXUS_DEPLOYER" \
  "$NEXUS_CANISTER" "$NEXUS_JOB" "$NEXUS_RUN/receipts"
for receipt in "$NEXUS_RUN"/receipts/[0-9][0-9].json; do
  if jq -e '.method == "get_changes_since"' "$receipt" >/dev/null && test -f "${receipt%.json}.reply"; then
    cargo run --locked -q -p nexus-ic-sources --example check_registry_page -- \
      "${receipt%.json}.request" "${receipt%.json}.reply"
  fi
done | tee "$NEXUS_RUN/registry-decode.txt"
record_balance > "$NEXUS_RUN/post-export-status.json"
```

Keep the bundle under Git-ignored `.local`. Export verifies every retained response length and SHA-256. Record the pinned decoder revision, exact arguments and source identities, start and callback timestamps, rejects, raw and selected byte counts, instructions, admission reservations, and initial, terminal and post-export balances. Per-callback balance deltas are timing samples. The whole-run delta includes scheduling and ingress. Source canisters' certified module hashes can be recorded anonymously with `dfx canister info`.

Accept a supported payload with matching proposal ID, populated contiguous Registry pages whose second request follows the delivered cursor, and a successful historical value at an earlier requested version. Require successful caller and remote management samples to establish deployed coverage for both subnets. Verify the inclusive overlap where a first sample is present. Mark empty, rejected, unsupported, malformed and budget-limited checks individually. After the terminal export, leave the dedicated canister idle. No bootstrap is started by this procedure.

## Production Registry replay pilot

The first production pilot on `s34gv-3qaaa-aaaar-qcifa-cai` used the authorized 18:55:43 to 19:05:43 UTC interval on 23 November 2026. Observation 1 pinned Registry version 65,958. The collector stopped at `CallLimit` with five complete pages through cursor 4,270 and 5,330 processed mutations. It retained 547 mutations and 91,057 value bytes. Governance used 18 calls, including four listings and 14 individual captures. The remaining six fetched the Registry head and five pages. The stopped state had an empty lease, stage, block and publication pointer. A direct read of version 4,270 returned the incomplete-version error. The 19:05:51 UTC check confirmed that the collector was disabled and the ledger, stable allocation and Registry checkpoint were unchanged after expiry.

The sizing review found historical operator-conflict records that will block the current adapter at version 48,021. Review the focused compatibility proposal, storage sizing, funding model and larger-window limits before authorizing more replay. [First-pilot review](EVIDENCE.md#first-pilot-review)

Stable memory grew from 897 to 2,305 pages (88 MiB) during the pilot, within the 3,072-page admission ceiling. After export, the sampled balance was 13.09 billion cycles lower, including operator reads and elapsed idle cost. The 2.652-trillion-cycle admission reservation was separate. The new freezing estimate left about 2.711 trillion liquid cycles above freezing. A later window under the same 2.9-trillion entry floor needs a fresh passing balance check.

The initial plan aimed for about ten populated pages on the existing 34-node fiduciary subnet under `codex_local`. Calls and slices were shared by all workers. A fresh bootstrap has no published metrics roster. Any later activation needs separate approval.

| Limit | Initial pilot |
|---|---:|
| Window | One 10-minute UTC interval with a specified start and absolute end |
| Source calls | 24 across all workers, including the Registry head and any chunk calls |
| Cycle admission ceiling | 2,800,000,000,000 cycles |
| Raw reply budget | 18 MiB across all workers, allowing up to 2 MiB for the next reply |
| Slices and attempts | 160 total slices, including local applies, and one attempt per request |
| Stable allocation | 3,072 pages (192 MiB total) before admitting each slice |
| Entry balance | At least 2.9 trillion liquid cycles above estimated freezing |

At the observed 110.36 billion cycles per call, 24 calls plus allowances for up to 136 local-only slices put estimated admissions at 2.683 trillion cycles. This leaves about 117 billion under the proposed ceiling. The 2.9-trillion entry floor leaves further operating margin. The actual debit is measured separately. The stable ceiling counts the existing diagnostic evidence and allocation buckets. A single admitted slice can push allocation past the threshold before the next check. Stable memory is never truncated to enforce the limit.

### Preflight, start and monitor

Repeat the read-only [target checks](#build-and-verify-target) against the approved installed hash and original controller set. Require 34 certified node keys, a running canister and the entry balance above. The planning-only preflight on 23 November 2026 observed head 65,933 anonymously, 769 stable pages and about 2.928 trillion cycles above estimated freezing. The authoritative bootstrap target is the first successful live `get_latest_version` reply to the production collector. Record its observation and `registry_status.bootstrap_target` immediately. The API pins that target without a caller-provided version. The diagnostic cursor and anonymous sample were sizing evidence.

Only after approval, set `PILOT_DIR` to an ignored local directory and `START_UTC` and `END_UTC` to the approved timestamps. Include approval for the storage-cap setter, monitoring reads and an early pause if needed. These administrative reads are replicated calls and may initialize their stable indexes. Check that collection is disabled, its lease is empty and its existing allocation is below the proposed ceiling before setting the cap. The historical initial-window example below expects no target and cursor zero. For a later window, use the saved nonzero checkpoint and follow the resume checks.

```bash
set -euo pipefail
pilot_call() {
  DFX_WARNING=-mainnet_plaintext_identity dfx canister call --network ic --identity codex_local \
    --update --candid canisters/reviewer/reviewer.did --output json \
    s34gv-3qaaa-aaaar-qcifa-cai "$@"
}
start="$(date -u -d "$START_UTC" +%s)"
end="$(date -u -d "$END_UTC" +%s)"
test "$((end - start))" -eq 600
pilot_call registry_status '()' | tee "$PILOT_DIR/before-registry.json"
pilot_call collection_status '()' | tee "$PILOT_DIR/before-collection.json"
jq -e '.Ok | (.enabled == false and .in_flight == [] and
  ((.allocated_pages | tostring | gsub("_"; "") | tonumber) < 3072))' "$PILOT_DIR/before-collection.json"
jq -e '.Ok | (.bootstrap_target == [] and .staging == [] and .published == [] and
  .block == [] and (.ingested_through | tostring) == "0")' "$PILOT_DIR/before-registry.json"
now="$(date -u +%s)"
test "$now" -ge "$start" && test "$now" -lt "$end"
pilot_call configure_collection_storage '(opt (3072 : nat64))' | jq -e 'has("Ok")'
test "$(date -u +%s)" -lt "$end"
pilot_call authorize_verification "(${end}000000000 : nat64, record {
  cycle_ceiling = 2_800_000_000_000 : nat; calls = 24 : nat32; attempts = 1 : nat8;
  raw_bytes = 18_874_368 : nat64; slices = 160 : nat32; duration_secs = 600 : nat32;
})" | tee "$PILOT_DIR/authorization.json" | jq -e 'has("Ok")'
```

Check Registry status after the first head call, then use `pilot_call collection_status '()'` and `pilot_call registry_status '()'` about every 20 seconds, saving snapshots with UTC timestamps. Expect `bootstrap_target` to stay fixed even if `observed_head` advances. Stop at expiry or the first budget limit. Use the pre-approved `pilot_call configure_collection '(null)'` to pause early at about ten fully applied pages if the count is clear, or for a Registry block, anomalous growth, a balance admission stop or any publication inconsistency. Up to one admitted call may finish after pause or expiry. Save the stop reason or the operator pause timestamp and wait for `enabled == false` and `in_flight == []`. Preserve failure evidence via `source_observation` and retained `evidence_bytes` when available. Cap increases, retries, funding and additional windows require separate approval.

### Checkpoint and resume

Save `registry_status`, `collection_status` and an anonymous management balance sample after the lease drains. Check both statuses again after the UTC end to confirm there was no new work. Report changes in `ingested_through`, `processed_mutations`, `retained_mutations`, `retained_value_bytes`, Registry and total wire bytes, stable pages, calls, slices, instructions, reservations and settled net cycle balance. Retained counters can include a partially applied stage, so record `staging.end`, `staging.observation`, `count` and `applied` separately. For a completed-page count, read the pilot's observation ID range with `pilot_call source_observation '(ID : nat64)'`. Decode each valid `get_changes_since` request with the pinned `RegistryGetChangesSinceRequest` protobuf. Count distinct decoded request cursors below the final committed cursor so empty repeats do not inflate the count. A held stage at the committed cursor is a separate received page. Successful production pages retain their source hashes, lengths and selected records.

Before authorizing a later window, compare the saved target, cursor, stage and publication pointer. Use a fresh absolute expiry and a new explicitly approved budget. Retain the existing state and storage cap unless a separate approval changes it. The collector applies a staged page first, fetching its required chunks when present, and then requests changes from the committed cursor. Confirm the original target and next request cursor through status and source observations. `published` stays empty while the initial target is unfinished. No stage remains to compare when the first window ends exactly at a page boundary.

The existing local M1 PocketIC suite passed all four tests during planning, including deadline fencing and preservation of an unfinished Registry stage through recovery. The runbook shell and proposed Candid arguments also passed local validation. The mainnet pause and resume observations are pending their respective approvals.

Estimate remaining windows from measured versions per completed page, wire and retained bytes per version, calls per page and stable allocation growth. Allow for the different densities in early and late pages. Continue with capped resumable windows if the pilot supports them. Preserve the first complete published target as a review baseline. If a deterministic block occurs, retain its cursor, version range, affected key or chunk and recovery status for targeted correction.

### Registry compatibility upgrade and next replay

The 24 November 2026, 16:00–17:00 UTC window expired. The replacement proposed for explicit approval is **25 November 2026, 16:00–17:00 UTC** (`2026-11-25T16:00:00Z` through expiry `2026-11-25T17:00:00Z`). Obtain approval covering the upgrade, funding, storage-cap change, collection authorization, monitoring reads and early pause as applicable. If the window is missed, agree on a fresh one.

The anonymous 24 November preflight at 17:36 UTC confirmed canister `s34gv-3qaaa-aaaar-qcifa-cai` was running on the expected fiduciary subnet `pzp6e-ekpqk-3c5x7-2h6so-njoeq-mt45d-h3h6c-q3mxf-vpeq5-fk5o7-yae` with 34 certified node keys and 2,305 stable pages. The certified old module hash was `f5d7c280ce15f008e8095e26ab74d55aa5627e0a80a537fb2354ac411a92f32f`. The controller set matched the installation record, including `codex_local` (`amzih-bssz4-twanl-zf6nr-bqsnn-d7rlt-eerbc-oe7vv-uggn5-3naqo-3ae`) and `zkkkd-i34qc-367ln-e2u7o-ezznu-dkfqh-gtfvz-cviph-6qa4v-evtfs-wqe`. The anonymous Registry subnet record reply matched the earlier non-SEV sample byte for byte, including record version 65,854 and all 34 members.

The verified 23 November post-expiry archive recorded disabled collection, an empty lease, no Registry block or stage, cursor **4,270**, fixed target **65,958** and an empty publication pointer. Observation 1 pinned the target. Observation 22 records a valid 166,224-byte `get_changes_since` reply with wire SHA-256 `e9f756ac383e442f99811a1c0e34190d09945f9d50399815d4d8f17920ff90bf`. The pilot archive contains 24 source observation entries, and the Registry checkpoint records 547 retained mutations and 91,057 retained value bytes. The fresh anonymous reads confirm the deployment metadata and stable allocation. Refresh the controller-only replicated checkpoint and evidence reads under the next approval.

The proposed release is commit `6457e8def601b7b9fd078360eb4d07c2e2644528`. The local production build compressed with `gzip -n` yielded SHA-256 `e8ef5f56da672675e3b1ecbec6d276f45b3e922f3f91adb365d4ba211f06033a`. The matching push and pull request CI runs passed. [Push CI](https://github.com/aodl/IC_Widgets/actions/runs/45274464926) · [Pull request CI](https://github.com/aodl/IC_Widgets/actions/runs/45274477070)

At 21:49 UTC on 23 November the reported balance was `3,090,313,239,753` cycles with zero reserved. Estimated freezing was `381,407,434,650`, leaving `2,708,905,805,103` liquid. A transfer of `1,909,686,760,247` would have reached 5 trillion at that reading. At 17:36 UTC on 24 November the reported balance was `3,080,026,423,524` with zero reserved. The reported idle burn of `12,713,581,155` cycles per day and the 30-day threshold imply the same `381,407,434,650` freezing estimate. That leaves `2,698,618,988,874` liquid, `201,381,011,126` below the entry floor. At that reading, adding `1,919,973,576,476` cycles would reach 5 trillion total and an estimated `4,618,592,565,350` liquid at the current allocation and settings.

- Recheck the certified metadata, running status, subnet and balance. With the approved controller reads, compare `registry_status`, `collection_status` and source observations 1 and 22 against the archived checkpoint. Save those replies and stop on a discrepancy.
- Check the exact approved compressed artifact. Use only upgrade mode to preserve stable memory, source observations and Registry progress. The approved command form is `dfx canister install --network ic --identity codex_local --mode upgrade --wasm "$APPROVED_WASM" s34gv-3qaaa-aaaar-qcifa-cai`. Check the new certified module hash, unchanged controller set, checkpoint and source observations again before admitting work.
- Keep the existing freezing settings. Recalculate any separately approved funding from a fresh balance and verify at least **2.9 trillion liquid cycles above estimated freezing** immediately before activation. Stop on insufficient balance.
- During the approved interval, run the two calls below once. `pilot_call` is the controller wrapper in [Preflight, start and monitor](#preflight-start-and-monitor). The nonrenewable absolute expiry is encoded in nanoseconds. All workers share the budget. The 6,144-page (384 MiB) cap is checked before each slice. An admitted slice may allocate a bucket before the next check. The production maximum remains unchanged.

```bash
start=$(date -u -d '2026-11-25T16:00:00Z' +%s)
expiry=$(date -u -d '2026-11-25T17:00:00Z' +%s)
now=$(date -u +%s)
test "$now" -ge "$start" && test "$now" -lt "$expiry" || exit 1
set -o pipefail
pilot_call configure_collection_storage '(opt (6144 : nat64))' | jq -e 'has("Ok")' || exit 1
test "$(date -u +%s)" -lt "$expiry" || exit 1
pilot_call authorize_verification "(${expiry}000000000 : nat64, record {
  cycle_ceiling = 10_500_000_000_000 : nat; calls = 90 : nat32; attempts = 1 : nat8;
  raw_bytes = 100_663_296 : nat64; slices = 1_500 : nat32; duration_secs = 3_600 : nat32;
})" | jq -e 'has("Ok")' || exit 1
```

Poll `registry_status` and `collection_status` and poll more closely near the target. Pause promptly with `configure_collection(null)` when the target is published, at a Registry block, or on a balance or storage admission stop. Let the existing call and slice limits and absolute expiry stop admission independently. Wait for the lease to drain, then keep the checkpoint and report the settled balance, source call mix, page and mutation totals, stable allocation and publication status. Any additional window is separately authorized.

Well-formed historical operator identity conflicts retain their original evidence and allow publication when the rest of the Registry state validates. Provider and data-center metadata for the affected historical records remain explicitly unavailable. Other material Registry integrity errors still block publication.

### First immutable review

After a complete version is published, separately approve `capture_proposal(144942)` and enough bounded collection to obtain its fresh production Governance capture. Inspect `proposal_archive(144942, null)` and pin its observation and payload hash. Use `request_membership_review` with that capture, the exact published version, scenario A and `request_missing = false`. Advance the existing review job with `advance_membership_review` and record its immutable review revision. For an executed capture, use `hypothetical_executed = opt true` and check its label, or select an open proposal. Exact historical before-state requires independent attribution evidence.

Compare the requested additions and removals against resulting membership, Registry joins and findings. Verify the manifest and use `membership_review_scope` to check its target subnet, nodes and evidence identifiers. Confirm `list_completed_reviews` and `read_membership_review` return the same revision via the public replicated API. Frontend asset deployment has its own authorization.

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
