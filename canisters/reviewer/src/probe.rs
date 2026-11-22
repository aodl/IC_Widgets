use candid::{CandidType, Principal, encode_one};
use nexus_domain::sha256;
use nexus_ic_sources::{
    decode_candid, governance,
    management::{self, NodeMetricsHistoryArgs, SubnetInfoArgs, SubnetInfoResult},
    registry::{self, ChunkRequest, Key, RecordSummary, ValueContent},
};

use crate::{
    model::{Assembled, ChunkPlan, Job, ListedProposal, Observation, Sources, Step},
    store,
};

pub struct Command {
    pub source: Principal,
    pub method: &'static str,
    pub request: Vec<u8>,
}

impl Step {
    pub fn command(&self, sources: Sources) -> Command {
        let (source, method, request) = match self {
            Self::List {
                before,
                omit_large_fields,
                limit,
            } => (
                sources.governance,
                "list_proposals",
                encode(governance::list_request(
                    *before,
                    *omit_large_fields,
                    *limit,
                )),
            ),
            Self::Proposal(id) => (sources.governance, "get_proposal_info", encode(id)),
            Self::Head => (sources.registry, "get_latest_version", vec![]),
            Self::Changes { after, .. } => (
                sources.registry,
                "get_changes_since",
                registry::changes_request(*after),
            ),
            Self::Value { key, at } => (
                sources.registry,
                "get_value",
                registry::value_request(key, *at),
            ),
            Self::Chunk(plan) => (
                sources.registry,
                "get_chunk",
                encode(ChunkRequest {
                    content_sha256: Some(plan.hashes[plan.prior_receipts.len()].to_vec()),
                }),
            ),
            Self::SubnetInfo(subnet) => (
                Principal::management_canister(),
                "subnet_info",
                encode(SubnetInfoArgs { subnet_id: *subnet }),
            ),
            Self::Metrics { subnet, start, .. } => (
                Principal::management_canister(),
                "node_metrics_history",
                encode(NodeMetricsHistoryArgs {
                    subnet_id: *subnet,
                    start_at_timestamp_nanos: *start,
                }),
            ),
        };
        Command {
            source,
            method,
            request,
        }
    }

