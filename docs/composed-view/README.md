# Review artifacts

- [Exact frontend refinement](https://github.com/aodl/IC_Widgets/commit/50e397e18fe86454b3cbc6bce7e3a547dbc6a550) · [Desktop](evidence/recorded-desktop.png) · [Mobile map popover](evidence/recorded-mobile-popover.png)
- [Exact reusable-map milestone](https://github.com/aodl/IC_Widgets/commit/7003ccced338eeafda633b0a5b65a4890974b486) · [Historical browser matrix](evidence/standalone-browser.json) · [Standalone certified network regression](evidence/standalone-gateway.json)
- [Exact generic host baseline](https://github.com/aodl/Network_Nexus/commit/e9b657c8960031a7a4d5575a55de9ddf470a3bf4) · [Implemented contract](https://github.com/aodl/Network_Nexus/blob/main/docs/WIDGET_CONTRACT.md)
- [Data-only widget descriptors and views](catalogue.example.json) · [Scope definitions and rehearsal](../COMPOSED_VIEWS.md) · [Original Candid request filters decoded by principal](evidence/prior-performance-requests.json)

All captures and browser reports here use disposable fixture replicas. The [production baseline](../release-candidates/membership-b8014c8/production/README.md) records the separate live verification and installed module hashes.

The final disposable rehearsal verified 22 certified responses across the host and five widget origins. All three views loaded the same certified `/embed` map origin. The browser matched every represented and requested principal to the fixture oracle, including removed nodes on the maps. It also cleared a proposal input and verified the map emptied and Performance issued no request. Map inspection and the complete rehearsal made zero external requests.

| View | Independent map | Workspace |
| --- | --- | --- |
| Existing subnet | [Map](evidence/existing-subnet-map.png) | [Workspace](evidence/existing-subnet-workspace.png) |
| Proposal 144954 | [Map](evidence/144954-map.png) | [Workspace](evidence/144954-workspace.png) |
| Proposal 144940 | [Map](evidence/144940-map.png) | [Workspace](evidence/144940-workspace.png) |

[Certified responses and exact decoded filters](evidence/independent-map-gateway.json)
