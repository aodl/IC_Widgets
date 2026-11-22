use candid::{CandidType, Principal, decode_one};
use pocket_ic::PocketIc;
use serde::de::DeserializeOwned;
use std::{
    fs,
    path::{Path, PathBuf},
    time::Duration,
};

pub fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

pub fn enabled() -> bool {
    std::env::var_os("NEXUS_M0_TEST").is_some()
}

pub fn wasm(path: &str) -> Vec<u8> {
    fs::read(root().join(path)).unwrap_or_else(|err| panic!("{path}: {err}"))
}

pub fn call<T: CandidType + DeserializeOwned>(
    pic: &PocketIc,
    canister: Principal,
    method: &str,
    args: Vec<u8>,
) -> T {
    let reply = pic
        .update_call(canister, Principal::anonymous(), method, args)
        .unwrap_or_else(|err| panic!("{method}: {err:?}"));
    decode_one(&reply).unwrap()
}

pub fn advance(pic: &PocketIc) {
    pic.advance_time(Duration::from_secs(2));
    for _ in 0..4 {
        pic.tick();
    }
}
