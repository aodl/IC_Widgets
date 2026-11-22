# Subnet Membership parity ledger

**Local** means implemented and verified with PocketIC, Rust tests or the local asset-canister demo. **Live pending** means the implemented workflow still needs replicated source evidence from an authorized mainnet application canister. **Library only** covers computed results outside the current widget. **Missing** records a feasible feature that has no implementation. **Deferred** is a scope decision. **Unavailable** means the approved sources cannot establish the legacy observation.

| Legacy capability | Current status | What the application can show |
|---|---|---|
| ChangeSubnetMembership, AddNodeToSubnet, RemoveNodesFromSubnet | Local, live pending | Functions 31, 2 and 13 use the pinned Registry rules. Multi-subnet removal retains proposal-wide findings and resolves each affected subnet separately. |
| CreateSubnet preview | Deferred | The first widget covers existing-subnet reviews. |
| Combining open proposals | Local, live pending | A selected single or paired revision exposes independent runs and both execution orders, including intermediate states. |
| Proposal ID, status and action | Local, live pending | Displayed in the widget from an archived individual lookup, including the requested nodes and payload hash. |
| Proposer summary and other text | Archived locally, UI missing | Governance wire bytes preserve the text and its provenance. The widget shows metadata and actions. Displaying useful proposer text as claims remains open. |
| Before/after membership, additions, removals and retained members | Local, live pending | A completed Registry version anchors the baseline. The widget shows the simulated result and intermediate counts. The report contains the retained set. |
| Overlapping instructions, wrong targets and selected-proposal conflicts | Local, live pending | Structured findings cover validation, conflicts and failure in either selected execution order. |
| Search for competing proposals across the archive | Missing | Governance discovery is bounded. Explicit proposal IDs and pair analysis work. Global conflict coverage is unestablished. |
| Historical pre-execution reconstruction | Deferred | Executed actions can be evaluated as labelled hypotheticals at a selected Registry version. Exact attribution and before-state reconstruction require additional evidence. |
| Operator, provider, data-center and registered owner | Local, live pending | The widget shows group distributions and missing counts. Detailed per-node joins are available in Registry evidence and analysis inputs. |
| Registered country and continent | Local, live pending | Group distributions use the registered region and show unknown coverage. GPS is retained where registered. |
| Concentration thresholds and registered distances | Library only | The engine calculates thresholds and pairwise registered distances with coverage. The widget currently displays group counts and findings. Threshold details and distances have no dedicated presentation. |
| Map and geographic role overlays | Deferred | The widget has no map. Registered-coordinate analysis exists in the library. |
| Independent IP location and mismatch lines | Unavailable | Approved sources provide registered locations and network endpoints without an independent IP-geolocation observation. |
| Node UP/DOWN/DEGRADED, alert names and global outage warnings | Unavailable | Approved management observations measure consensus blockmaking. Infrastructure alerts and wall-clock uptime require other evidence. |
| Node performance linked to the membership review | Local, live pending | One archived subnet sample shows cumulative counters, scoped rows and coverage. Missing rows and conflicts have explicit states. |
| Blockmaking interval changes | Library only | The pure interval contract handles known epochs, gaps and resets. The widget currently displays a single sample. Cross-subnet history is deferred. |
| Static metrics JSON and daily CSV | Current archive local, export missing | Autonomous management calls produce timestamped archive records. The widget reads the archive. CSV generation and reward extrapolation are outside the current workflow. |
| Assigned, unassigned and provider structural totals | Library and evidence APIs only, live pending | Versioned assignment, boundary classification and provider records support structural queries. No fleet totals are shown in the widget. |
| Alternative unassigned nodes | Deferred | Candidate discovery and ranking are open. Blockmaking evidence cannot establish whether an unassigned node is healthy. |
| Configured and observed subnet versions | Evidence APIs and probe only, live pending | Registry carries desired configuration. `subnet_info` provides a separately timed observed replica version. No comparison is shown in the widget. |
| External HostOS probe and provider labels or beneficial ownership | Unavailable from approved sources | Registry provides configured HostOS, principals and registered labels. Live host measurements and verified beneficial ownership need other evidence. |
| DFINITY, related-party and decommissioning policy | Deferred | The widget uses protocol rules and explicit registered evidence. Policy claims from prose and verified identity remain distinct. |
| Forum-ready report, Markdown export or vote output | Missing | An immutable revision and bounded report bytes exist. No user-facing Markdown, CSV or voting action exists. |
| Immutable reviews and linked widget scope | Local, live pending | The standard agent verifies replicated reads. The asset-hosted widget selects a revision and narrows the sample to the resolved subnet scope. |

## Evidence for the current checkpoint

- PocketIC verifies pinned Governance and Registry calls, native management calls, historical records, ordered simulations and stable upgrades. [Source manifest](SOURCES.md) · [Evidence contracts](EVIDENCE.md)
- The browser opens the replayed Governance reply for real proposal 144942. The local fixture Registry lacks that proposal's target. The synthetic 93/92 pair demonstrates successful before/after review and both execution orders. [Widget demonstration](../web/README.md)
- Anonymous source sampling supplied transport and sizing evidence. A mainnet application-canister run and a completed real Registry projection are still pending. [Operations](OPERATIONS.md)

Legacy cross-checks include `IC_Subnet_Analysis/SubnetMembership.cs` for proposal grouping, health classification and reconstructed before-state, `ProposalVisualiser/Pages/SubnetMembership.cshtml` for maps and Markdown, and `TrustWorthyNodeMetrics/Program.cs` for the CSV workflow.
