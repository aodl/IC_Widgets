# Source and toolchain manifest

Inspected on 22 November 2026. The upstream [IC source revision](https://github.com/dfinity/ic/tree/87617d5fda3b2c8ec0919293a5f1e3a068b07f43) provides the vendored Candid and protobuf schemas. [SHA256SUMS](../vendor/ic/SHA256SUMS) records the exact files. The build uses prost-build 0.14.4 and protoc 3.12.4, enabling the experimental flag required by that compiler for proto3 optional fields. Governance uses a bounded Candid width projection of the pinned types, supported by local wire tests. The full Governance outer response is retained when a variant is outside the projection.

| IC source | Principal | Artifact revision | Certified public module hash |
|---|---|---|---|
| NNS Governance | `rrkah-fqaaa-aaaaa-aaaaq-cai` | `98c898f8de068a1fc0e97ebc805f9fa7f315d862` | `7f85124ee08c3f59c0050009268807c7aea2b80ee296c23338b05458888f19df` |
| NNS Registry | `rwlgt-iiaaa-aaaaa-aaaaa-cai` | `00e4d8e3ee6081c1862e6119d63cffa76bd4af3d` | `de89b547a135927288963c190379077a3facd5fb96c4e621af70ec89725a717b` |

Public module hashes read using anonymous IC protocol `read_state` via `dfx canister info` match both the [pinned release manifest](https://github.com/dfinity/ic/blob/87617d5fda3b2c8ec0919293a5f1e3a068b07f43/mainnet-canister-revisions.json) and the SHA-256 of the compressed files retrieved by `scripts/fetch-nns-test-wasms.sh`. The released Governance DID differs from the vendored DID in a documentation comment. The Registry DID, raw transport proto, and four spot-join record schemas are byte-identical to their release sources. Public module metadata establishes artifact identity. It gives no observation of an application canister making live calls.

| Contract | Inspected source |
|---|---|
| Governance query conversion and 1,000-byte multi-result payload threshold | [Released conversion code](https://github.com/dfinity/ic/blob/98c898f8de068a1fc0e97ebc805f9fa7f315d862/rs/nns/governance/src/pb/proposal_conversions.rs) and [list/lookup implementation](https://github.com/dfinity/ic/blob/98c898f8de068a1fc0e97ebc805f9fa7f315d862/rs/nns/governance/src/governance.rs) |
| Registry raw entrypoints, certificate dependency and page cap | [Released entrypoints](https://github.com/dfinity/ic/blob/00e4d8e3ee6081c1862e6119d63cffa76bd4af3d/rs/registry/canister/canister/canister.rs) and [versioned store](https://github.com/dfinity/ic/blob/00e4d8e3ee6081c1862e6119d63cffa76bd4af3d/rs/registry/canister/src/registry.rs) |
| NNS function codes 2, 13, 18 and 31 | [Released Governance enum](https://github.com/dfinity/ic/blob/98c898f8de068a1fc0e97ebc805f9fa7f315d862/rs/nns/governance/proto/ic_nns_governance/pb/v1/governance.proto#L316) |
| Governing membership preconditions | [Atomic change](https://github.com/dfinity/ic/blob/87617d5fda3b2c8ec0919293a5f1e3a068b07f43/rs/registry/canister/src/mutations/do_change_subnet_membership.rs), [add](https://github.com/dfinity/ic/blob/87617d5fda3b2c8ec0919293a5f1e3a068b07f43/rs/registry/canister/src/mutations/do_add_nodes_to_subnet.rs) and [remove](https://github.com/dfinity/ic/blob/87617d5fda3b2c8ec0919293a5f1e3a068b07f43/rs/registry/canister/src/mutations/do_remove_nodes_from_subnet.rs) |
| Management wire, permissions and metrics semantics | [IC management interface](https://docs.internetcomputer.org/references/ic-interface-spec/management-canister/), [replica permissions](https://github.com/dfinity/ic/blob/0e0e15dbf24b6a0d9a1b7bba459d087eb5cd7125/rs/execution_environment/src/ic00_permissions.rs) and [metrics state](https://github.com/dfinity/ic/blob/0e0e15dbf24b6a0d9a1b7bba459d087eb5cd7125/rs/replicated_state/src/metadata_state.rs). This source revision does not identify every subnet’s running version. |
| Replicated query restrictions | [IC System API](https://docs.internetcomputer.org/references/ic-interface-spec/canister-interface/#replicated-and-non-replicated-execution-mode) and [resource limits](https://docs.internetcomputer.org/references/resource-limits/#message-limits) |

## Toolchain

| Tool or library | Pinned |
|---|---|
| Rust and Cargo | 1.96.0, with `wasm32-unknown-unknown` |
| dfx | 0.31.0, already available on the VM |
| Protobuf | protoc 3.12.4, prost/prost-build 0.14.4 |
| Candid | 0.10.37, candid-extractor 0.1.6 for interface generation |
| IC libraries | ic-cdk 0.20.3, ic-cdk-timers 1.0.0, stable structures 0.7.2, management types 0.8.0 |
| PocketIC | Rust client and server 14.0.0 |

Cargo.lock pins full dependency resolution. The management adapter uses the same bounded wait, destination and typed arguments as the pinned CDK helper implementation, with the raw response retained before decode for inspection.
