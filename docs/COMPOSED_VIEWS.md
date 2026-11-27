# IC Widgets composed views

The standalone production release remains the baseline for Membership and Performance behavior. Use [its published evidence](release-candidates/membership-b8014c8/production/README.md) for installed hashes and rollback inputs.

## Inputs and evidence

| View | Declared input | Producer | IC Node Map input | Performance input |
| --- | --- | --- | --- | --- |
| Existing subnet | `urn:ic-widgets:subnet` v1 | One replicated request pins the Registry head and reads the registered roster and unique linked metadata | Finite set of current members, registered coordinates and neutral country groups | Finite set of current member IDs |
| Proposal review | `urn:ic-widgets:proposal-ids` v1 | The existing caller-bound proposal workflow and replicated comparison | Before and selected state, roles, registered coordinates and replicated country groups | Finite selected, incoming, outgoing and affected filters |

The map takes a viewport key, location evidence and country display groups. It has no proposal input or source client. Exact placement, the country and role presentation, node inspection, unmapped nodes and map gestures use the same component. Existing-subnet coverage uses recorded Registry evidence. Before/proposed analytical counts still come from the replicated comparison.

The producers share `urn:ic-widgets:node-selection` v1. It carries full IDs, the Registry version, an evidence revision, source receipts, observation clocks and coverage. A proposal comparison includes its order, step, Governance observations and exact accepted input digest. A separate readiness state describes waiting or unavailable work. An empty ready selection remains empty. The consumer uses these IDs only as typed filters for its own replicated metrics request. Caller-bound review tokens and credentials stay in the Membership instance.

## Certified composition rehearsal

The generic Network Nexus host lives in its own repository. It handles the descriptor catalogue, declared port profiles, view inputs and bindings, browser-local saving and widget layout. It does not parse the IC Widgets profiles. The prototype uses a bundled catalogue. Public descriptor discovery, attention and optional authenticated persistence are separate follow-up slices.

Prepare the same toolchain and Chromium dependencies used by the recorded Membership regression. From IC Widgets, use:

```bash
./scripts/rehearse-composed-view.sh /path/to/Network_Nexus_Host .local/composed-view-evidence
```

The command provisions an ephemeral loopback replica, builds dedicated certified host, Membership and Performance artifacts, exercises two independently loaded views and stops the replica. The Membership canisters use recorded and constructed source fixtures for each view. The frontend profiles include the exact Nexus framing origin. The standalone profile keeps its existing `frame-ancestors 'none'` policy. The host and frames exchange only declared inputs and output states through exact-origin session channels. A reload or input change supersedes old outputs. The two Membership views share the node-selection contract with Performance.

The real gateway test validates the certificates for the host and the separate widget embed documents, scripts and styles against the disposable IC trust root. Its Chromium allowlist admits only those certified asset URLs, local IC status and protocol calls to the two fixture reviewers. Historical subnet principals can produce missing blockmaking metrics in PocketIC. The composition test verifies the exact finite request filters and method order. The separate production release evidence records the live Performance result.
