# Map-first review acceptance

This revision puts the map and the consequential findings in the primary workspace. Nodes, Concentration, Claims, Evidence, Export review and Performance provide the supporting views. The Nodes view and inspector provide a text path to the locations and roles shown by the map. Progress announcements use a status region and leave focus with the reviewer. [W3C guidance on complex images](https://www.w3.org/WAI/tutorials/images/complex/) · [W3C status messages](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html)

A browser-local sequence admits one request at a time. A replacement review waits for an accepted call to settle, skips obsolete work and starts a separate pinned session. Changing orders within that session reuses versioned records. Comparisons keep their own evidence copies and digests. Explicit retry targets failed keys. Stop cancels future steps in this browser. A submitted IC call can still finish. Performance follows the selected scope only when requested and waits for active review work.

The recorded 144954 case uses Registry 66,013. Its appearance and results come from the same proposal and Registry fixture used for the voting-grade review. Fixture read times describe local replay. The rendered HTML named in the design brief was unavailable in this checkout, so the reported layout positions measure this implementation directly. Production still uses bundled Natural Earth geometry and the existing canister interfaces, with no runtime map service.

[Screenshots, exports and measurements](VERIFICATION.md) · [Frontend candidate and checksum](release/README.md)

## Reproduce locally

Run from the repository root with DFX 0.31.0 and an unused port 4966. This recipe creates a disposable local project and uses the existing local identity. The fixture and its mode controls are test-only.

```bash
export DFX_IDENTITY=codex_local
project="$PWD/.local/map-review-demo"
test ! -e "$project"
mkdir -p "$project/assets"
cargo build --locked --release --target wasm32-unknown-unknown \
  -p nexus-source-fixture -p nexus-reviewer --features local-fixtures
cp target/wasm32-unknown-unknown/release/nexus_source_fixture.wasm "$project/fixture.wasm"
cp target/wasm32-unknown-unknown/release/nexus_reviewer.wasm "$project/reviewer.wasm"
cp canisters/reviewer/reviewer.did "$project/reviewer.did"
cat > "$project/fixture.did" <<'DID'
service : {
  load_voting_reference : () -> ();
  set_voting_review_fixture : (nat8) -> ();
  set_registry_mode : (nat8) -> ();
  prepare_direct_registry : () -> ();
  enable_proposal_fixture : () -> ();
}
DID
cat > "$project/dfx.json" <<'JSON'
{
  "version": 1,
  "networks": {"local": {"bind": "127.0.0.1:4966", "type": "ephemeral"}},
  "canisters": {
    "fixture": {"type":"custom","wasm":"fixture.wasm","candid":"fixture.did"},
    "reviewer": {"type":"custom","wasm":"reviewer.wasm","candid":"reviewer.did"},
    "frontend": {"type":"assets","source":["assets"],"build":[]}
  }
}
JSON
(
  cd "$project"
  dfx start --background --host 127.0.0.1:4966
  dfx canister create --all --network local
)
fixture="$(cd "$project" && dfx canister id --network local fixture)"
reviewer="$(cd "$project" && dfx canister id --network local reviewer)"
npm --prefix web ci
DFX_NETWORK=local CANISTER_ID_REVIEWER="$reviewer" npm --prefix web run build
cp -a web/dist/. "$project/assets/"
(
  cd "$project"
  dfx canister install --network local --mode install --wasm fixture.wasm fixture
  dfx canister call --network local fixture load_voting_reference '()'
  dfx canister install --network local --mode install --wasm reviewer.wasm reviewer \
    --argument "(opt record { registry = principal \"$fixture\"; governance = principal \"$fixture\" })"
  dfx build --network local frontend
  dfx canister install --network local --mode install frontend
  dfx canister id --network local frontend
)
```

Open `http://<frontend-id>.localhost:4966/`. Copy the browser principal from **Pilot access**, keep that tab open and grant that principal on the local reviewer.

```bash
(cd "$project" && dfx canister call --network local reviewer set_on_demand_caller \
  '(opt principal "BROWSER_PRINCIPAL")')
```

The Chromium scripts accept the project directory and, for the first script, an artifact output directory. Set `PLAYWRIGHT_MODULE` to an installed Playwright module if it is outside the package and `CHROMIUM_EXECUTABLE` if using a separately installed browser. The scripts grant each test tab on the disposable reviewer.

```bash
npm --prefix web test
node web/browser-voting-review.mjs "$project" "$PWD/.local/map-review-demo-results"
node web/browser-review-scenarios.mjs "$project"
```

## Uncoached reviewer worksheet

Use the local replay and give each reviewer the tasks below without demonstrating the controls. Record what they conclude, the route they take, any uncertainty they miss and whether they can recover. Run the tasks on desktop, a narrow screen or keyboard-only as appropriate.

| Task to give the reviewer | What the facilitator checks after the response |
|---|---|
| Review proposal 144954 and explain what changes and what you would want to verify before acting. | Understands the move, the scoped 40→40 outcome and the incomplete assignment check. |
| Investigate the strongest concentration finding and identify the contributing nodes. | Links the affected groups to the correct three resulting nodes and keeps the whole-subnet denominator. |
| Check the decommissioning rationale using the map and evidence. | Separates the last registered member at one data center from city, country and real-world retirement claims. |
| Compare the two orders for local fixtures 93 and 92, including the first step. | Explains the 51 versus 49 intermediate states and recognizes the later convergence. |
| Follow the review in Performance, then switch to an independent subnet. | Distinguishes the selected review preset from an independent query and understands sparse samples. |
| Draft an assessment, export it and switch to another scope. | Locates the digest and uses the correct map and Markdown. Recognizes that the other scope has its own draft. |

For the paired case, set fixture mode 5, then call `set_registry_mode(1)`, `prepare_direct_registry()` and `enable_proposal_fixture()` on the local fixture. Restore mode 0 for 144954. Capture reviewer reasoning in addition to timing and navigation. Automated browser walkthroughs and screenshots establish interaction behavior. Participant feedback and mainnet timing for this revision require their own sessions.

## Release boundary

The candidate changes frontend assets and local test fixtures. Review the draft, checks and acceptance files before arranging any deployment. The frontend bundle uses the existing backend canister and the app keeps the isolated asset-canister configuration. The deployed canisters were outside this work.
