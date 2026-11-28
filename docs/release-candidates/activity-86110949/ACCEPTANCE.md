# Subnet Activity acceptance

## Reviewed behavior

| Finding | Resolution |
| --- | --- |
| Refresh and review identity | The active request generation holds the review IDs. A refresh scopes the existing bounded scan to the exact proposal IDs, full node identities and incoming or outgoing roles from the accepted Membership instructions. The reply echoes this scope, which must match the active review. The selected proposal may be absent from the list. When reusing an overview without an explicit node scope, the fallback compares each accepted NNS function and raw executable payload SHA-256. A failure or unbound replacement retains the prior observation with its original time and a reason. Membership final verification governs lifecycle. |
| Integrated current subnet | All subnets offers current membership for every listed subnet using the existing subnet producer and map. The result displays its own Registry pin and observation time. Choosing a review or subnet invalidates obsolete map and Performance results. |
| Navigator | The default queue is Undecided. Voting open uses the observed Governance reward status, including decided proposals. Pending execution has its own expandable list. The badges and totals distinguish unique proposals, confirmed subnet associations and unresolved targets. Single-proposal rows open directly. Narrow screens use a list and shared inspector with restored position. |
| Performance | All related nodes is the finite union of the accepted before/proposed sets. Standalone and composed views share the exact scope function. Existing, Proposed, Add, Remove and across-steps scopes remain explicit. Independent requests still use their own subnet. Empty and missing finite filters cannot become unfiltered reads. |
| Resilience and receipts | The existing margin calculation is unchanged. Both individual and cumulative details show the before/proposed budgets, modeled unavailable counts, remaining values and limiting state. Cumulative details identify earlier unsynchronized arrivals. The review ZIP freezes discovery findings and full receipts separately from Membership, Registry and final Governance verification. |
| Source work and coverage | A targeted-only overview pins the Registry and reads the roster. After hydration, an observed supported untargeted removal triggers one shared scan of pinned memberships. The pending interaction and voting pagination scopes remain separate. An explicit node projection reuses the same source reads and adds no Registry or Governance lookup. A review-specific projection skips rereading the selected proposal. Known unsupported action tags are projected without decoding their bodies. Motion text is checked without counting a motion as decoded executable evidence. Omitted or unreadable actions, malformed payloads and truncated selected findings are qualified. |
| Permanent catalogue | The five Registry 66,264 cases and their exact captured Governance replies remain in the catalogue. The single archived discovery page cannot establish historical discovery completeness. The existing introduction renderer remains unchanged. |

## Coverage limits

Governance pagination is a bounded observation window. A proposal's absence cannot establish a later lifecycle outcome. Unknown action tags outside the pinned projection can remain unavailable after hydration. Actual synchronization and global execution validity remain unverified. Current-subnet inspection can obtain a different Registry pin from the navigator. Browser and replica observations here use disposable fixtures.

## Integration

The Activity base and this PR's tested head descend from the production catalogue source `4cdb714258f6ea0cf8f1163d0a6d1b42cda9ad51`. The catalogue publication and deployment record `5f0f11e` is on the parallel catalogue branch. The default `main` still points to the M0 checkpoint `6a6330c`. Accept PR #11 onto the Activity stack first, then review the whole source stack for integration to the agreed release branch and retain the prior catalogue deployment ledger. Use the verified candidate tree for the release or rerun the release gate if integration changes code or build inputs. No branch was merged as part of this acceptance pass.

## Discovery source calls

Counts include rejected source calls. Registry totals include the version and roster reads. These are disposable-fixture measurements.

| Scenario | Listed Registry subnets | Governance lists | Governance hydration | Registry head and roster | Individual memberships | Total |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Synthetic targeted Membership only | 1 | 4 | 1 | 2 | 0 | 7 |
| Untargeted removal associated with two subnets | 2 | 4 | 0 | 2 | 2 | 8 |
| Recorded mixed archive of 20 proposals | 98 | 6 | 0 | 2 | 0 | 8 |
| Rejected Governance discovery | 96 | 2 | 0 | 2 | 0 | 4 |

The recorded mixed archive was incomplete, and the last row represents two rejected source lists. The reviewer permits up to 14 attempts per discovery scope and 72 hydrations. Existing guards admit at most 384 source calls per request, in batches of up to eight, with a 4 MiB source-reply budget, a 1 MiB result limit, a 120-second deadline, cycle reservations and one active slot. The public budgets admit bursts of 96 updates and 768 source calls and each refill at one operation per 30 seconds. A response can retain verified partial evidence or report an explicit bounded error. The overview and an explicitly requested projection each cap returned findings at 256, and overflow is disclosed for the relevant scope. An explicit projection accepts no more than two proposal IDs, 128 unique node identities and 512 instruction-role tuples.

[Raw discovery receipt samples](evidence/discovery/) · [Archive coverage audit](evidence/pinned-registry-audit.json)

## Composed verification and report samples

The same independently hosted map origin served both the existing-subnet and proposal-review inputs. The network-limited browser asserted exact principal sets for the 40 existing members, the 41-node union for 144954, the seven-node union for 144940 and the explicit five-node proposed scope for 144940. Invalidating the proposal anchor cleared map and Performance state without broadening the request. [Composition results](evidence/composition.json) · [Existing subnet map](evidence/composed-existing-subnet.png) · [Proposal map](evidence/composed-review.png)

The combined review sample separates individual arithmetic, cumulative arrivals and limiting side from source receipts. The recorded 144954 report retains the original Governance observation and separate fixture-serving timestamps. Both ZIPs contain the Markdown and the corresponding map PNG. [Combined review ZIP](evidence/combined-review.zip) · [144954 review ZIP](evidence/144954-review.zip) · [Combined warnings screenshot](evidence/combined-review.png)

The same mixed archive used eight source calls with an explicit accepted-node projection. The projection did not add a source lookup. [Projected mixed observation](evidence/discovery/mixed-with-node-projection.json)

## Verification

The exact implementation and test source is `8611094901da951fbca033e7aae74d99aa6706b2`. [Passing hosted gate](https://github.com/aodl/IC_Widgets/actions/runs/46134702624)

- The full network-restricted Chromium rehearsal checked 126 certified responses, all 45 catalogue routes, 20 interactive workflows and 17 generated review ZIPs. The bundled cases made zero reviewer calls and the rehearsal made zero external requests.
- The browser exercised current-subnet inspection, mobile return and scroll restoration, original timestamp rendering, stale and failed refresh, a successful refresh without the selected proposal in the listing, navigator selection, and standalone Performance. It captured exact requests for 41 related nodes on 144954 and seven on 144940, and verified that the explicit 144940 Proposed filter sent exactly five.
- The independent hosted composition checked 22 certified responses and zero requests outside the allowlist. The Registry audit confirmed sufficient pinned Membership evidence for the five new cases. The archived Governance discovery remains incomplete.

[Browser results](evidence/catalogue.json) · [Desktop navigator](evidence/navigator.png) · [Recorded burst](evidence/recorded-burst.png) · [Mobile current-subnet inspection](evidence/current-subnet-mobile.png) · [Install packages and release runbook](README.md)
