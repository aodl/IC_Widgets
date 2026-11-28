# Subnet Activity navigator

The standalone navigator keeps a single selected review and map beside the subnet list. Discovery never starts a Membership review by itself. Navigation uses the distinct observed Membership proposals in the active filter. Selecting an untargeted removal under a subnet opens that subnet's comparison, while the shared review retains access to the other resolved subnets. The map implementation, composed Performance scope and generic Network Nexus host remain independent of discovery.

The reviewer separately pages Open and Adopted-awaiting-execution proposals for pending node references and proposals with Governance reward status AcceptVotes for the Voting open filter. Decided proposals can appear in the latter. Each proposal carries observed decision, voting deadline and execution information. Undecided uses decision state. All subnets uses the full pinned Registry roster, including rows with no observed proposals. Empty counts depend on the displayed coverage.

Untargeted removals are matched by exact node IDs against the pinned subnet memberships. One proposal can appear under multiple rows and in Unresolved targets if an association cannot be established. Missing payloads, unsupported actions and incomplete Registry reads remain visible. Explicit refresh creates a new observation. On failure the previous result remains visible and marked stale. A selected Membership review can reuse the accepted timestamped overview for its checks without another full scan. Its pinned calculation and final Governance verification follow the existing review path.

The executable index also decodes recovery replacement node IDs (NNS function 6) and deployed HostOS target node IDs (41 and 51). When a list entry omits its action or payload, the reviewer tries to hydrate it before classification. An action outside the decoder's projection remains unsupported when hydration succeeds and its action is still unrecognized. Missing and malformed payloads keep separate counts.

## Conditional resilience

An applied simulation with valid unique before/proposed sets has a conditional numeric margin even when global incoming assignment is unresolved. The margin does not establish execution validity. In each step the before-side unavailable set includes departures and the proposed-side unavailable set includes arrivals. The lower remaining fault budget governs. In a later combined step the cumulative case also keeps every earlier arrival unavailable while it remains a member of the relevant state. Set unions count a departing earlier arrival once. There is no assumed synchronization time, recovery between steps, or inferred network liveness.

## Recorded cases

The five recorded Open proposals at Registry 66,264 reuse exact Governance replies and Registry records from the reviewed pinned archive. The browser bundles contain local replicated Membership responses. The original Governance discovery archived one page. The development fixture fails when that observation is exhausted and does not convert it into complete historical coverage. The permanent recorded Membership cases show the missing cross-proposal coverage separately.
