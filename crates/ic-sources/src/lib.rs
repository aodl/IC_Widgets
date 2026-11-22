pub mod governance;
pub mod management;
pub mod registry;

pub const DECODER_REVISION: &str = "m0.1";
pub const MAX_RESPONSE_BYTES: usize = 2 * 1024 * 1024;

pub fn decode_candid<'a, T>(bytes: &'a [u8]) -> Result<T, String>
where
    T: candid::CandidType + serde::Deserialize<'a>,
{
    let mut config = candid::DecoderConfig::new();
    config.set_decoding_quota(25_000_000);
    config.set_skipping_quota(500_000);
    candid::decode_one_with_config(bytes, &config).map_err(|err| err.to_string())
}
