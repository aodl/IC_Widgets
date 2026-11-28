#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
root=$PWD
host=$(cd "${1:?Usage: rehearse-composed-view.sh <Network Nexus checkout> <output> [port]}" && pwd)
mkdir -p "${2:?Provide an evidence output directory}"
output=$(cd "$2" && pwd)
port=${3:-4975}
export DFX_IDENTITY=codex_local
export DFX_NETWORK=local
[[ -f "$host/web/catalogue.json" ]]
launcher="$output/replica.log"
project=
cleanup() {
    if [[ -z "$project" ]]; then project=$(sed -n 's/^Local project: //p' "$launcher"); fi
    if [[ -n "$project" && -f "$project/dfx.json" ]]; then (cd "$project" && dfx stop); fi
}
trap cleanup EXIT
./scripts/dev-review-fixture.sh --port "$port" --single >"$launcher" 2>&1
project=$(sed -n 's/^Local project: //p' "$launcher")
[[ "$project" == "$root"/.local/review-fixtures.* ]]
jq '.canisters += (["nx_host","nx_membership","nx_membership_second","nx_subnet","nx_map","nx_performance","nx_activity","nx_inspector"] |
    map({key:.,value:{type:"custom",candid:"frontend.did",wasm:(.+".wasm.gz")}}) | from_entries) |
    .canisters.fixture_second = .canisters.fixture | .canisters.reviewer_second = .canisters.reviewer' \
    "$project/dfx.json" >"$project/dfx.composed.json"
mv "$project/dfx.composed.json" "$project/dfx.json"
cp canisters/frontend/frontend.did "$project/frontend.did"
local_dfx() { (cd "$project" && dfx "$@" --network local); }
for alias in fixture_second reviewer_second nx_host nx_membership nx_membership_second nx_subnet nx_map nx_performance nx_activity nx_inspector; do
    local_dfx canister create --no-wallet "$alias"
done
fixture_second=$(local_dfx canister id fixture_second)
local_dfx canister install --wasm fixture.wasm.gz fixture_second
local_dfx canister call --candid fixture.did fixture_second load_review_case '("multiple-changes")'
local_dfx canister install --wasm reviewer.wasm.gz reviewer_second \
    --argument "(opt record { governance = principal \"$fixture_second\"; registry = principal \"$fixture_second\" })"
origin() { printf 'http://%s.localhost:%s' "$(local_dfx canister id "$1")" "$port"; }
host_origin=$(origin nx_host)
node --input-type=module - "$root/docs/composed-view/catalogue.example.json" \
    "$(origin nx_membership)" "$(origin nx_membership_second)" "$(origin nx_subnet)" \
    "$(origin nx_map)" "$(origin nx_performance)" "$(origin nx_activity)" "$(origin nx_inspector)" >"$project/nexus-catalogue.json" <<'JS'
import { readFileSync } from 'node:fs';
const [file, first, second, subnet, map, performance, activity, inspector] = process.argv.slice(2);
const example = JSON.parse(readFileSync(file, 'utf8'));
const origins = { 'membership-one': first, 'membership-two': second, subnet, map, performance, activity, inspector };
for (const widget of example.widgets) widget.origin = origins[widget.definition];
console.log(JSON.stringify(example));
JS
for spec in 'nx_membership reviewer proposal' 'nx_membership_second reviewer_second proposal' \
    'nx_subnet reviewer subnet' 'nx_map reviewer map' 'nx_performance reviewer performance' \
    'nx_activity reviewer activity' 'nx_inspector reviewer inspector'; do
    read -r alias reviewer view <<<"$spec"
    CANISTER_ID_REVIEWER="$(local_dfx canister id "$reviewer")" IC_WIDGET_EMBED_VIEW="$view" \
      IC_WIDGET_HOST_ORIGIN="$host_origin" ./scripts/build-frontend-wasm.sh
    cp "${CARGO_TARGET_DIR:-target}/wasm32-unknown-unknown/release/nexus_frontend.wasm.gz" "$project/$alias.wasm.gz"
    local_dfx canister install --wasm "$alias.wasm.gz" --argument '()' "$alias"
done
(
    cd "$host"
    CARGO_TARGET_DIR="$root/target" NEXUS_HOST_CATALOGUE="$project/nexus-catalogue.json" \
      cargo build --offline --locked --release --target wasm32-unknown-unknown
)
gzip -n -c "$root/target/wasm32-unknown-unknown/release/network_nexus_frontend.wasm" >"$project/nx_host.wasm.gz"
local_dfx canister install --wasm nx_host.wasm.gz --argument '()' nx_host
node web/browser-composed-view.mjs "$project" "$output"
