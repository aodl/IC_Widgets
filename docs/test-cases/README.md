# Permanent IC Widgets test-case catalogue

This frontend-only candidate serves `/test-cases` and directly shareable case paths such as `/test-cases/nns-144954-recorded-open`. Interactive cases open the ordinary Membership workflow. The case page and downloaded report identify bundled fixture evidence, original observations, the pinned Registry version, lifecycle and synthetic supplements. The live route uses the existing reviewer actor and canonical source protections. Production continues to serve the accepted standalone baseline. [Production release evidence](../release-candidates/membership-b8014c8/production/README.md)

## Catalogue and evidence boundary

The build reads the existing fixture replay manifests and indexed proposal catalogue. Topic labels come from committed indexed records. The same sources supply action names, proposal IDs, purposes, lifecycle labels, source observations and support limits. The 37 displayed entries include 12 interactive fixture cases. The other 25 link to their classification or automated-test context.

The browser fixture client decodes typed Candid replies from the existing reviewer workflow captured on a disposable replica. The reviewed proposal set is fixed by the route. The client matches the existing request encoding and refuses requests outside the capture. It can serve a captured record page in another workflow order using the original typed records and receipts. Exact analysis requests still have to match the recorded calculation digest. The case data is tied to the fixture manifest, indexed catalogue and reviewer interface by SHA-256. A normal build reads only checked-in inputs and prepared dependencies.

The adapter sits at the same client boundary as the live reviewer connection. The regular review session, Candid contract, map, calculations, node tables and report generator are reused. The capture tool drives the same staged review engine against the actual local reviewer and fixture source canister. Automated Rust and interactive replica replay suites remain available. A later composed view can give a widget the same scoped client. Performance is hidden in bundled test cases because these captures contain Membership evidence.

Case HTML and content-hashed Candid packs are embedded in the existing Rust frontend design and served through HTTP v2 certification. Case documents restrict connections to their own origin. There is no mutable fixture installation API or runtime source substitution in the reviewer.

## Disposable verification

Prepare the locked dependencies and Chromium according to the [frontend guide](../../web/README.md). Start the local fixture and retain the printed project directory:

```bash
./scripts/dev-review-fixture.sh --single --port 4969
node web/test-cases/capture.mjs "$project" web/test-cases/captures.json
```

Regenerate the capture only when intentionally refreshing the evidence. The generator uses one initialized fixture/reviewer pair and selects each interactive case in turn. It leaves the fixture on its last case. Reload `nns-144954-recorded-open` for the live-mode regression, then install the embedded local frontend in the disposable project using the [local upgrade procedure](../EMBEDDED_FRONTEND.md). Run the following and stop the replica afterwards:

```bash
node web/browser-test-catalogue.mjs "$project" .local/test-catalogue-evidence
node web/test-cases/measure.mjs "$project"
(cd "$project" && DFX_IDENTITY=codex_local dfx stop)
```

The Chromium run checked all 37 direct paths, 12 interactive reviews and nine generated ZIP reports. It exercised a paired proposal's second order and a second affected subnet, the slow-location case, terminal outcomes, reload, case switching, a 390 CSS-pixel catalogue and return to live mode. The independent verifier checked 102 HTTP v2 responses. All bundled reviews made zero reviewer or external requests. The live-mode control attempted only the intended local IC protocol. Rust and frontend Candid remained compatible with the existing release. [Browser report](evidence/summary.json) · [Catalogue capture](evidence/catalogue.png) · [Recorded case capture](evidence/144954-test-case.png) · [Generated review ZIP](evidence/144954-review.zip) · [Capture transcript](evidence/capture.log) · [Evidence hashes](evidence/SHA256SUMS)

## Artifact size and cycles

The exact production-profile build uses `DFX_NETWORK=ic CANISTER_ID_REVIEWER=s34gv-3qaaa-aaaar-qcifa-cai ./scripts/build-frontend-wasm.sh`. This command only builds the package. [Production-profile hashes](PRODUCTION-BUILD-SHA256SUMS) · [Disposable rehearsal hashes](REHEARSAL-BUILD-SHA256SUMS)

| Artifact | Accepted standalone | Catalogue candidate | Increase |
| --- | ---: | ---: | ---: |
| Uncompressed frontend Wasm | 1,873,295 bytes | 2,482,072 bytes | 608,777 bytes |
| Frontend install gzip | 707,373 bytes | 941,028 bytes | 233,655 bytes |

A warmed disposable run served 60 queries across the catalogue, case page and recorded Candid pack, totaling 2,450,400 response bytes in 660 ms. The frontend and idle reviewer balances each decreased by 1,944,000 cycles during the sampled window. The equal background change left no incremental query cost distinguishable in this local measurement. This measures local balances and browser-side case execution. It does not establish mainnet query pricing. [Cycle observations](evidence/cycles.json)
