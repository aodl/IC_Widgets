#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
root="$PWD"
revision=6a6330c181d6697649da3779d1eb11a6cb729ac0
mkdir -p .local/m0-wasm
if [[ ! -s .local/m0-wasm/reviewer.wasm ]]; then
    mkdir -p .local/m0-wasm/source
    git archive "$revision" | tar -xf - -C .local/m0-wasm/source
    (
        cd .local/m0-wasm/source
        CARGO_TARGET_DIR="$root/target" cargo build --locked --release \
            --target wasm32-unknown-unknown -p nexus-reviewer --features local-fixtures
    )
    cp target/wasm32-unknown-unknown/release/nexus_reviewer.wasm .local/m0-wasm/reviewer.wasm
fi
sha256sum .local/m0-wasm/reviewer.wasm
