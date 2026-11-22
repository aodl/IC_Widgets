use std::collections::{BTreeMap, BTreeSet};

use candid::{CandidType, Principal};
use nexus_domain::{Hash, sha256};
use serde::Deserialize;

use crate::{ANALYSIS_VERSION, MembershipAction, Policy};

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, CandidType, Deserialize)]
pub enum RegistryKey {
    Roster,
    Subnet(Principal),
    Node(Principal),
    Operator(Principal),
    DataCenter(String),
    ApiBoundary(Principal),
}

#[derive(Clone, Debug, PartialEq, Eq, CandidType, Deserialize)]
pub struct RecordStamp {
    pub mutation_version: u64,
    pub mutation_time: Option<u64>,
    pub page_observation: u64,
    pub chunk_observations: Vec<u64>,
    pub value_hash: Option<Hash>,
}

#[derive(Clone, Debug, PartialEq, Eq, CandidType, Deserialize)]
pub enum Record<T> {
    Present {
        value: T,
        stamp: RecordStamp,
    },
    Deleted(RecordStamp),
    Missing,
    Unavailable {
        reason: String,
        stamp: Option<RecordStamp>,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, CandidType, Deserialize)]
pub enum RecordReference {
    Present(RecordStamp),
    Deleted(RecordStamp),
    MissingAtBaseline,
    Unavailable {
        reason: String,
        stamp: Option<RecordStamp>,
    },
}

impl<T> Record<T> {
    pub fn value(&self) -> Option<&T> {
        match self {
            Self::Present { value, .. } => Some(value),
            _ => None,
        }
    }

    fn reference(&self) -> RecordReference {
        match self {
            Self::Present { stamp, .. } => RecordReference::Present(stamp.clone()),
            Self::Deleted(stamp) => RecordReference::Deleted(stamp.clone()),
            Self::Missing => RecordReference::MissingAtBaseline,
            Self::Unavailable { reason, stamp } => RecordReference::Unavailable {
                reason: reason.clone(),
                stamp: stamp.clone(),
            },
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, CandidType, Deserialize)]
pub struct Subnet {
    pub members: Vec<Principal>,
    pub kind: i32,
    pub sev_enabled: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, CandidType, Deserialize)]
pub struct Node {
    pub operator: Option<Principal>,
    pub reward_type: Option<i32>,
    pub has_chip_id: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, CandidType, Deserialize)]
pub struct Operator {
    pub provider: Option<Principal>,
    pub data_center: String,
}

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, CandidType, Deserialize)]
pub struct Coordinates {
    pub latitude_e7: i32,
    pub longitude_e7: i32,
}

impl Coordinates {
    pub fn from_degrees(latitude: f64, longitude: f64) -> Option<Self> {
        if !(-90.0..=90.0).contains(&latitude) || !(-180.0..=180.0).contains(&longitude) {
            return None;
        }
        Some(Self {
            latitude_e7: (latitude * 10_000_000.0).round() as i32,
            longitude_e7: (longitude * 10_000_000.0).round() as i32,
        })
    }

    pub fn is_valid(&self) -> bool {
        (-900_000_000..=900_000_000).contains(&self.latitude_e7)
            && (-1_800_000_000..=1_800_000_000).contains(&self.longitude_e7)
    }
}

#[derive(Clone, Debug, PartialEq, Eq, CandidType, Deserialize)]
pub struct DataCenter {
    pub registered_region: String,
    pub registered_owner: String,
    pub coordinates: Option<Coordinates>,
}

#[derive(Clone, Debug, PartialEq, Eq, CandidType, Deserialize)]
pub struct RegistryBaseline {
    pub version: u64,
    /// Certified by the local projection's publication invariant.
    pub complete: bool,
    pub roster: Record<Vec<Principal>>,
    pub subnets: BTreeMap<Principal, Record<Subnet>>,
    pub nodes: BTreeMap<Principal, Record<Node>>,
    pub operators: BTreeMap<Principal, Record<Operator>>,
    pub data_centers: BTreeMap<String, Record<DataCenter>>,
    pub boundaries: BTreeMap<Principal, Record<()>>,
}

