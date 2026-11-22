# Frontend boundary

The frontend will use generated Candid bindings in `src/client` and presentation components in `src/widgets`. A later milestone will build the dashboard and package its assets for a certified asset canister.

A membership result will supply each child widget with an immutable revision, scenario, Registry baseline and allowed node set. Local filters intersect that set. An empty or unresolved scope yields no data. The browser renders analyses and verifies proofs against the backend result. The canister implements evidence collection and review rules.
