# Subnet Activity release candidate

The production build source is `8611094901da951fbca033e7aae74d99aa6706b2`. Production remains on the catalogue baseline. [Acceptance findings, source-call counts and branch integration](ACCEPTANCE.md) · [Source commit](SOURCE_COMMIT) · [Install manifest](SHA256SUMS) · [Two-build manifest](BUILD-SHA256SUMS)

| Canister | Exact gzip bytes | Install package SHA-256 | Uncompressed bytes | Uncompressed Wasm SHA-256 |
| --- | ---: | --- | ---: | --- |
| [Frontend](frontend.wasm.gz) | 1,091,152 | `f64a81cd9d00bf734d1f992f5976b6a3d0405924b75e7273f9c6fddb3388e2e3` | 2,877,923 | `798bb6181236b5258cba8a2a78c0559b10c597cd02879a3d9597b6e1f1ffd6b7` |
| [Reviewer](reviewer.wasm.gz) | 979,381 | `a9337f47cce5e294718598d0adf1d3aa33fd034f9b1a786b81d1b2f5709359d2` | 5,202,714 | `d5941f4ad6fca97ca53d8ca1786d116591a54d91ccbc2b06fc0c947ce3176e48` |

Use the exact gzip digest to check the resulting installed module hash when deploying these gzip packages. The uncompressed digest identifies the Wasm payload. Two independently archived clean builds matched byte for byte for the raw Wasms, deterministic gzip packages and extracted Candid files. The published Candid copies trim trailing whitespace. [Build transcript](evidence/build.log) · [Frontend Candid](frontend.did) · [Reviewer Candid](reviewer.did)

## Proposed deployment, pending explicit authorization

The entire upgrade scope is the two existing production canisters. Recheck their certified identities, controllers, installed hashes, available cycle margin and collector status at deployment time. Compare to the recorded baselines and preserve the exact rollback packages, frontend asset evidence and reviewer checkpoint and receipts before touching either canister.

| Canister | Recorded installed package SHA-256 | Existing principal |
| --- | --- | --- |
| Frontend catalogue | `b8acdc601b8d2580476a488a735fff17781937846fc782b63c7e1a87ddc166d8` | `s45ab-wiaaa-aaaar-qcifq-cai` |
| Reviewer | `bb0b3cf4d08267f1262eac26d6cde1d34b2e0b8f0331d525dd7faaab0efe21db` | `s34gv-3qaaa-aaaar-qcifa-cai` |

1. Upgrade the reviewer in place using the published gzip. Check the installed hash, controllers, stable checkpoint and retained evidence, disabled collector and compatibility with the catalogue frontend.
2. Upgrade the frontend in place using the published gzip. Check the installed hash, controllers, certified HTML and assets, raw-host refusal, public navigation, catalogue, and independent and linked application paths. Use only eligible currently observable data for prospective mainnet verification.
3. If rollback is required, restore the exact preceding frontend gzip first, with the reviewer still compatible. Verify frontend bytes and serving. Restore the prior reviewer gzip second and verify stable state and disabled collection again. Stop before making changes if preflight materially differs from the rehearsed baseline.

This pass authorized only disposable rehearsals and publication for review. No production deployment, controller changes, top-ups or new canisters occurred.

## Release verification

- The exact packages installed in the disposable environment reported both published gzip hashes as their module hashes. The gateway verified 126 responses, including the catalogue and all case routes. Canister-qualified raw requests returned 403. The bare raw localhost alias was blocked by gateway verification with 503. [Exact local installs](evidence/exact-install.log) · [Gateway verification](evidence/exact-gateway.json)
- The extracted services passed Candid compatibility against the recorded catalogue frontend and Membership reviewer. The paired rehearsal used the exact prior packages, upgraded reviewer then frontend, and restored frontend then reviewer. It preserved canister settings, 1,793 stable pages, the Registry cursor and target, nine retained observations and the 1,575-byte raw Governance reply. The collector stayed disabled and without a lease over the simulated day. Frontend rollback reproduced the previous HTML, JavaScript and CSS byte for byte. [Upgrade and rollback transcript](evidence/upgrade-rollback.log)
- The first immediate frontend rollback attempt encountered the install-code rate limit. The passing rehearsal advanced the disposable replica clock and let the debit replenish before restoring the prior frontend package. During a real rollback, wait out a rate-limit response and verify the restored frontend before touching the reviewer. The local cooldown is evidence of the condition, not a mainnet timing guarantee.
