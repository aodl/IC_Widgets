# IC Widgets composed views

The standalone production release remains the baseline for Membership and Performance behavior. Use [its published evidence](release-candidates/membership-b8014c8/production/README.md) for installed hashes and rollback inputs.

## Inputs and evidence

| View | Declared input | Producer | IC Node Map input | Performance input |
| --- | --- | --- | --- | --- |
| Existing subnet | `urn:ic-widgets:subnet` v1 | One replicated request pins the Registry head and reads the registered roster and unique linked metadata | Finite set of current members, registered coordinates and neutral country groups | Finite set of current member IDs |
| Proposal review | `urn:ic-widgets:proposal-ids` v1 | The existing caller-bound proposal workflow and replicated comparison | Before and selected state, roles, registered coordinates and replicated country groups | Before/proposed union by default, with explicit proposed, before, changed, incoming, outgoing and all-steps filters |

The map takes a viewport key, location evidence and country display groups. It has no proposal input or source client. Exact placement, the country and role presentation, node inspection, unmapped nodes and map gestures use the same component. Existing-subnet coverage uses recorded Registry evidence. Before/proposed analytical counts still come from the replicated comparison.

The independently hosted map accepts `urn:ic-widgets:map-scene` v1. It receives the represented member records, roles and accepted country groups, the subnet and Registry pin, the evidence revision, coverage and observation metadata. The producers retain detailed source receipts. Their embedded views omit the duplicate interactive map and bind the scene to the same standalone map frontend. The map has no reviewer client.

Performance accepts `urn:ic-widgets:node-filter` v1, which carries an explicitly labeled scope, one exact ID array, the subnet, Registry pin and the evidence revision. The producer supplies the existing roster for a Subnet view and the before/proposed union for a Proposal view. The Proposal producer provides explicit alternatives scoped to its accepted comparison. The exact array is passed unchanged to the reviewer as a present Candid filter. A connected frame has no independent-mode or preset fallback. An empty, invalid, unavailable or superseded filter does not open an unfiltered request. The upstream management method observes counters for the subnet and the reviewer returns only rows for the supplied principals. Partial sample availability does not change the filter. Caller-bound review tokens and credentials stay with the producer.

## What the earlier Performance filters represented

The reported 40 and five were the complete **proposed memberships** at the selected step. Both original requests were checked by principal against the committed fixture oracle.

| Replay | Existing before | Proposed filter sent | Changed identities | Before/proposed union on the map |
| --- | ---: | ---: | --- | ---: |
| 144954, recorded Open | 40 | 40 | 2 · 1 added and 1 removed | 41 |
| 144940, constructed Open replay of an indexed action | 5 | 5 | 4 · 2 added and 2 removed | 7 |

The equal roster sizes conceal different identities. The 144954 request contains 39 retained members and the incoming node. The 144940 request contains three retained members and both incoming nodes. Departing nodes are present in both map scenes and excluded from these proposed-roster filters. The existing-subnet view sends the 40 recorded before-state principals only. The before/proposed union is the set of distinct identities in those two compared states. The new default sends 41 principals for 144954 and seven for 144940. The earlier 40- and five-node filters remain available as Proposed members. An explicit all-steps filter can include transient identities in a multi-proposal comparison.

## Certified composition rehearsal

The generic Network Nexus host lives in its own repository. It handles the descriptor catalogue, declared port profiles, view inputs and bindings, browser-local saving and widget layout. It does not parse the IC Widgets profiles. The prototype uses a bundled catalogue. Public descriptor discovery, attention and optional authenticated persistence are separate follow-up slices.

Prepare the same toolchain and Chromium dependencies used by the recorded Membership regression. From IC Widgets, use:

```bash
./scripts/rehearse-composed-view.sh /path/to/Network_Nexus_Host .local/composed-view-evidence
```

