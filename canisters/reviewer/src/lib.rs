mod budget;
mod diagnostics;
mod model;
mod probe;
mod store;

pub use budget::{Limits, Stop, Usage};
pub use diagnostics::{ProbeBudget, ReplyPage, Status};
pub use model::{Observation, ProbeRequest, Receipt, Sources};

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
}

fn require_controller() -> Result<(), String> {
    if ic_cdk::api::is_controller(&ic_cdk::api::msg_caller()) {
        Ok(())
    } else {
        Err("controller required".into())
    }
}

ic_cdk::export_candid!();
