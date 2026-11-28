import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { capturedInputs } from './source-inputs.mjs';

const root = new URL('../../tests/source-fixture/data/', import.meta.url);
const json = async file => JSON.parse(await readFile(new URL(file, root), 'utf8'));
const words = value => value?.replace(/^TOPIC_/, '').toLowerCase().replaceAll('_', ' ')
  .replace(/^./, letter => letter.toUpperCase());
const actionName = value => value?.replace(/([a-z])([A-Z])/g, '$1 $2');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

export async function testCatalogue() {
  const { replays } = await json('historical/replays.json');
  const { proposals, functions } = await json('catalogue.json');
  const indexed = new Map(await Promise.all(proposals.map(async proposal =>
    [proposal.proposal_id, { ...proposal, raw: await json(proposal.evidence.raw) }])));
  const capture = JSON.parse(await readFile(new URL('./captures.json', import.meta.url), 'utf8'));
  if (capture.version !== 1) throw new Error('Unsupported test replay capture version.');
  for (const [name, digest] of Object.entries(await capturedInputs())) {
    if (capture.inputs?.[name] !== digest) throw new Error('Test reply capture does not match ' + name + '.');
  }
  const assets = {};
  const cases = [];
  for (const row of replays) {
    const source = row.proposal_ids.map(id => indexed.get(id)).filter(Boolean);
    const topics = [...new Set(source.map(item => words(item.raw.topic)).filter(Boolean))];
    if (!topics.length && (row.activity?.length || row.registry.kind === 'activity-archive')) topics.push('Subnet management');
    const actions = row.function_ids.map(id => actionName(functions.find(item => item.id === id)?.name) ?? 'Function ' + id);
    const actionEvidence = row.action_evidence.map(action => {
      const entry = indexed.get(action.proposal_id);
      return { id: action.proposal_id, kind: action.kind,
        at: action.observation_utc ?? entry?.evidence.observation_utc ?? null };
    });
    const registry = row.registry;
    const times = registry.capture ? Object.values((await json(registry.capture.file)).records).map(record => record.at).sort() : [];
    const bundled = capture.cases[row.id];
    if (!!bundled !== row.menu) throw new Error('Capture membership differs from fixture catalogue for ' + row.id);
    let asset;
    if (bundled) {
      const bytes = JSON.stringify(bundled);
      asset = 'replay.' + hash(bytes) + '.json';
      assets[asset] = bytes;
    }
    const kind = registry.kind === 'synthetic'
      ? (row.activity?.length ? 'Synthetic evidence' : 'Recorded action with synthetic evidence')
      : registry.synthetic_overlay || row.fault ? 'Recorded evidence with synthetic supplements' : 'Recorded evidence';
    const [basis, status] = row.lifecycle.split('-', 2);
    const lifecycleLabel = (basis === 'constructed' ? 'Constructed ' : 'Recorded ') + words(status) + ' proposal';
    cases.push({ id: row.id, name: row.name, proposalIds: row.proposal_ids, topic: topics.join(' / ') || 'Topic not recorded',
      actions, activity: !!row.activity?.length, purpose: row.purpose, provenance: row.provenance, kind, fault: row.fault, support: row.support,
      limits: row.limits, lifecycleLabel, registryVersion: registry.version ?? null, roleSupplement: registry.synthetic_overlay,
      registryFrom: registry.from_utc ?? times[0], registryTo: registry.to_utc ?? times.at(-1), actionEvidence, failureReason: row.indexed_failure_reason,
      supportLabel: bundled ? 'Interactive review' : row.support === 'production-unsupported' ? 'Classification only' : 'Automated fixture',
      asset, bundled: true });
  }
  const replayed = new Set(replays.flatMap(row => row.proposal_ids));
  for (const [id, row] of indexed) {
    if (!replayed.has(id)) cases.push({ id: 'classification-' + id, name: row.title, proposalIds: [id],
      topic: words(row.raw.topic) || 'Topic not recorded', actions: [actionName(row.function_name)],
      lifecycleLabel: 'Indexed ' + words(row.indexed_status), kind: 'Recorded indexed evidence',
      purpose: row.purpose.join(' '), limits: row.limits.join(' '), supportLabel: 'Classification or automated coverage',
      actionEvidence: [{ id, kind: row.evidence.kind, at: row.evidence.observation_utc }], bundled: true });
  }
  if (new Set(cases.map(row => row.id)).size !== cases.length || cases.some(row => !/^[a-z0-9-]+$/.test(row.id))) {
    throw new Error('Invalid or duplicate test case route.');
  }
  return { cases, assets };
}
