# Practical composition verification

[IC Widgets review](https://github.com/aodl/IC_Widgets/pull/12) · [Network Nexus review](https://github.com/aodl/Network_Nexus/pull/1) · [Selection profiles, rehearsal and proposed hosting](../../COMPOSED_VIEWS.md)

The standalone browser regression built the embedded frontend from `6fdfd18db6923ce7e36d23596e1d9667919ce7c5`. It independently validated 126 gateway responses and exercised all 45 catalogue cases. Seventeen cases generated reports. The bundled cases made zero reviewer calls and the complete browser run admitted zero unauthorized requests. The rehearsal then exercised the Activity, Membership, and finite Performance paths against disposable fixture canisters. [Standalone browser trace](standalone-regression.json)

The unrelated Palette browser proof verified two views, superseded inputs, an empty ready scope, saved restoration and removal of a silent widget at host `2d0abdcfbde9a577502bde2d0ecd7bf39ace0727`. It allowed zero off-origin requests. Four host unit tests also passed.

## Certified composition

The disposable build used IC Widgets `e380fc2f0c44b4b83a01730afbba400836b781ff` and Network Nexus `2d0abdcfbde9a577502bde2d0ecd7bf39ace0727`. The final browser test is IC Widgets `7c69ea5bafc87751e83cab123fba2509ced1f8a4`. It reused the exact disposable install packages from the clean build after comparing the pinned catalogue and canister origins. The browser independently verified 28 certificate-v2 responses from the local IC gateway. Host, Activity, Inspector, Map and Performance ran in distinct canisters. The allowlist denied zero requests and the browser observed no page errors. [Gateway trace with exact node principals](composition-gateway.json) · [Disposable package hashes](disposable-install-hashes.txt) · [Evidence checksums](SHA256SUMS)

| Activity selection | Existing | Proposed | Principals in default Performance request |
| --- | ---: | ---: | ---: |
| 144954 recorded replacement | 40 | 40 | 41 |
| Current membership using the 144954 Registry fixture | 40 | — | 40 |
| 144940 multiple-change fixture | 5 | 5 | 7 |
| 132102, two selected subnets | 2 and 3 | 1 each | 2 and 3, respectively |

The browser compared each request with the exact expected set of principals. Selecting Proposed for 144940 sent only its five expected principals. A held proposal request was superseded by current-subnet selection. The old map and Performance filter cleared, and the current-subnet result settled after the held request was released. Activity refresh and injected discovery failure preserved the existing Membership review. The browser created and arranged a blank guest dashboard, restored its bindings after reload, retried an Activity frame, and removed the frame while retaining the other two bindings. Its transient selection was cleared.

PocketIC has no native blockmaking endpoint for these recorded subnet IDs. Some automatic metric requests also hit the reviewer's existing single-flight guard during inspection. The independent Performance widget showed these results and retained its manual read action. Membership and ZIP generation completed. The gateway test verifies requested scopes and failure isolation. The production release ledger records the earlier successful live Performance result.

The sandbox keeps optional external Dashboard pop-up navigation subject to the host's existing restrictions. Full recorded identities and the standalone reference remain available.

- [Four-widget desktop dashboard](activity-review-desktop.png)
- [Current-subnet inspection](activity-current-desktop.png)
- [Activity at 390 CSS pixels](activity-review-mobile.png) and [connected map at that width](activity-map-mobile.png)
- [144954 desktop map](activity-review-map.png) and [generated review ZIP](activity-review-144954.zip)

The disposable replicas and loopback Palette origins were stopped. The existing mainnet application and reviewer remain at the accepted production release. [Production ledger](../../release-candidates/activity-86110949/production/README.md)
