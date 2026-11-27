# Open membership proposals observed on November 27, 2026

The original developer capture contains one Governance page with 20 Open or Adopted proposals across public topics and five individually hydrated proposal replies while Open. It includes each affected subnet record retrieved at Registry version 66,264. The original request and response bytes, local retrieval times, observed lifecycle, decoded membership instructions and distinct member counts are preserved. [Original observation](observation.json)

## Pinned Registry follow-up

Additional anonymous `get_value` queries went directly to the NNS Registry canister. Every request explicitly pins version 66,264. The archive retains exact request and response bytes, reply SHA-256, local retrieval time, mutation version and mutation timestamp where present. The five original subnet responses and times were reused. Proof of absence requires the Registry's `KEY_NOT_PRESENT` response to name the requested key. These are direct developer query records outside the deployed catalogue. [Raw pinned Registry replies](pinned-registry-values.json) · [Coverage and assignments](pinned-replay-coverage.json)

The archive contains 274 distinct keys. There are 258 inline records and 16 explicit absences, all for API boundary assignments. The Registry roster and all 98 listed subnet records resolve at the pin. The NNS subnet identity resolves. For each comparison the represented union has a recorded node, operator, provider and data centre with valid GPS and non-empty region and owner. The roster audit found no duplicate assignments and every requested incoming node had no listed subnet or API boundary assignment at the pin.

| Proposal | Before | Proposed from recorded instructions | Effective additions / removals | Evidence for pinned Membership replay |
| --- | ---: | ---: | ---: | --- |
| 145077 | 13 | 13 | 1 / 1 | Sufficient |
| 145076 | 13 | 13 | 1 / 1 | Sufficient |
| 145075 | 13 | 13 | 2 / 2 | Sufficient |
| 145071 | 13 | 13 | 2 / 2 | Sufficient |
| 145063 | 13 | 13 | 2 / 2 | Sufficient |

The pinned archive closes the Registry inputs needed to replay all five Membership comparisons from their recorded Open proposal bytes, including network-wide assignment coverage for the incoming nodes. This is an input audit with no new replay case registrations. The frozen targeted on-demand reviewer still checks only the affected subnet for these actions. Its coverage warning can remain even though this independent archive contains the wider roster.

The original cross-topic Governance history remains incomplete. It contains one page and five hydrated replies from separate observation windows. Registry follow-up cannot recover the other original pages, missing proposal payloads, any later execution outcome or actual synchronization history. A complete historical replay of cross-proposal findings or execution cannot be established from this capture.

To validate the saved requests, response digests, coverage and Registry joins offline from the repository root, run:

```sh
(cd docs/subnet-activity/governance-2026-11-27 && sha256sum -c SHA256SUMS)
python3 docs/subnet-activity/governance-2026-11-27/audit-pinned-registry.py
```