#[derive(Clone, Debug, PartialEq, Eq, CandidType, Deserialize)]
pub struct ProposalEvidence {
    pub id: u64,
    pub observation: u64,
    pub observed_at_nanos: u64,
    pub raw_hash: Hash,
    pub payload_hash: Hash,
    pub decoder: String,
    pub function: i32,
    pub lifecycle_status: i32,
    pub proposed_at_seconds: Option<u64>,
    pub executed_at_seconds: Option<u64>,
}

#[derive(Clone, Debug, PartialEq, Eq, CandidType, Deserialize)]
pub struct Proposal {
    pub evidence: ProposalEvidence,
    pub action: MembershipAction,
}

#[derive(Clone, Debug, PartialEq, Eq, CandidType, Deserialize)]
pub enum Capture {
    Full(Box<Proposal>),
    Missing(u64),
    Malformed {
        id: u64,
        observation: u64,
    },
    Unsupported {
        id: u64,
        function: Option<i32>,
        observation: u64,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, CandidType, Deserialize)]
pub enum ScenarioSelection {
    All,
    A,
    B,
    AThenB,
    BThenA,
}

/// A Registry head receipt from before the proposal was submitted. This pins
/// an earlier hypothetical baseline without assuming the exact pre-execution state.
#[derive(Clone, Debug, PartialEq, Eq, CandidType, Deserialize)]
pub struct HistoricalHead {
    pub version: u64,
    pub observation: u64,
    pub observed_at_nanos: u64,
    pub raw_hash: Hash,
}

#[derive(Clone, Debug, PartialEq, Eq, CandidType, Deserialize)]
pub struct ReviewManifest {
    pub schema: u16,
    pub registry_version: u64,
    pub registry: BTreeMap<RegistryKey, RecordReference>,
    pub proposals: Vec<ProposalEvidence>,
    pub scenario: ScenarioSelection,
    pub analysis_version: u16,
    pub policy: Policy,
    pub historical_head: Option<HistoricalHead>,
    pub metrics_revision: Option<Hash>,
    pub input_hash: Hash,
}

impl ReviewManifest {
    pub fn revision(&self) -> Hash {
        digest(self)
    }
}

#[derive(Clone, Debug, PartialEq, Eq, CandidType, Deserialize)]
pub enum ReviewError {
    IncompleteBaseline(u64),
    UnavailableRecord(RegistryKey),
    InvalidRecordEvidence(RegistryKey),
    InvalidTopology,
    InvalidSelection,
    MissingProposal(u64),
    MalformedPayload {
        id: u64,
        observation: u64,
    },
    UnsupportedAction {
        id: u64,
        function: Option<i32>,
        observation: u64,
    },
    InvalidCapture(u64),
    UnsupportedPolicy,
    InvalidHistoricalEvidence,
}

#[derive(Clone, Debug)]
pub struct ReviewInput {
    pub(crate) baseline: RegistryBaseline,
    pub(crate) proposals: Vec<Proposal>,
    pub(crate) manifest: ReviewManifest,
    pub(crate) hypothetical_executed: bool,
}

pub(crate) fn digest<T: CandidType>(value: &T) -> Hash {
    sha256(&candid::encode_one(value).expect("canonical review encoding"))
}

