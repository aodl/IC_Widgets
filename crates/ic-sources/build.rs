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
        defs.join("registry/api_boundary_node/v1/api_boundary_node.proto"),
        defs.join("registry/unassigned_nodes_config/v1/unassigned_nodes_config.proto"),
        defs.join("registry/replica_version/v1/replica_version.proto"),
        defs.join(
            "registry/standard_engine_replica_version/v1/standard_engine_replica_version.proto",
        ),
    ];
    println!("cargo:rerun-if-changed={}", root.display());
    prost_build::Config::new()
        .include_file("registry.rs")
        .disable_comments(["."])
        .protoc_arg("--experimental_allow_proto3_optional")
        .compile_protos(&files, &[defs, root.join("rs/registry/transport/proto")])
        .expect("compile pinned Registry protobuf schemas");
}
