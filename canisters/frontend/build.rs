use std::{env, fs, path::PathBuf, process::Command};

fn main() {
    for name in [
        "CANISTER_ID_REVIEWER",
        "DFX_NETWORK",
        "NEXUS_REPLAY_MANIFEST",
        "NEXUS_REPLAY_OUTPUT",
    ] {
        println!("cargo:rerun-if-env-changed={name}");
    }
    let web = PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").unwrap()).join("../../web");
    for input in [
        "src",
        "index.html",
        "styles.css",
        "build.mjs",
        "test-cases",
        "package.json",
        "package-lock.json",
    ] {
        println!("cargo:rerun-if-changed={}", web.join(input).display());
    }
    println!("cargo:rerun-if-changed=../../tests/source-fixture/data");
    if env::var("CARGO_CFG_TARGET_ARCH").as_deref() != Ok("wasm32") {
        return;
    }

    let output = PathBuf::from(env::var_os("OUT_DIR").unwrap()).join("frontend-assets");
    // This directory belongs exclusively to this Cargo build. The web build also refuses existing output.
    if output.exists() {
        fs::remove_dir_all(&output).expect("remove previous embedded assets");
    }
    let status = Command::new("node")
        .current_dir(web)
        .arg("build.mjs")
        .arg("--embed")
        .arg(&output)
        .status()
        .expect("run prepared Node frontend build");
    assert!(status.success(), "embedded frontend build failed");
    println!("cargo:rustc-env=NEXUS_EMBEDDED_ASSETS={}", output.display());
}
