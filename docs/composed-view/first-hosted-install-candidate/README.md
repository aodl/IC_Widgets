# First hosted Network Nexus installation candidate

The five allocated canisters are empty on mainnet. This package requests a separate install approval.

| Role | Canonical origin | Subnet | Cycles-ledger creation block | Balance observed after allocation |
| --- | --- | --- | ---: | ---: |
| Network Nexus host | [5i3qr-tyaaa-aaaar-qcjaq-cai](https://5i3qr-tyaaa-aaaar-qcjaq-cai.icp.net/) | Fiduciary, 34 nodes | 17,348,258 | 149,994,915,979 |
| Subnet Activity | [mdoiw-yaaaa-aaaas-am2ca-cai](https://mdoiw-yaaaa-aaaas-am2ca-cai.icp.net/embed) | European, 13 nodes | 17,348,264 | 149,998,056,000 |
| Membership Inspector | [mepoc-vyaaa-aaaas-am2cq-cai](https://mepoc-vyaaa-aaaas-am2cq-cai.icp.net/embed) | European, 13 nodes | 17,348,271 | 149,998,056,000 |
| IC Node Map | [mnmf6-dqaaa-aaaas-am2da-cai](https://mnmf6-dqaaa-aaaas-am2da-cai.icp.net/embed) | European, 13 nodes | 17,348,274 | 149,998,056,000 |
| Node Performance | [mkndk-oiaaa-aaaas-am2dq-cai](https://mkndk-oiaaa-aaaas-am2dq-cai.icp.net/embed) | European, 13 nodes | 17,348,284 | 149,998,056,000 |

Certified state-tree delegations confirmed actual placement. The two approved controllers were observed on every canister. All five used zero reserved compute and memory allocation, the 30-day freezing threshold and the existing storage reservation limit. [Allocation and build manifest](manifest.json) · [Creation transactions](creation-ledger-blocks.json) · [Management status and placement evidence](evidence)

On 28 November 2026 the deployment account converted 2.82315987 ICP at the observed 1.4375 trillion cycles per ICP rate. It paid 0.00010000 ICP for the conversion transfer at ICP ledger block 40,765,345 and retained 0.17674013 ICP. Creation debited 4,058,192,307,692 cycles. Including the 100,000,000-cycle mint deposit fee, 3,308,292,307,692 cycles went to fees and 750,000,000,000 cycles were initially retained across the new balances. Status observations reflect small subsequent charges. The 5,433-cycle excess from ICP denomination rounding remained in the deployment cycles-ledger account. [Conversion and balance evidence](evidence)

## Exact build inputs

- Network Nexus `b8c174b928a9c07dad7a76aa5145ca24e5ed3bfa` supplies the generic host.
- IC Widgets `a3a3787326bcc2f17dd17b0fde198b3a98fe4c97` supplies the four profiles.
- The pinned [production catalogue](catalogue.json) supplies a prepared NNS Activity review view as data. The host retains the blank guest workspace.
- The widget builds use `DFX_NETWORK=ic`, `CANISTER_ID_REVIEWER=s34gv-3qaaa-aaaar-qcifa-cai`, `IC_WIDGET_HOST_ORIGIN=https://5i3qr-tyaaa-aaaar-qcjaq-cai.icp.net`, and the `activity`, `inspector`, `map` or `performance` profile for `IC_WIDGET_EMBED_VIEW`. Use the source repository's `scripts/build-frontend-wasm.sh` and prepared lockfile dependencies.
- The host uses `DFX_NETWORK=ic` and `NEXUS_HOST_CATALOGUE` pointing to the exact production catalogue. Build each fresh source copy with `cargo build --locked --offline --release --target wasm32-unknown-unknown` and compress the host artifact with `gzip -n`.

The two isolated source and target builds matched byte for byte for all five uncompressed Wasms, compressed packages and extracted Candid files. The extracted service interfaces matched the checked-in interfaces in both directions. The published Candid copies trim trailing spaces in comments. The manifest records both size and hash forms. The downloadable packages are the exact compressed files. [Package checksums](SHA256SUMS) · [Build verification](evidence/build-verification.txt)

## Verification and installation order

All five exact production packages were installed on a disposable local replica. The local IC gateway verified 23 certificate-v2 responses, including the four widget routes that excluded the development catalogue. The test then supplied those already-verified response bytes to a network-restricted browser at the exact production origins. The four widget handshakes completed, blank guest creation worked, an unapproved parent was blocked, and the browser attempted no unauthorized requests. Mainnet gateway checks and live source-workflow smoke tests remain for the installation stage. The disposable replica was stopped. [Certified gateway and browser evidence](evidence/gateway-verification.json)

After installation approval, recheck the five IDs, placement, both controllers, settings, available balance and empty module hashes. Validate `SHA256SUMS` and the per-target manifest. Install the widget packages one at a time in Activity, Inspector, Map and Performance order. Verify each installed module hash, certified embed and framing policy. Install the host last. Then run the previously agreed bounded live smoke test and confirm the existing standalone and reviewer fingerprints. Keep the standalone deployment independent throughout. [Smoke-test plan](../first-hosted-release.md#package-preparation-and-launch-verification) · [Existing production observations](unchanged-production.txt)
