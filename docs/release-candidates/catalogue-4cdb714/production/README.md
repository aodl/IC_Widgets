# IC Widgets catalogue production release

On 27 November 2026, the existing frontend was upgraded in place from 21:56:14 to 21:56:17 UTC using the exact published gzip. Its source is `4cdb714258f6ea0cf8f1163d0a6d1b42cda9ad51` and its artifact publication is `f978d27dd605204e954be0a978c144ca1c4fdd25`. [Install package, rollback rehearsal and reproducibility](../README.md) · [Hosted CI](https://github.com/aodl/IC_Widgets/actions/runs/46066358445)

| Canister | ID | Observed installed SHA-256 |
| --- | --- | --- |
| Frontend | `s45ab-wiaaa-aaaar-qcifq-cai` | `b8acdc601b8d2580476a488a735fff17781937846fc782b63c7e1a87ddc166d8` |
| Reviewer | `s34gv-3qaaa-aaaar-qcifa-cai` | `bb0b3cf4d08267f1262eac26d6cde1d34b2e0b8f0331d525dd7faaab0efe21db` |

Both IDs and controller sets matched the earlier release before and after. The reviewer was not upgraded. Its stable-memory size remained 151,060,480 bytes. The exact previous frontend gzip, SHA-256 `d3c27e678ff4313972a781abafbd2ed8ef31f2824cd0b77adb85f02411cf73cc`, matched the preflight installed hash. Its embedded bytes matched the certified HTML, JavaScript and CSS served before the upgrade. [Preflight](certified-before.json) · [After install](certified-installed.json) · [Final status](certified-final.json) · [Previous asset proof](gateway-before.json)

The production gateway independently verified 63 version 2 responses against the pinned IC root. Successful responses included the app HTML, JS and CSS, all 37 catalogue entry pages and all 12 bundled evidence files. Fresh query URLs bypassed cached certificates during cryptographic verification. Chromium used the ordinary canonical URLs. The six raw-host checks returned HTTP 403 with empty bodies. [Gateway results](gateway-after.json)

Live Membership completed for Open proposal [145077](https://dashboard.internetcomputer.org/proposal/145077) at pinned Registry 66,264 and generated a ZIP. Independent Performance returned seven blockmaking samples. The browser confirmed public access and admitted only certified application assets and reviewer protocol traffic in this phase. [Live workflow trace](browser-live.json) · [Live review ZIP](live-review.zip)

Chromium opened the [catalogue](https://s45ab-wiaaa-aaaar-qcifq-cai.icp.net/test-cases), navigated directly to the [recorded 144954 case](https://s45ab-wiaaa-aaaar-qcifq-cai.icp.net/test-cases/nns-144954-recorded-open), reloaded it, generated a review and downloaded `review.md` and `map.png`. This phase allowed only certified frontend URLs and observed zero reviewer or external requests. The page labels the fixture and its synthetic supplement. The completed review and Markdown preserve the original Governance observation. The case introduction renders `[object HTMLParagraphElement]` where the original Governance timestamp would appear, plus a stray `null`. The traces record that defect and the separate successful catalogue run. [Catalogue trace](browser-catalogue.json) · [Recorded review ZIP](recorded-144954-review.zip) · [Capture](recorded-144954.png)

Net balance decreased by 15,951,067,417 frontend cycles and 1,571,904,997 reviewer cycles from preflight through the final management observation, which includes idle usage and verification. Estimated balances above the freezing reserves were 2,523,435,735,834 and 2,421,128,155,627 cycles respectively. There were no top-ups, canister creations, controller changes or Subnet Activity installs. [Evidence checksums](SHA256SUMS)
