//! Validate a saved Registry reply with the production projection adapter.
use nexus_ic_sources::{
    projection::{self, Content},
    registry,
};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = std::env::args().skip(1).collect();
    let [request, reply] = args.as_slice() else {
        return Err("usage: check_registry_page REQUEST.pb REPLY.pb".into());
    };
    use prost::Message;
    let request = registry::transport::RegistryGetChangesSinceRequest::decode(
        std::fs::read(request)?.as_slice(),
    )?;
    let bytes = std::fs::read(reply)?;
    let page = registry::decode_projection_changes(&bytes, request.version, None)?;
    let mut inline_bytes = 0;
    let mut chunked = 0;
    for mutation in &page.projected {
        match &mutation.value {
            Content::Value(value) => {
                projection::details(&mutation.key, value).map_err(|err| {
                    format!("{} at {}: {err}", mutation.key.name(), mutation.version)
                })?;
                inline_bytes += value.len();
            }
            Content::Chunks(_) => chunked += 1,
            Content::Deleted => {}
        }
    }
    println!(
        "after {} delivered {} head {} bytes {} mutations {} selected {} inline bytes {} selected chunked {}",
        request.version,
        page.span.delivered_through,
        page.span.observed_head,
        bytes.len(),
        page.raw_mutations,
        page.projected.len(),
        inline_bytes,
        chunked
    );
    Ok(())
}
