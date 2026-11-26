//! One transient review context for the current browser request.
use std::{cell::RefCell, collections::BTreeSet};

use candid::{CandidType, Principal, encode_one};
use ic_cdk::api::{msg_caller, time};
use nexus_domain::{Hash, sha256};
use nexus_ic_sources::{
    decode_candid,
    governance::{Action, ProposalInfo},
    registry::{
        NNS_SUBNET_KEY, ValueContent, decode_value_for_name, nns_subnet, value_request_for_name,
    },
};
use nexus_review_engine::{NnsTarget, ProposalEvidence, Review, parse_nns_target};
use serde::Deserialize;

use super::{
    DetailComparisonInput, LiveResponse, Request, RequestGuard, check_proposal, proposals,
};
use crate::{Sources, store};

struct Context {
    token: Hash,
    caller: Principal,
    revision: Hash,
    version: u64,
    states: BTreeSet<Hash>,
    proposals: Vec<ProposalEvidence>,
    policy: Option<PolicySnapshot>,
}

thread_local! {
    static CONTEXT: RefCell<Option<Context>> = const { RefCell::new(None) };
}

#[derive(Clone, CandidType, Deserialize)]
pub struct PolicySnapshot {
    pub digest: Hash,
    pub nns_subnet: Option<Principal>,
    pub nns_record: Option<Vec<u8>>,
    pub nns_mutation_version: Option<u64>,
    pub nns_issue: Option<String>,
    pub nns_retryable: bool,
    pub motion: Option<PolicyMotion>,
}

#[derive(Clone, CandidType, Deserialize)]
pub struct PolicyMotion {
    pub id: u64,
    pub status: Option<i32>,
    pub observed_at: Option<u64>,
    pub raw_hash: Option<Hash>,
    pub raw: Option<Vec<u8>>,
    pub rule: Option<NnsTarget>,
    pub issue: Option<String>,
    pub retryable: bool,
}

fn sources() -> Sources {
    if cfg!(feature = "local-fixtures") {
        store::config().sources
    } else {
        Sources::canonical()
    }
}

fn state_id(subnet: Principal, before: &[Principal], after: &[Principal]) -> Hash {
    sha256(&candid::encode_args((subnet, before, after)).expect("review membership identity"))
}

pub(super) fn begin(report: &Review) -> Hash {
    let caller = msg_caller();
    let token =
        sha256(&candid::encode_args((caller, time(), report.revision)).expect("review token"));
    let states = report
        .scenarios
        .iter()
        .flat_map(|scenario| scenario.subnets.iter())
        .flat_map(|(&subnet, view)| {
            let before = &view.baseline.members;
            std::iter::once(&view.baseline)
                .chain(view.after_steps.iter().flatten())
                .map(move |next| state_id(subnet, before, &next.members))
        })
        .collect();
    CONTEXT.set(Some(Context {
        token,
        caller,
        revision: report.revision,
        version: report.manifest.registry_version,
        states,
        proposals: report.manifest.proposals.clone(),
        policy: None,
    }));
    token
}

fn with_context<T>(token: Hash, read: impl FnOnce(&Context) -> T) -> Result<T, String> {
    CONTEXT.with_borrow(|context| {
        context
            .as_ref()
            .filter(|context| context.token == token && context.caller == msg_caller())
            .map(read)
            .ok_or_else(|| "This review context was superseded. Start a new review.".into())
    })
}

pub(super) fn policy_for(
    token: Hash,
    digest: Hash,
    input: &DetailComparisonInput,
) -> Result<PolicySnapshot, String> {
    with_context(token, |context| {
        if input.registry_version != context.version
            || input.preview_revision != context.revision
            || !context
                .states
                .contains(&state_id(input.subnet, &input.before, &input.after))
        {
            return Err("Comparison does not match a state in the pinned preview.".into());
        }
        context
            .policy
            .as_ref()
            .filter(|snapshot| snapshot.digest == digest)
            .cloned()
            .ok_or_else(|| "Selected policy observation is unavailable for this review.".into())
    })?
}

