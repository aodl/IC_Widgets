# Voting-grade review artifacts

The browser artifacts show proposal 144954 on `tdb26`, with scenario **A independently** and phase **After proposal #144954 (final step)** at Registry version **66,013**. They come from a local replay of recorded public Registry and Governance replies. The Markdown renders the exported map and states both the original Governance observation and the local replay’s limits.

| Evidence | File |
|---|---|
| Complete generated review | [Markdown](144954/review.md) |
| Map for the exported review | [PNG](144954/map.png) |
| Browser screenshots | [Desktop](144954/desktop.png) · [Mobile](144954/mobile.png) |
| Exact replicated comparison input | [Candid bytes](144954/calculation.didbin) |
| Test results and stage measurements | [Verification report](VERIFICATION.md) |
| Evidence interpretation and proposed rollout | [Parity matrix and methodology](../VOTING_GRADE_REVIEW.md) |
| Original source observations | [Capture manifest](../../tests/source-fixture/data/144954/capture.json) |
| Artifact integrity | [SHA-256 checksums](SHA256SUMS) |

Verify the downloaded calculation input against the SHA-256 in the Markdown. To inspect its typed fields, run this command from the repository root:

```bash
didc decode --defs canisters/reviewer/reviewer.did --method compare_membership_details \
  "$(xxd -p -c 256 docs/review-artifacts/144954/calculation.didbin | tr -d '\n')"
```

The release package uses the existing backend and frontend canisters. The [artifact source revision](release/SOURCE_COMMIT) identifies the code used for the builds. Review artifacts and verification notes are published in a subsequent commit.

| Deployment artifact | File |
|---|---|
| Compressed production backend Wasm | [reviewer.wasm.gz](release/reviewer.wasm.gz) |
| Production asset archive | [frontend-assets.tar.gz](release/frontend-assets.tar.gz) |
| Isolated frontend-only deployment configuration | [dfx.json](release/frontend-only/dfx.json) · [canister IDs](release/frontend-only/canister_ids.json) |
| Release integrity | [Release checksums](release/SHA256SUMS) |
