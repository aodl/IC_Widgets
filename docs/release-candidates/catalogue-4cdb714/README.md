# IC Widgets catalogue and presentation release candidate

This frontend-only candidate was built from commit `4cdb714258f6ea0cf8f1163d0a6d1b42cda9ad51`. It adds the embedded test-case catalogue and the accepted standalone presentation. The package targets the existing frontend at `s45ab-wiaaa-aaaar-qcifq-cai`. The deployed reviewer baseline is `s34gv-3qaaa-aaaar-qcifa-cai` and remains the compatibility target. Subnet Activity is outside this candidate. Publication is for review and authorization.

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| Exact install gzip and local observed installed hash | 941,028 | `b8acdc601b8d2580476a488a735fff17781937846fc782b63c7e1a87ddc166d8` |
| Uncompressed Wasm | 2,482,072 | `d24afb34213f8d2ec5fc78641bb9b2d33f64782d00900ac0c1d6f7cda709af15` |

Verify the install gzip with `sha256sum -c SHA256SUMS` from this directory. Run `scripts/verify-frontend-reproducibility.sh 4cdb714 <output-directory>` from the checkout to rebuild. Two clean builds produced byte-identical output in both formats. A stylesheet change produced distinct hashes in both formats. The [build manifest](BUILD-SHA256SUMS) includes all six hashes and the [toolchain record](evidence/toolchain.txt) identifies the tools used.

Both the candidate frontend and baseline reviewer interfaces were extracted from the exact packages. The candidate and baseline frontend interfaces passed `didc check` in both directions. The extracted baseline reviewer interface and the interface consumed by this candidate also passed in both directions. Reviewer and engine sources are identical to the standalone production publication.

An ephemeral replica rehearsal installed the exact previous frontend and reviewer gzip packages, upgraded the frontend in place with this package and restored the earlier frontend gzip. The reviewer module hash and both local controller sets remained constant. The frontend returned to its prior module hash and identical gateway verification output. The [candidate gateway record](evidence/gateway-candidate.json) covers actual HTTP certification for HTML, JS, CSS, the catalogue, every case route and replay bundle, unknown routes and refusal on the raw host. The local gateway could not route the bare raw localhost host with a canister-ID query for this topology and returned 503 without serving application assets.

The [catalogue browser acceptance](../../test-cases/evidence/summary.json) uses the local-profile frontend with a disposable reviewer and verifies the ordinary review interface, report generation and separation between replay and live reviews. The exact production-profile package was tested for installation and static delivery on the local replica. The rehearsal made no changes to mainnet. A production upgrade requires separate authorization.
