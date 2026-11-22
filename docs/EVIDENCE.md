# M1 evidence foundation

## Registry replay and publication

The production collector reads an initial Registry head and fixes it as its bootstrap target. Every raw `get_changes_since` page has a source head and a separate delivered cursor. The adapter validates the delivered version sequence across all keys. The collector copies the selected key mutations into one stable stage, capped at the fixed target while bootstrapping. An apply slice validates and commits at most 64 staged rows. A required chunk has to arrive and match its SHA-256 before its stage row can advance. A staged schema failure or hash mismatch is recorded and holds the publication pointer.

The collector may write a partial page to versioned history while processing its stage. Historical readers check the publication pointer before traversing history. At the end of the initial stage that completes the target, the same replicated execution advances both the applied cursor and publication pointer. Later complete pages advance them independently of the original target. An IC message trap rolls back the stage cursor and the writes it owns.

The Registry stores an ordered sequence of operations within each atomic version, including repeated mutations of one key. The raw query returns a key's newest value first. A pinned `get_value` lookup chooses that same entry when several mutations share the version. The adapter projects the first entry for that key/version, verifies shared source time and counts superseded writes. A conflicting duplicated key group or a different committed value for the same history key is an integrity error. [Pinned Registry implementation](https://github.com/dfinity/ic/blob/87617d5fda3b2c8ec0919293a5f1e3a068b07f43/rs/registry/canister/src/registry.rs)

History keys pair the canonical Registry key with its mutation version. A predecessor lookup returns present, deleted or missing at a completed requested version. It never resolves against an unrequested version. The indexed record contains an observation ID, original mutation timestamp, optional content hash, and any chunk observation IDs. A small versioned membership index avoids repeatedly decoding or loading full subnet records for assignment resolution. Key enumeration examines up to 64 keys per page. The cursor advances even when a historical filter returns an empty page.

Retained families are `subnet_list`, `subnet_record_`, `node_record_`, `node_operator_record_`, `data_center_record_`, `api_boundary_node_`, `unassigned_nodes_config`, `replica_version_` and `standard_engine_replica_version`. The adapter uses full principals and the Registry's lower-cased data-center key. The wire bytes preserve the original assertions, including owner and region text. Registry state alone does not establish IP geography, beneficial ownership or observed uptime. [Pinned Registry keys](https://github.com/dfinity/ic/blob/87617d5fda3b2c8ec0919293a5f1e3a068b07f43/rs/registry/keys/src/lib.rs)

## Observation and storage contracts

| Stable memory ID | Format and contents |
|---|---|
| 0–3 | M0 config, jobs, receipts and raw replies in their original formats |
| 4 | Probe admission ledger and migration provenance |
| 5 | Production scheduler, durable call lease, stage budget and observation ID counter |
| 6–7 | Source observations and SHA-256 indexed evidence blobs |
| 8–11 | Registry projection state, sparse history, current page stage and key index |
| 12–15 | Governance collector, captures, indexes and refresh schedule |
| 16–20 | Metrics roster, subnet collector state, due times, samples and integrity findings |
| 21–22 | Membership review requests and immutable report bytes |

Structured M1 values start with format tag 1 followed by Candid bytes. A later writer has to retain readers for tags already in use or migrate to a new memory ID. Memory IDs and stable key shapes are persistent. Blobs keep their exact bytes and rely on the enclosing observation or capture for schema and decoder revision. Only selected Registry record bytes are retained from valid pages. The observation commits to the full wire hash and length, and failed decoding or integrity replies are retained for examination.

`registry_status`, `registry_record`, `registry_keys` and `registry_assignment` are controller-only replicated reads. `source_observation` resolves a provenance ID and `evidence_bytes` exports retained bytes in 128 KiB pages. A bounded `evidence_manifest` binds the explicit completed Registry version and a sorted deduplicated set of caller-selected source observations to one digest. It does not validate their sufficiency for a review. Selected Registry values and tombstones can be reconstructed from stable history and their evidence. Successful Registry pages retain their full wire hash and size, while selected values are stored separately. The original page cannot be reconstructed from those values. Certain failed replies are retained for diagnosis. The browser can use later certified review APIs. These administrative reads expose no UI certification claim.

## Bootstrap sizing

Anonymous development queries on 22 November 2026 observed Registry head 65,925. These are direct non-replicated source samples used for sizing.

| Request after | Delivered versions | Wire bytes | Wire mutations including repeated writes | Selected wire mutations | Selected inline bytes |
|---:|---:|---:|---:|---:|---:|
| 0 | 270 | 1,367,560 | 1,082 | 399 | 56,203 |
| 32,962 | 983 | 1,314,806 | 2,086 | 808 | 313,304 |
| 64,925 | 453 | 1,301,282 | 1,478 | 1,012 | 243,824 |

A first-pass extrapolation from these page densities yields roughly 67–245 fetches and 87–335 MB of wire input. On a standard 13-node subnet that is about 0.09–0.34 trillion transmission cycles before decoding, execution and storage. At the local diagnostic reservation rate of 42.35 billion per call, those fetches would reserve about 2.8–10.4 trillion in aggregate. Reservations are an admission allowance and actual debits are measured separately. Storage depends on selected mutations and their sizes, the number of chunks and index overhead. The samples found no selected chunked values.

