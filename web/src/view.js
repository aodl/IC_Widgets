export function el(tag, ...children) {
  const item = document.createElement(tag);
  for (const child of children.flat()) {
    if (child !== null && child !== undefined) item.append(child instanceof Node ? child : String(child));
  }
  return item;
}

export function styled(tag, className, ...children) {
  const item = el(tag, ...children);
  item.className = className;
  return item;
}

export const branch = value => Object.keys(value)[0];
export const option = value => value[0];
export const hex = bytes => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
export const principal = id => id.toText();
export const proposalIds = ids => Array.from(ids, id => `#${id}`).join(' + ');
export const number = value => value.toLocaleString('en-US');
export const time = nanos => new Date(Number(nanos / 1_000_000n)).toISOString().replace('T', ' ').replace('.000Z', ' UTC');
export const words = value => value.replace(/([a-z0-9])([A-Z])/g, '$1 $2');

const scenarioLabels = { A: 'A independently', B: 'B independently', AThenB: 'A then B', BThenA: 'B then A' };
const functions = { 2: 'Add nodes to subnet', 13: 'Remove nodes from subnets', 31: 'Change subnet membership' };
const lifecycle = { 1: 'Open', 2: 'Rejected', 3: 'Adopted', 4: 'Executed', 5: 'Failed' };
const outcomes = { Applied: 'Simulated', Rejected: 'Rejected in simulation', Skipped: 'Skipped' };
const findingLabels = {
  ExecutedProposalHypothesis: 'Executed proposal evaluated as a hypothesis at the selected baseline.',
  HistoricalBaselineUnavailable: 'Historical baseline unavailable. This execution was not reconstructed.',
  UnaffectedRemovalCandidate: 'Removal candidate had no membership in the listed subnets in this step.',
  DifferentIntermediateStates: 'The two orders give different intermediate memberships.',
  MissingRegistryMetadata: 'Registry metadata is missing or unavailable.',
  UnknownDimension: 'Registered dimension unavailable',
  ConcentrationIncreased: 'Concentration increased',
};

export function scenarioLabel(id) {
  return scenarioLabels[branch(id)];
}

function details(label, ...content) {
  return el('details', el('summary', label), ...content);
}

function principalList(label, values, open = false) {
  const list = details(`${label} (${number(values.length)})`, values.length
    ? styled('ul', 'principals', values.map(id => el('li', el('code', principal(id)))))
    : el('p', 'None'));
  list.open = open;
  return list;
}

export function table(headers, rows) {
  return styled('div', 'table-wrap',
    el('table', el('thead', el('tr', headers.map(label => {
      const heading = el('th', label);
      heading.scope = 'col';
      return heading;
    }))),
      el('tbody', rows.map(row => el('tr', row.map(cell => el('td', cell)))))));
}

function findingsList(findings) {
  if (!findings.length) return el('p', 'No findings in this scenario.');
  const rows = findings.map(finding => {
    const code = branch(finding.code);
    const detail = finding.code[code];
    const description = findingLabels[code] ?? words(code);
    return el('li', el('strong', `${branch(finding.severity)} · `), description,
      detail && typeof detail === 'object' ? ` · ${words(branch(detail))}` : '',
      option(finding.proposal) !== undefined ? ` · proposal #${option(finding.proposal)}` : '',
      finding.nodes.length ? el('div', el('code', finding.nodes.map(principal).join(', '))) : null,
      finding.subnets.length ? styled('div', 'muted', 'Subnets ', el('code', finding.subnets.map(principal).join(', '))) : null);
  });
  return styled('ul', 'findings', rows);
}

