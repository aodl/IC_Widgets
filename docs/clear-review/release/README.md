# Clear review release candidate

The release consists of a production reviewer Wasm, the generated Candid interface and a production frontend asset archive. `SOURCE_COMMIT` pins their source and `SHA256SUMS` records their exact file hashes. The reviewer uses canonical sources in production. The frontend bundle targets the existing reviewer `s34gv-3qaaa-aaaar-qcifa-cai`.

To reproduce from the source commit using the pinned Rust toolchain and locked frontend dependencies:

```bash
cargo build --locked --release --target wasm32-unknown-unknown -p nexus-reviewer
gzip -n -c target/wasm32-unknown-unknown/release/nexus_reviewer.wasm > reviewer.wasm.gz
cp canisters/reviewer/reviewer.did reviewer.did
npm --prefix web ci
DFX_NETWORK=ic CANISTER_ID_REVIEWER=s34gv-3qaaa-aaaar-qcifa-cai npm --prefix web run build
tar --sort=name --format=ustar --mtime=@0 --owner=0 --group=0 --numeric-owner --mode='a=rX,u+w' \
  -C web/dist -cf - . | gzip -n > frontend-assets.tar.gz
```

Candid extends the existing interface with contextual preview, policy observation, policy comparison and final Governance methods, plus scoped detail-page reads. Existing methods remain available with optional result extensions. The review context is transient and the stable layout is preserved. Analysis version 5 adds per-group rule evaluation over bound records and retains the raw Registry token grouping convention.

To repeat the PocketIC upgrade after `./scripts/test-m0.sh` has built the candidate and fixture, use the archived artifact that matches the predecessor's observed installed module. Set `POCKET_IC_BIN` to the PocketIC 14 server if needed.

```bash
DFX_IDENTITY=codex_local \
  NEXUS_REHEARSAL_OLD="$PWD/docs/review-artifacts/release/reviewer.wasm.gz" \
  NEXUS_REHEARSAL_MODULE_SHA256=9efc41f0c29ae1280522e6bf459a6f2c122ad24e7aff8a24c0367f73d7cbe9ec \
  cargo test --locked -p nexus-reviewer --test voting_upgrade -- --ignored --nocapture
```

A deployment requires the established backend upgrade and asset-only frontend release gates. The current frontend continues using the existing endpoint surface until the new bundle is installed. Use the existing runbook and authorization boundary. [Release process](../../VOTING_GRADE_REVIEW.md#reproduction-and-proposed-deployment)
