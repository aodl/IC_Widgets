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
./scripts/dev-review-fixture.sh --port "$port" >"$launcher" 2>&1
project=$(sed -n 's/^Local project: //p' "$launcher")
[[ "$project" == "$root"/.local/review-fixtures.* ]]
jq '.canisters += (["nx_host","nx_membership","nx_membership_second","nx_performance"] |
    map({key:.,value:{type:"custom",candid:"frontend.did",wasm:(.+".wasm.gz")}}) | from_entries)' \
    "$project/dfx.json" >"$project/dfx.composed.json"
mv "$project/dfx.composed.json" "$project/dfx.json"
cp canisters/frontend/frontend.did "$project/frontend.did"
local_dfx() { (cd "$project" && dfx "$@" --network local); }
for alias in nx_host nx_membership nx_membership_second nx_performance; do
    local_dfx canister create --no-wallet "$alias"
done
origin() { printf 'http://%s.localhost:%s' "$(local_dfx canister id "$1")" "$port"; }
host_origin=$(origin nx_host)
node --input-type=module - "$(origin nx_membership)" "$(origin nx_membership_second)" "$(origin nx_performance)" \
  >"$project/nexus-catalogue.json" <<'JS'
const [first, second, performance] = process.argv.slice(2);
const port = (id, name) => ({ id, profile: { id: 'urn:ic-widgets:' + name, major: 1 } });
const proposals = port('proposals', 'proposal-ids');
const selection = port('selection', 'node-selection');
const widget = (definition, title, origin, inputs, outputs) =>
  ({ definition, title, origin, path: '/embed', configuration: { version: 1, value: {} }, inputs, outputs });
const widgets = [
  { ...widget('membership-one', 'Membership', first, [proposals], [selection]), downloads: true },
  { ...widget('membership-two', 'Membership', second, [proposals], [selection]), downloads: true },
  widget('performance', 'Performance', performance, [selection], []),
];
const view = (id, title, proposal, producer) => ({
  id, title, layout: 'two-column', inputs: [{ ...proposals, value: [proposal] }],
  widgets: [{ ...widgets[producer], id: 'membership' }, { ...widgets[2], id: 'performance' }],
  bindings: [
    { from: { input: 'proposals' }, to: { widget: 'membership', port: 'proposals' } },
    { from: { widget: 'membership', port: 'selection' }, to: { widget: 'performance', port: 'selection' } },
  ],
});
console.log(JSON.stringify({ widgets,
  dashboard: { version: 1, id: 'guest', title: 'IC Widgets replay', revision: 0,
    views: [view('one', 'Recorded review', '144954', 0), view('two', 'Multiple changes', '144940', 1)] },
}, null, 2));
JS
for spec in 'nx_membership reviewer proposal' 'nx_membership_second reviewer_4 proposal' 'nx_performance reviewer performance'; do
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
