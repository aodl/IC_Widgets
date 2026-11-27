# Embedded, certified frontend

The Network Nexus web application is embedded in `nexus_frontend.wasm`. Installation and upgrade rebuild the HTTP v2 certification tree from the immutable assets. The one public method is the `http_request` query. The Rust canister serves certified GET and HEAD responses for the root, HTML, hash-named scripts and styles, and a certified 404 for unmatched paths. HTML and the fallback use no-store. Hash-named files use one-year immutable caching.

The implementation follows Jupiter's pinned `include_dir` and `AssetRouter` pattern. A shared `HttpCertificationTree` covers GET and HEAD. The canister advertises v2 in public Wasm metadata. The security headers use Network Nexus's origin and reviewer protocol policy. The gateway allows scripts and styles from the frontend origin, and connections to that origin and the IC protocol gateway. [Jupiter Rust frontend](https://github.com/aodl/JUPITER_FAUCET_SUITE/blob/ed756fa7ba17abfd918a89f63d3e20c827b057ec/canisters/frontend/src/lib.rs) · [Jupiter web build](https://github.com/aodl/JUPITER_FAUCET_SUITE/blob/ed756fa7ba17abfd918a89f63d3e20c827b057ec/canisters/frontend/web/build-frontend.mjs) · [Jupiter release verification](https://github.com/aodl/JUPITER_FAUCET_SUITE/blob/ed756fa7ba17abfd918a89f63d3e20c827b057ec/docs/operations/reproducible-builds.md)

## Build and verify

Prepare the locked dependencies with `cargo fetch --locked` and `npm --prefix web ci`. The tested environment used Rust 1.96.0, Node 24.15.0, GNU gzip 1.10, the checked-in locks and DFX 0.31.0. Ordinary builds consume the prepared dependencies. The Rust build invokes the web bundler into a fresh Cargo output directory, checks the HTML references, renames the JS and CSS by SHA-256 and embeds the generated assets. The separate development replay build still writes its legacy layout. Embedded builds reject replay inputs in every network profile.

Build the production package without installing anything:

```bash
CANISTER_ID_REVIEWER=s34gv-3qaaa-aaaar-qcifa-cai DFX_NETWORK=ic \
  ./scripts/build-frontend-wasm.sh
```

The build prints both sizes and SHA-256 digests. The release package is `target/wasm32-unknown-unknown/release/nexus_frontend.wasm.gz`. Use the SHA-256 of the exact package passed to `install_code` as the installed module hash comparison. When installing the gzip package, compare its gzip digest. The raw Wasm digest describes the decompressed module.

```bash
CANISTER_ID_REVIEWER=s34gv-3qaaa-aaaar-qcifa-cai \
  ./scripts/verify-frontend-reproducibility.sh <source-commit> .local/frontend-repro
```

The verifier builds two clean source and target directories from the same revision, compares both raw and gzip files byte for byte, then changes one served stylesheet in a third disposable copy. This is a same-environment reproducibility check. It keeps the prepared dependency set and tool versions fixed.

## Verification at the PR #10 baseline

Implementation `3b5ed9b553cb2c410926181daa15eb71d21ae4b6` embeds the accepted interface from PR #10 revision `5deed456870b2c1e32a33833186c362aed922c65`. Two clean production builds generated these byte-identical artifacts.

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| Raw Wasm | 1,869,747 | `1eb46a2c17c52c0f6be479d11e305db7a961f287b368450ea44d98315781bd56` |
| Gzip install package | 705,394 | `e69d4e1725924a33ecc812e50f6e5cdc69b680e82a5d79af15ac6e0fe010225e` |

The disposable frontend installed from gzip reported the gzip SHA-256 as its module hash. A separate disposable frontend installed from raw Wasm reported the raw SHA-256. The stylesheet-only variant changed both digests, and installing its gzip changed the module hash to `ddd6e7d372f317a6943d609f96e413135cb7e5a4c78c633a3a9c32721cd0ee98`. The real gateway served the new certified CSS path and the same certified JavaScript path.

The legacy module used for rehearsal matched the observed production module hash. The upgrade preserved the disposable frontend principal and controllers. Rollback restored the legacy module and reproduced the saved HTML and JavaScript byte for byte. The reviewer module and controllers matched their preflight status throughout. The gateway verifier validated 11 HTTP v2 responses for the local application profile, exact production package, exact raw Wasm and stylesheet variant. The exact production package served byte-identical JavaScript and CSS to the accepted PR baseline.

Chromium completed proposal 144954 using the embedded local profile and the real gateway. The restricted browser observed ten reviewer IC calls for the normal review and one local replica trust-root request. Map interaction and report generation made zero additional IC calls and zero external requests.

## Disposable local migration and network regression

Start the standard asset canister in the existing local harness:

```bash
./scripts/dev-review-fixture.sh --single --port 4991
```

Set `project` to the printed project directory. Record the local frontend principal, controllers, installed hash and the old gateway responses. Build the embedded local profile with that project's reviewer ID. Copy the previous `assetstorage.wasm.gz` and the original local DFX configuration for rollback. Replace only the disposable project's frontend configuration with the custom canister entry and existing alias. Point it at the built gzip and `canisters/frontend/frontend.did`. Preserve its local canister mapping and reviewer entry. Use `DFX_IDENTITY=codex_local dfx canister install --network local --mode upgrade --wasm <gzip> frontend` in that project. The normal upgrade lets the standard asset canister save its state. The embedded implementation uses heap certification state and leaves stable memory available for rollback.

DFX reports an incompatible Candid interface because the old asset-management methods, including `api_version`, are intentionally removed. The disposable rehearsal acknowledged that prompt.

```bash
node web/verify-embedded-frontend.mjs "$project"
node web/browser-production-network.mjs "$project" "$PWD/.local/embedded-browser"
```

The Node verifier checks the actual gateway bytes against the replica trust root using the official response verifier. The browser driver loads the same certified bytes directly. Its allowlist is limited to the frontend assets and reviewer IC protocol. The embedded local profile uses the local protocol status endpoint to establish replica trust. The production profile still uses the SDK's pinned mainnet root. The production artifact's static responses can be checked through the local gateway without running its mainnet reviewer calls.

## Proposed production migration

The read-only certified observation at 2026-11-27 15:23:15 UTC reported frontend `s45ab-wiaaa-aaaar-qcifq-cai`, installed module SHA-256 `04e565b3425fe7510ee16b02adcfe3f01abc9a2725c82a21cb08969241debd62`, and these controllers:

- `amzih-bssz4-twanl-zf6nr-bqsnn-d7rlt-eerbc-oe7vv-uggn5-3naqo-3ae`
- `zkkkd-i34qc-367ln-e2u7o-ezznu-dkfqh-gtfvz-cviph-6qa4v-evtfs-wqe`

For a separately authorized migration, recheck the certified frontend and reviewer identities, the frontend module hash and controllers, and the old certified assets. Retain the exact current standard asset module and the old asset snapshot for rollback. Use the existing frontend-only DFX mapping and change its build type to custom without changing the canister principal or controllers. Upgrade in place with the exact reviewed production gzip so the legacy asset canister runs its normal pre-upgrade hook. Compare the installed hash to the reviewed gzip and verify certified HTML, hashed scripts and styles, HEAD, 404 and application functionality. Compare the controller set and reviewer module hash with their preflight observations. Use the recorded standard asset Wasm upgrade for rollback if required and verify the restored certified assets against the snapshot.

The implementation and rehearsal use a disposable local replica for installs and upgrades. Mainnet was accessed only for read-only metadata.
