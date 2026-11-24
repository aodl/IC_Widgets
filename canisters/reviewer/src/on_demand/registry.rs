use std::collections::{BTreeMap, BTreeSet};

use candid::{Principal, encode_one};
use nexus_domain::{Hash, MembershipAction, sha256};
use nexus_ic_sources::{
    projection::{DecodedRecord, Details, RecordKey, decode_record},
    registry::{
        ChunkRequest, ValueContent, decode_value_for_name, head, value_request_for_name,
        verify_chunk,
    },
};
use nexus_review_engine::{
    Proposal, Record, RecordStamp, RegistryBaseline, RegistryKey, ReviewError, data_center_key,
    relevant_nodes, requested_nodes,
};

use super::{CandidateAssignment, LiveError, NODE_LIMIT, Request, bounded_reason, source_error};
use crate::review_records;

pub(super) async fn resolve(
    request: &mut Request,
    source: Principal,
    proposals: &[Proposal],
) -> Result<(RegistryBaseline, Vec<(Principal, CandidateAssignment)>), LiveError> {
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
    let listed = roster
        .value()
        .filter(|ids| !ids.is_empty())
        .ok_or_else(|| unavailable(RegistryKey::Roster))?;
    let mut subnets: BTreeSet<_> = listed.iter().copied().collect();
    for row in proposals {
        if let MembershipAction::Add { subnet, .. } | MembershipAction::Change { subnet, .. } =
            row.action
        {
            subnets.insert(subnet);
        }
    }
    let subnet_rows = resolver
        .read(
            subnets.iter().copied().map(RecordKey::Subnet).collect(),
            review_records::subnet,
        )
        .await?;
    let mut baseline = RegistryBaseline {
        version,
        complete: true,
        roster,
        subnets: subnets.into_iter().zip(subnet_rows).collect(),
        nodes: BTreeMap::new(),
        boundaries: BTreeMap::new(),
        operators: BTreeMap::new(),
        data_centers: BTreeMap::new(),
    };
    let actions: Vec<_> = proposals.iter().map(|row| &row.action).collect();
    let nodes = relevant_nodes(&baseline, &actions).map_err(LiveError::InvalidEvidence)?;
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
    let assignments = assignments(&baseline, &actions)?;

    let operators: BTreeSet<_> = baseline
        .nodes
        .values()
        .filter_map(|node| node.value()?.operator)
        .collect();
    let operator_rows = resolver
        .read(
            operators.iter().copied().map(RecordKey::Operator).collect(),
            review_records::operator,
        )
        .await?;
    baseline.operators = operators.into_iter().zip(operator_rows).collect();
    let centers: BTreeSet<_> = baseline
        .operators
        .values()
        .filter_map(|row| data_center_key(&row.value()?.data_center))
        .collect();
    let center_rows = resolver
        .read(
            centers.iter().cloned().map(RecordKey::DataCenter).collect(),
            review_records::data_center,
        )
        .await?;
    baseline.data_centers = centers.into_iter().zip(center_rows).collect();
    Ok((baseline, assignments))
}

fn assignments(
    baseline: &RegistryBaseline,
    actions: &[&MembershipAction],
) -> Result<Vec<(Principal, CandidateAssignment)>, LiveError> {
    let mut listed = BTreeMap::new();
    for subnet in baseline.roster.value().expect("validated roster") {
        for node in &baseline.subnets[subnet]
            .value()
            .expect("validated subnet")
            .members
        {
            if baseline.nodes.contains_key(node) {
                listed.insert(*node, *subnet);
            }
        }
    }
    let candidates: BTreeSet<_> = actions
        .iter()
        .flat_map(|action| {
            let (add, remove) = requested_nodes(action);
            add.iter().chain(remove).copied()
        })
        .collect();
    let mut assignments = vec![];
    for (&node, record) in &baseline.nodes {
        let boundary = &baseline.boundaries[&node];
        if matches!(record, Record::Unavailable { .. }) {
            return Err(unavailable(RegistryKey::Node(node)));
        }
        if matches!(boundary, Record::Unavailable { .. }) {
            return Err(unavailable(RegistryKey::ApiBoundary(node)));
        }
        let assignment = match (record.value(), listed.get(&node), boundary.value()) {
            (None, None, None) => CandidateAssignment::NodeAbsent,
            (Some(_), Some(subnet), None) => CandidateAssignment::ListedSubnet(*subnet),
            (Some(_), None, Some(())) => CandidateAssignment::ApiBoundary,
            (Some(_), None, None) => CandidateAssignment::UnknownOutsideListedSubnets,
            _ => return Err(LiveError::InvalidEvidence(ReviewError::InvalidTopology)),
        };
        if candidates.contains(&node) {
            assignments.push((node, assignment));
        }
    }
    Ok(assignments)
}

fn unavailable(key: RegistryKey) -> LiveError {
    LiveError::InvalidEvidence(ReviewError::UnavailableRecord(key))
}

struct Resolver<'a> {
    request: &'a mut Request,
    source: Principal,
    version: u64,
    chunks: BTreeMap<Hash, (u64, Result<Vec<u8>, String>)>,
}

impl Resolver<'_> {
    async fn read<T>(
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
