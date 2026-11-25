# Network Nexus architecture

The application has one Rust backend and a standard DFX asset canister. The backend reads NNS Governance, Registry and the management canister using typed, replicated inter-canister calls. The Azure VM is the build and test environment. The runtime source boundary comprises IC canisters and the IC protocol.

| Path | Responsibility |
|---|---|
| `crates/domain` | Source-independent identities, hashes and membership action contracts |
| `crates/ic-sources` | Governance Candid, Registry protobuf and chunk Candid, management bindings |
| `crates/review-engine` | Deterministic membership simulation, validated review evidence, topology, scopes and blockmaking contracts |
| `canisters/reviewer` | On-demand evidence resolution and analysis, on-demand blockmaking, and legacy evidence APIs |
| `tests/source-fixture` | Synthetic canister for controlled wire cases |
| `web` | Independent Subnet Membership and Node Performance widgets using the IC agent |

## Review contract

A preview takes one or two NNS proposal IDs. One replicated update fetches the full Governance responses, pins the Registry head and reads the subnet roster and the target memberships at that version. An untargeted removal requires every listed subnet membership so the preview can identify all affected subnets. Ordered scenarios share the resolved inputs. A final Governance read checks for lifecycle or payload changes before analysis. Executed proposals can show their observed status without reconstructing their historical baseline.

The result reports the number of checked memberships and the total listed subnet count. The preview resolves node registration, hardware eligibility and API-boundary records for the proposal candidates. Assignments outside checked subnets and full proposal validity remain unverified. Missing or conflicting required membership evidence stops the affected simulation. The Membership widget renders the requested changes, observations, scenarios and hypothetical before/after memberships. The preview passes an explicitly incomplete Registry baseline to `ReviewInput::build_membership`, whose evidence requirements are scoped to the proposed actions. The full `ReviewInput::build` contract rejects incomplete baselines and retains the topology and concentration calculations used by archived reviews. Proposal lifecycle, Registry version and metrics sample time retain their own clocks.

Function 31 uses removal precedence for overlapping additions and removals after applying the upstream preconditions. Function 2 models addition to an explicit subnet. Function 13 can affect several subnets and carries no target subnet. Function 18 deletes node records and has its own semantics. Separate proposals produce both independent reviews and both execution orders with intermediate states, where applicable.

A linked Node Performance widget can adopt the selected Membership scenario's subnet and resolved node IDs as filters. It also accepts a subnet independently. It fetches management canister samples only when requested, preserves their timestamps, and displays sparse omissions explicitly. Metrics availability has no effect on the membership result.

## Evidence and request limits

There is one active on-demand request across both widgets. A controller or one explicitly delegated principal can start it. It dispatches up to eight calls per batch and checks the liquid balance against each batch's reservation and safety margin. It admits at most 384 calls, stops processing at 4 MiB of aggregate source replies and has a 120-second deadline. Already dispatched replies can arrive at the byte limit. The review is bounded to 128 proposal candidates and 1 MiB of encoded result data. Request-local source receipts identify the source, method, argument hash, observation time and reply hash. Source bytes and analysis results are transient.

The standard IC agent verifies update-call certificates. An explicit Save Review action, exact historical reconstruction, global proposal archiving and fleet-wide monitoring are deferred.

The earlier diagnostic, collector and archive APIs remain available for compatibility and inspection of historical evidence. The new request path does not call them. See [legacy evidence contracts](EVIDENCE.md) and [operations history](OPERATIONS.md) for their stable layout. The mainnet canister and its stored evidence are outside this local proof of concept.
