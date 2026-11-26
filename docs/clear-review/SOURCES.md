# Clear review source manifest

| Data or result | Source and scope | Interpretation and dependent calculation |
|---|---|---|
| Proposal IDs, lifecycle, decoded membership action | NNS Governance `get_proposal_info`; initial read, preview recheck and final recheck after comparisons | Validate returned ID and executable function. Retain timestamps, receipts and raw and payload hashes. An observed lifecycle or payload change blocks proposed-state results and export. |
| Subnet roster and membership | Registry `get_latest_version` and `get_value` for `subnet_list` and `subnet_record_<principal>` at the pin | Decode pinned protobuf. Membership order is preserved. Checked and listed memberships provide the assignment coverage denominator. |
| Registration and API-boundary evidence | Registry `node_record_<principal>` and `api_boundary_node_<principal>` at the pin | Check captured candidate records under the supported membership simulation. The result preserves expected absence, failed reads and checks outside scope. |
| Provider and operator groups, DC ID | Registry `node_record_<principal>` and `node_operator_record_<principal>` at the pin | Group by full recorded principals. Facility IDs use the Registry data-center key convention. A provider principal does not establish affiliation or beneficial ownership. |
| Region, DC owner, coordinates | Registry `data_center_record_<id>` at the pin | Group by trimmed recorded owner and comma-delimited region tokens, preserving case and the original declaration. Blank fields stay unknown. Only valid registered coordinates place nodes on the map. |
| NNS role | Registry `get_value` for `nns_subnet_id` at the pin | Decode inline `types.v1.SubnetId` and compare the full principal. Preserve Registry mutation stamp, raw value and reply receipt. Subnet kind and size carry no role inference. |
| Target Topology rule values | NNS Governance `get_proposal_info` for the configured pilot reference or explicit override | Verify ID, adopted or executed Motion action and explicit incorporation of a supported consolidated table. The checked grammar verifies headers, counts, totals and the selected NNS row. Preserve the observation time, reply digest, rule clause and bounded raw reply. |
| Limits, deltas and coverage | Replicated `compare_membership_with_policy` over the checked membership state, subnet kind and context-bound detail observations | Verify each supplied record against the typed result of the actual Registry read. Check consistency along the node → operator → DC graph and reject omission of observed records. Bind the exact Candid arguments to the calculation digest and retain Registry receipts. Numeric bounds apply to each group where identity is established. Country tokens and DC owner names leave policy identity unresolved. The exception is needed only when a recorded provider or facility group's lower bound exceeds the ordinary cap. |
| Blockmaking | Management canister `node_metrics_history` | Keep its sample timestamps and coverage. Sparse samples provide no uptime or health conclusion. Independently requested Performance stays outside Membership completion. |
| Coastlines | Natural Earth 1:110m land, v5.1.2 | Bundled public-domain visual asset. It contributes no application facts or rule inputs. [Asset source](https://github.com/nvkelso/natural-earth-vector/blob/v5.1.2/geojson/ne_110m_land.geojson) · [Terms](https://www.naturalearthdata.com/about/terms-of-use/) |

The role key and pinned protobuf structure follow the IC Registry helper. Governance observations and the Registry pin have distinct clocks. Selection of a policy motion establishes the comparison reference. Applicability of later motions and amendments remains outside this review. [Versioned Registry role lookup](https://github.com/dfinity/ic/blob/ec91fdf7729bcac13251f12d27014ac3e944ffb3/rs/registry/helpers/src/subnet.rs) · [Motion #143190](https://nns.ic0.app/proposal/?proposal=143190&u=qoctq-giaaa-aaaaa-aaaea-cai)

The browser uses the IC protocol endpoint and bundled root trust in production. Scripts, stylesheet and map geometry ship with the asset canister. Registry and Governance facts come from replicated source reads. External links are optional references.

## Follow-up policy observations

Direct anonymous Governance `get_proposal_info` queries on 26 November 2026 from 09:21:34 to 09:21:36 UTC checked the consolidated reference and three motions named in its provenance. The research queries used the IC transport. Production policy observations still use replicated reads.

| Reference | Observed result |
|---|---|
| #125549 | Governance returned an empty optional. This leaves the carried-forward exception's conditions and numerical allowance unverified. |
| #137147 | Governance returned an empty optional. The earlier topology cannot be reconstructed from this lookup. |
| #140858 | Executed Mission70 motion. The content adjusts application subnet counts and reserve sizes. It provides no authoritative node affiliation, data-center provider identity or NNS exception value. Reply SHA-256 `1342edb4d50658dccb282cbf9301f3a4e15fd82b37b476ecdfc9919ca8260c7f`. |
| #143190 | Executed consolidated motion. The reply matched the recorded fixture SHA-256 `9f2e78492a227992e5b413eca5f38e6a7eaa31f109ab164d400ea3f954d28053`. It restates the numeric NNS rules and refers to the earlier exception. |

These reads establish the selected reference and its interpretive limits. They leave current applicability, complete amendment history and policy role bindings for other subnets unverified. [#125549](https://dashboard.internetcomputer.org/proposal/125549) · [#137147](https://dashboard.internetcomputer.org/proposal/137147) · [#140858](https://dashboard.internetcomputer.org/proposal/140858) · [#143190](https://dashboard.internetcomputer.org/proposal/143190)
