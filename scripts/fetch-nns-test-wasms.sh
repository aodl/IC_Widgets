#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p .local
fetch() {
    local name="$1" revision="$2" hash="$3"
    local path=".local/$name-canister.wasm.gz"
    if [[ ! -f "$path" ]]; then
        curl --fail --silent --show-error --location --retry 2 \
            "https://download.dfinity.systems/ic/$revision/canisters/$name-canister.wasm.gz" \
            --output "$path.partial"
        mv "$path.partial" "$path"
    fi
    printf '%s  %s\n' "$hash" "$path" | sha256sum --check
}
fetch governance 98c898f8de068a1fc0e97ebc805f9fa7f315d862 7f85124ee08c3f59c0050009268807c7aea2b80ee296c23338b05458888f19df
fetch registry 00e4d8e3ee6081c1862e6119d63cffa76bd4af3d de89b547a135927288963c190379077a3facd5fb96c4e621af70ec89725a717b