export function reviewHeader(review, live) {
  const { manifest } = review;
  const ids = proposalIds(manifest.proposals.map(row => row.id));
  const hypothetical = option(review.hypothetical_executed);
  const executed = manifest.proposals.some(row => row.lifecycle_status === 4 || row.executed_at_seconds.length);
  const total = option(live.total_listed_subnets ?? []);
  const scoped = total !== undefined && live.listed_subnets < total;
  return styled('section', 'card',
    el('h2', `Proposal ${ids}`),
    option(live.proposal_text ?? [])?.map(row => {
      const title = option(row.title);
      if (!title) return null;
      const link = el('a', title);
      link.href = 'https://dashboard.internetcomputer.org/proposal/' + row.id;
      return el('p', link);
    }) ?? null,
    el('p', 'Registry baseline ', el('strong', number(manifest.registry_version))),
    manifest.proposals.every(row => [1, 3].includes(row.lifecycle_status))
      ? el('p', scoped ? 'Scoped membership preview' : 'Prospective membership preview') : null,
    executed && hypothetical ? styled('p', 'notice warning',
      'Hypothetical evaluation of an executed proposal. The selected Registry version is the simulation baseline. Actual historical execution remains unverified.') : null,
    executed && !hypothetical ? styled('p', 'notice warning',
      'Historical execution remains unavailable for this report.') : null,
    table(['Proposal', 'Action', 'Observed status', 'Observed at'], manifest.proposals.map(row => [
      `#${row.id}`, functions[row.function] ?? `Function ${row.function}`, lifecycle[row.lifecycle_status] ?? `Status ${row.lifecycle_status}`,
      time(row.observed_at_nanos),
    ])),
    styled('p', 'notice', total === undefined
      ? `Assignment checks cover ${number(live.listed_subnets)} listed subnets and the candidates’ Registry API boundary records.`
      : `Checked ${number(live.listed_subnets)} of ${number(total)} listed subnet memberships. Node, hardware and API boundary checks cover the proposal candidates. Assignments outside the checked subnets remain unverified. The result shows hypothetical membership changes. Full proposal validity remains unverified.`),
    live.assignments.length ? details('Candidate assignments at the baseline', table(
      ['Node', 'Assignment evidence'], live.assignments.map(([node, assignment]) => [
        el('code', principal(node)),
        assignment.ListedSubnet ? el('code', principal(assignment.ListedSubnet)) : ({
          ApiBoundary: 'API boundary node',
          UnknownOutsideListedSubnets: 'No assignment found in the checked Registry records',
          NodeAbsent: 'Node record absent at this version',
        })[branch(assignment)],
      ]),
    )) : null,
    details('Review evidence',
      el('p', 'Revision ', el('code', hex(review.revision))),
      el('p', `Analysis v${manifest.analysis_version} · Policy v${manifest.policy.version}`),
      manifest.proposals.map(row => el('p',
        `#${row.id} · observation ${row.observation} · ${time(row.observed_at_nanos)}`,
        el('br'), 'Payload SHA-256 ', el('code', hex(row.payload_hash)),
        el('br'), 'Source reply SHA-256 ', el('code', hex(row.raw_hash)))),
      el('p', `${number(manifest.registry.length)} Registry record references, including ${number(manifest.registry.filter(([, row]) => !('Present' in row)).length)} missing, deleted or unavailable records.`),
      details('Registry references', table(['Record', 'Evidence at baseline'], manifest.registry.map(([key, row]) => {
        const name = branch(key);
        const keyValue = key[name];
        const status = branch(row);
        const evidence = row[status];
        const stamp = status === 'Unavailable' ? option(evidence.stamp) : evidence;
        return [
          el('span', words(name), ' ', keyValue === null ? '' : el('code', keyValue.toText?.() ?? keyValue)),
          el('span', words(status), stamp?.page_observation !== undefined
            ? ` · mutation ${stamp.mutation_version} · observation ${stamp.page_observation}` : ''),
        ];
      })))));
}

