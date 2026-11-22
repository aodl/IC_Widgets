# Network Nexus

Network Nexus is an Internet Computer application for reviewing NNS Subnet Membership proposals against versioned on-chain evidence. This repository starts with M0, a Rust canister that probes the direct Governance, Registry and management interfaces and archives the outcomes in stable memory.

- [Implementation status and next milestone](docs/IMPLEMENTATION_STATUS.md)
- [Architecture and evidence model](docs/ARCHITECTURE.md)
- [Input inventory](docs/MATERIALS.md)
- [Legacy parity and source mapping](docs/PARITY.md)
- [Pinned source manifest](docs/SOURCES.md)
- [M0 test matrix and deployment runbook](docs/M0.md)

Use Rust 1.96.0 with the Wasm target, Cargo, Protobuf compiler 3.12.4 or compatible, and PocketIC 14.0.0 for local integration. The dfx 0.31.0 CLI is used for the prepared deployment and diagnostic command examples.

```bash
cargo test --locked --workspace
./scripts/test-m0.sh
```

The integration script builds and installs Wasm in a fresh PocketIC instance. The original archives and separate extracted materials are local references under the repository root. The frontend boundary is reserved at [web/](web/README.md).
