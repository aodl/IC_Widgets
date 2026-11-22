# Network Nexus repository instructions

Follow the implementation pack under `materials/network-nexus-codex-pack/` when it is available. Start from `docs/IMPLEMENTATION_STATUS.md` and the architecture document. The source, parity and M0 documents record which behavior has evidence.

- Never read, print, copy, export or modify PEMs, seed phrases, private keys, wallet keys or .env secrets. Never export a dfx identity. Restrict inspection of dfx identity configuration to confirming the active name. Use `DFX_IDENTITY=codex_local` for local ICP tests.
- Work within `/home/codexdev`. Do not use sudo or escalate privileges. Mainnet deployment, spending mainnet cycles, publication and controller changes require explicit authorization.
- Keep legacy materials and their historical data in the ignored `materials/` tree. Do not run the legacy tooling or copy credentials.
- Runtime source acquisition uses direct replicated inter-canister reads only. Use pinned interfaces and preserve source bytes and provenance. Explicitly distinguish registered facts, proposer claims, observed metrics, inferences and unavailable evidence.
- Keep source transport, stable persistence, pure analysis and display in their respective units. Bound work, persist job intent before awaiting and protect commits with the job generation.
- Preserve public Candid interfaces unless a change is requested. Regenerate `canisters/reviewer/reviewer.did` when the interface changes. Add or update behavioral tests and run the relevant suites before delivery.

## Engineering principles

- Choose the simplest implementation that meets the actual requirement. Reuse existing modules and libraries. Generalize for future widgets when a concrete need appears.
- Weigh edge cases by likelihood, impact and implementation cost. For low-impact cases, an explicit unsupported or unavailable result can be the clearest outcome.
- Preserve correctness, source integrity, access control and durable-state safety. Give each new option, abstraction and persistent structure a practical reason to exist.
- Keep changes small and reviewable. Test meaningful behavior. Leave working code in place unless the task calls for a concrete improvement.
