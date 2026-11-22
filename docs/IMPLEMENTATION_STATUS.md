# Implementation status

## M0 local implementation

M0 builds a production Wasm probe and a fixture Wasm. The production backend reads canonical system-canister principals. Each bounded probe persists its queue and raw evidence in stable memory and offers controller-only replicated reads for inspection. The committed Candid interface describes that API.

| Deliverable | State |
|---|---|
| Input inventory, archive separation and local Git bootstrap | Complete |
| Architecture, legacy feature checklist and source-to-feature mapping | Complete |
| Pinned Rust workspace, dfx config, source manifest and local development scripts | Complete |
| Governance, Registry, management adapters and stable probe receipts | Implemented |
| Release artifact identity | Verified by public certified module hashes |
| Live application-canister call path and cost measurements | Awaiting authorized funded application canister |

The frontend currently reserves the future verified client and widget boundary. No dashboard was in the M0 implementation scope. The review engine crate marks the pure analysis boundary, while scenario evaluation is scheduled for M2 after the source projection.

## Test evidence

`./scripts/test-m0.sh` passed 8 unit tests and 3 PocketIC integration tests, built both Wasm configurations, verified the upstream artifact hashes and matched the generated Candid interface. `cargo fmt --all --check` and `didc check canisters/reviewer/reviewer.did` passed. See [M0 capability matrix and measurements](M0.md#capabilities-observed). Local PocketIC tests exercised released Governance code, released Registry code on an empty Registry, a nonempty synthetic Registry join and chunk exchange, native cross-subnet management calls, replicated query limits and a queued-job upgrade. Mainnet module metadata was read anonymously through the IC protocol. No mainnet Wasm was installed or controllers changed.

## Next milestone

Run the same probe in an owner-designated funded application canister under an authorized controller identity and budget. Then build M1's single coherent Registry projection with a fixed bootstrap target, atomic complete-version publication, versioned history and resumable jobs. Add a durable proposal archive and metrics collection backed by the measured source limits. M2 will consume those pinned inputs for the three membership actions and both execution orders.

The owner input for live verification is an assigned canister ID, an existing authorized deployer identity name, install or upgrade authorization, and the cycle budget. The [M0 live runbook](M0.md#authorized-live-verification) includes the commands and required evidence.