#[ic_cdk::update]
async fn membership_target_topology(
    token: Hash,
    policy_id: Option<u64>,
) -> Result<LiveResponse<PolicySnapshot>, String> {
    let guard = RequestGuard::acquire()?;
    if policy_id == Some(0) {
        return Err("Select a positive policy proposal ID.".into());
    }
    let (version, prior) =
        with_context(token, |context| (context.version, context.policy.clone()))?;
    let sources = sources();
    let mut request = Request::new(guard.0);
    request.version = Some(version);
    let read_role = prior.as_ref().is_none_or(|snapshot| snapshot.nns_retryable);
    let mut source = prior.unwrap_or(PolicySnapshot {
        digest: [0; 32],
        nns_subnet: None,
        nns_record: None,
        nns_mutation_version: None,
        nns_issue: None,
        nns_retryable: false,
        motion: None,
    });
    if read_role {
        source.nns_issue = None;
        source.nns_retryable = false;
        match request
            .one(
                sources.registry,
                "get_value",
                NNS_SUBNET_KEY.into(),
                value_request_for_name(NNS_SUBNET_KEY, version),
            )
            .await
        {
            Ok(reply) => {
                source.nns_retryable = reply.body.is_err();
                let decoded = reply.body.and_then(|bytes| {
                    let value = decode_value_for_name(&bytes, NNS_SUBNET_KEY, version)?
                        .ok_or("NNS role was not recorded at the pinned version")?;
                    let ValueContent::Inline(raw) = value.content else {
                        return Err("Chunked NNS role is unsupported".into());
                    };
                    let subnet = nns_subnet(&raw)?;
                    Ok((subnet, value.version, raw))
                });
                match decoded {
                    Ok((subnet, version, raw)) => {
                        source.nns_subnet = Some(subnet);
                        source.nns_mutation_version = Some(version);
                        source.nns_record = Some(raw);
                    }
                    Err(reason) => source.nns_issue = Some(super::bounded_reason(reason)),
                }
            }
            Err(error) => {
                source.nns_retryable = true;
                source.nns_issue = Some(format!("{error:?}"));
            }
        }
    }
    if let Some(id) = policy_id
        && source
            .motion
            .as_ref()
            .is_none_or(|motion| motion.id != id || motion.retryable)
    {
        let mut motion = PolicyMotion {
            id,
            status: None,
            observed_at: None,
            raw_hash: None,
            raw: None,
            rule: None,
            issue: None,
            retryable: false,
        };
        match request
            .one(
                sources.governance,
                "get_proposal_info",
                id.to_string(),
                encode_one(id).expect("policy ID"),
            )
            .await
        {
            Ok(reply) => {
                motion.observed_at = Some(reply.observed_at);
                motion.raw_hash = reply.hash;
                match reply.body {
                    Ok(raw) if raw.len() <= 64 * 1024 => {
                        resolve_motion(&mut motion, &raw);
                        motion.raw = Some(raw);
                    }
                    Ok(_) => motion.issue = Some("Policy reply exceeds 64 KiB".into()),
                    Err(reason) => {
                        motion.retryable = true;
                        motion.issue = Some(super::bounded_reason(reason));
                    }
                }
            }
            Err(error) => {
                motion.retryable = true;
                motion.issue = Some(format!("{error:?}"));
            }
        }
        source.motion = Some(motion);
    }
    if policy_id.is_none() {
        source.motion = None;
    }
    source.digest = [0; 32];
    source.digest =
        sha256(&candid::encode_args((token, &source)).expect("policy evidence identity"));
    let response = request.finish(Ok(source));
    if let Ok(source) = &response.outcome {
        with_context(token, |_| ())?;
        CONTEXT.with_borrow_mut(|context| {
            context.as_mut().expect("validated context").policy = Some(source.clone())
        });
    }
    Ok(response)
}