export function renderScenario(review, scenario, subnet, stateIndex, container) {
  const view = scenario.subnets.find(([id]) => principal(id) === subnet)?.[1];
  const states = view ? [view.baseline, ...view.after_steps.map(option)] : [];
  const selected = states[stateIndex];
  const counts = view ? styled('div', 'grid', [
    ['Baseline members', view.baseline.member_count],
    ['Net added', selected?.added.length],
    ['Net removed', selected?.removed.length],
    ['Selected state members', selected?.member_count],
  ].map(([label, count]) => styled('div', 'stat', el('strong', count === undefined ? 'Unavailable' : number(count)), el('span', label)))) : null;

  const timeline = el('ol', scenario.steps.map((step, index) => {
    const outcome = branch(step.outcome);
    const state = states[index + 1];
    const operation = branch(step.requested);
    const requested = step.requested[operation];
    const additions = requested.add ?? (operation === 'Add' ? requested.nodes : []);
    const removals = requested.remove ?? (operation === 'Remove' ? requested.nodes : []);
    return el('li', el('strong', `#${step.proposal} · ${outcomes[outcome]}`),
      state ? ` · ${number(state.member_count)} members after step` : '',
      requested.subnet ? el('p', 'Target subnet ', el('code', principal(requested.subnet))) : null,
      principalList('Requested additions', additions, additions.length === 1),
      principalList('Requested removals', removals, removals.length === 1),
      step.findings.length ? findingsList(step.findings) : null);
  }));
  timeline.className = 'steps';
  const findings = [...review.findings, ...scenario.findings];
  const notes = findings.length ? details(`Scenario findings (${number(findings.length)})`, findingsList(findings)) : null;

  container.replaceChildren(...[
    el('h3', scenarioLabel(scenario.id)),
    counts,
    timeline,
    notes,
    view ? principalList('Baseline membership', view.baseline.members) : el('p', 'This scenario has no resolved subnet scope.'),
    selected && stateIndex > 0 ? principalList('Added members', selected.added) : null,
    selected && stateIndex > 0 ? principalList('Removed members', selected.removed) : null,
    selected && stateIndex > 0 ? principalList('Selected membership', selected.members) : null,
    view && !selected ? styled('p', 'notice warning', 'Membership after that step is unavailable.') : null,
  ].filter(Boolean));
}

export function sourceReceipts(result) {
  const version = option(result.registry_version);
  return details('Source receipts',
    version === undefined ? null : el('p', `Pinned Registry version ${number(version)}`),
    el('p', `${number(result.usage.calls)} source calls · ${number(result.usage.source_bytes)} reply bytes`),
    el('p', `${number((result.usage.finished_at - result.usage.started_at) / 1_000_000n)} ms source stage · ${number(result.usage.instructions)} instructions · ${number(result.usage.peak_batch_reservation)} cycles peak batch reservation`),
    table(['Observation', 'Source read', 'Observed at', 'Reply'], result.receipts.map(row => [
      row.id, el('span', row.method, ' ', el('code', row.item), el('br'), el('code', principal(row.source))),
      time(row.observed_at),
      option(row.reply_hash) ? el('code', hex(option(row.reply_hash))) : option(row.reject) ?? 'Unavailable',
    ])));
}

export function renderPerformance(history, filter, section) {
  if (!history.samples.length) {
    section.replaceChildren(el('p', 'No blockmaking samples are available for this period.'));
    return;
  }
  const select = el('select', history.samples.map((sample, index) => {
    const item = el('option', time(sample.timestamp_nanos));
    item.value = String(index);
    return item;
  }));
  select.value = String(history.samples.length - 1);
  const output = el('div');
  function draw() {
    const sample = history.samples[Number(select.value)];
    const observed = new Map(sample.node_metrics.map(row => [principal(row.node_id), row]));
    const nodes = filter ?? sample.node_metrics.map(row => row.node_id);
    output.replaceChildren(
      el('p', filter ? `${observed.size} of ${nodes.length} selected nodes have counter rows in this sample.`
        : `${observed.size} counter rows in this sample. Unchanged rows can be omitted.`),
      nodes.length ? table(['Node', 'Proposed blocks, cumulative', 'Blockmaking failures, cumulative'], nodes.map(id => {
        const row = observed.get(principal(id));
        return [el('code', principal(id)), row ? number(row.num_blocks_proposed_total) : 'No row in sample',
          row ? number(row.num_block_failures_total) : 'No row in sample'];
      })) : null,
    );
  }
  select.addEventListener('change', draw);
  section.replaceChildren(el('label', 'Sample time', select), output);
  draw();
}
