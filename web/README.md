# Network Nexus widgets

Enter one or two NNS proposal IDs in Subnet Membership. The reviewer returns requested changes, before/after memberships, the pinned Registry version and source receipts. Both execution orders use the same evidence. A targeted preview checks the selected target memberships and proposal-candidate records. An untargeted removal checks every listed subnet. The scope label reports how many listed subnets were checked.

Node Performance can read blockmaking samples for a subnet directly. **Use this scope in Node Performance** fills the subnet and limits the rows to the selected membership scenario. Clearing the filter restores that subnet's independent view. Sample times and sparse source rows are visible.

## Local proof of concept

The same reviewer and frontend asset canisters serve the widgets. Use `DFX_IDENTITY=codex_local` on a local network. To use local source fixtures, build the reviewer with `--features local-fixtures` and configure its init argument with the fixture's Governance and Registry principals. Compile the existing `nexus-source-fixture` Wasm into a local test deployment only. Call the fixture's `set_registry_mode(1)`, `prepare_direct_registry()` and `enable_proposal_fixture()`. Try replacement `90`, the pair `93` and `92`, or multi-subnet removal `91`. These fixtures serve direct versioned Registry reads and individual Governance replies.

Open **Pilot access** in the frontend and copy the displayed browser principal. The local controller authorizes one browser tab at a time:

```bash
export DFX_IDENTITY=codex_local
dfx canister call --network local reviewer set_on_demand_caller '(opt principal "BROWSER_PRINCIPAL")'
```

The browser identity lives in memory and changes on reload. Pass `(null)` to revoke the delegation. A controller can also call the endpoints directly. Access expires on reviewer upgrade. The delegate can start on-demand reads and has no controller permissions.

The standard IC agent verifies replicated update responses. A local frontend fetches the local replica root key. A non-local build uses the IC trust root. Use these commands to verify the asset build and generated interface:

```bash
didc bind --target js canisters/reviewer/reviewer.did > web/src/reviewer.did.js
npm --prefix web ci
npm --prefix web test
CANISTER_ID_REVIEWER="$(dfx canister id --network local reviewer)" DFX_NETWORK=local npm --prefix web run build
```

`./scripts/test-m0.sh` builds the fixtures and runs the cross-subnet PocketIC tests, including the on-demand review and native blockmaking cases. Set `NEXUS_REAL_PROPOSAL_REPLY` to an existing public Candid reply for a one-addition, one-removal Governance proposal to also replay its exact payload against a synthetic local Registry. This tests the real proposal decoder and analysis path while keeping Registry verification local.