    pub fn observe(&self, bytes: &[u8], job: &mut Job) -> Result<Observation, String> {
        match self {
            Self::List {
                before,
                omit_large_fields,
                limit,
            } => {
                let rows = governance::decode_page(bytes, *before, *limit)?;
                let listed: Vec<_> = rows
                    .iter()
                    .map(|row| {
                        let action = row.executable();
                        ListedProposal {
                            id: row.id.expect("validated list ID").id,
                            function: action.map(|action| action.nns_function),
                            listed_payload_bytes: action.map(|action| action.payload.len() as u32),
                        }
                    })
                    .collect();
                if before.is_none() && *omit_large_fields {
                    if job.request.proposal_id.is_none() {
                        if let Some(row) = listed
                            .iter()
                            .find(|row| row.function.is_some_and(governance::is_membership))
                        {
                            job.pending.push(Self::Proposal(row.id));
                        }
                    }
                    if let Some(last) = listed.last() {
                        job.pending.push(Self::List {
                            before: Some(last.id),
                            omit_large_fields: true,
                            limit: *limit,
                        });
                    }
                }
                Ok(Observation::ProposalList(listed))
            }
            Self::Proposal(id) => {
                let info: Option<governance::ProposalInfo> = decode_candid(bytes)?;
                let Some(info) = info else {
                    return Ok(Observation::Unavailable);
                };
                if info.id.map(|id| id.id) != Some(*id) {
                    return Err("returned proposal ID differs from the request".into());
                }
                let action = info.executable();
                let (membership, payload_decode_error) =
                    match action.map(governance::membership).transpose() {
                        Ok(value) => (value.flatten(), None),
                        Err(err) => (None, Some(short_error(&err))),
                    };
                Ok(Observation::Proposal {
                    id: *id,
                    status: info.status,
                    topic: info.topic,
                    proposal_time_seconds: info.proposal_timestamp_seconds,
                    executed_time_seconds: (info.executed_timestamp_seconds != 0)
                        .then_some(info.executed_timestamp_seconds),
                    function: action.map(|action| action.nns_function),
                    payload_bytes: action.map(|action| action.payload.len() as u32),
                    payload_hash: action.map(|action| sha256(&action.payload)),
                    membership,
                    payload_decode_error,
                })
            }
            Self::Head => {
                let version = registry::head(bytes)?;
                job.captured_head = Some(version);
                if version > 0 {
                    job.pending.extend([
                        Self::Value {
                            key: Key::SubnetList,
                            at: version,
                        },
                        Self::Value {
                            key: Key::MissingProbe,
                            at: version,
                        },
                    ]);
                }
                job.pending.push(Self::Changes {
                    after: 0,
                    remaining: if version > 0 { 2 } else { 1 },
                });
                Ok(Observation::RegistryHead(version))
            }
            Self::Changes { after, remaining } => {
                let page = registry::decode_changes(bytes, *after)?;
                if let Some((key, mutation_version, hashes)) =
                    page.chunk_example.filter(|_| !job.page_chunk_attempted)
                {
                    job.page_chunk_attempted = true;
                    job.pending.push(Self::Chunk(ChunkPlan {
                        key: None,
                        registry_key: String::from_utf8_lossy(&key).chars().take(256).collect(),
                        at: job.captured_head.unwrap_or(0),
                        mutation_version,
                        timestamp_nanos: None,
                        hashes,
                        prior_receipts: vec![],
                    }));
                }
                if *remaining > 1 {
                    job.pending.push(Self::Changes {
                        after: page.span.delivered_through,
                        remaining: remaining - 1,
                    });
                }
                Ok(Observation::RegistryPage(page.span))
            }
            Self::Value { key, at } => {
                let Some(result) = registry::decode_value(bytes, key, *at)? else {
                    return Ok(Observation::Unavailable);
                };
                match result.content {
                    ValueContent::Inline(bytes) => {
                        let record = registry::summarize(key, &bytes)?;
                        continue_join(job, key, *at, result.version, &record);
                        Ok(Observation::RegistryValue {
                            key: key.clone(),
                            requested_version: *at,
                            mutation_version: result.version,
                            source_timestamp_nanos: result.timestamp_nanos,
                            record,
                        })
                    }
                    ValueContent::Chunked(hashes) => {
                        let registry_key = key.registry_name();
                        job.pending.push(Self::Chunk(ChunkPlan {
                            key: Some(key.clone()),
                            registry_key: registry_key.clone(),
                            at: *at,
                            mutation_version: result.version,
                            timestamp_nanos: result.timestamp_nanos,
                            hashes: hashes.clone(),
                            prior_receipts: vec![],
                        }));
                        Ok(Observation::RegistryChunks {
                            registry_key,
                            mutation_version: result.version,
                            hashes,
                        })
                    }
                }
            }
            Self::Chunk(plan) => observe_chunk(bytes, plan, job),
            Self::SubnetInfo(subnet) => {
                let info: SubnetInfoResult = decode_candid(bytes)?;
                Ok(Observation::SubnetInfo {
                    subnet: *subnet,
                    replica_version: info.replica_version,
                    registry_version: info.registry_version,
                })
            }
            Self::Metrics {
                subnet,
                start,
                expected_boundary_hash,
            } => {
                let history = management::decode_metrics(bytes, *start)?;
                let first = history.first().map(|sample| sample.timestamp_nanos);
                let last = history.last().map(|sample| sample.timestamp_nanos);
                let first_sample_hash = history.first().map(|sample| sha256(&encode(sample)));
                if expected_boundary_hash.is_none() {
                    if let Some(last) = history.last() {
                        job.pending.push(Self::Metrics {
                            subnet: *subnet,
                            start: last.timestamp_nanos,
                            expected_boundary_hash: Some(sha256(&encode(last))),
                        });
                    }
                }
                Ok(Observation::Metrics {
                    subnet: *subnet,
                    requested_start_nanos: *start,
                    sample_count: history.len() as u32,
                    first_timestamp_nanos: first,
                    last_timestamp_nanos: last,
                    minimum_rows: history
                        .iter()
                        .map(|sample| sample.node_metrics.len() as u32)
                        .min(),
                    maximum_rows: history
                        .iter()
                        .map(|sample| sample.node_metrics.len() as u32)
                        .max(),
                    first_sample_hash,
                    overlap_matches: expected_boundary_hash
                        .map(|hash| first == Some(*start) && first_sample_hash == Some(hash)),
                })
            }
        }
    }
}

