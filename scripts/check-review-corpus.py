#!/usr/bin/env python3
"""Offline integrity checks for the committed replay inputs."""
from datetime import datetime
from hashlib import sha256
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "tests/source-fixture/data"


def read(file):
    path = (ROOT / file).resolve()
    assert path.is_relative_to(ROOT) and path.is_file(), file
    return path.read_bytes()


def load(file):
    return json.loads(read(file))


def digest(file):
    return sha256(read(file)).hexdigest()


def reference(ref):
    assert digest(ref["file"]) == ref["sha256"], ref


def decimal(value):
    assert isinstance(value, str) and 0 < int(value) < 2**64 and str(int(value)) == value
    return int(value)


def timestamp(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


catalogue = load("catalogue.json")
replays = load("historical/replays.json")
expected = load("historical/expected.json")
assert {catalogue["schema_version"], replays["schema_version"], expected["schema_version"]} == {1}
functions = {row["id"]: row["name"] for row in catalogue["functions"]}
assert functions == {
    1: "CreateSubnet", 2: "AddNodeToSubnet", 6: "RecoverSubnet", 13: "RemoveNodesFromSubnet",
    18: "RemoveNodes", 31: "ChangeSubnetMembership", 43: "AddApiBoundaryNodes",
    44: "RemoveApiBoundaryNodes", 46: "UpdateApiBoundaryNodesVersion", 47: "DeployGuestosToSomeApiBoundaryNodes",
    56: "SplitSubnet", 57: "DeleteSubnet", 59: "MergeSubnets",
}
proposals = {}
for row in catalogue["proposals"]:
    identifier = decimal(row["proposal_id"])
    assert identifier not in proposals
    evidence = row["evidence"]
    assert evidence["kind"] == "offchain-index-capture"
    assert evidence["sha256"] == digest(evidence["raw"])
    assert evidence["receipt_sha256"] == digest(evidence["receipt"])
    raw = load(evidence["raw"])
    receipt = load(evidence["receipt"])
    assert raw["proposal_id"] == identifier
    assert raw["action"] == "ExecuteNnsFunction"
    assert raw["status"] == row["indexed_status"]
    assert raw["action_nns_function"] == row["function_name"] == functions[row["function_id"]]
    assert isinstance(raw["payload"], dict) and raw["payload"]
    assert receipt["sha256"] == evidence["sha256"] and receipt["bytes"] == len(read(evidence["raw"]))
    assert receipt.get("http_status") in (None, 200) and receipt["url"] == evidence["source"]
    assert timestamp(receipt["retrieved_at"]) == timestamp(evidence["observation_utc"])
    assert evidence["request"] == {"method": "GET", "proposal_id": row["proposal_id"]}
    proposals[identifier] = (row, raw)

assert len(proposals) == 25
assert sum(len(read(row["evidence"]["raw"])) for row, _ in proposals.values()) == 165678
assert proposals[144954][1]["status"] == "EXECUTED"
assert proposals[48615][1]["failure_reason"] is None
assert proposals[140988][1]["failure_reason"]["error_message"]
assert proposals[130714][1]["failure_reason"]["error_message"]
assert proposals[85612][1]["executed_timestamp_seconds"] < proposals[85622][1]["executed_timestamp_seconds"]
assert proposals[140280][1]["executed_timestamp_seconds"] < proposals[140279][1]["executed_timestamp_seconds"]

cases = set()
for case in replays["replays"]:
    assert case["id"] not in cases
    assert case["name"] and case["purpose"] and case["support"] and case["tags"] and case["limits"]
    assert case["fault"] in (
        None, "slow-locations", "missing-gps", "location-reject", "open-then-executed",
        "final-governance-recheck-fails", "chunked-location", "corrupt-chunk",
    )
    clock = decimal(case["replay_clock_unix_seconds"])
    assert clock == int(timestamp(case["replay_clock_utc"]).timestamp())
    assert len(case["proposal_ids"]) == len(case["function_ids"]) == len(case["action_evidence"])
    for identifier, function, evidence in zip(case["proposal_ids"], case["function_ids"], case["action_evidence"]):
        if evidence["kind"] == "synthetic-governance-action":
            assert case["lifecycle"] == "constructed-open"
            assert identifier == evidence["proposal_id"]
            assert any(row["id"] == identifier and row["function"] == function for row in case["activity"])
            continue
        row, raw = proposals[decimal(identifier)]
        assert function == row["function_id"] and identifier == evidence["proposal_id"]
        if evidence["kind"] == "recorded-governance-reply":
            assert case["lifecycle"] == "recorded-open"
            assert identifier == "144954"
            reference(evidence["reference"])
        else:
            assert evidence["kind"] == "fixture-candid-from-indexed-payload" and evidence["encoder_revision"] == "1"
            assert evidence["indexed_record"] == row["evidence"]["raw"]
            if case["lifecycle"].startswith("indexed-"):
                assert case["lifecycle"].removeprefix("indexed-").upper() == raw["status"]
    registry = case["registry"]
    version = decimal(registry["version"])
    assert registry["coverage"] and isinstance(registry["chunks"], list)
    if registry["kind"] == "captured-with-overlay":
        assert version == 66013 and "nns_subnet_id" in registry["synthetic_overlay"]
        reference(registry["capture"])
        reference(registry["reference"])
    else:
        assert registry["kind"] == "synthetic" and decimal(registry["mutation_version"]) < version
        assert set(registry["subnets"]) <= set(registry["roster"])
        keys = registry["keys"]
        assert {"subnet_list", "data_center_record_fixture-0", "data_center_record_fixture-1"} <= set(keys["present"])
        assert set(keys["uncaptured"]) == {
            "subnet_record_" + subnet for subnet in set(registry["roster"]) - registry["subnets"].keys()
        }
        assert set(keys["absent"]) == {"nns_subnet_id"} | {
            "api_boundary_node_" + key.removeprefix("node_record_")
            for key in keys["present"] if key.startswith("node_record_")
        }
        assert sum(len(values) for values in keys.values()) == len(set().union(*keys.values()))
        for chunk in registry["chunks"]:
            assert chunk["record"] in keys["present"] and len(chunk["sha256"]) == 3
            assert all(len(bytes.fromhex(part)) == 32 for part in chunk["sha256"])
    reference(case["policy"]["reference"])
    assert case["policy"]["proposal_id"] == "143190"
    if "transition" in case:
        assert load(case["transition"]["source"])["status"] == "EXECUTED"
    cases.add(case["id"])

assert expected["cases"].keys() <= cases
assert {"nns-144954-recorded-open", "invalid-140988", "separate-add-remove", "untargeted-no-matches"} <= expected["cases"].keys()
print(f"Verified {len(proposals)} exact API replies and receipts, {len(cases)} case manifests and committed membership expectations.")
