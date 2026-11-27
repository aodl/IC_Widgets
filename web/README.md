# Network Nexus widgets

Enter one or two NNS proposal IDs and select **Review**. The browser starts membership and continues through the bounded detail pages and replicated comparisons. The map and findings use the pinned Registry snapshot. **Coverage** opens Evidence, including the observations and calculation input. A targeted preview checks the selected target memberships and proposal-candidate records. An untargeted removal checks every listed subnet. The scope notice reports how many listed subnets were checked.

Performance can read blockmaking samples for an independent subnet or follow the selected review with a named node filter. Changing the linked review scope clears its previous performance result. Sample times and sparse source rows are visible.

See [Clear review and Target Topology](../docs/clear-review/README.md) for the current review options, recorded example and uncoached worksheet.

## Local proof of concept

The same reviewer and frontend asset canisters serve the widgets. Use `DFX_IDENTITY=codex_local` on a local network. To use local source fixtures, build the reviewer with `--features local-fixtures` and configure its init argument with the fixture's Governance and Registry principals. Compile the existing `nexus-source-fixture` Wasm into a local test deployment only. Call the fixture's `set_registry_mode(1)`, `prepare_direct_registry()` and `enable_proposal_fixture()`. Try replacement `90`, the pair `93` and `92`, or multi-subnet removal `91`. These fixtures serve direct versioned Registry reads and individual Governance replies.

Open the frontend and select **Review** or **Performance**. Each page generates an in-memory identity for its review session. Registry sources and administrative operations remain controller-managed. [Replay setup](../docs/review-fixtures/README.md)

The standard IC agent verifies replicated update responses. A local frontend fetches the local replica root key. A non-local build uses the IC trust root. Use these commands to verify the asset build and generated interface:

```bash
didc bind --target js canisters/reviewer/reviewer.did > web/src/reviewer.did.js
npm --prefix web ci
npm --prefix web test
CANISTER_ID_REVIEWER="$(dfx canister id --network local reviewer)" DFX_NETWORK=local npm --prefix web run build
```

`./scripts/test-m0.sh` builds the fixtures and runs the cross-subnet PocketIC tests, including the on-demand review and native blockmaking cases. Set `NEXUS_REAL_PROPOSAL_REPLY` to an existing public Candid reply for a one-addition, one-removal Governance proposal to also replay its exact payload against a synthetic local Registry. This tests the real proposal decoder and analysis path while keeping Registry verification local.

## Embedded frontend and production network regression

The normal DFX frontend build bundles the web application with content-hashed names and embeds it in the certified Rust frontend. Follow the [build and migration guide](../docs/EMBEDDED_FRONTEND.md). The separate historical replay launcher still serves development replay assets.

Prepare the locked npm dependencies and Playwright with Chromium. Create a disposable local fixture project, then upgrade its standard asset canister to the embedded local build as described in the guide. Use the printed project directory. Optional `PLAYWRIGHT_MODULE` and `CHROMIUM_EXECUTABLE` point to prepared installations.

```bash
node web/verify-embedded-frontend.mjs "$project"
node web/browser-production-network.mjs "$project" "$PWD/.local/production-network"
```

The browser driver uses the actual certified responses from the loopback IC HTTP gateway. It independently verifies v2 responses, allows only the hashed frontend assets and the intended reviewer protocol routes, and blocks outside requests, service workers and external DNS. The installed local profile fetches the replica trust root through the standard local IC status endpoint. The test does not rewrite the bundle or bypass certification. The separately reproducible production artifact embeds the mainnet reviewer ID and uses the SDK's pinned mainnet trust root. The guide also checks that exact production artifact through the local gateway without running mainnet application calls.

The embedded frontend includes [/test-cases](../docs/test-cases/README.md), which serves immutable fixture evidence through certified case URLs. The disposable historical launcher continues to exercise the full backend evidence workflow.
