# First hosted Network Nexus installation preflight

Installation stopped before the first install on 28 November 2026. All five canisters were Running with empty module hashes. Both approved controllers, compute and memory settings, freezing threshold, and storage reservation policy matched the candidate. Certified delegation confirmed the host on the 34-node Fiduciary subnet and each widget on the 13-node European subnet. The five published gzip packages at `580d94288909518ecf8c62294cd1b5e5f0c58dca` matched their authorized SHA-256 hashes and manifest sizes. [Candidate manifest](../first-hosted-install-candidate/manifest.json) · [Observed balances and verified package hashes](preflight.json) · [Certified placement](placement.json)

## Admission shortfall

Both subnet records identify replica revision `8aa8519624f131c98ce87f51d04fdd4937b1d959`. For direct and chunked installation, that revision assigns a 300-billion-instruction message limit. Before starting, it prepays the full limit at the subnet rate and preserves the target's existing freezing reserve. Unused execution prepayment is refunded. This balance requirement applies even when the expected net installation charge is much lower. [Install instruction limit](https://github.com/dfinity/ic/blob/8aa8519624f131c98ce87f51d04fdd4937b1d959/rs/config/src/subnet_config.rs#L69) · [Scheduler limits](https://github.com/dfinity/ic/blob/8aa8519624f131c98ce87f51d04fdd4937b1d959/rs/execution_environment/src/scheduler.rs#L1989) · [Install prepayment](https://github.com/dfinity/ic/blob/8aa8519624f131c98ce87f51d04fdd4937b1d959/rs/execution_environment/src/canister_manager.rs#L758) · [Freezing reserve and prepayment](https://github.com/dfinity/ic/blob/8aa8519624f131c98ce87f51d04fdd4937b1d959/rs/cycles_account_manager/src/cycles_account_manager.rs#L477) · [IC tariffs](https://docs.internetcomputer.org/references/cycle-costs/)

| Canister | Observed balance | Refundable prepayment including fixed execution fee | Empty freezing reserve | Minimum additional cycles before ingress or further idle burn |
| --- | ---: | ---: | ---: | ---: |
| Network Nexus host | 149,728,536,936 | 784,628,461,538 | 67,815,906,090 | 702,715,830,692 |
| Subnet Activity | 149,896,535,326 | 300,005,000,000 | 25,929,611,160 | 176,038,075,834 |
| Membership Inspector | 149,896,635,363 | 300,005,000,000 | 25,929,611,160 | 176,037,975,797 |
| IC Node Map | 149,896,735,400 | 300,005,000,000 | 25,929,611,160 | 176,037,875,760 |
| Node Performance | 149,896,855,445 | 300,005,000,000 | 25,929,611,160 | 176,037,755,715 |

The combined admission shortfall at the observations was **1,406,867,513,798 cycles**. Each minimum is prepayment plus the observed 30-day empty freezing reserve minus the observed balance. Include a buffer for elapsed idle burn and ingress when revisiting funding.

## Fiduciary host operating estimate

The prior disposable host build reported 1,691,738 bytes installed. Applying the 34-node tariff to that footprint gives approximately **2.373 billion cycles per day**, **71.182 billion for 30-day freezing**, and **33.218 billion for 14 days of additional idle operation**. The disposable host installation window consumed approximately 4.77 billion cycles. Scaling that reference by 34/13 gives a rough net-charge estimate of **12.47 billion cycles**. Budget **20 billion cycles each** for the initial and fallback net charges as a planning allowance. The exact net charge stays unobserved until installation.

To retain the ability to submit a fallback install on day 14 using the same balance, budget for another full refundable prepayment at that point. The model gives approximately 909.03 billion cycles in initial host balance and up to 360.90 billion per widget before ingress, elapsed burn and any additional storage reservation. This model includes the initial installation allowance, post-install freezing reserve and 14 days of idle burn. The single fallback prepayment covers the fallback execution charge until refund. Recheck current balances and rates before submitting any install. [Reference footprint measurements](../first-hosted-release.md#funding-and-operating-estimates)

No Wasm installation, top-up, ICP conversion, controller change or canister creation was attempted. The existing reviewer and standalone frontend reported their previously published module hashes and controller sets. No smoke test was run because the five allocated canisters remain empty. [Existing production read-only observations](unchanged-production.txt)
