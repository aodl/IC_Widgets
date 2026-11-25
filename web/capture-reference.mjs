// Read-only capture of the Registry evidence for the historical proposal 144954 fixture.
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { HttpAgent } from '@icp-sdk/core/agent';
import { IDL } from '@icp-sdk/core/candid';
import { Principal } from '@icp-sdk/core/principal';

const output = process.argv[2];
if (!output) throw new Error('Provide an output directory');
const version = 66013;
const subnet = 'tdb26-jop6k-aogll-7ltgs-eruif-6kk7m-qpktf-gdiqx-mxtrf-vb5e6-eqe';
const addition = 'kaoz3-4okcl-24amq-v5y4k-vim56-4njvo-fwvyk-v4grq-kuqum-7zm3p-4qe';
const source = Principal.fromText('rwlgt-iiaaa-aaaaa-aaaaa-cai');
const governance = Principal.fromText('rrkah-fqaaa-aaaaa-aaaaq-cai');
const agent = await HttpAgent.create({ host: 'https://icp-api.io' });
const records = {};
const started = Date.now();

function varint(value) {
  value = BigInt(value);
  const result = [];
  while (value >= 128n) {
    result.push(Number(value % 128n) + 128);
    value >>= 7n;
  }
  return [...result, Number(value)];
}
const field = (number, bytes) => [number * 8 + 2, ...varint(bytes.length), ...bytes];

// Traverse only the pinned fields needed to discover dependent Registry keys.
// The fixture replay uses the regular Rust decoder to interpret the exact replies.
function fields(bytes, target) {
  let position = 0;
  const next = () => {
    let result = 0n;
    for (let shift = 0n; position < bytes.length && shift < 70n; shift += 7n) {
      const byte = bytes[position++];
      result |= BigInt(byte & 127) << shift;
      if (byte < 128) return result;
    }
    throw new Error('Invalid protobuf varint');
  };
  const matches = [];
  while (position < bytes.length) {
    const key = Number(next());
    const wire = key % 8;
    let value;
    if (wire === 0) value = next();
    else {
      const length = wire === 2 ? Number(next()) : ({1: 8, 5: 4})[wire];
      if (length === undefined || position + length > bytes.length) throw new Error('Invalid protobuf field');
      value = bytes.subarray(position, position += length);
    }
    if (Math.floor(key / 8) === target) matches.push(value);
  }
  return matches;
}
const text = bytes => Buffer.from(bytes ?? []).toString('utf8');
const pid = bytes => Principal.fromUint8Array(bytes).toText();

async function read(key) {
  const request = Uint8Array.from([...field(1, [8, ...varint(version)]), ...field(2, Buffer.from(key))]);
  const response = await agent.query(source, { methodName: 'get_value', arg: request });
  if (response.status !== 'replied') throw new Error(key + ': ' + response.reject_message);
  const bytes = Buffer.from(response.reply.arg);
  records[key] = {
    at: new Date().toISOString(),
    sha256: createHash('sha256').update(bytes).digest('hex'),
    reply_hex: bytes.toString('hex'),
  };
  const [error] = fields(bytes, 1);
  if (error) {
    if (fields(error, 1)[0] === 1n && text(fields(error, 3)[0]) === key) return null;
    throw new Error(key + ': ' + text(fields(error, 2)[0]));
  }
  const [mutation] = fields(bytes, 2);
  const [inline] = fields(bytes, 3);
  if (!inline || !mutation || mutation > BigInt(version)) throw new Error('Unexpected value for ' + key);
  return inline;
}

async function batch(keys) {
  const values = [];
  for (let index = 0; index < keys.length; index += 8) {
    values.push(...await Promise.all(keys.slice(index, index + 8).map(read)));
  }
  return values;
}

const [roster, baseline] = await batch(['subnet_list', 'subnet_record_' + subnet]);
const nodes = [...new Set([...fields(baseline, 3).map(pid), addition])];
const [, ...registrations] = await batch([
  'api_boundary_node_' + addition, ...nodes.map(id => 'node_record_' + id),
]);
const removed = 'tg4ec-b2g4p-h42kd-k7zvb-6rls2-i2q7l-gtr4h-ymr6v-rrez4-w6fao-oqe';
await read('api_boundary_node_' + removed);
const operators = [...new Set(registrations.filter(Boolean).flatMap(row => fields(row, 15).map(pid)))];
const operatorRecords = await batch(operators.map(id => 'node_operator_record_' + id));
const centers = [...new Set(operatorRecords.filter(Boolean).flatMap(row =>
  fields(row, 4).map(dc => text(dc).toLowerCase()).filter(Boolean)))];
await batch(centers.map(id => 'data_center_record_' + id));
const elapsed = Date.now() - started;
const governanceStarted = new Date();
const proposal = await agent.query(governance, {
  methodName: 'get_proposal_info', arg: IDL.encode([IDL.Nat64], [144954n]),
});
if (proposal.status !== 'replied') throw new Error(proposal.reject_message);
const governanceAt = new Date();
const governanceBytes = Buffer.from(proposal.reply.arg);
const executable = IDL.Record({ nns_function: IDL.Int32, payload: IDL.Vec(IDL.Nat8) });
const governanceInfo = IDL.Record({
  id: IDL.Opt(IDL.Record({ id: IDL.Nat64 })),
  status: IDL.Int32,
  proposal: IDL.Opt(IDL.Record({ action: IDL.Opt(IDL.Variant({ ExecuteNnsFunction: executable })) })),
});
const [[info]] = IDL.decode([IDL.Opt(governanceInfo)], governanceBytes);
const action = info?.proposal[0]?.action[0]?.ExecuteNnsFunction;
const payloadHash = 'f2875737ce603f9f03b65366f23abd880fdba50e42e7f685ee2dbfb3815db37b';
if (info?.id[0]?.id !== 144954n || action?.nns_function !== 31
    || createHash('sha256').update(action.payload).digest('hex') !== payloadHash) throw new Error('Unexpected Governance payload');
const registryBytes = IDL.encode([IDL.Nat64, IDL.Vec(IDL.Tuple(IDL.Text, IDL.Vec(IDL.Nat8)))], [
  BigInt(version), Object.entries(records).sort(([a], [b]) => a.localeCompare(b)).map(([key, row]) =>
    [key, Buffer.from(row.reply_hex, 'hex')]),
]);
await mkdir(output, { recursive: true });
await Promise.all([
  writeFile(output + '/registry.didbin', new Uint8Array(registryBytes)),
  writeFile(output + '/governance.didbin', governanceBytes),
  writeFile(output + '/capture.json', JSON.stringify({
    version, subnet, source: source.toText(), elapsed_ms: elapsed, roster_count: fields(roster, 2).length,
    records: Object.fromEntries(Object.entries(records).map(([key, { at, sha256 }]) => [key, { at, sha256 }])),
    governance: { source: governance.toText(), requested_at: governanceStarted, at: governanceAt,
      status: info.status, id: 144954, function: action.nns_function },
  }, null, 2) + '\n'),
]);
console.log(`Captured ${Object.keys(records).length} Registry replies at version ${version}`);
