# Subnet Membership widget

The widget reads the reviewer through generated Candid bindings and the standard IC agent. The DFX `frontend` asset canister serves a static bundle. The browser renders the selected revision, its proposal evidence, scenario steps, registered distributions and scoped blockmaking page.

## Local use

Use the `codex_local` identity throughout the local workflow. Deploy the backend and assets on a local network. From the repository root:

```bash
export DFX_IDENTITY=codex_local
dfx start --background
dfx deploy --network local
```

The asset build reads `CANISTER_ID_REVIEWER` and `DFX_NETWORK` from DFX. For a standalone bundle build or binding check:

```bash
didc bind --target js canisters/reviewer/reviewer.did > web/src/reviewer.did.js
npm --prefix web ci
CANISTER_ID_REVIEWER="$(dfx canister id --network local reviewer)" DFX_NETWORK=local npm --prefix web run build
```

The catalogue initially lists completed reports. Review creation stays in the controller workflow described in [M2](../docs/M2.md). For a local fixture demo, deploy the reviewer with the `local-fixtures` build and the existing synthetic source canister. Registry mode 1 and the proposal fixture support an addition/removal pair, proposals 93 and 92 at fixture version 5. `set_demo_proposal` on the fixture canister optionally replays one exact public `get_proposal_info` wire reply. Such a capture retains its reply hash while the UI identifies the local replica. Registry lookup still resolves against the configured fixture, so a real proposal can show an unavailable target at that local baseline.

## Replicated reads

The first release uses read-only-in-effect Candid update methods for the catalogue, report and scoped performance. The standard agent verifies subnet-consensus certificates for these responses. Production retains the IC trust root. Local builds fetch the local root key. Asset HTTP certification comes from the standard asset canister. [IC response certification](https://docs.internetcomputer.org/guides/frontends/certification/)

This trades query latency for a simpler verification path. An initial visit costs one update for the catalogue, one on opening a report, and one per requested performance page. Searching the loaded catalogue and switching among scenarios use the loaded report with no additional network calls. Heavy reads stop at the 50-billion-cycle safety floor. Reads are bounded by the existing 64-job and 1 MiB report limits, and the performance endpoint decodes at most one archived source reply per request and returns at most 64 scoped nodes. The endpoints perform no collection, review generation or writes. Review creation and archive administration require a controller. IC guidance estimates updates at roughly two to four seconds and queries around 200 ms. Actual live read cost and latency still need an authorized run. [IC client latency and verification](https://docs.internetcomputer.org/guides/canister-calls/calling-from-clients/)

The performance panel shows the latest archived management sample and per-node cumulative proposed blocks and blockmaking failures. A sparse omission remains “No row in sample”. The panel identifies conflicted samples and archive continuity gaps. A paginated result uses the selected sample timestamp and the resolved scope cursor. Historical membership and a sample's observation time are independent. Per-window derivation and reliability scoring are deferred.

Mainnet deployment and live replication checks remain separately authorized. The initial workflow uses completed reports prepared by a controller.