The command provisions an ephemeral loopback replica, builds dedicated certified host, Membership, Subnet overview, IC Node Map and Performance artifacts, exercises three independently loaded views and stops the replica. The Membership canisters use recorded and constructed source fixtures for each view. The frontend profiles include the exact Nexus framing origin. The standalone profile keeps its existing `frame-ancestors 'none'` policy. The host and frames exchange only declared inputs and output states through exact-origin session channels. A reload or input change supersedes old outputs. All views use [one data-only catalogue](composed-view/catalogue.example.json). The script substitutes disposable canister origins for the placeholders. [Generic host repository and contract](https://github.com/aodl/Network_Nexus/blob/main/docs/WIDGET_CONTRACT.md)

The real gateway test validates the certificates for the host and the separate widget embed documents, scripts and styles against the disposable IC trust root. Its Chromium allowlist admits only those certified asset URLs, local IC status and protocol calls to the two fixture reviewers. Historical subnet principals can produce missing blockmaking metrics in PocketIC. The composition test verifies the exact finite request filters and method order. The separate production release evidence records the live Performance result.

## Independent-map milestone verification

Chromium completed the full historical review matrix, including both proposal orders, terminal outcomes, held and missing locations, returning to a calculated subnet and independent browser contexts. The recorded 144954 replacement kept its ten reviewer calls. The existing-subnet view used one additional replicated snapshot request when selected. Map use, node inspection, sorting and ZIP generation sent no additional requests. The tested widths were 1366, 768, 390 and 320 CSS pixels.

The earlier rehearsal at `7003ccc` verified the separately framed producers and Performance. The independent-map rehearsal and its exact scope checks are recorded with the [verification artifacts](composed-view/README.md).

## Repository names

The active IC Widgets checkout is `~/src/IC_Widgets`. The application title and current developer documentation use IC Widgets. The earlier `~/src/Network_Nexus` checkout preserves the stable standalone release and its rollback evidence. Existing Rust package names, deployment aliases and build variables remain available for reproducibility. The generic host is a separate Git repository, checked out locally at `~/src/Network_Nexus_Host` and published as [aodl/Network_Nexus](https://github.com/aodl/Network_Nexus).

## Activity-driven workspace

The `activity` and `inspector` embed profiles add a fourth view to the bundled example. The same Activity navigator draws the decision and voting queues, deadlines, pending execution, unresolved targets, observed coverage, and the Registry roster. Load activity and Refresh discovery are explicit. The standalone navigator keeps its existing behaviour.

Activity publishes `urn:ic-widgets:inspection-subject` major 1 as its `subject` output. It has two shapes:

- `{"kind":"subnet","subnet":"<full canonical subnet principal>"}`
- `{"kind":"proposals","proposalIds":["144954"],"subnet":"<optional full canonical target principal>"}`

Proposal IDs are one or two distinct positive uint64 decimal strings in their supplied order. The navigator publishes a single proposal per selection, retaining the chosen subnet for a multi-subnet action. The inspector also accepts two IDs through a declared view input of this profile. A missing target allows the existing proposal workflow to resolve and choose its initial subnet. A provided target must occur in the executable comparison returned by the inspector's own replicated workflow. The map receives `scene` and Performance receives `filter`, with the existing profiles and finite scope semantics.

The host forwards selection intent only. The inspector reads Governance and pins Registry itself, retaining the existing lifecycle verification and source-bound calculations. Activity discovery has no portable proof in the existing public interface that independently authenticates it to a second frame. The inspector therefore obtains its own bounded cross-proposal observation from accepted instructions. This can duplicate one discovery for a reviewed proposal. Neither widget passes caller-bound tokens or archive receipts through Network Nexus. An Activity refresh does not publish a new selection or start a new Membership calculation. Subject changes clear obsolete outputs and supersede in-flight responses. Reopening a saved view restores its wiring and leaves the Activity selection transient.

The disposable test adds an opt-in synthetic discovery listing to selected historical scenarios. Per-proposal replies and Registry fixture data still come from their respective source fixtures. The listing demonstrates selection and lifecycle behaviour without claiming historical scan completeness or current Open status. The fixture-only loader is absent from the production reviewer. The inspector's disposable reports identify their fixture origin.

## Proposed first hosted demonstration

Publish one certified Network Nexus host and four independently hosted certified IC Widgets frontends for Activity, Inspector, IC Node Map and Performance. Keep the existing standalone frontend and catalogue at their current origin. Reuse the existing reviewer and its public methods for discovery, current subnet snapshots, Membership review and Performance. No reviewer interface or state migration is needed. Activity and the inspector use the reviewer for sourced evidence, and Performance uses it for metrics. The map consumes only its supplied scene through the host.

After approval, reserve the five canister IDs on standard application subnets and pin the exact canonical HTTPS host and widget origins. Build the host with a trusted catalogue containing only the approved descriptors and the prepared Activity view. Pin the host in each widget's certified `frame-ancestors` policy and handshake. The host validates each trusted origin and exact embed path against its bundled descriptor. Use immutable certified Wasm assets and reject raw host access using the existing serving policies. Keep all production builds free of fixture overrides. A guest can open the certified host, try the prepared view, or build and save a blank dashboard without an account. The standalone permanent catalogue remains the place to try recorded interactive scenarios.

For planning, five standard 13-node application-subnet creations cost 2.5 trillion cycles in total before installation and liquid reserves. A provisional 0.5 trillion liquid cycles per frontend after creation gives a 5 trillion initial provision plus measured installation overhead. At zero reserved compute and an illustrative 8–80 MiB of aggregate metered memory, base and storage charges are approximately 0.14–0.20 trillion cycles per 30 days for five frontends. Sum the measured memory and reported idle burn after a rehearsal with the proposed settings before requesting the final funding amount. Reviewer-driven discovery, inspection and metrics vary with usage and are charged to the existing reviewer. Check its headroom and public quotas before launch. There is no new scheduled work or off-chain service. [IC cycle costs](https://docs.internetcomputer.org/references/cycle-costs/)

The proposed first release covers only the five frontend installations and a bounded certified smoke test. No mainnet actions were taken for this composition milestone.
