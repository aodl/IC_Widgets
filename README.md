# IC Widgets

IC Widgets is an Internet Computer application for reviewing NNS subnet membership and inspecting registered nodes and blockmaking. It includes a certified frontend and the on-demand reviewer. Earlier releases and fixtures use the Network Nexus name. Network Nexus is now the name of the separate generic host design.

- [Implementation status and next milestone](docs/IMPLEMENTATION_STATUS.md)
- [Architecture and evidence model](docs/ARCHITECTURE.md)
- [Input inventory](docs/MATERIALS.md)
- [Legacy parity and source mapping](docs/PARITY.md)
- [Subnet Membership widget and local build](web/README.md)
- [Offline historical Membership reviews](docs/review-fixtures/README.md)
- [Pinned source manifest](docs/SOURCES.md)
- [M1 evidence contracts](docs/EVIDENCE.md)
- [Budget, recovery and deployment operations](docs/OPERATIONS.md)
- [M0 test matrix and deployment runbook](docs/M0.md)

Use Rust 1.96.0 with the Wasm target, Cargo, Protobuf compiler 3.12.4 or compatible, and PocketIC 14.0.0 for local integration. The full script needs `candid-extractor` 0.1.6 and `didc` for generated interface checks. The dfx 0.31.0 CLI is used for the prepared deployment and diagnostic command examples.

```bash
cargo test --locked --workspace
./scripts/test-m0.sh
```

The integration script builds and installs Wasm in a fresh PocketIC instance. The original archives and separate extracted materials are local references under the repository root. The production frontend embeds the application from [web/](web/README.md). Start and stop a disposable replica with the [historical replay launcher](docs/review-fixtures/README.md). Rust crate names, existing environment variables and deployment aliases remain stable for current tooling and historical reproduction.
