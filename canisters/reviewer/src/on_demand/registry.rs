use std::collections::{BTreeMap, BTreeSet};

use candid::{Principal, encode_one};
use nexus_domain::{Hash, sha256};
use nexus_ic_sources::{
    projection::{DecodedRecord, Details, RecordKey, decode_record},
    registry::{
        ChunkRequest, ValueContent, decode_value_for_name, head, value_request_for_name,
        verify_chunk,
    },
};
use nexus_review_engine::{
    Proposal, Record, RecordStamp, RegistryBaseline, RegistryKey, ReviewError, candidate_nodes,
    listed_subnets, preview_subnets,
};

use super::{CandidateAssignment, LiveError, NODE_LIMIT, Request, bounded_reason, source_error};
use crate::review_records;

pub(super) async fn pinned_head(
    request: &mut Request,
    source: Principal,
) -> Result<u64, LiveError> {
    let reply = request
        .one(source, "get_latest_version", "Registry head".into(), vec![])
        .await?;
    let bytes = reply
        .body
        .map_err(|reason| source_error(reply.id, reason))?;
    let version = head(&bytes).map_err(|err| source_error(reply.id, err))?;
    if version == 0 {
        return Err(source_error(reply.id, "invalid Registry head"));
    }
    request.version = Some(version);
    Ok(version)
}

pub(super) async fn resolve(
    request: &mut Request,
    source: Principal,
    proposals: &[Proposal],
) -> Result<(RegistryBaseline, Vec<(Principal, CandidateAssignment)>), LiveError> {
    let version = pinned_head(request, source).await?;
    let mut resolver = Resolver {
        request,
        source,
        version,
        chunks: BTreeMap::new(),
    };
    let roster = resolver
        .read(vec![RecordKey::SubnetList], review_records::roster)
        .await?
        .pop()
        .expect("one roster");
    let listed = listed_subnets(&roster).map_err(LiveError::InvalidEvidence)?;
    let actions: Vec<_> = proposals.iter().map(|row| &row.action).collect();
    let subnets = preview_subnets(&listed, &actions);
    let subnet_rows = resolver
        .read(
            subnets.iter().copied().map(RecordKey::Subnet).collect(),
            review_records::subnet,
        )
        .await?;
    let mut baseline = RegistryBaseline {
        version,
        complete: false,
        roster,
        subnets: subnets.into_iter().zip(subnet_rows).collect(),
        nodes: BTreeMap::new(),
        boundaries: BTreeMap::new(),
        operators: BTreeMap::new(),
        data_centers: BTreeMap::new(),
    };
    let nodes = candidate_nodes(&actions);
    if nodes.len() > NODE_LIMIT {
        return Err(LiveError::CallLimit);
    }
    let node_rows = resolver
        .read(
            nodes.iter().copied().map(RecordKey::Node).collect(),
            review_records::node,
        )
        .await?;
    let boundary_rows = resolver
        .read(
            nodes.iter().copied().map(RecordKey::ApiBoundary).collect(),
            review_records::boundary,
        )
        .await?;
    baseline.nodes = nodes.iter().copied().zip(node_rows).collect();
    baseline.boundaries = nodes.into_iter().zip(boundary_rows).collect();
    let assignments = assignments(&baseline, &listed)?;
    Ok((baseline, assignments))
}

fn assignments(
    baseline: &RegistryBaseline,
    listed: &BTreeSet<Principal>,
) -> Result<Vec<(Principal, CandidateAssignment)>, LiveError> {
    let mut known = BTreeMap::new();
    for (&id, record) in &baseline.subnets {
        if !listed.contains(&id) {
            continue;
        }
        let subnet = record
            .value()
            .ok_or_else(|| unavailable(RegistryKey::Subnet(id)))?;
        for node in &subnet.members {
            if baseline.nodes.contains_key(node) && known.insert(*node, id).is_some() {
                return Err(LiveError::InvalidEvidence(ReviewError::InvalidTopology));
            }
        }
    }
    let mut assignments = vec![];
    for (&node, record) in &baseline.nodes {
        let boundary = &baseline.boundaries[&node];
        if matches!(record, Record::Unavailable { .. }) {
            return Err(unavailable(RegistryKey::Node(node)));
        }
        if matches!(boundary, Record::Unavailable { .. }) {
            return Err(unavailable(RegistryKey::ApiBoundary(node)));
        }
        let assignment = match (record.value(), known.get(&node), boundary.value()) {
            (None, None, None) => CandidateAssignment::NodeAbsent,
            (Some(_), Some(subnet), None) => CandidateAssignment::ListedSubnet(*subnet),
            (Some(_), None, Some(())) => CandidateAssignment::ApiBoundary,
            (Some(_), None, None) => CandidateAssignment::UnknownOutsideListedSubnets,
            _ => return Err(LiveError::InvalidEvidence(ReviewError::InvalidTopology)),
        };
        assignments.push((node, assignment));
    }
    Ok(assignments)
}

fn unavailable(key: RegistryKey) -> LiveError {
    LiveError::InvalidEvidence(ReviewError::UnavailableRecord(key))
}

pub(super) struct Resolver<'a> {
    pub(super) request: &'a mut Request,
    pub(super) source: Principal,
    pub(super) version: u64,
    pub(super) chunks: BTreeMap<Hash, (u64, Result<Vec<u8>, String>)>,
}

