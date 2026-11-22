# Network Nexus architecture

The application has one Rust backend and a planned certified asset canister. The backend reads NNS Governance, Registry and the management canister using typed, replicated inter-canister calls. The Azure VM is the build and test environment. The runtime source boundary comprises IC canisters and the IC protocol.

| Path | Responsibility |
|---|---|
| `crates/domain` | Source-independent identities, hashes and membership action contracts |
| `crates/ic-sources` | Governance Candid, Registry protobuf and chunk Candid, management bindings |
| `crates/review-engine` | Boundary for future pure, deterministic membership, policy and metrics rules |
| `canisters/reviewer` | Probe API, source calls, bounded stable jobs and evidence export |
| `tests/source-fixture` | Synthetic canister for controlled wire cases |
| `web` | Planned verified client and scoped widgets |

## Review contract

A review identifies explicit proposal IDs, an ordered execution scenario, a complete Registry baseline, an evidence manifest and analysis versions. Proposal lifecycle and timestamps, Registry versions and metrics sample time retain their own clocks. An immutable review revision binds all of them.

Function 31 uses removal precedence for overlapping additions and removals after applying the upstream preconditions. Function 2 models addition to an explicit subnet. Function 13 can affect several subnets and carries no target subnet. Function 18 deletes node records and has its own semantics. Separate proposals produce both independent reviews and both execution orders with intermediate states, where applicable.

A linked widget receives a resolved scope with the scenario, revision, baseline and full node principals. Its local filter can only narrow the supplied set. Baseline members and all nodes mentioned by steps are in the initial scope, even when a step fails or a node's net change is zero.

## Evidence and durability

M0 reads Registry record joins at one captured version and journals complete-page diagnostics. M1 will build one versioned projection and publish only fully staged versions. The probe exports the original wire bytes using a small replicated, controller-only API. Report certification and browser-side proof verification enter with the report and UI milestones.

M0 stable memory schema v1 assigns memory IDs 0 through 3 to config, jobs, receipts and raw replies respectively. Timer handles are transient. The durable queue records each attempt and generation before dispatch. After an upgrade, a new timer resumes the durable job and fences older callbacks. Future schemas must keep IDs compatible or introduce an explicit migration. Raw replies and metadata commit atomically with the queue transition.
