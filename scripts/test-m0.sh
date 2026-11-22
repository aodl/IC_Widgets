#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export DFX_IDENTITY=codex_local
export CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-6}"
mkdir -p .local/tmp
export TMPDIR="$PWD/.local/tmp"
sha256sum --check vendor/ic/SHA256SUMS
if [[ -z "${POCKET_IC_BIN:-}" && -f "$HOME/.cache/pocket-ic/pocket-ic-server-14.0.0.gz" ]]; then
    mkdir -p .local/pocket-ic-14
    if [[ ! -x .local/pocket-ic-14/pocket-ic-server ]]; then
        gzip -dc "$HOME/.cache/pocket-ic/pocket-ic-server-14.0.0.gz" > .local/pocket-ic-14/pocket-ic-server
        chmod 700 .local/pocket-ic-14/pocket-ic-server
    fi
    export POCKET_IC_BIN="$PWD/.local/pocket-ic-14/pocket-ic-server"
fi
if [[ -n "${POCKET_IC_BIN:-}" ]]; then
    [[ "$("$POCKET_IC_BIN" --version)" = "pocket-ic-server 14.0.0" ]]
fi
command -v didc >/dev/null
[[ "$(candid-extractor --version)" = "candid-extractor 0.1.6" ]]
./scripts/build-m0-fixture.sh
cargo build --locked --release --target wasm32-unknown-unknown -p nexus-source-fixture --features slow-governance
cp target/wasm32-unknown-unknown/release/nexus_source_fixture.wasm .local/slow-source-fixture.wasm
cargo build --locked --release --target wasm32-unknown-unknown -p nexus-reviewer --features local-fixtures -p nexus-source-fixture
cp target/wasm32-unknown-unknown/release/nexus_reviewer.wasm .local/reviewer-fixture.wasm
if cmp -s .local/m0-wasm/reviewer.wasm .local/reviewer-fixture.wasm; then
    echo "M0 and current fixture Wasms are identical" >&2
    exit 1
fi
cargo build --locked --release --target wasm32-unknown-unknown -p nexus-reviewer
export NEXUS_M0_TEST=1
./scripts/fetch-nns-test-wasms.sh
capture=()
if [[ "${NEXUS_TEST_VERBOSE:-1}" != 0 ]]; then
    capture=(--nocapture)
fi
cargo test --locked --workspace -- "${capture[@]}"
cargo test --locked -p nexus-reviewer --test m0 -- --ignored "${capture[@]}"
cargo test --locked -p nexus-reviewer --test m1 -- --ignored "${capture[@]}"
candid-extractor target/wasm32-unknown-unknown/release/nexus_reviewer.wasm |
    sed 's/[[:blank:]]*$//' > .local/reviewer.did
diff -u canisters/reviewer/reviewer.did .local/reviewer.did
didc check .local/reviewer.did canisters/reviewer/m0.did
