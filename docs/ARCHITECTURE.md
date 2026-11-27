# Network Nexus architecture

The application has a Rust reviewer and a Rust frontend canister built with DFX. The backend reads NNS Governance, Registry and the management canister using typed, replicated inter-canister calls. The Azure VM is the build and test environment. The runtime source boundary comprises IC canisters and the IC protocol.

| Path | Responsibility |
|---|---|
| `crates/domain` | Source-independent identities, hashes and membership action contracts |
| `crates/ic-sources` | Governance Candid, Registry protobuf and chunk Candid, management bindings |
| `crates/review-engine` | Deterministic membership simulation, validated review evidence, topology, scopes and blockmaking contracts |
| `canisters/reviewer` | On-demand evidence resolution and analysis, on-demand blockmaking, and legacy evidence APIs |
| `tests/source-fixture` | Synthetic canister for controlled wire cases |
| `canisters/frontend` | Immutable embedded assets and HTTP certification |
| `web` | Independent Subnet Membership and Node Performance widgets using the IC agent |

## Self-contained deployed application

This requirement applies to the complete application and every widget. All runtime scripts, styles, fonts, icons, flags, geometry, country names, images, configuration and functionality come from Network Nexus canisters, IC system canisters or native browser facilities. The application uses system fonts, browser cryptography, `Intl.DisplayNames`, Canvas, clipboard, Blob and local file downloads. Maps and flags are bundled into JavaScript. The production HTML, JavaScript and CSS are embedded in the frontend Wasm, so the installed module hash identifies the complete build. Generated review Markdown and PNG are created locally and share a relative reference inside the ZIP. Licensed third-party assets may be prepared during development when their version, source, licence and transformation are recorded and the shipped inputs are committed. Ordinary builds use prepared dependencies and committed inputs. [Bundled cartography and flags](../web/src/data/README.md)

The frontend loads its own HTML, CSS and JavaScript. The pinned `@icp-sdk/core` and its transitive code are bundled. The active agent uses browser fetch, an explicit `https://icp-api.io` gateway and the pinned mainnet trust root for production. Signed update submissions and certified result polling through that gateway are IC protocol transport to the configured reviewer principal. The gateway supplies no separate application data or functionality. Both Membership and Performance use this client. The reviewer obtains evidence through replicated calls to Governance, Registry and the management canister. The local replay uses loopback or its scoped HTTPS preview with a local replica trust root. [Frontend network regression](../web/README.md#production-network-regression)

The runtime audit excludes external scripts, stylesheets, remote fonts, flag CDNs, map tiles, reverse geocoders, country APIs, analytics, telemetry and external image hosting. The production regression denies other requests with browser interception and DNS disabled. It loads the exact embedded assets from the IC HTTP gateway, independently verifies their v2 certification and restricts requests to that frontend and its reviewer protocol routes. The embedded local profile uses the replica trust root via the local IC status endpoint. Production builds use the pinned mainnet trust root. Embedded builds reject replay manifests. Cartographic render keys and browser country names never change recorded grouping identities, counts or calculations.

Official Dashboard entity links are optional navigation. Widgets never retrieve or preload Dashboard content. Each link uses an already recorded identity, and absent or unsupported routes leave that identity available locally.

## Embedded frontend releases

Install and upgrade build the HTTP v2 certification tree from the immutable assets. Only the `http_request` query is public. HTML uses no-store and content-hashed JavaScript and CSS use immutable caching. The deployable artifact is the deterministic gzip package. Compare its SHA-256 with the module hash when those exact compressed bytes are installed. [Build and migration evidence](EMBEDDED_FRONTEND.md)

## Review contract

A preview takes one or two NNS proposal IDs. One replicated update fetches the full Governance responses, pins the Registry head and reads the subnet roster and the target memberships at that version. An untargeted removal requires every listed subnet membership so the preview can identify all affected subnets. Ordered scenarios share the resolved inputs. A final Governance read checks for lifecycle or payload changes before analysis. Executed proposals can show their observed status without reconstructing their historical baseline.

The result reports the number of checked memberships and the total listed subnet count. The preview resolves node registration, hardware eligibility and API-boundary records for the proposal candidates. Assignments outside checked subnets and full proposal validity remain unverified. Missing or conflicting required membership evidence stops the affected simulation. The Membership widget renders the requested changes, observations, scenarios and hypothetical before/after memberships. The preview passes an explicitly incomplete Registry baseline to `ReviewInput::build_membership`, whose evidence requirements are scoped to the proposed actions. The full `ReviewInput::build` contract rejects incomplete baselines and retains the topology and concentration calculations used by archived reviews. Proposal lifecycle, Registry version and metrics sample time retain their own clocks.

Function 31 uses removal precedence for overlapping additions and removals after applying the upstream preconditions. Function 2 models addition to an explicit subnet. Function 13 can affect several subnets and carries no target subnet. Function 18 deletes node records and has its own semantics. Separate proposals produce both independent reviews and both execution orders with intermediate states, where applicable.

A linked Node Performance widget can adopt the selected Membership scenario's subnet and resolved node IDs as filters. It also accepts a subnet independently. It fetches management canister samples only when requested, preserves their timestamps, and displays sparse omissions explicitly. Metrics availability has no effect on the membership result.

The clear review starts with a contextual preview. The browser reuses pinned records across the requested orders and steps, acquires the pinned NNS role, and submits each supported state for replicated factual calculation. The reviewer binds observed metadata to the caller and preview in one transient context. A final bounded Governance recheck occurs after the comparisons. Scope and evidence coverage remain visible alongside the completed work status. [Clear review](clear-review/README.md) · [Source manifest](clear-review/SOURCES.md)

## Evidence and request limits

Both widgets are public and share one active on-demand request slot. A request dispatches up to eight calls per batch and checks the liquid balance against the batch reservation and safety margin. It admits at most 384 calls, stops processing at 4 MiB of aggregate source replies and has a 120-second deadline. Already dispatched replies can arrive at the byte limit. The review is bounded to 128 proposal candidates and 1 MiB of encoded result data. Request-local source receipts identify the source, method, argument hash, observation time and reply hash. Source bytes and analysis results are transient.

The reviewer allows up to 32 concurrent review contexts. Each page generates its own key in memory and can replace only its own context. Contexts expire after 30 minutes or on upgrade. A shared budget admits bursts of up to 96 updates and 768 source calls. Each budget refills by one operation per 30 seconds. The canister reports when shared capacity is unavailable. Administrative updates still require a controller.

The standard IC agent verifies update-call certificates. An explicit Save Review action, exact historical reconstruction, global proposal archiving and fleet-wide monitoring are deferred.

The earlier diagnostic, collector and archive APIs remain available for compatibility and inspection of historical evidence. The new request path does not call them. See [legacy evidence contracts](EVIDENCE.md) and [operations history](OPERATIONS.md) for their stable layout. The mainnet canister and its stored evidence are outside this local proof of concept.
