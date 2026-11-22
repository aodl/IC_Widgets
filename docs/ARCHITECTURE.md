# Network Nexus architecture

The application has one Rust backend and a planned certified asset canister. The backend reads NNS Governance, Registry and the management canister using typed, replicated inter-canister calls. The Azure VM is the build and test environment. The runtime source boundary comprises IC canisters and the IC protocol.

| Path | Responsibility |
|---|---|
| `crates/domain` | Source-independent identities, hashes and membership action contracts |
| `crates/ic-sources` | Governance Candid, Registry protobuf and chunk Candid, management bindings |
| `crates/review-engine` | Boundary for future pure, deterministic membership, policy and metrics rules |
| `canisters/reviewer` | Diagnostic probe, production scheduler, stable Registry and archive workers, and controller evidence API |
| `tests/source-fixture` | Synthetic canister for controlled wire cases |
| `web` | Planned verified client and scoped widgets |

## Review contract

A review identifies explicit proposal IDs, an ordered execution scenario, a complete Registry baseline, an evidence manifest and analysis versions. Proposal lifecycle and timestamps, Registry versions and metrics sample time retain their own clocks. An immutable review revision binds all of them.

Function 31 uses removal precedence for overlapping additions and removals after applying the upstream preconditions. Function 2 models addition to an explicit subnet. Function 13 can affect several subnets and carries no target subnet. Function 18 deletes node records and has its own semantics. Separate proposals produce both independent reviews and both execution orders with intermediate states, where applicable.

A linked widget receives a resolved scope with the scenario, revision, baseline and full node principals. Its local filter can only narrow the supplied set. Baseline members and all nodes mentioned by steps are in the initial scope, even when a step fails or a node's net change is zero.

## Evidence and durability

The diagnostic probe keeps its original API and stable records. The production scheduler owns the single durable dispatch lease and rotates among three workers. Each bounded callback records a source observation with exact source, method, argument identity, time, hash and status. A content-addressed blob store holds selected Registry values and exact archived Governance and metrics replies. Upgrades restore logical work from stable records and fence the outstanding lease before retrying.

The Registry worker bootstraps to a fixed target and advances publication only after selected values in a contiguous page have been validated. Historical keys are sparse, ordered mutations. Governance discovery queues full individual captures and rechecks live lifecycle states. The metrics worker uses a completed Registry roster and keeps independent histories and inclusive cursors per subnet. The sources have separate clocks.

The evidence API surrounds future analysis with an explicit Registry version and a manifest of observation IDs. Reserve the future review revision identifier as the digest of the canonical review result plus manifest and scenario plan. The resolved scope identifier additionally binds the ordered proposal IDs, revision and exact node set. The membership engine will establish those node sets, including all touched nodes and nodes in intermediate states. A downstream performance widget will consume the resolved node scope directly, including explicitly empty or unavailable scopes.

Production reads are replicated and controller-only at this checkpoint. Canister report certification and browser proof verification are later deliverables. See [evidence contracts](EVIDENCE.md) and [operations](OPERATIONS.md) for the stable layout, API and recovery details.
