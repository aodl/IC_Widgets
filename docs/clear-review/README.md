# Clear review and Target Topology

Enter a membership proposal ID, open **Review options** to select a policy motion or enter a second proposal, then select **Review**. The map remains available during enrichment. **Sources & details** opens the shared inspector with provenance, registered members and the exact computation input. Select a measure to inspect its group distribution and highlight the contributing nodes. Performance is available separately from the header.

This release supports explicit selection of one consolidated policy motion and NNS role resolution through the pinned Registry. The motion selection starts blank. In the recorded walkthrough use membership proposal **144954** and policy motion **143190**. The review uses the policy actually read for that request. [Source manifest](SOURCES.md)

The local harness uses the same asset and reviewer setup as the map-first review. Use the current branch's Wasms, generated interface and frontend build with the `local-fixtures` feature only for the local reviewer. The fixture combines the recorded Registry 66,013 and Governance membership replies, the recorded #143190 Governance reply, and a synthetic pinned `nns_subnet_id` record pointing to the fixture's NNS target. The source reply hash for #143190 is `9f2e78492a227992e5b413eca5f38e6a7eaa31f109ab164d400ea3f954d28053`. [Local replica setup](../map-first-review/README.md#reproduce-locally)

A clear-review browser request opens one transient canister context bound to its caller and preview. The next contextual preview replaces that context. Policy observations are reused across comparisons, and failed source reads can be retried at the same pin. The final Governance update checks the proposal IDs and lifecycle and payload fields against that context. Existing preview and comparison methods stay available. Controller and pilot admission, concurrency, request limits and stable storage layout keep their established configuration.

## Uncoached walkthrough

Give the owner the fixture page and the two IDs. Ask them to identify whether the review has finished, the outgoing and incoming nodes, the subnet size, the rule used, and which conclusions the evidence supports. Ask them to find the members behind a concentration row and return to the overview. Run the task with a held location reply and a completed review. Record their reasoning and navigation. Browser automation verifies interaction behaviour and request receipts. Participant observations require the owner walkthrough.