fn observe_chunk(bytes: &[u8], plan: &ChunkPlan, job: &mut Job) -> Result<Observation, String> {
    let index = plan.prior_receipts.len();
    let hash = plan.hashes[index];
    let chunk = registry::chunk_bytes(bytes, hash)?;
    let assembled = if index + 1 == plan.hashes.len() {
        let mut record = Vec::new();
        for (&receipt, &expected) in plan.prior_receipts.iter().zip(&plan.hashes) {
            let reply = store::raw(job.id, receipt).ok_or("missing stored chunk reply")?;
            record.extend(registry::chunk_bytes(&reply, expected)?);
        }
        record.extend_from_slice(&chunk);
        if record.len() > registry::MAX_RECORD_BYTES {
            return Err("Registry reconstruction exceeds byte budget".into());
        }
        let summary = plan
            .key
            .as_ref()
            .map(|key| registry::summarize(key, &record))
            .transpose()?;
        if let (Some(key), Some(summary)) = (&plan.key, &summary) {
            continue_join(job, key, plan.at, plan.mutation_version, summary);
        }
        Some(Assembled {
            hash: sha256(&record),
            bytes: record.len() as u32,
            record: summary,
        })
    } else {
        let mut next = plan.clone();
        next.prior_receipts.push(job.receipt_count);
        job.pending.push(Step::Chunk(next));
        None
    };
    Ok(Observation::Chunk {
        hash,
        bytes: chunk.len() as u32,
        assembled,
    })
}

fn continue_join(job: &mut Job, key: &Key, at: u64, version: u64, record: &RecordSummary) {
    if job.captured_head != Some(at) {
        return;
    }
    let next = match record {
        RecordSummary::SubnetList { first, .. } => {
            if version > 1 {
                job.pending.push(Step::Value {
                    key: key.clone(),
                    at: version - 1,
                });
            }
            job.request.registry_subnet.or(*first).map(Key::Subnet)
        }
        RecordSummary::Subnet {
            subnet_type, first, ..
        } => {
            if let Key::Subnet(subnet) = key {
                if job.request.remote_subnet.is_none()
                    && *subnet != job.caller_subnet
                    && matches!(subnet_type, 1 | 2 | 4)
                    && job.auto_remote.is_none()
                {
                    job.auto_remote = Some(*subnet);
                    add_management(&mut job.pending, *subnet, job.request.metrics_start_nanos);
                }
            }
            first.map(Key::Node)
        }
        RecordSummary::Node { operator } => Some(Key::Operator(*operator)),
        RecordSummary::Operator { dc, .. } => Some(Key::DataCenter(dc.clone())),
        RecordSummary::DataCenter { .. } => None,
    };
    if let Some(key) = next {
        job.pending.push(Step::Value { key, at });
    }
}

pub fn add_management(pending: &mut Vec<Step>, subnet: Principal, start: u64) {
    pending.extend([
        Step::SubnetInfo(subnet),
        Step::Metrics {
            subnet,
            start,
            expected_boundary_hash: None,
        },
    ]);
}

fn encode(value: impl CandidType) -> Vec<u8> {
    encode_one(value).expect("encode typed source argument")
}

pub fn short_error(message: &str) -> String {
    message.chars().take(240).collect()
}
