# Subnet Activity navigator

The standalone navigator keeps a single selected review and map beside the subnet list. Discovery never starts a Membership review by itself. Navigation uses the distinct observed Membership proposals in the active filter. Selecting an untargeted removal under a subnet opens that subnet's comparison, while the shared review retains access to the other resolved subnets. The map implementation, composed Performance scope and generic Network Nexus host remain independent of discovery.

The reviewer separately pages Open and Adopted-awaiting-execution proposals for pending node references and proposals with Governance reward status AcceptVotes for the Voting open filter. Decided proposals can appear in the latter. Each proposal carries observed decision, voting deadline and execution information. Undecided uses decision state. All subnets uses the full pinned Registry roster, including rows with no observed proposals. Empty counts depend on the displayed coverage.

Untargeted removals are matched by exact node IDs against the pinned subnet memberships. One proposal can appear under multiple rows and in Unresolved targets if an association cannot be established. Missing payloads, unsupported actions and incomplete Registry reads remain visible. Explicit refresh creates a new observation. On failure the previous result remains visible and marked stale. A selected Membership review can reuse the accepted timestamped overview for its checks without another full scan. Its pinned calculation and final Governance verification follow the existing review path.

Each discovery scope allows up to 14 page attempts. The shared request retains its two-minute deadline and 4 MiB reply budget. Hydration permits up to 72 proposals and findings cap at 256. Pagination completion requires an observed empty page.

The executable index also decodes recovery replacement node IDs (NNS function 6) and deployed HostOS target node IDs (41 and 51). When a list entry omits its action or payload, the reviewer tries to hydrate it before classification. An action outside the decoder's projection remains unsupported when hydration succeeds and its action is still unrecognized. Missing and malformed payloads keep separate counts.

## Conditional resilience

An applied simulation with valid unique before/proposed sets has a conditional numeric margin even when global incoming assignment is unresolved. The margin does not establish execution validity. In each step the before-side unavailable set includes departures and the proposed-side unavailable set includes arrivals. The lower remaining fault budget governs. In a later combined step the cumulative case also keeps every earlier arrival unavailable while it remains a member of the relevant state. Set unions count a departing earlier arrival once. There is no assumed synchronization time, recovery between steps, or inferred network liveness.

## Recorded cases

The five recorded Open proposals at Registry 66,264 reuse exact Governance replies and Registry records from the reviewed pinned archive. The browser bundles contain local replicated Membership responses. The original Governance discovery archived one page. The development fixture fails when that observation is exhausted and does not convert it into complete historical coverage. The permanent recorded Membership cases show the missing cross-proposal coverage separately.

## Review artifacts

- [Navigator beside the shared Membership map](evidence/navigator/navigator-and-map.png). The overview rows in this capture use a synthetic discovery fixture.
- [Recorded burst coverage and Registry roster](evidence/navigator/recorded-burst.png). The replay resolves the 98 listed subnets and explicitly flags incomplete Governance voting discovery.
- [Combined warning capture](evidence/navigator/combined-review.png) and [generated review ZIP](evidence/navigator/combined-review.zip). These use the synthetic overlapping-instructions scenario. The ZIP contains the complete Markdown and map.
- [Pinned archive and capture manifest](governance-2026-11-27/). The recorded case routes are `/test-cases/nns-145077-recorded-open`, `/test-cases/nns-145076-recorded-open`, `/test-cases/nns-145075-recorded-open`, `/test-cases/nns-145071-recorded-open`, and `/test-cases/nns-145063-recorded-open`.
- [Composed review capture](evidence/navigator/composed-review.png) and [exact finite requests](evidence/navigator/composition.json). The same independently hosted map served the existing-subnet and both proposal views. The existing subnet passed 40 current members. Proposal 144954 passed the 41-member union of its 40 before and 40 proposed members. The multiple-change view for 144940 passed the seven-member union of two five-member sets. Its explicit proposed-only filter passed exactly five members. The disposable gateway verified 22 certified responses with zero requests outside the allowed origins.
- [Network-restricted Chromium results](evidence/navigator/catalogue.json). The clean disposable run checked 126 certified gateway responses and 45 catalogue routes, exercised 20 interactive cases and downloaded 17 review ZIPs. The five recorded cases generated reports with explicit replay provenance. The browser exercised keyboard expansion, next and previous selection, preservation of the selected review across refresh, and recovery after a rejected refresh. Bundled cases made zero reviewer calls. The suite made zero outside requests.
- [Hosted CI](https://github.com/aodl/IC_Widgets/actions/runs/46128195301) passed on implementation and test revision `3f54c66e68107c56b2b174970650dd15bce840c4`. The archive checksums, offline pinned Registry coverage audit and review corpus validation also passed.
