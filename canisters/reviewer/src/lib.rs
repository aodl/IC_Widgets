mod budget;
mod diagnostics;
mod evidence;
mod governance_archive;
mod ingestion;
mod metrics_archive;
mod model;
mod probe;
mod registry_sync;
mod store;

use candid::Principal;
use nexus_domain::{Hash, MembershipAction};
pub use nexus_ic_sources::projection::RecordKey;

pub use budget::{Limits, Stop, Usage};
pub use diagnostics::{ProbeBudget, ReplyPage, Status};
pub use evidence::{EvidenceManifest, SourceObservation, SourceStatus};
pub use governance_archive::{
    ActionStatus, CapturePage, DiscoveryStatus, ProposalCapture, ProposalStatus,
};
pub use ingestion::{COLLECTION_LIMITS, CollectionStatus, Work};
pub use metrics_archive::{
    CollectionGap, HistoryKind, MetricConflict, MetricConflictPage, MetricPage, MetricRows,
    MetricSample, MetricsRosterStatus, SubnetCollection, SuccessfulHistory,
};
pub use model::{Observation, ProbeRequest, Receipt, Sources};
pub use registry_sync::{
    Assignment, KeyPage, ProviderPage, RecordAt, RecordEvidence, RegistryBlock, RegistryLimit,
    RegistryLimits, RegistryRecovery, RegistryStatus,
};

#[ic_cdk::init]
fn init(local_sources: Option<Sources>) {
    if let Some(sources) = local_sources {
        if !cfg!(feature = "local-fixtures") {
            ic_cdk::trap("source overrides require a fixture build");
        }
        let mut config = store::config();
        config.sources = sources;
        store::put_config(config);
    }
}

#[ic_cdk::post_upgrade]
fn post_upgrade() {
    diagnostics::restore();
    ingestion::restore();
}

fn require_controller() -> Result<(), String> {
    if ic_cdk::api::is_controller(&ic_cdk::api::msg_caller()) {
        Ok(())
    } else {
        Err("controller required".into())
    }
}

ic_cdk::export_candid!();
