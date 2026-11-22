# Supplied materials

| Archive | SHA-256 | Extracted location | Inventory |
|---|---|---|---|
| `Reference.zip` | `a2cbfb38260641704201d6f17509663e6225aa711380d9b255680e5268f8b3b7` | `materials/legacy-reference/` | 218 files across seven .NET projects, 41,253,084 bytes including historical exports |
| `Network_Nexus_Codex_Implementation_Pack.zip` | `8c543cf79a5cb9033e6c85d9a3d0d5bac29d015c44e5fb90c989447293754f93` | `materials/network-nexus-codex-pack/` | 11 files, 166,253 bytes, including start-here, scope and acceptance contracts |

The legacy archive has separate projects for proposal visualization, subnet analysis, IC API collection, trustworthy node metrics, commit analysis, models and data access. The archives were checked separately for path traversal and unsafe file types before extraction. Archive and extraction contents are Git-ignored and retained locally. The legacy builds were never executed.

A path-only scan identified embedded credential or token references in AutoAnalysis, the geolocation helper and ProposalVisualiser. The production code and Git index contain no legacy credential values or historical data exports. No legacy datasets were promoted to source evidence. The original legacy archive remains sensitive.