fn resolve_motion(motion: &mut PolicyMotion, raw: &[u8]) {
    let parsed = (|| {
        let info = decode_candid::<Option<ProposalInfo>>(raw)
            .map_err(|_| "Policy proposal reply could not be decoded")?
            .ok_or("Policy proposal was not returned")?;
        if info.id.map(|id| id.id) != Some(motion.id) {
            return Err("Policy proposal ID did not match");
        }
        motion.status = Some(info.status);
        if !matches!(info.status, 3 | 4) {
            return Err("Policy proposal is neither adopted nor executed");
        }
        let proposal = info
            .proposal
            .ok_or("Policy proposal content is unavailable")?;
        let Some(Action::Motion { motion_text }) = proposal.action else {
            return Err("Policy proposal is not a Motion");
        };
        parse_nns_target(&motion_text, &proposal.summary)
            .ok_or("Policy interpretation not verified")
    })();
    match parsed {
        Ok(rule) => motion.rule = Some(rule),
        Err(reason) => motion.issue = Some(reason.into()),
    }
}

#[ic_cdk::update]
async fn finalize_membership_review(
    token: Hash,
) -> Result<LiveResponse<Vec<ProposalEvidence>>, String> {
    let guard = RequestGuard::acquire()?;
    let (version, prior) = with_context(token, |context| {
        (context.version, context.proposals.clone())
    })?;
    let ids = prior.iter().map(|proposal| proposal.id).collect::<Vec<_>>();
    let mut request = Request::new(guard.0);
    request.version = Some(version);
    let current = proposals(&mut request, sources().governance, &ids)
        .await
        .and_then(|rows| {
            let mut evidence = Vec::with_capacity(rows.len());
            for (before, (after, _)) in prior.iter().zip(rows) {
                check_proposal(before, &after.evidence)?;
                evidence.push(after.evidence);
            }
            Ok(evidence)
        });
    Ok(request.finish(current))
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &[u8] =
        include_bytes!("../../../../tests/source-fixture/data/143190/governance.didbin");

    fn observation(raw: &[u8]) -> PolicyMotion {
        let mut motion = PolicyMotion {
            id: 143190,
            status: None,
            observed_at: None,
            raw_hash: None,
            raw: None,
            rule: None,
            issue: None,
            retryable: false,
        };
        resolve_motion(&mut motion, raw);
        motion
    }

    #[test]
    fn recorded_motion_has_source_values_and_an_unresolved_exception() {
        let mut motion = observation(SAMPLE);
        assert_eq!(motion.status, Some(4));
        let rule = motion.rule.take().unwrap();
        assert_eq!((rule.size, rule.country_cap, rule.group_cap), (40, 3, 1));
        assert!(rule.exception.is_some());
        motion.id = 7;
        resolve_motion(&mut motion, SAMPLE);
        assert_eq!(
            motion.issue.as_deref(),
            Some("Policy proposal ID did not match")
        );
    }

    #[test]
    fn the_selected_observation_checks_lifecycle_action_and_table_content() {
        let fresh = || {
            decode_candid::<Option<ProposalInfo>>(SAMPLE)
                .unwrap()
                .unwrap()
        };
        for status in [1, 2, 3, 4, 5] {
            let mut info = fresh();
            info.status = status;
            let result = observation(&encode_one(Some(info)).unwrap());
            assert_eq!(result.rule.is_some(), matches!(status, 3 | 4));
        }
        let mut info = fresh();
        let proposal = info.proposal.as_mut().unwrap();
        proposal.summary = proposal.summary.replace("| 3 |", "| 7 | ");
        assert_eq!(
            observation(&encode_one(Some(info)).unwrap())
                .rule
                .unwrap()
                .country_cap,
            7
        );
        let mut info = fresh();
        info.proposal.as_mut().unwrap().action = None;
        assert!(observation(&encode_one(Some(info)).unwrap()).rule.is_none());
        assert!(
            observation(&encode_one(None::<ProposalInfo>).unwrap())
                .rule
                .is_none()
        );
    }
}
