#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
root=$PWD
case_id=nns-144954-recorded-open
port=4971
single=false
while (( $# )); do
    case "$1" in
        --case) case_id=${2:?Missing case ID}; shift 2 ;;
        --port) port=${2:?Missing local gateway port}; shift 2 ;;
        --single) single=true; shift ;;
        *) echo 'Usage: scripts/dev-review-fixture.sh [--case ID] [--port PORT] [--single]' >&2; exit 2 ;;
    esac
done
[[ "$port" =~ ^[0-9]{4,5}$ ]] && (( 10#$port >= 1024 && 10#$port <= 65535 )) || exit 2
export DFX_IDENTITY=codex_local
unset DFX_NETWORK
for tool in dfx candid-extractor cargo gzip node npm python3; do
    command -v "$tool" >/dev/null || { echo "Missing prerequisite: $tool" >&2; exit 1; }
done
[[ -d web/node_modules/esbuild ]] || { echo 'Install the locked frontend dependencies with npm --prefix web ci before going offline.' >&2; exit 1; }
if [[ -n "${POCKET_IC_BIN:-}" ]]; then
    [[ -x "$POCKET_IC_BIN" && "$("$POCKET_IC_BIN" --version)" = "pocket-ic-server 14.0.0" ]] || {
        echo 'POCKET_IC_BIN must name the prepared PocketIC 14.0.0 executable.' >&2
        exit 1
    }
fi
cache=$(dfx cache show)
[[ -x "$cache/pocket-ic" ]] || { echo 'Prepare the local DFX cache with dfx cache install before going offline.' >&2; exit 1; }
mkdir -p .local
project=$(mktemp -d "$root/.local/review-fixtures.XXXXXXXX")
echo "Local project: $project"
mkdir -p "$project/tmp"
export TMPDIR="$project/tmp"
python3 - "$project" "$port" "$case_id" "$single" <<'PY'
import json
from pathlib import Path
import sys

project, port, initial, single = Path(sys.argv[1]), int(sys.argv[2]), sys.argv[3], sys.argv[4] == "true"
catalogue = json.loads(Path("tests/source-fixture/data/historical/replays.json").read_text())
cases = {row["id"]: row for row in catalogue["replays"]}
if initial not in cases:
    raise SystemExit(f"Unknown development case {initial}")
selected = [cases[initial]]
if not single:
    selected += [row for row in cases.values() if row["menu"] and row["id"] != initial]
canisters = {"frontend": dict(type="assets", source=["assets"], build=[])}
linked = []
for index, row in enumerate(selected):
    suffix = f"_{index}" if index else ""
    for name in ["reviewer", "fixture"]:
        canisters[name + suffix] = dict(type="custom", candid=f"{name}.did", wasm=f"{name}.wasm.gz")
    linked.append((suffix, row["id"]))
(project / "dfx.json").write_text(json.dumps(dict(
    version=1, networks={"local": dict(bind=f"127.0.0.1:{port}", type="ephemeral")},
    canisters=canisters,
)) + "\n")
(project / "cases.tsv").write_text("".join(f"fixture{suffix}\treviewer{suffix}\t{id}\n" for suffix,id in linked))
PY
cargo build --locked --offline --release --target wasm32-unknown-unknown \
    -p nexus-reviewer -p nexus-source-fixture --features nexus-reviewer/local-fixtures,nexus-source-fixture/slow-governance
wasms="$root/target/wasm32-unknown-unknown/release"
mkdir -p "$project/assets"
gzip -n -c "$wasms/nexus_reviewer.wasm" >"$project/reviewer.wasm.gz"
gzip -n -c "$wasms/nexus_source_fixture.wasm" >"$project/fixture.wasm.gz"
cp canisters/reviewer/reviewer.did "$project/reviewer.did"
candid-extractor "$wasms/nexus_source_fixture.wasm" > "$project/fixture.did"
cd "$project"
dfx start --background --artificial-delay 0
trap 'dfx stop' ERR
dfx canister create --all --network local
while IFS=$'\t' read -r fixture_name reviewer_name id; do
    fixture=$(dfx canister id --network local "$fixture_name")
    dfx canister install --network local --wasm fixture.wasm.gz "$fixture_name"
    dfx canister call --network local --candid fixture.did "$fixture_name" load_review_case "(\"$id\")"
    dfx canister install --network local --wasm reviewer.wasm.gz "$reviewer_name" \
        --argument "(opt record { governance = principal \"$fixture\"; registry = principal \"$fixture\" })"
done < cases.tsv
python3 - "$root" "$case_id" <<'PY'
import json
from pathlib import Path
import subprocess
import sys

source = Path(sys.argv[1]) / "tests/source-fixture/data/historical/replays.json"
metadata = {row["id"]: row for row in json.loads(source.read_text())["replays"]}
data = source.parent.parent
cases = []
for line in Path("cases.tsv").read_text().splitlines():
    _, reviewer, id = line.split("\t")
    row = metadata[id]
    principal = subprocess.check_output(["dfx", "canister", "id", "--network", "local", reviewer], text=True).strip()
    registry = row["registry"]
    capture = registry.get("capture")
    times = sorted(record["at"] for record in json.loads((data / capture["file"]).read_text())["records"].values()) if capture else []
    actions = []
    for action in row["action_evidence"]:
        at = action.get("observation_utc")
        indexed = action.get("indexed_record")
        if indexed:
            receipt = (data / indexed).with_suffix(".receipt.json")
            at = json.loads(receipt.read_text())["retrieved_at"]
        actions.append(dict(id=action["proposal_id"], kind=action["kind"],
                            at=at.replace("+00:00", "Z") if at else None))
    kind, status = row["lifecycle"].split("-", 1)
    lifecycle = ("Constructed " if kind == "constructed" else "Recorded ") + status.title() + " proposal"
    cases.append(dict(id=id, name=row["name"], purpose=row["purpose"], reviewer=principal, proposalIds=row["proposal_ids"],
                      provenance=row["provenance"], failureReason=row.get("indexed_failure_reason"),
                      registryVersion=registry["version"], registryFrom=times[0] if times else None,
                      registryTo=times[-1] if times else None, lifecycleLabel=lifecycle,
                      roleSupplement=registry.get("synthetic_overlay"), actionEvidence=actions))
Path("replays.json").write_text(json.dumps(dict(initial=sys.argv[2], cases=cases)) + "\n")
PY
reviewer=$(dfx canister id --network local reviewer)
DFX_NETWORK=local CANISTER_ID_REVIEWER="$reviewer" NEXUS_REPLAY_MANIFEST="$project/replays.json" \
    NEXUS_REPLAY_OUTPUT="$project/assets" npm --prefix "$root/web" run build
dfx deploy --network local frontend
frontend=$(dfx canister id --network local frontend)
trap - ERR
echo "Open http://$frontend.localhost:$port/"
echo "Stop with (cd '$project' && DFX_IDENTITY=codex_local dfx stop)."
