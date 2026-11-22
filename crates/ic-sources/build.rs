use std::path::Path;

fn main() {
    let root = Path::new("../../vendor/ic");
    let defs = root.join("rs/protobuf/def");
    let files = [
        root.join("rs/registry/transport/proto/ic_registry_transport/pb/v1/transport.proto"),
        defs.join("registry/subnet/v1/subnet.proto"),
        defs.join("registry/node/v1/node.proto"),
        defs.join("registry/node_operator/v1/node_operator.proto"),
        defs.join("registry/dc/v1/dc.proto"),
    ];
    println!("cargo:rerun-if-changed={}", root.display());
    prost_build::Config::new()
        .include_file("registry.rs")
        .protoc_arg("--experimental_allow_proto3_optional")
        .compile_protos(&files, &[defs, root.join("rs/registry/transport/proto")])
        .expect("compile pinned Registry protobuf schemas");
}
