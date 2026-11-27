#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
repo=$PWD
revision=$(git rev-parse "${1:?Specify the source revision}^{commit}")
: "${2:?Specify a fresh release evidence directory}"
: "${CANISTER_ID_REVIEWER:?Specify the production reviewer principal}"
[[ -d web/node_modules/esbuild ]] || { echo 'Prepare the locked npm dependencies first.' >&2; exit 1; }
mkdir "$2"
output=$(cd "$2" && pwd)
exec > >(tee "$output/build.log") 2>&1
git show "$revision:scripts/release-rustc.sh" > "$output/reviewer-rustc"
chmod +x "$output/reviewer-rustc"
export DFX_NETWORK=ic CARGO_INCREMENTAL=0
unset NEXUS_REPLAY_MANIFEST NEXUS_REPLAY_OUTPUT

printf '%s\n' "$revision" > "$output/SOURCE_COMMIT"
printf 'Source %s\nReviewer %s\n' "$revision" "$CANISTER_ID_REVIEWER"
rustc -Vv
node --version
protoc --version
gzip --version | sed -n '1p'

build_copy() {
    local name=$1
    local checkout target
    checkout=$(mktemp -d "$output/source.XXXXXXXX")
    target="$checkout/target"
    git archive "$revision" Cargo.toml Cargo.lock rust-toolchain.toml canisters crates tests/source-fixture vendor/ic \
        scripts/build-frontend-wasm.sh web | tar -x -C "$checkout"
    ln -s "$repo/web/node_modules" "$checkout/web/node_modules"
    local wasm="$target/wasm32-unknown-unknown/release"
    (
        cd "$checkout"
        export CARGO_TARGET_DIR="$target"
        sha256sum --check vendor/ic/SHA256SUMS
        ./scripts/build-frontend-wasm.sh
        NEXUS_RELEASE_SOURCE="$checkout" RUSTC_WRAPPER="$output/reviewer-rustc" \
            cargo build --offline --locked --release --target wasm32-unknown-unknown -p nexus-reviewer
    )
    mkdir "$output/$name"
    cp "$wasm/nexus_frontend.wasm" "$output/$name/frontend.wasm"
    cp "$wasm/nexus_frontend.wasm.gz" "$output/$name/frontend.wasm.gz"
    cp "$wasm/nexus_reviewer.wasm" "$output/$name/reviewer.wasm"
    gzip -n -c "$wasm/nexus_reviewer.wasm" > "$output/$name/reviewer.wasm.gz"
    for canister in frontend reviewer; do
        gzip -dc "$output/$name/$canister.wasm.gz" | cmp "$output/$name/$canister.wasm"
        candid-extractor "$output/$name/$canister.wasm" > "$output/$name/$canister.did"
        local interface="$checkout/canisters/$canister/$canister.did"
        didc check "$output/$name/$canister.did" "$interface"
        didc check "$interface" "$output/$name/$canister.did"
    done
    cargo clean --target-dir "$target"
}

build_copy first
build_copy repeat
cd "$output"
for canister in frontend reviewer; do
    for extension in wasm wasm.gz did; do
        cmp "first/$canister.$extension" "repeat/$canister.$extension"
    done
done
wc -c first/*.wasm first/*.wasm.gz
sha256sum first/* repeat/* > SHA256SUMS
sha256sum -c SHA256SUMS