impl Resolver<'_> {
    pub(super) async fn read<T>(
        &mut self,
        keys: Vec<RecordKey>,
        project: fn(Details) -> Option<T>,
    ) -> Result<Vec<Record<T>>, LiveError> {
        let replies = self
            .request
            .read(
                self.source,
                "get_value",
                keys.iter()
                    .map(|key| {
                        let name = key.name();
                        let args = value_request_for_name(&name, self.version);
                        (name, args)
                    })
                    .collect(),
            )
            .await?;
        let decoded: Vec<_> = keys
            .into_iter()
            .zip(replies)
            .map(|(key, reply)| {
                let raw = reply
                    .body
                    .and_then(|raw| decode_value_for_name(&raw, &key.name(), self.version));
                (key, reply.id, raw)
            })
            .collect();
        let hashes: BTreeSet<_> = decoded
            .iter()
            .filter_map(|(_, _, row)| match row {
                Ok(Some(row)) => match &row.content {
                    ValueContent::Chunked(hashes) => Some(hashes),
                    ValueContent::Inline(_) => None,
                },
                _ => None,
            })
            .flatten()
            .filter(|hash| !self.chunks.contains_key(*hash))
            .copied()
            .collect();
        let chunk_replies = self
            .request
            .read(
                self.source,
                "get_chunk",
                hashes
                    .iter()
                    .map(|hash| {
                        (
                            hex(hash),
                            encode_one(ChunkRequest {
                                content_sha256: Some(hash.to_vec()),
                            })
                            .expect("chunk args"),
                        )
                    })
                    .collect(),
            )
            .await?;
        for (hash, reply) in hashes.into_iter().zip(chunk_replies) {
            let content = reply
                .body
                .and_then(|raw| verify_chunk(&raw, hash).map_err(|err| err.to_string()));
            self.chunks.insert(hash, (reply.id, content));
        }
        Ok(decoded
            .into_iter()
            .map(|(key, id, row)| {
                let row = match row {
                    Ok(None) => return Record::Missing,
                    Err(reason) => {
                        return Record::Unavailable {
                            reason: bounded_reason(reason),
                            stamp: None,
                        };
                    }
                    Ok(Some(row)) => row,
                };
                let mut stamp = RecordStamp {
                    mutation_version: row.version,
                    mutation_time: row.timestamp_nanos,
                    page_observation: id,
                    chunk_observations: vec![],
                    value_hash: None,
                };
                let bytes = match row.content {
                    ValueContent::Inline(bytes) => Ok(bytes),
                    ValueContent::Chunked(hashes) => self.assemble(hashes, &mut stamp),
                };
                let value = bytes.and_then(|bytes| {
                    stamp.value_hash = Some(sha256(&bytes));
                    match decode_record(&key, &bytes)? {
                        DecodedRecord::Present(details) => project(details)
                            .ok_or_else(|| "Registry review schema unavailable".into()),
                        DecodedRecord::Opaque(reason) => Err(reason.into()),
                    }
                });
                match value {
                    Ok(value) => Record::Present { value, stamp },
                    Err(reason) => Record::Unavailable {
                        reason: bounded_reason(reason),
                        stamp: Some(stamp),
                    },
                }
            })
            .collect())
    }

    fn assemble(&self, hashes: Vec<Hash>, stamp: &mut RecordStamp) -> Result<Vec<u8>, String> {
        let mut bytes = vec![];
        for hash in hashes {
            let (id, chunk) = &self.chunks[&hash];
            stamp.chunk_observations.push(*id);
            let chunk = chunk.as_ref().map_err(Clone::clone)?;
            if bytes.len() + chunk.len() > 1024 * 1024 {
                return Err("assembled Registry record exceeds 1 MiB".into());
            }
            bytes.extend_from_slice(chunk);
        }
        Ok(bytes)
    }
}

fn hex(hash: &Hash) -> String {
    hash.iter().map(|byte| format!("{byte:02x}")).collect()
}

pub(super) async fn activity_roster(
    request: &mut Request,
    source: Principal,
) -> Result<(Vec<Principal>, BTreeMap<Principal, Vec<Principal>>, bool), LiveError> {
    let version = pinned_head(request, source).await?;
    let mut resolver = Resolver {
        request,
        source,
        version,
        chunks: BTreeMap::new(),
    };
    let roster = resolver
        .read(vec![RecordKey::SubnetList], review_records::roster)
        .await?;
    let listed: Vec<_> = listed_subnets(&roster[0])
        .map_err(LiveError::InvalidEvidence)?
        .into_iter()
        .collect();
    let mut owners = BTreeMap::<_, Vec<_>>::new();
    let mut complete = true;
    for batch in listed.chunks(16) {
        match resolver
            .read(
                batch.iter().copied().map(RecordKey::Subnet).collect(),
                review_records::subnet,
            )
            .await
        {
            Ok(records) => {
                for (&subnet, record) in batch.iter().zip(records) {
                    if let Some(value) = record.value() {
                        for &member in &value.members {
                            owners.entry(member).or_default().push(subnet);
                        }
                    } else {
                        complete = false;
                    }
                }
            }
            Err(_) => {
                complete = false;
                break;
            }
        }
    }
    Ok((listed, owners, complete))
}
