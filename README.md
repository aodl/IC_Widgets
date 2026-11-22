# Network Nexus

Network Nexus is an Internet Computer application for reviewing NNS Subnet Membership proposals against versioned on-chain evidence. The Rust backend includes a diagnostic probe and an autonomous production evidence collector for Governance, Registry and management-canister observations.

- [Implementation status and next milestone](docs/IMPLEMENTATION_STATUS.md)
- [Architecture and evidence model](docs/ARCHITECTURE.md)
- [Input inventory](docs/MATERIALS.md)
- [Legacy parity and source mapping](docs/PARITY.md)
- [Subnet Membership widget and local build](web/README.md)
- [Pinned source manifest](docs/SOURCES.md)
- [M1 evidence contracts](docs/EVIDENCE.md)
- [Budget, recovery and deployment operations](docs/OPERATIONS.md)
- [M0 test matrix and deployment runbook](docs/M0.md)

Use Rust 1.96.0 with the Wasm target, Cargo, Protobuf compiler 3.12.4 or compatible, and PocketIC 14.0.0 for local integration. The full script needs `candid-extractor` 0.1.6 and `didc` for generated interface checks. The dfx 0.31.0 CLI is used for the prepared deployment and diagnostic command examples.

```bash
cargo test --locked --workspace
./scripts/test-m0.sh
```

The integration script builds and installs Wasm in a fresh PocketIC instance. The original archives and separate extracted materials are local references under the repository root. The DFX asset canister serves the widget from [web/](web/README.md).
