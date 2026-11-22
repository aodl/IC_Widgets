# Subnet Membership parity ledger

The proposed first release replaces the existing-subnet membership review workflow. It is not a promise to reproduce unavailable external observations or every adjacent tool. This ledger makes the proposed boundary reviewable. Final release acceptance must record the actual implementation and test evidence for every row.

**Reproduce** means the useful behavior has a sufficient on-chain source. **Correct** means preserve the question while replacing erroneous semantics. **Unavailable** means the verified source boundary does not support the old observation. **Defer** is a deliberate scope decision, not a claim that the capability is impossible. **New** identifies an added requirement rather than inherited functionality.

| Legacy behavior or new need | Proposed v1 disposition | Required result |
|---|---|---|
| ChangeSubnetMembership review | Reproduce and correct | Native payload, pinned baseline, exact semantics |
| AddNodeToSubnet review | Correct | Recognize actual function 2 rather than legacy AddNodes string |
| RemoveNodesFromSubnet review | Reproduce and correct | Complete proposal-wide effect, per-subnet scopes |
| CreateSubnet membership preview | Defer explicitly | Legacy has an active but fragile creation path. Recognize and explain unsupported creation review in v1. Add a distinct new-subnet context later without inventing a principal or historical baseline |
| Implicit grouping of all open proposals | Correct | Explicit single or paired selection. Independent and ordered scenarios |
| Proposal metadata, summary, raw action and status | Reproduce | Direct Governance retrieval. Summary remains a proposer claim |
| Before/after membership | Correct | Captured Registry V, no reversed current-state fabrication |
| Added/removed/retained node lists | Reproduce and extend | Also preserve touched nodes and per-step roles |
| Same-node overlap, wrong target and redundant changes | Correct | Pinned protocol semantics plus distinct reviewer findings |
| Cross-proposal node conflict | Correct and extend | Relevant action extractors, dependency/competition distinction and scan coverage |
| Node/operator/provider/DC fields | Reproduce | Full principals and Registry joins at V |
| Registered region/country/continent and GPS | Reproduce and correct | Original string plus documented parsing, no fabricated geography |
| Distinct counts and min/max/mean concentration | Reproduce and correct | Correct denominators, unknown coverage and edge handling |
| Pairwise registered-location distances | Reproduce and correct | Documented formula, valid-pair coverage and safe zero/one-node behavior |
| Map with membership roles | Reproduce | Bundled canister assets and registered coordinates. No external tiles |
| Independent IP-location discrepancy lines | Unavailable | No IPInfo/OpenCage or imported cache. Explain the lost observation |
| Node UP/DOWN/DEGRADED and infrastructure alert names | Unavailable | No sufficient native equivalent. Do not rename consensus metrics |
| Global DOWN/DEGRADED by-subnet warnings | Unavailable as old telemetry | A separate consensus-evidence summary may exist with different labels and coverage |
| Network/provider UP percentages and reward extrapolation | Unavailable as old telemetry | Do not infer readiness/reward equivalence from different evidence |
| Assigned/unassigned/provider structural totals | Reproduce | Complete relevant Registry inventory. Classify boundary/unsupported kinds explicitly. Unassigned is not healthy spare |
| Alternative unassigned candidates | Reproduce with changed evidence | Structural filters/ranking only, health unknown, bounded scan |
| Desired subnet/unassigned GuestOS comparison | Reproduce and improve | Registry configuration plus separately timed observed subnet_info |
| Actual running HostOS/version from external node probe | Unavailable where no sufficient source | Show desired Registry fields and clearly limit observations |
| Provider display names and DFINITY substring inventory | Unavailable as canonical identity labels | Principals are identity. No substring matching |
| Minimum DFINITY presence warning | Defer policy | Would require explicit scoped identity/policy provenance. Not a protocol invariant |
| Manually grouped related-party providers | Unavailable as verified ownership | Do not copy source-code clusters into canonical facts |
| Historical cordon and MU1/decommissioning assumptions | Correct/defer policy | Proposer text may be displayed as a claim. No permanent current eligibility from prose or hardcoded name |
| Forum-ready report with vote/TLDR placeholders | Reproduce and improve | Same structured revision, evidence/limitations, human decision. No automatic vote |
| Link to a separate node metrics dashboard | Replace and extend | Integrated independently reusable node-performance widget consuming scope |
| Static metrics JSON to daily CSV | Correct and extend | Autonomous direct collection with baselines, epochs, gaps and source subnets |
| General Nakamoto display | New | Legacy TODO. Transparent threshold definition, test n divisible by three |
| SEV readiness checks | Not inherited. Unavailable as attestation | Legacy TODO. Registered chip-ID presence is a distinct field |
| Providers with no assigned nodes | New small derived view | Legacy TODO. Possible once complete registry inventory exists |
| Widget constraints and immutable shareable reviews | New | Typed scopes, server-side validation, certified results, durable evidence |

The CreateSubnet deferral is the principal deliberate omission from the legacy membership action set beyond source-impossible fields. If creation must be part of the first acceptance boundary, add a separately specified creation preview milestone before sign-off: an empty proposed baseline, native creation payload, proposed-node scope, and an explicit unknown/new target identity. Do not silently reuse an existing-subnet ID or flatten creation into an ordinary change.

## Source-to-feature mapping

| Workflow area | Canonical source | Delivery |
|---|---|---|
| Discovery, proposal text, action bytes and lifecycle | Governance listing plus individual lookup | M0 wire probe, M1 archive and conflict indexing |
| Membership, assignments and candidate structure | Registry mutation replay at pinned version, including node and API-boundary key families | M0 spot checks and page diagnostics, M1 complete projection |
| Providers, geography, ownership strings, desired versions | Registry node/operator/DC/subnet and unassigned config records | M0 spot-check join, M2 comparisons, M3 canister-hosted geography |
| Order outcomes, roles, diversification and distance | Deterministic derivations from proposal actions and pinned Registry facts | M2 |
| Running subnet context | Management `subnet_info` at receipt time | M0 probe, later context widget |
| Node performance | Management `node_metrics_history`, observed counts and explicit coverage | M0 probe, later autonomous archive and metrics analysis |
| Report, export and linked presentation | One immutable analysis revision with typed node selection | M3–M5 |
| IP location, uptime, alert names and beneficial ownership | Evidence gap | Explicitly unavailable |

Legacy code cross-checks include `IC_Subnet_Analysis/SubnetMembership.cs` for action selection and grouping (lines 175–184 and 499–608), reverse-engineered before-state (634–643), and health classification (1056). `ProposalVisualiser/Pages/SubnetMembership.cshtml` includes map rendering, node alerts and Markdown export. `TrustWorthyNodeMetrics/Program.cs` reads local JSON for the CSV workflow. Line references are to the retained archive and may differ from previous versions.

## M1 evidence coverage

M1 supplies historical Registry joins and inventory classification, full Governance payloads and lifecycle evidence, and a subnet-scoped blockmaking archive. Explicitly unavailable legacy telemetry remains in the parity ledger. The next milestone uses these inputs to implement the versioned membership simulations and resolve node scopes. The performance widget needs only the resolved scope and evidence manifest. It has no independent proposal collector or selection logic.

Governance discovery initially scans up to five pages. The selected-proposal workflow can request older IDs directly and use their full individual captures. Historical conflict-search completeness remains a separate capability.
