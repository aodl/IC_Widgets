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

## Production network regression

Prepare the locked Node dependencies, Playwright with Chromium, and an isolated local replay project using `./scripts/dev-review-fixture.sh --case nns-144954-recorded-open --single`. Use the printed project directory. Optional `PLAYWRIGHT_MODULE` and `CHROMIUM_EXECUTABLE` point to prepared installations.

```bash
node web/browser-production-network.mjs "$project" "$PWD/.local/production-network"
```

The driver makes an ordinary production build with the isolated reviewer principal. When Chromium requests the bundle, the test harness replaces only the pinned mainnet trust anchor with the fixture replica public root. Production mode, the IC SDK, request signing and certificate verification remain active. The browser receives the deployed CSP and only the three local application assets. It routes approved IC calls to the isolated replica through the test harness. DNS, service workers and other browser requests are blocked. The test rejects attempted outside traffic, verifies the complete 144954 review, and checks that map interaction, flags, borders and generating the report consume no additional IC requests. No public or mainnet network is contacted by the test.
