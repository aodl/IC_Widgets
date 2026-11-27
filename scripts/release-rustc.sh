#!/usr/bin/env bash
set -euo pipefail
rustc=$1
shift
flags=("--remap-path-prefix=${NEXUS_RELEASE_SOURCE:?}=/nexus/source")
if [[ -n "${OUT_DIR:-}" ]]; then
    # Prost-generated locations participate in the Wasm even with debug info disabled.
    flags+=("--remap-path-prefix=$OUT_DIR=/nexus/generated/${CARGO_PKG_NAME:-crate}")
fi
exec "$rustc" "${flags[@]}" "$@"
