#!/usr/bin/env python3
"""Export a completed probe's receipts and verify the retained upstream bytes."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--network", required=True)
parser.add_argument("--identity", required=True)
parser.add_argument("canister")
parser.add_argument("job", type=int)
parser.add_argument("directory", type=Path)
args = parser.parse_args()
candid = Path(__file__).resolve().parents[1] / "canisters/reviewer/reviewer.did"
command = [
    "dfx", "canister", "call", "--network", args.network, "--identity", args.identity,
    "--update", "--candid", str(candid), "--output", "json", args.canister,
]


def invoke(method, argument):
    result = json.loads(subprocess.check_output(command + [method, argument], text=True))
    if "Ok" not in result:
        raise RuntimeError(f"{method}: {result.get('Err', result)}")
    return result["Ok"]


def save(name, value):
    (args.directory / name).write_text(json.dumps(value, indent=2) + "\n")


job_arg = f"({args.job} : nat64)"
status = invoke("probe_status", job_arg)
if not status["completed_at_nanos"] or status["in_flight"]:
    raise SystemExit("Wait for the probe to reach a terminal state.")
args.directory.mkdir(exist_ok=False)
save("status.json", status)
save("budget.json", invoke("probe_budget", job_arg))
for index in range(int(status["receipt_count"])):
    stem = f"{index:02}"
    receipt_arg = f"{args.job} : nat64, {index} : nat32"
    receipt = invoke("probe_receipt", f"({receipt_arg})")
    save(f"{stem}.json", receipt)
    (args.directory / f"{stem}.request").write_bytes(bytes(receipt["request"]))
    if not receipt["raw_hash"]:
        continue
    offset = 0
    raw = bytearray()
    while True:
        page = invoke("probe_reply", f"({receipt_arg}, {offset} : nat32)")
        raw.extend(page["bytes"])
        if not page["next_offset"]:
            break
        next_offset = int(page["next_offset"][0])
        if next_offset <= offset or next_offset != len(raw):
            raise RuntimeError(f"invalid reply page cursor for receipt {index}")
        offset = next_offset
    if len(raw) != int(receipt["raw_bytes"][0]) or hashlib.sha256(raw).digest() != bytes(receipt["raw_hash"][0]):
        raise RuntimeError(f"reply length or hash mismatch for receipt {index}")
    (args.directory / f"{stem}.reply").write_bytes(raw)
