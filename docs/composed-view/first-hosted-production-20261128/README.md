# First hosted Network Nexus release

On 28 November 2026, the four independently hosted widget frontends were installed first on the European application subnet. The Network Nexus host was installed last on the Fiduciary subnet. Each canister kept its allocated ID, both controllers and its approved settings. Both existing IC Widgets canisters kept their installed hashes, controllers and settings. [Authorized candidate](../first-hosted-install-candidate/manifest.json) · [Read-only existing production observations](evidence/existing)

| Frontend | Canonical URL | Install window (UTC) | Compressed install SHA-256 |
| --- | --- | --- | --- |
| Subnet Activity | [Certified embed](https://mdoiw-yaaaa-aaaas-am2ca-cai.icp.net/embed) | 15:46:27–15:46:30 | `a6376142e539f82da5cc7f84df9fdb1c0a2ce3aa080d2b8816fd18a68f46a67b` |
| Membership Inspector | [Certified embed](https://mepoc-vyaaa-aaaas-am2cq-cai.icp.net/embed) | 15:46:33–15:46:36 | `ad33060a928977a8b86ce2452ad4876d0da309d6ea8930905ac49ab0b2366aa9` |
| IC Node Map | [Certified embed](https://mnmf6-dqaaa-aaaas-am2da-cai.icp.net/embed) | 15:46:39–15:46:41 | `be49747fbd8a16a3c1bd7cb30c5cb3c1671987b1c5e73da7512c9b19bfac92d4` |
| Node Performance | [Certified embed](https://mkndk-oiaaa-aaaas-am2dq-cai.icp.net/embed) | 15:46:44–15:46:48 | `e62658ca0ecd41509f29a712432e830806a9d8d79dfe06383ee01c315afe8e96` |
| Network Nexus host | [Permanent certified application](https://5i3qr-tyaaa-aaaar-qcjaq-cai.icp.net/) | 15:46:51–15:46:57 | `3b513f90ec66a0371df6a1cdf6ce28a56a30be2f86b955578ecc6e79bef75ccb` |

The mainnet IC gateway verified 23 certificate-v2 responses with the published Wasm bytes and exact widget framing policies. The host's pinned catalogue matched byte for byte. The five tested raw-host requests returned HTTP 403. The existing standalone passed five representative certified route checks. The reviewer's collector reported disabled with no work in flight. Its collector status, Registry checkpoint, retained evidence manifest and sampled evidence bytes match the earlier production release digests. [Installation and gateway observations](evidence/install) · [Retained-state digests](evidence/existing/retained-state-sha256.txt)

## Funding and operating margin

The deployment account converted 1.13364744 ICP and paid an additional 0.00010000 ICP as the conversion transfer fee. It retained 1.04299269 ICP. The five top-ups transferred 1,625,730,619,894 cycles into the existing allocated canister balances. The deposit fee and five withdrawal fees totaled 600,000,000 cycles. The deployment cycles-ledger account retained 2,963 cycles. [Funding and ledger receipts](evidence/funding)

| Frontend | Balance before install | Balance after install | Observed decrease | Installed memory (bytes) | Reported daily idle burn | Estimated 30-day freezing reserve | Estimated days retaining fallback prepayment |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Network Nexus host | 914,988,000,512 | 902,504,012,470 | 12,483,988,042 | 1,703,855 | 2,373,540,409 | 71,206,212,270 | 19.66 |
| Subnet Activity | 364,995,541,790 | 359,981,171,157 | 5,014,370,633 | 2,048,188 | 916,327,190 | 27,489,815,700 | 35.45 |
| Membership Inspector | 364,995,351,720 | 359,548,698,783 | 5,446,652,937 | 2,573,261 | 929,741,777 | 27,892,253,310 | 34.04 |
| IC Node Map | 364,995,351,720 | 359,789,543,899 | 5,205,807,821 | 2,143,752 | 918,768,663 | 27,563,059,890 | 35.07 |
| Node Performance | 364,995,351,720 | 359,548,698,812 | 5,446,652,908 | 2,573,261 | 929,741,777 | 27,892,253,310 | 34.04 |

The decrease is the observed installation-window balance change, including incidental charges. The runway estimate subtracts the freezing reserve and a full refundable fallback-install prepayment from the post-install balance before dividing by the reported idle burn. It excludes future workload changes. Review funding on **5 December 2026** to preserve Fiduciary fallback headroom. [Machine-readable balance and memory observations](evidence/installed.json)

## Live smoke test

The prepared dashboard connected all four widgets through the generic host. Activity made one live discovery request. At Registry 66,274 it showed 23 distinct Membership proposals and 23 confirmed affected subnets, with complete voting pagination and an explicit incomplete-coverage notice for broader proposal interactions.

Current-subnet inspection delivered the same 40 registered node identities to the map and the finite Performance request. Performance offered seven native samples. Live proposal 145075 completed its Membership review at Registry 66,274. The map and Performance request used the same 15-node union, including both removals. The review ZIP generated independently of Performance and passed archive validation. [Current-subnet capture](evidence/current-subnet.png) · [Proposal review capture](evidence/live-dashboard.png) · [Generated review ZIP](evidence/live-review.zip)

A blank guest dashboard saved and reopened with its widget binding intact. A simulated map outage left the other widget usable, and retry restored the map. Clearing the subject cleared the obsolete scene. Browser instrumentation saw no unauthorized requests or unhandled errors. The guest, outage, and recovery checks made zero reviewer calls. [Browser verification](evidence/smoke.json)

The first proposal-linked Performance request encountered the expected single-flight guard while other reviewer work was active. A single retry through the production widget, after the original request window, sent the same 15 principals and returned seven native samples at 15:54:00 UTC. It made no new Activity or Membership requests. [Exact-filter retry](evidence/performance-retry.json)

No disposable replicas or temporary infrastructure were required for the production smoke test. No application source or production artifact changed in this release-evidence commit.