Continue with the existing replay if the bounded live probe confirms the delivery cursor, page size and decoding on the replicated path. The high wire estimate exceeds the default production allowance of 256 MiB per day. A separately authorized replay can continue from its durable cursor across windows while keeping the original target fixed. A reply or required chunk that repeatedly fails at supported limits, or a version whose complete delivery cannot be verified, is grounds to reassess feasibility. The simplest candidate alternative would be a canonical snapshot of provably complete state at a fixed version, if the source can provide one. Individual reads and a subnet roster cannot establish a complete node inventory.

The three sampled pages passed the production adapter's structural and record decoding checks. The middle page held 808 selected wire mutations and 741 effective keys at their versions. A direct non-replicated `get_value` at version 33,019 matched the first of two mutations for one node operator in that page. The SHA-256 of the pinned read is `1dc54d3270b98cbbe21a1689b8eb68d22e784f227d2ca0c5da64bb9d79adb8dd`.

The 24-subnet, 1,200-node PocketIC run processed five versions, 1,237 wire mutations and 1,232 retained mutations. It received 348,471 raw source bytes and retained 99,632 selected value bytes. The instrumentation recorded 2.28 billion instructions in the callback and apply slices. The canister balance declined by 8.62 billion cycles including polling and upgrade. Stable structures allocated 1,025 pages, about 64 MiB, with fixed memory-manager buckets dominating this small archive. Per-byte charges from M0 and the three sampled page sizes suggest a transport component on the order of 90–350 billion cycles under comparable local pricing. That is a sizing scenario. Full cost also depends on replica pricing, decoding, writes, chunks, dispatch reservations and the mix of historical versions.

## Governance archive

The collector pages `list_proposals` by exclusive ID. It starts with at most five recent pages, records the oldest scanned ID, and resumes subsequent discovery toward the previous scan watermark. Listings queue supported membership candidates. Every capture uses `get_proposal_info` for the individual proposal. A large list reduces its requested page size on the observed replica size rejection. An oversized individual reply has an explicit unavailable payload status because the source provides no paginated follow-up.

Stable IDs 12–15 contain the discovery state, immutable captures keyed by proposal and observation ID, per-proposal status index, and open/adopted refresh schedule. The entire captured Candid reply is stored by hash. The executable payload and proposer text have their own digests inside that capture and can be recovered from the same bytes. The typed action read distinguishes atomic change, add, remove, unsupported functions and payload decode errors. Proposer-authored strings are claims in Governance evidence.

Repeated equivalent lifecycle and content observations share a capture. Every attempt has an independent source observation, including a missing ID or a transport failure. A changed lifecycle creates another capture referencing its own observation and original wire hash. An executable payload change for one proposal ID is retained with an integrity finding. Open/adopted proposals are rechecked hourly. Transient failures use bounded backoff. An exhausted capture can be requeued by a controller.

`capture_proposal` queues an explicit ID. `proposal_status`, `proposal_archive`, `proposal_history`, `proposal_action` and `discovery_status` read the durable archive. For later conflict discovery, these indexes can expand to a separately reviewed set of node-affecting Governance functions. The first discovery pass scans at most five pages of the proposal list. The reported range covers that bounded pass only. A user-selected review can request either proposal individually, including an older ID outside discovery coverage.

## Node blockmaking archive

The metrics worker derives its roster from a completed Registry version. Application, system and verified-application subnets are eligible. Cloud Engine and unrecognized kinds are visible in the unsupported roster. Failed roster refreshes keep the previous roster and expose the error. A retired subnet remains readable and drops out of the due index.

Stable IDs 16–20 contain the Registry-derived roster, subnet-specific collection state, due-time index, timestamp index and conflicting sample findings. Every successful request retains its raw response by content hash, including empty and boundary-only replies. Identical wire content shares one blob. Identical overlap samples keep their original source observation. The sample identity digests the sorted node rows and exact source timestamp under the recorded decoder revision. Raw Candid preserves original row order. The archive distinguishes the sample timestamp and the successful collection time.

The next request starts inclusively at the last committed sample. The callback verifies overlaps before advancing the cursor. Different counters for an existing subnet/timestamp retain both observations and mark the sample conflicted. An empty successful response preserves the cursor and any previously recorded gap. A boundary-only reply establishes the overlap without adding a sample. If an inclusive reply starts after its expected boundary, the archive records the missing boundary. Rejections, abbreviated backfill coverage and calendar discontinuities have separate evidence. A decrease between adjacent observations is recorded as a continuity signal. Sparse rows are retained and may represent disappearance or reappearance. Counter interpretation remains an M2 or later derivation concern, with epochs and denominators supplied by the metrics contract.

Daily collection leaves ample margin against a rolling history of up to 60 timestamps and supports initial backfill from timestamp zero. Shorter history after an oversized reply starts at most seven days back and carries a gap. Transient failures back off at five and ten minutes under the default attempt cap. An exhausted or permanently invalid reply gets a per-subnet failure status and another daily attempt. The other due subnets remain eligible. Collection resumes through the durable queue on upgrade.

`metrics_roster`, `metrics_status`, `metric_samples`, `metric_sample_rows` and `metric_conflicts` expose bounded controller reads. Sample pages carry collection status, so a page with no stored samples can still report an unobserved or rejected source. The raw and derived availability fields can distinguish no sample, an empty reply, a failed fetch, a sampled node row and a continuity gap. M2 can use `registry_provider` to enumerate at most one bounded page of operators of a provider at the chosen Registry version, and compose a node/operator/DC join through typed records at the same version.

The [M2 review manifest](M2.md#evidence-and-revision) validates the records required by a membership scenario and retains each typed input reference alongside the resulting revision.
