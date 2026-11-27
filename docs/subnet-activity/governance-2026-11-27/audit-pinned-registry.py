#!/usr/bin/env python3
"""Capture or verify the version-pinned Registry records for the frozen Activity sample."""
import argparse
import base64
import concurrent.futures
import datetime
import hashlib
import json
import pathlib
import struct
import subprocess
import time
import zlib
from collections import Counter, defaultdict

ROOT = pathlib.Path("docs/subnet-activity/governance-2026-11-27")
OBS = json.loads((ROOT / "observation.json").read_text())
REGISTRY = OBS["registryCanister"]
PIN = OBS["registryPin"]

def varint(value):
    out = bytearray()
    while value > 127:
        out.append((value & 127) | 128)
        value >>= 7
    out.append(value)
    return bytes(out)

def read_varint(data, pos):
    val = 0
    for shift in range(0, 70, 7):
        b = data[pos]
        pos += 1
        val |= (b & 127) << shift
        if b < 128:
            return val, pos
    raise ValueError("invalid Protobuf varint")

def protobuf(data):
    pos = 0
    while pos < len(data):
        tag, pos = read_varint(data, pos)
        field, wire = tag >> 3, tag & 7
        if not field:
            raise ValueError("invalid Protobuf tag")
        if wire == 0:
            value, pos = read_varint(data, pos)
        else:
            if wire == 2:
                size, pos = read_varint(data, pos)
            elif wire == 5:
                size = 4
            elif wire == 1:
                size = 8
            else:
                raise ValueError(f"unsupported Protobuf wire type {wire}")
            value = data[pos:pos + size]
            if len(value) != size:
                raise ValueError("truncated Protobuf field")
            pos += size
        yield field, value

def principal(data):
    if not 0 < len(data) <= 29:
        raise ValueError("invalid principal size")
    code = base64.b32encode(zlib.crc32(data).to_bytes(4, 'big') + data).decode().lower().rstrip('=')
    return '-'.join(code[i:i+5] for i in range(0, len(code), 5))

def request_args(key):
    version = b'\x08' + varint(PIN)
    label = key.encode('utf-8')
    return b'\x0a' + varint(len(version)) + version + b'\x12' + varint(len(label)) + label

def sha(data):
    return hashlib.sha256(data).hexdigest()

def timestamp():
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z')

def archive(key, reply, at):
    outer = dict(protobuf(reply))
    row = dict(argumentHex=request_args(key).hex(), replyHex=reply.hex(), replySha256=sha(reply), retrievedAt=at)
    if 1 in outer:
        error = dict(protobuf(outer[1]))
        code = error.get(1, 0)
        explicit = code == 1 and error.get(3) == key.encode()
        return row | dict(status="absent" if explicit else "registry-error", registryErrorCode=code)
    mutation = outer.get(2, 0)
    if not 0 < mutation <= PIN or ((3 in outer) == (4 in outer)):
        raise ValueError(f"Invalid Registry value envelope for {key}")
    return row | dict(status="inline" if 3 in outer else "chunked", mutationVersion=mutation,
                      mutationTimestampNanos=str(outer.get(5, 0)))