impl ReviewInput {
    pub fn build(
        mut baseline: RegistryBaseline,
        captures: Vec<Capture>,
        scenario: ScenarioSelection,
        policy: Policy,
        historical_head: Option<HistoricalHead>,
        metrics_revision: Option<Hash>,
        hypothetical_executed: bool,
    ) -> Result<Self, ReviewError> {
        if !baseline.complete {
            return Err(ReviewError::IncompleteBaseline(baseline.version));
        }
        if captures.is_empty()
            || captures.len() > 2
            || (captures.len() == 1
                && !matches!(scenario, ScenarioSelection::All | ScenarioSelection::A))
        {
            return Err(ReviewError::InvalidSelection);
        }
        if !policy.is_supported() {
            return Err(ReviewError::UnsupportedPolicy);
        }
        if historical_head.as_ref().is_some_and(|head| {
            head.version != baseline.version || head.observation == 0 || head.observed_at_nanos == 0
        }) {
            return Err(ReviewError::InvalidHistoricalEvidence);
        }

        let proposals = captures
            .into_iter()
            .map(validate_capture)
            .collect::<Result<Vec<_>, _>>()?;
        if proposals.len() == 2 && proposals[0].evidence.id == proposals[1].evidence.id {
            return Err(ReviewError::InvalidSelection);
        }
        let actions: Vec<_> = proposals.iter().map(|proposal| &proposal.action).collect();
        let relevant = relevant_nodes(&baseline, &actions)?;
        let requested_subnets = actions
            .iter()
            .filter_map(|action| target(action))
            .collect::<BTreeSet<_>>();
        let roster: BTreeSet<_> = baseline
            .roster
            .value()
            .expect("validated roster")
            .iter()
            .copied()
            .collect();
        baseline
            .subnets
            .retain(|id, _| roster.contains(id) || requested_subnets.contains(id));
        baseline.nodes.retain(|id, _| relevant.contains(id));
        baseline.boundaries.retain(|id, _| relevant.contains(id));

        let mut references = BTreeMap::new();
        let mut bind =
            |key, reference| bind_reference(&mut references, baseline.version, key, reference);
        bind(RegistryKey::Roster, baseline.roster.reference())?;
        for id in roster.union(&requested_subnets).copied() {
            let key = RegistryKey::Subnet(id);
            bind(
                key.clone(),
                resolved(&baseline.subnets, &id, key)?.reference(),
            )?;
        }
        let mut operators = BTreeSet::new();
        for id in relevant {
            let key = RegistryKey::Node(id);
            let row = resolved(&baseline.nodes, &id, key.clone())?;
            bind(key, row.reference())?;
            operators.extend(row.value().and_then(|node| node.operator));

            let key = RegistryKey::ApiBoundary(id);
            bind(
                key.clone(),
                resolved(&baseline.boundaries, &id, key)?.reference(),
            )?;
        }
        baseline.operators.retain(|id, _| operators.contains(id));
        let mut centers = BTreeSet::new();
        for id in operators {
            let key = RegistryKey::Operator(id);
            let row = resolved(&baseline.operators, &id, key.clone())?;
            bind(key, row.reference())?;
            centers.extend(
                row.value()
                    .and_then(|operator| data_center_key(&operator.data_center)),
            );
        }
        baseline.data_centers.retain(|key, _| centers.contains(key));
        for id in centers {
            let key = RegistryKey::DataCenter(id.clone());
            bind(
                key.clone(),
                resolved(&baseline.data_centers, &id, key)?.reference(),
            )?;
        }

        let input_hash = digest(&(&baseline, &proposals, hypothetical_executed));
        let manifest = ReviewManifest {
            schema: 1,
            registry_version: baseline.version,
            registry: references,
            proposals: proposals
                .iter()
                .map(|proposal| proposal.evidence.clone())
                .collect(),
            scenario,
            analysis_version: ANALYSIS_VERSION,
            policy,
            historical_head,
            metrics_revision,
            input_hash,
        };
        Ok(Self {
            baseline,
            proposals,
            manifest,
            hypothetical_executed,
        })
    }

    pub fn manifest(&self) -> &ReviewManifest {
        &self.manifest
    }
}

