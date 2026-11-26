# Clear review release candidate

The release consists of a production reviewer Wasm, the generated Candid interface and a production frontend asset archive. `SOURCE_COMMIT` pins their source and `SHA256SUMS` records their exact file hashes. The reviewer uses canonical sources in production. The frontend bundle targets the existing reviewer `s34gv-3qaaa-aaaar-qcifa-cai`.

To reproduce from the source commit using the pinned Rust toolchain and locked frontend dependencies:

```bash
cargo build --locked --release --target wasm32-unknown-unknown -p nexus-reviewer
gzip -n -c target/wasm32-unknown-unknown/release/nexus_reviewer.wasm > reviewer.wasm.gz
cp canisters/reviewer/reviewer.did reviewer.did
npm --prefix web ci
DFX_NETWORK=ic CANISTER_ID_REVIEWER=s34gv-3qaaa-aaaar-qcifa-cai npm --prefix web run build
tar --sort=name --format=ustar --mtime=@0 --owner=0 --group=0 --numeric-owner \
  -C web/dist -cf - . | gzip -n > frontend-assets.tar.gz
```

Candid extends the existing interface with contextual preview, policy observation, policy comparison and final Governance methods. Existing methods remain available with optional result extensions. The review context is transient and the stable layout is preserved. Analysis version 4 identifies the raw Registry token grouping convention.

A deployment requires the established backend upgrade and asset-only frontend release gates. The current frontend continues using the existing endpoint surface until the new bundle is installed. Use the existing runbook and authorization boundary. [Release process](../../VOTING_GRADE_REVIEW.md#reproduction-and-proposed-deployment)
