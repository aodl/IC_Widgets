#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
: "${CANISTER_ID_REVIEWER:?Set the reviewer canister principal}"
if [[ -n "${NEXUS_REPLAY_MANIFEST:-}${NEXUS_REPLAY_OUTPUT:-}" ]]; then
    echo "Embedded frontend builds refuse replay inputs." >&2
    exit 1
fi
export DFX_NETWORK="${DFX_NETWORK:-ic}"
target_dir="${CARGO_TARGET_DIR:-target}"
cargo build --offline --locked --release --target wasm32-unknown-unknown -p nexus-frontend
wasm="$target_dir/wasm32-unknown-unknown/release/nexus_frontend.wasm"
package="$wasm.gz"
temporary=$(mktemp "$package.XXXXXXXX")
trap 'rm -f "$temporary"' EXIT
gzip -n -c "$wasm" > "$temporary"
mv "$temporary" "$package"
wc -c "$wasm" "$package"
sha256sum "$wasm" "$package"