def direct_read(key):
    request = request_args(key)
    for delay in (0, 1, 3):
        if delay:
            time.sleep(delay)
        try:
            response = subprocess.run(['dfx','canister','call','--network','ic','--identity','anonymous','--query',
                                       '--type','raw','--output','raw',REGISTRY,'get_value',request.hex()],
                                      capture_output=True,text=True,timeout=30,check=True)
            return key, archive(key,bytes.fromhex(response.stdout.strip()),timestamp())
        except (subprocess.SubprocessError, ValueError) as error:
            last = getattr(error, "stderr", None) or str(error)
    return key, dict(argumentHex=request.hex(), attemptedAt=timestamp(), status="transport-error", error=last.strip()[:300])

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--capture', action='store_true', help='make direct read-only Registry queries for missing keys')
    args = parser.parse_args()
    path = ROOT / 'pinned-registry-values.json'
    summary_path = ROOT / 'pinned-replay-coverage.json'
    if path.exists():
        output = json.loads(path.read_text())
    else:
        output = dict(registryCanister=REGISTRY, method='get_value', requestedVersion=PIN,
                      transport='Direct anonymous IC query via dfx', records={})
    assert output['requestedVersion'] == PIN and output['registryCanister'] == REGISTRY
    records = output['records']
    for case in OBS['proposals']:
        key = 'subnet_record_' + case['subnet']
        prefix = case['id']
        request = (ROOT / f'{prefix}.registry-request.pb').read_bytes()
        reply = (ROOT / f'{prefix}.registry.pb').read_bytes()
        assert request_args(key) == request
        row = archive(key,reply,case['registryRetrievedAt'])
        assert row['mutationVersion'] == case['subnetRecordMutation']
        if key in records:
            assert records[key] == row
        records[key] = row

    def acquire(keys, phase):
        pending = sorted({key for key in keys if key not in records or records[key]['status'] == 'transport-error'})
        if args.capture:
            with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
                records.update(pool.map(direct_read,pending))
            path.write_text(json.dumps(output,indent=2,sort_keys=True)+'\n')
        print(phase, len(set(keys)), 'needed', len(pending), 'additional', flush=True)

    def inline(key):
        row = records.get(key, {})
        if row.get('status') != 'inline':
            return None
        return dict(protobuf(bytes.fromhex(row['replyHex'])))[3]

    def principals(raw, field):
        return [principal(value) for number,value in protobuf(raw) if number == field] if raw is not None else []

    acquire({'subnet_list','nns_subnet_id'},'roster and role')
    subnets = principals(inline('subnet_list'),2)
    assert len(subnets) == len(set(subnets)) and set(case['subnet'] for case in OBS['proposals']) <= set(subnets)
    nns = inline('nns_subnet_id')
    role = principal(dict(protobuf(dict(protobuf(nns))[1]))[1]) if nns is not None else None
    assert role is None or role in subnets
    acquire({'subnet_record_'+subnet for subnet in subnets},'subnet rosters')
    roster = {subnet: principals(inline('subnet_record_'+subnet),3) for subnet in subnets}
    assert all(len(members) == len(set(members)) for members in roster.values())
    owners = defaultdict(list)
    for subnet,members in roster.items():
        for node in members:
            owners[node].append(subnet)
    candidates = {node for case in OBS['proposals'] for node in case['add']+case['remove']}
    represented = {node for case in OBS['proposals'] for node in roster[case['subnet']]+case['add']+case['remove']}
    acquire({'node_record_'+id for id in represented} | {'api_boundary_node_'+id for id in candidates},'nodes and boundary assignments')
    operators = {id: (principals(inline('node_record_'+id),15) or [None])[0] for id in represented}
    acquire({'node_operator_record_'+id for id in operators.values() if id},'operators')
    op_data = {}
    for op in {op for op in operators.values() if op}:
        raw = inline('node_operator_record_'+op)
        if raw is None:
            continue
        row = dict(protobuf(raw))
        assert not row.get(1) or principal(row[1]) == op, 'operator record key mismatch'
        op_data[op] = (row.get(4,b'').decode().lower(),principal(row[3]) if row.get(3) else None)
    acquire({'data_center_record_'+dc for dc,_ in op_data.values() if dc},'data centres')
    for key,row in records.items():
        assert bytes.fromhex(row['argumentHex']) == request_args(key)
        if 'replyHex' in row:
            assert archive(key,bytes.fromhex(row['replyHex']),row['retrievedAt']) == row

    def status(key):
        return records.get(key,{}).get('status','uncaptured')

    all_subnets = all(status('subnet_record_'+subnet) == 'inline' and roster[subnet] for subnet in subnets)
    multiple_assignments = sorted(node for node, ids in owners.items() if len(ids) > 1)
    cases = []
    for case in OBS['proposals']:
        base = set(roster[case['subnet']])
        add = set(case['add'])
        remove = set(case['remove'])
        comparison = base | add | remove
        nodes = sorted(comparison)
        assert len(base) == case['pinnedMembers'] and remove <= base
        keys = {'subnet_list','nns_subnet_id','subnet_record_'+case['subnet']}
        keys |= {'node_record_'+node for node in comparison}
        keys |= {'api_boundary_node_'+node for node in add|remove}
        unresolved, metadata_gaps = [], []
        for node in nodes:
            op = operators.get(node)
            if op:
                keys.add('node_operator_record_'+op)
            dc, provider = op_data.get(op,(None,None))
            if dc:
                keys.add('data_center_record_'+dc)
            raw = inline('data_center_record_'+dc) if dc else None
            if raw is not None:
                fields = dict(protobuf(raw))
                assert fields.get(1,b'').decode().lower() == dc, 'data center record key mismatch'
                coords = dict(protobuf(fields[4])) if 4 in fields else None
                lat = struct.unpack('<f',coords.get(1,b'\0'*4))[0] if coords is not None else None
                lon = struct.unpack('<f',coords.get(2,b'\0'*4))[0] if coords is not None else None
                if not fields.get(2) or not fields.get(3) or lat is None or not (-90 <= lat <= 90 and -180 <= lon <= 180):
                    metadata_gaps.append(node)
            if not (op and provider and dc and raw is not None):
                metadata_gaps.append(node)
        for key in sorted(keys):
            expected = {'inline','absent'} if key.startswith('api_boundary_node_') else {'inline'}
            if status(key) not in expected:
                unresolved.append(dict(key=key,status=status(key)))
        assignments = [dict(node=node,subnets=owners[node],apiBoundary=status('api_boundary_node_'+node)) for node in sorted(add)]
        cases.append(dict(proposal=case['id'], subnet=case['subnet'],before=len(base),
                          proposed=len((base|add)-remove), represented=len(comparison),
                          effectiveIncoming=len(add-base),effectiveOutgoing=len(remove & base),
                          incomingAssignments=assignments, requiredKeyCount=len(keys),
                          missingOrUnavailable=unresolved, incompleteMetadataNodes=sorted(set(metadata_gaps)),
                          sufficientPinnedRegistry=not unresolved and not metadata_gaps and
                          all_subnets and not multiple_assignments and role is not None))
    summary = dict(registryPin=PIN, nnsSubnet=role, rosterSubnets=len(subnets),
                   subnetRostersResolved=sum(bool(roster[subnet]) for subnet in subnets),
                   duplicateRosterAssignments=multiple_assignments, queriedKeys=len(records),
                   recordStatuses=dict(Counter(row['status'] for row in records.values())),
                   capturedGovernance={'proposalReplies':len(cases),'discoveryPages':OBS['discoveryPages'],
                                       'discoveryComplete':OBS['discoveryComplete']},
                   proposals=cases)
    if args.capture:
        summary_path.write_text(json.dumps(summary,indent=2,sort_keys=True)+'\n')
    elif summary_path.exists():
        assert summary == json.loads(summary_path.read_text())
    print(json.dumps(summary,indent=2,sort_keys=True),flush=True)

if __name__ == '__main__':
    main()