fn validate_capture(capture: Capture) -> Result<Proposal, ReviewError> {
    let proposal = match capture {
        Capture::Full(proposal) => *proposal,
        Capture::Missing(id) => return Err(ReviewError::MissingProposal(id)),
        Capture::Malformed { id, observation } => {
            return Err(ReviewError::MalformedPayload { id, observation });
        }
        Capture::Unsupported {
            id,
            function,
            observation,
        } => {
            return Err(ReviewError::UnsupportedAction {
                id,
                function,
                observation,
            });
        }
    };
    let expected = match proposal.action {
        MembershipAction::Add { .. } => 2,
        MembershipAction::Remove { .. } => 13,
        MembershipAction::Change { .. } => 31,
    };
    if proposal.evidence.id == 0
        || proposal.evidence.observation == 0
        || proposal.evidence.function != expected
    {
        return Err(ReviewError::InvalidCapture(proposal.evidence.id));
    }
    Ok(proposal)
}

fn resolved<'a, K: Ord, V>(
    map: &'a BTreeMap<K, V>,
    id: &K,
    key: RegistryKey,
) -> Result<&'a V, ReviewError> {
    map.get(id).ok_or(ReviewError::UnavailableRecord(key))
}

fn bind_reference(
    references: &mut BTreeMap<RegistryKey, RecordReference>,
    version: u64,
    key: RegistryKey,
    reference: RecordReference,
) -> Result<(), ReviewError> {
    let valid_stamp =
        |stamp: &RecordStamp| stamp.mutation_version <= version && stamp.page_observation != 0;
    let valid = match &reference {
        RecordReference::Present(stamp) => valid_stamp(stamp) && stamp.value_hash.is_some(),
        RecordReference::Deleted(stamp) => valid_stamp(stamp) && stamp.value_hash.is_none(),
        RecordReference::MissingAtBaseline => true,
        RecordReference::Unavailable { stamp, .. } => stamp.as_ref().is_none_or(valid_stamp),
    };
    if !valid {
        return Err(ReviewError::InvalidRecordEvidence(key));
    }
    references.insert(key, reference);
    Ok(())
}

pub fn data_center_key(field: &str) -> Option<String> {
    (!field.is_empty()).then(|| field.to_lowercase())
}

pub(crate) fn target(action: &MembershipAction) -> Option<Principal> {
    match action {
        MembershipAction::Change { subnet, .. } | MembershipAction::Add { subnet, .. } => {
            Some(*subnet)
        }
        MembershipAction::Remove { .. } => None,
    }
}

pub fn requested_nodes(action: &MembershipAction) -> (&[Principal], &[Principal]) {
    match action {
        MembershipAction::Change { add, remove, .. } => (add, remove),
        MembershipAction::Add { nodes, .. } => (nodes, &[]),
        MembershipAction::Remove { nodes } => (&[], nodes),
    }
}

/// Resolves the join footprint without collecting every node's metadata.
pub fn relevant_nodes(
    baseline: &RegistryBaseline,
    actions: &[&MembershipAction],
) -> Result<BTreeSet<Principal>, ReviewError> {
    let roster = baseline
        .roster
        .value()
        .ok_or(ReviewError::UnavailableRecord(RegistryKey::Roster))?;
    let roster_set: BTreeSet<_> = roster.iter().copied().collect();
    if roster_set.len() != roster.len() {
        return Err(ReviewError::InvalidTopology);
    }
    let mut mentioned = BTreeSet::new();
    let mut removals = BTreeSet::<Principal>::new();
    let mut targets = BTreeSet::new();
    for action in actions {
        let (adds, drops) = requested_nodes(action);
        mentioned.extend(adds);
        mentioned.extend(drops);
        if let Some(id) = target(action) {
            targets.insert(id);
        } else {
            removals.extend(drops);
        }
    }
    let mut assigned = BTreeSet::new();
    for id in roster {
        let row = baseline
            .subnets
            .get(id)
            .and_then(Record::value)
            .ok_or(ReviewError::UnavailableRecord(RegistryKey::Subnet(*id)))?;
        if row.members.iter().any(|node| !assigned.insert(*node)) {
            return Err(ReviewError::InvalidTopology);
        }
        if targets.contains(id) || row.members.iter().any(|node| removals.contains(node)) {
            mentioned.extend(row.members.iter().copied());
        }
    }
    Ok(mentioned)
}
