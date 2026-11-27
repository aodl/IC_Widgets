# Standalone Membership production release

On 27 November 2026, the two existing canisters were upgraded in place using the exact packages published in PR #10. The frozen source is `b8014c8d264928a3ed8f16338fb5d4dc9a494489` and the publication head is `c34cb402baf4cbe24413b676cce724d2e88d1be3`. [Certified production application](https://s45ab-wiaaa-aaaar-qcifq-cai.icp.net/) · [Release packages and rehearsal evidence](../README.md)

| Canister | ID | Observed installed module hash |
| --- | --- | --- |
| Reviewer | `s34gv-3qaaa-aaaar-qcifa-cai` | `bb0b3cf4d08267f1262eac26d6cde1d34b2e0b8f0331d525dd7faaab0efe21db` |
| Frontend | `s45ab-wiaaa-aaaar-qcifq-cai` | `d3c27e678ff4313972a781abafbd2ed8ef31f2824cd0b77adb85f02411cf73cc` |

The package manifest and both live legacy module hashes matched before installation. Rollback packages match the earlier installed hashes and the prior asset snapshot matched independently certified gateway bytes. Both controller sets and the sampled management settings matched before and after. The reviewer retained its observed 151,060,480-byte stable-memory size. Collection status, Registry status and the sampled evidence manifest matched byte for byte before upgrade, after reviewer upgrade and after full verification. The legacy collector remained disabled with no collection in flight. No rollback was needed. [Preflight](preflight-certified.json) · [Final status](final-certified.json) · [Rollback and state digests](rollback-and-state-sha256.txt)

The reviewer upgrade finished at 18:57:37 UTC. The existing frontend then reached the export-ready result on an open proposal through the legacy Membership methods, with coverage gaps shown. The frontend upgrade finished at 19:01:09 UTC. The production gateway independently verified eleven v2 responses, including HTML, JavaScript and CSS. The three assets matched the bytes embedded in the authorized package. The tested raw-host paths returned empty HTTP 403 responses. [Legacy compatibility observation](browser-legacy.json) · [Gateway verification](gateway-embedded.json)

A public Chromium session completed an open-proposal review for NNS proposal 145077 at Registry 66,264 and produced a local ZIP with Markdown and a PNG. A separate browser page returned seven Performance samples via its independent on-demand method. Browser request interception admitted only the certified application assets and IC protocol transport to the reviewer. No login, external application requests or report uploads were observed. This was a prospective production check of an eligible open proposal. [Browser verification](browser-embedded.json) · [Membership capture](live-membership.png) · [Generated review](live-review.zip)

| Canister | Initial balance | Final balance | Net balance decrease |
| --- | ---: | ---: | ---: |
| Reviewer | 2,843,660,562,677 | 2,800,142,269,756 | 43,518,292,921 |
| Frontend | 2,629,937,479,345 | 2,615,818,671,897 | 14,118,807,448 |

Balances are in cycles. The observed decreases include installation, elapsed idle burn and activity during verification. The available status command did not expose per-operation metrics that isolate the installation charge. Final estimated balances above the freezing reserve were 2,424,519,290,026 reviewer cycles and 2,541,853,973,967 frontend cycles. There were no top-ups, controller changes or canister creations. [Evidence checksums](SHA256SUMS)

## Acceptance environment

The reviewer accepted the public preview on 27 November and completed hands-on verification. The temporary Cloudflare Quick Tunnel, scoped ingress proxy and its PocketIC instance were stopped. The archived replay fixtures, release packages and rollback inputs remain available. Ordinary development uses disposable loopback replicas. The application continues to serve from the two existing IC canisters through the certified gateway.
