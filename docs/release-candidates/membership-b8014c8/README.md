# Standalone Membership release candidate

The release source and build inputs are frozen at `b8014c8d264928a3ed8f16338fb5d4dc9a494489`. The publication commit adds the packages and verification evidence to PR #10. [Pinned source](https://github.com/aodl/IC_Widgets/tree/b8014c8d264928a3ed8f16338fb5d4dc9a494489) · [PR #10](https://github.com/aodl/IC_Widgets/pull/10)

| Install package | Bytes | SHA-256 |
| --- | ---: | --- |
| [Frontend](frontend.wasm.gz) | 707,373 | `d3c27e678ff4313972a781abafbd2ed8ef31f2824cd0b77adb85f02411cf73cc` |
| [Reviewer](reviewer.wasm.gz) | 918,015 | `bb0b3cf4d08267f1262eac26d6cde1d34b2e0b8f0331d525dd7faaab0efe21db` |

Run `sha256sum -c SHA256SUMS` from this directory to verify the published packages and Candid interfaces. The published Candid copies trim trailing spaces. Use the gzip hashes to check the installed module hashes when installing these exact gzip bytes. Decompress the published packages to recover the exact raw Wasm. The full build manifest records the raw Wasm hashes and the original Candid hashes. [Published file manifest](SHA256SUMS) · [Full build manifest](BUILD-SHA256SUMS)

## Verification

- Two clean builds compiled the pinned source from separate directories. Raw Wasm, gzip packages and the extracted Candid interfaces matched byte for byte. The build transcript records the toolchain and both checksum checks. Local build paths are abbreviated in the published copy. [Build transcript](evidence/build.log) · [Reproduction command and exact raw Wasm hashes](../../RELEASE_CANDIDATE.md#prepare-the-release-artifacts)
- The exact production frontend package matched the installed module hash on a disposable replica. The gateway verified 11 certified responses and served no application assets on the tested raw hosts. Chromium completed the recorded Membership flow with zero external requests. [Frontend install](evidence/frontend-install.txt) · [Gateway verification](evidence/frontend-gateway.json) · [Browser network report](evidence/browser-network.json)
- The paired rehearsal upgraded the reviewer first and rolled it back last. Both local canisters retained their IDs and controllers. The reviewer retained its synthetic checkpoint and evidence, and rollback restored the original frontend asset bytes. The candidate reviewer passed the new Membership methods and the legacy policy comparison. [Upgrade and rollback transcript](evidence/upgrade-rollback.log) · [Reviewer workflow transcript](evidence/reviewer-workflow.log)
- The mainnet observations were certified and read-only. They identify the exact legacy frontend and PR #9 reviewer modules. The older reviewer lacks methods required by the candidate frontend, so the proposed release upgrades the existing reviewer before the existing frontend. [Mainnet preflight](evidence/mainnet-certified.json) · [Recheck](evidence/mainnet-recheck.jsonl) · [Compatibility result](evidence/reviewer-backward-incompatibility.txt) · [Proposed upgrade order](../../RELEASE_CANDIDATE.md#proposed-upgrade-and-rollback)

The development replay remains available for acceptance. Production installation requires separate authorization. [Public development preview](https://treaty-database-sizes-enforcement.trycloudflare.com/)
