# First hosted Network Nexus release proposal

## Integrated source and evidence

| Repository | Main-branch integration commit | Verified input |
| --- | --- | --- |
| Network Nexus | `b8c174b928a9c07dad7a76aa5145ca24e5ed3bfa` | Runtime and Palette proof at `2d0abdcfbde9a577502bde2d0ecd7bf39ace0727` |
| IC Widgets | `a2b86564d04e73bf272ff1ffd3a6d53f65ffddcb` | Runtime and hosted CI at `e380fc2f0c44b4b83a01730afbba400836b781ff` |

Both merge commits have the accepted PR heads as parents, and their source trees match those heads. The IC Widgets gateway harness at `7c69ea5bafc87751e83cab123fba2509ced1f8a4` adds capture changes to the tested runtime. Publication at `a2727973a0a5d3384a0c7ef19daac7396685db13` adds documentation and artifacts. The integrated IC Widgets tree preserves both the reviewer source and the earlier production deployment records. Four host unit tests and the publication manifest checks were rerun for this proposal. [Network Nexus PR #1](https://github.com/aodl/Network_Nexus/pull/1) · [IC Widgets PR #12](https://github.com/aodl/IC_Widgets/pull/12) · [Passing IC Widgets CI](https://github.com/aodl/IC_Widgets/actions/runs/46139140100) · [Certified rehearsal and Palette evidence](practical/README.md)

## Topology and control

Allocate five frontends on standard 13-node application subnets. Give Network Nexus the `nx_host` origin. Give IC Widgets the `nx_activity`, `nx_inspector`, `nx_map` and `nx_performance` origins. Use the existing reviewer `s34gv-3qaaa-aaaar-qcifa-cai` and retain the standalone frontend `s45ab-wiaaa-aaaar-qcifq-cai` and its permanent catalogue. Both existing canister IDs, deployments and controllers are outside the allocation.

Set best-effort compute and memory allocation to zero and use the default 30-day freezing threshold. Retain the normal storage reservation policy. Check current standard subnet placement and pricing before allocation, then verify the actual subnet class, controllers, settings, balance and empty module hash for each new ID. The allocation budget assumes the standard application rate. [IC subnet types](https://docs.internetcomputer.org/references/subnet-types/) · [Canister settings](https://docs.internetcomputer.org/guides/canister-management/settings/)

Use the existing deployment identity `codex_local` for allocation and subsequent approved installations. Specify both controllers at creation, matching the current standalone control arrangement:

- Deployment principal `amzih-bssz4-twanl-zf6nr-bqsnn-d7rlt-eerbc-oe7vv-uggn5-3naqo-3ae`.
- Existing second controller `zkkkd-i34qc-367ln-e2u7o-ezznu-dkfqh-gtfvz-cviph-6qa4v-evtfs-wqe`.

DFX reports that the deployment identity uses plaintext storage. The proposed funding is capped at the allocation amount, and the independent second controller remains in place. The existing environment can sign when the identity and this constraint are explicitly approved. The account balances observed on 28 November 2026 were zero cycles on the cycles ledger and zero ICP. Use the NNS cycles ledger directly, without a wallet canister. [DFX 0.31 creation path](https://github.com/dfinity/sdk/blob/0.31.0/src/dfx/src/lib/operations/canister/create_canister.rs)

## Funding and operating estimates

The table uses the exact local certified-rehearsal packages and fresh disposable installation measurements. The install column is the local balance decrease between pre-install and post-install status calls, including incidental charges. Mainnet idle and reserve estimates use the reported installed memory with the current standard 13-node application rates of 10,000 cycles per second per canister and 317,500 cycles per GiB-second. The 30-day freezing estimate is part of the balance to retain. Local idle tariffs and install measurements are separate from the mainnet estimates. [IC cycle costs](https://docs.internetcomputer.org/references/cycle-costs/) · [Measured package hashes](practical/disposable-install-hashes.txt)

| Frontend | Wasm bytes | Gzip bytes | Installed memory bytes | Local install-window decrease, B cycles | Estimated idle, B cycles/day | 30-day freezing reserve, B cycles |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Network Nexus host | 1,362,924 | 445,980 | 1,691,738 | 4.767 | 0.907 | 27.22 |
| Subnet Activity | 1,609,389 | 527,986 | 2,035,888 | 5.007 | 0.916 | 27.48 |
| Membership inspector | 1,925,677 | 725,407 | 2,560,989 | 5.439 | 0.929 | 27.88 |
| IC Node Map | 1,611,821 | 623,518 | 2,131,420 | 5.199 | 0.918 | 27.55 |
| Node Performance | 1,925,677 | 725,403 | 2,560,985 | 5.439 | 0.929 | 27.88 |

Estimated idle is **0.138 trillion cycles per 30 days** across the five frontends, assuming stable memory use and zero reserved compute. This excludes on-demand work charged to the existing reviewer. Allow **20 billion cycles per frontend** for one initial install and keep a further **20 billion per frontend** for one fallback install. These are planning allowances within the liquid balance, based on the disposable measurements and prior production installation evidence. Actual costs depend on the final modules, subnet charging, install work and any storage reservation. Record the fresh pre/post balance and memory, and stop if the remaining margin would be inadequate. [Prior production install measurements](../release-candidates/activity-86110949/production/README.md)

| Allocation item | Per canister | Total |
| --- | ---: | ---: |
| Creation fee spent | 500,000,000,000 | 2,500,000,000,000 |
| Cycles-ledger creation fee spent | 100,000,000 | 500,000,000 |
| Initial balance retained | 150,000,000,000 | 750,000,000,000 |
| Debit from deployment cycles account | 650,100,000,000 | **3,250,500,000,000** |

The live cycles ledger returned a 100,000,000-cycle fee. One sponsor transfer has the same fee, so set a **3,250,600,000,000-cycle all-in authorization limit**, including that transfer fee. In total, 2,500,600,000,000 cycles are fees and 750,000,000,000 land in the five frontend balances before running costs. With the 20 billion initial install allowance, 20 billion fallback allowance and up to 28 billion for freezing, each frontend has about 82 billion cycles of additional operating margin, roughly three months at the measured footprint. Keep the fallback allowance liquid until there is an approved fallback. [Official cycles-ledger creation and transfer specification](https://github.com/dfinity/cycles-ledger)

### Existing reviewer capacity

At 11:44 UTC on 28 November 2026 the reviewer reported Running, the accepted module hash `a9337f47cce5e294718598d0adf1d3aa33fd034f9b1a786b81d1b2f5709359d2`, 2,741,721,603,023 cycles in balance and zero reserved cycles. Its reported idle burn was 12,546,761,248 cycles per day, giving an estimated 376,402,837,440-cycle freezing reserve and 2,365,318,765,583 cycles above it before request reservations. The standalone frontend also reported Running with its accepted module hash `f64a81cd9d00bf734d1f992f5976b6a3d0405924b75e7273f9c6fddb3388e2e3` and the same two controllers.

The installed reviewer has one active on-demand request at a time, a 120-second deadline, a 384 source-call cap per request and a 50-billion-cycle liquid floor plus batch reservation. Its shared buckets start with capacity for 96 updates and 768 source calls, and each refills one token every 30 seconds. These values come from the source of the verified deployed module. This planning check measured balances and inspected the reviewed limits. It did not use live discovery to estimate traffic or refresh collector state. The prior production ledger records the collector as disabled. Use the current retry action after competing work settles and measure actual native sample availability during the hosted smoke test. [Reviewer limits](../../canisters/reviewer/src/on_demand.rs) · [Accepted production ledger](../release-candidates/activity-86110949/production/README.md)

## Creation-only approval and manual funding

After approval, the sponsor sends exactly 3,250,500,000,000 cycles from a funded cycles-ledger identity to the deployment principal's default cycles-ledger account. The sponsor pays the 100,000,000-cycle fee. This is the only manual prerequisite with the observed balances. The command is for the sponsor after approval:

```bash
dfx cycles transfer --network ic --identity <funded_identity> \
  amzih-bssz4-twanl-zf6nr-bqsnn-d7rlt-eerbc-oe7vv-uggn5-3naqo-3ae 3250500000000
```

With funds confirmed, use DFX 0.31 and a dedicated deployment configuration containing only the five new aliases. Allocate one alias at a time via `dfx canister create --network ic --identity codex_local --no-wallet` with `--with-cycles 650000000000`, both explicit controllers and the approved standard application placement. Record a fixed transaction timestamp per alias and preserve the returned ID, timestamp, debit and observed canister state before proceeding. Reconcile an ambiguous ledger response using its transaction before retrying. Stop on an unexpected fee, subnet class, controller set or balance. Record the canonical `https://<canister-id>.icp.net` origins after allocation.

Suggested authorization:

> Allocate exactly five empty certified-frontend slots on standard application subnets for Network Nexus host, Subnet Activity, Membership inspector, IC Node Map and Node Performance, using the existing codex_local deployment principal and both listed controllers. Use the cycles ledger and fund each slot with 150,000,000,000 retained cycles, up to 3,250,500,000,000 cycles in deployment-account debits and 3,250,600,000,000 cycles including the one sponsor transfer fee. Record all five IDs and prepare the production packages. Return the manifest for separate installation approval. Leave the existing standalone frontend, reviewer, their controllers and collector configuration unchanged.

## Package preparation and launch verification

1. Bundle a production catalogue containing the four approved descriptors and a prepared Activity review workspace. The host still offers blank guest dashboards, browser-local saves and import/export. The production example uses live selection. The standalone catalogue supplies deterministic historical reviews.
2. Set the four exact canonical widget origins and `/embed` paths in the host catalogue. Pin each widget's certified `frame-ancestors` and handshake to the exact host origin, using production build settings. Keep the standalone framing policy. The host's existing CSP permits certified IC frames, while catalogue validation and the message-channel handshake pin exact origin and path.
3. Build twice from clean pinned inputs. Record source commits, lockfiles and toolchain versions, deployed IDs, catalogue and framing configuration, uncompressed and compressed package sizes and SHA-256 hashes. Confirm matching bytes and exclude local origins, fixture-source overrides and developer-only replay assets. Use the existing disposable gateway verification to check the actual certificates, exact-origin channel, and external request allowlist. Publish exact immutable packages and the installation manifest for approval.
4. After installation approval, install the widgets first and publish the host last. Capture expected module hashes and controllers, verify certified responses for all five origins, raw-host refusal where the gateway forwards the host header, and the network allowlist. Check the standalone application and its permanent catalogue.
5. Run one Activity scan, one current-subnet inspection and one eligible live Membership review if available. Check exact map identities and finite Performance request payloads against the accepted inspector state. Generate the Markdown/map ZIP. If metrics encounter the single-flight guard, retry once after the competing request settles and record native sample availability separately. If no suitable live proposal appears, record that and use the permanent catalogue for deterministic review/export verification.
6. Create and reopen one guest dashboard, disconnect a binding to verify stale outputs clear, and confirm an unavailable widget can be retried without disrupting the rest of the view. Keep smoke-test requests bounded. If a frontend must be withdrawn, the new host can be taken out of service or an approved package can be restored on the same ID. Existing production remains independent. Keep rollback cycles within the operating allowance and honor install-code rate limits.
