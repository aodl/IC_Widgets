# Factual Membership follow-up

The [public historical replay](https://ashley-arabia-rebates-railroad.trycloudflare.com/) serves frontend revision `db4b8a22c8e1eccd4fdcba86b1eb833c40e9c1e6`. Select **NNS replacement**, then **Review**. The replay uses the recorded Open observation for proposal 144954 at Registry 66,013 and labels the synthetic NNS-role supplement.

The world view uses 8 px retained dots and 20 px incoming and outgoing glyphs. The layout moves glyphs within 48 CSS px of their registered anchors and connects displaced glyphs back to their source positions. Focus changes expands the view around the registered locations of the changed nodes. Dotted facility enclosures follow registered IDs. The focused view shows the three sh1 nodes and the separate outgoing zh2 node, with their before → proposed facility counts. Dense locations can have small targets, including within one facility. The node list in **Sources & details** remains available for selecting any node.

The composition overview includes directly affected groups and every proposed maximum above one member. Selecting a dimension reveals all its rows, distinct recorded-group counts, ties and its Nakamoto coefficient. The recorded example shows six country labels tied at three proposed members, and the data center, registered owner and operator coefficients each change from 13 → 12. Partial counts are recorded minimums and their arrows are uncoloured.

Export review generates concise Markdown by default. **Include full recorded distribution** adds all six recorded dimensions. Loading settlement, the selected calculation result and final Governance verification are shown separately. Export requires an accepted comparison and a successful final Governance verification.

- [Desktop](artifacts/refinements/recorded-desktop.png) · [390 px](artifacts/refinements/recorded-mobile.png) · [320 px](artifacts/refinements/recorded-320.png)
- [Focus changes at 390 px](artifacts/refinements/focused-390.png) · [Focus changes at 320 px](artifacts/refinements/focused-320.png) · [Missing locations](artifacts/refinements/missing-locations.png)
- [Concise Markdown](artifacts/refinements/recorded-review.md) · [Markdown with full distribution](artifacts/refinements/recorded-review-full.md) · [Map PNG](artifacts/refinements/recorded-map.png) · [Exact Candid input](artifacts/refinements/recorded-calculation.didbin)

## Browser verification over HTTPS

All world views showed 41 individual markers. Every marker centre reached its own button, and the selected nodes remained available individually after Focus changes. The test tapped the three sh1 nodes and the outgoing zh2 node on phones, and used the keyboard to open the incoming node and return focus to its marker.

| Viewport | World displacement, before → revised | Focused markers | Focused maximum displacement |
| --- | ---: | ---: | ---: |
| 1,366 px | 80 → 17 px | 16 | 17 px |
| 390 px | 119 → 29 px | 18 | 17 px |
| 320 px | 75 → 25 px | 19 | 17 px |

The table uses maximum measured distances between each glyph and its projected anchor. The smallest native button widths were 7, 7 and 8 px, respectively. Gaps between buttons also support nearest-marker selection. Centre-hit and tap tests validate the tested targets. Dense regions still benefit from regional zoom or the node list.

Nine historical replay cases passed. They included multiple changes, both proposal orders, terminal outcomes, held and missing location evidence, returning to a calculated subnet, and independent browser sessions. No requests went to other origins. Copy and download produced the same 90-line Markdown. The optional appendix expanded it to 319 lines. A pixel check matched the filtered PNG glyphs to their screen positions. The Markdown identifies the exact calculation input by SHA-256. [Browser results](artifacts/refinements/summary.json) · [Artifact checksums](artifacts/refinements/SHA256SUMS)

All 20 frontend tests passed, including neutral partial deltas, tied groups, the optional appendix, separate calculation and Governance outcomes, and coincident facilities. The production build excluded replay controls, fixtures and the indexed API. Candid extracted from the production Wasm matched the checked-in interface and passed compatibility checks against M0 and PR #9. Generated JavaScript bindings also matched.

The full local `./scripts/test-m0.sh` gate exited successfully. It ran the Rust workspace suite and all 15 PocketIC tests across M0, M1, M2, on-demand and historical replay, followed by Candid extraction and compatibility verification. The run used the cached Registry baseline and disabled host debug symbols to limit disk usage.

The public replay’s three served assets matched the local build byte for byte. The existing tunnel, replica and scoped routes continue serving the application. The public management endpoint returned HTTP 404. Cleanup removed disposable build caches and state directories from two stopped fixture replicas. The committed corpus, source captures, release artifacts and active replay were preserved.
