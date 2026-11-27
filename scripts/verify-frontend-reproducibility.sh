#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
repo=$PWD
revision=$(git rev-parse "${1:?Specify the source revision}^{commit}")
output="${2:?Specify a fresh directory for release evidence}"
: "${CANISTER_ID_REVIEWER:?Specify the fixed production reviewer principal}"
[[ -d web/node_modules/esbuild ]] || { echo 'Prepare the locked npm dependencies first.' >&2; exit 1; }

mkdir "$output"
output=$(cd "$output" && pwd)
scratch=$(mktemp -d "$output/work.XXXXXXXX")
trap 'rm -rf "$scratch"' EXIT
export CARGO_INCREMENTAL=0 DFX_NETWORK=ic
unset NEXUS_REPLAY_MANIFEST NEXUS_REPLAY_OUTPUT
printf 'Source %s\nReviewer %s\n' "$revision" "$CANISTER_ID_REVIEWER"
rustc -Vv
node --version
gzip --version | sed -n '1p'

build_copy() {
    local name=$1
    local source="$scratch/$name"
    mkdir "$source"
    git archive "$revision" Cargo.toml Cargo.lock rust-toolchain.toml canisters crates tests/source-fixture \
        scripts/build-frontend-wasm.sh web | tar -x -C "$source"
    ln -s "$repo/web/node_modules" "$source/web/node_modules"
    if [[ "$name" == changed-asset ]]; then
        printf '\n/* served asset hash sensitivity probe */\n' >> "$source/web/styles.css"
    fi
    (
        cd "$source"
        export CARGO_TARGET_DIR="$source/target"
        ./scripts/build-frontend-wasm.sh
    )
    cp "$source/target/wasm32-unknown-unknown/release/"nexus_frontend.wasm{,.gz} "$output/"
    mv "$output/nexus_frontend.wasm" "$output/$name.wasm"
    mv "$output/nexus_frontend.wasm.gz" "$output/$name.wasm.gz"
    gzip -dc "$output/$name.wasm.gz" | cmp "$output/$name.wasm"
    rm -rf "$source"
}

build_copy production
build_copy clean-repeat
cmp "$output/production.wasm" "$output/clean-repeat.wasm"
cmp "$output/production.wasm.gz" "$output/clean-repeat.wasm.gz"
build_copy changed-asset
if cmp -s "$output/production.wasm" "$output/changed-asset.wasm" ||
    cmp -s "$output/production.wasm.gz" "$output/changed-asset.wasm.gz"; then
    echo 'A served asset changed without changing both artifact hashes.' >&2
    exit 1
fi
(
    cd "$output"
    sha256sum production.wasm{,.gz} clean-repeat.wasm{,.gz} changed-asset.wasm{,.gz} > SHA256SUMS
    cat SHA256SUMS
)
