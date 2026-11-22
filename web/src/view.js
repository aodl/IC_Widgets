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
export const number = value => value.toLocaleString('en-US');
export const time = nanos => new Date(Number(nanos / 1_000_000n)).toISOString().replace('T', ' ').replace('.000Z', ' UTC');
export const words = value => value.replace(/([a-z0-9])([A-Z])/g, '$1 $2');

const scenarioLabels = { A: 'A independently', B: 'B independently', AThenB: 'A then B', BThenA: 'B then A' };
const functions = { 2: 'Add nodes to subnet', 13: 'Remove nodes from subnets', 31: 'Change subnet membership' };
const lifecycle = { 1: 'Open', 2: 'Rejected', 3: 'Adopted', 4: 'Executed', 5: 'Failed' };
const findingLabels = {
  ExecutedProposalHypothesis: 'Executed proposal evaluated as a hypothesis at the selected baseline.',
  HistoricalBaselineUnavailable: 'Historical baseline unavailable. This execution was not reconstructed.',
  UnaffectedRemovalCandidate: 'Removal candidate had no subnet membership in this step.',
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

function principalList(label, values) {
  return details(`${label} (${number(values.length)})`, values.length
    ? styled('ul', 'principals', values.map(id => el('li', el('code', principal(id)))))
    : el('p', 'None'));
}

function table(headers, rows) {
  return styled('div', 'table-wrap',
    el('table', el('thead', el('tr', headers.map(label => el('th', label)))),
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

export function reviewHeader(review) {
  const { manifest } = review;
  const ids = manifest.proposals.map(row => `#${row.id}`).join(' + ');
  const hypothetical = option(review.hypothetical_executed);
  const executed = manifest.proposals.some(row => row.lifecycle_status === 4 || row.executed_at_seconds.length);
  return styled('section', 'card',
    el('h2', `Proposal ${ids}`),
    el('p', 'Registry baseline ', el('strong', number(manifest.registry_version))),
    executed && hypothetical ? styled('p', 'notice warning',
      'Hypothetical evaluation of an executed proposal. The selected Registry version is the simulation baseline. Actual historical execution remains unverified.') : null,
    executed && !hypothetical ? styled('p', 'notice warning',
      'Historical execution remains unavailable for this report.') : null,
    table(['Proposal', 'Action', 'Archived status'], manifest.proposals.map(row => [
      `#${row.id}`, functions[row.function] ?? `Function ${row.function}`, lifecycle[row.lifecycle_status] ?? `Status ${row.lifecycle_status}`,
    ])),
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
            ? ` · mutation ${stamp.mutation_version} · page observation ${stamp.page_observation}` : ''),
        ];
      })))));
}

function distributionPanel(state) {
  const dimensions = { Operator: 'Node operator', Provider: 'Node provider', DataCenter: 'Data center', RegisteredOwner: 'Registered data-center owner', RegisteredCountry: 'Registered country', RegisteredContinent: 'Registered continent' };
  return styled('div', 'grid', state.distributions.map(([kind, row]) => {
    const title = dimensions[branch(kind)];
    return styled('div', 'stat', el('h4', title),
      el('p', `${number(row.groups.length)} groups · ${number(row.unknown)} unknown`),
      row.groups.length ? details('Group counts',
        table([title, 'Nodes'], row.groups.map(([group, count]) => [
          'Principal' in group ? el('code', principal(group.Principal)) : group.RegisteredLabel,
          number(count),
        ]))) : null);
  }));
}

export function renderScenario(review, scenario, subnet, stateIndex, container) {
  const view = scenario.subnets.find(([id]) => principal(id) === subnet)?.[1];
  const states = view ? [view.baseline, ...view.after_steps.map(option)] : [];
  const selected = states[stateIndex];
  const final = scenario.completed ? states.at(-1) : undefined;
  const counts = view ? styled('div', 'grid', [
    ['Baseline members', view.baseline.member_count],
    ['Net added', final?.added.length],
    ['Net removed', final?.removed.length],
    ['Final members', final?.member_count],
  ].map(([label, count]) => styled('div', 'stat', el('strong', count === undefined ? 'Unavailable' : number(count)), el('span', label)))) : null;

  const timeline = el('ol', scenario.steps.map((step, index) => {
    const outcome = branch(step.outcome);
    const state = states[index + 1];
    const operation = branch(step.requested);
    const requested = step.requested[operation];
    return el('li', el('strong', `#${step.proposal} · ${outcome}`),
      state ? ` · ${number(state.member_count)} members after step` : '',
      details('Requested changes',
        requested.subnet ? el('p', 'Target subnet ', el('code', principal(requested.subnet))) : null,
        principalList('Requested additions', requested.add ?? (operation === 'Add' ? requested.nodes : [])),
        principalList('Requested removals', requested.remove ?? (operation === 'Remove' ? requested.nodes : []))),
      step.findings.length ? findingsList(step.findings) : null);
  }));
  timeline.className = 'steps';
  const findings = [...review.findings, ...scenario.findings];
  const notes = findings.length ? details(`Scenario findings (${number(findings.length)})`, findingsList(findings)) : null;

  container.replaceChildren(
    el('h3', scenarioLabel(scenario.id)),
    counts,
    timeline,
    notes,
    view ? principalList('Baseline membership', view.baseline.members) : el('p', 'This scenario has no resolved subnet scope.'),
    final ? principalList('Added members', final.added) : null,
    final ? principalList('Removed members', final.removed) : null,
    final ? principalList('Final membership', final.members) : null,
    selected && stateIndex > 0 && stateIndex !== states.length - 1 ? principalList('Selected intermediate membership', selected.members) : null,
    selected ? el('h3', 'Registered distributions for selected state') : null,
    selected ? distributionPanel(selected) : null,
    view && !selected ? styled('p', 'notice warning', 'Membership after that step is unavailable.') : null,
  );
}

export function renderPerformance(page, section) {
  if ('Unavailable' in page.scope) {
    section.replaceChildren(el('p', 'This review has no resolved scope for the selected subnet.'));
    return;
  }
  const { rows } = page.scope.Nodes;
  const stamp = option(page.sample);
  const observed = new Map(page.rows.map(row => [principal(row.node_id), row]));
  const summary = !rows.length ? 'The selected scope contains no nodes.'
    : !stamp ? 'No archived blockmaking sample is available for this subnet.'
    : stamp.conflicted ? 'Conflicting sample. Counters are unavailable.'
    : `${observed.size} of ${rows.length} scoped nodes on this page have counter rows.`;
  section.replaceChildren(
    el('p', summary),
    stamp ? el('p', `Sample ${time(stamp.timestamp_nanos)} · collected ${time(stamp.collected_at)} · observation ${stamp.observation}`) : null,
    option(page.last_success_at) !== undefined ? styled('p', 'muted', `Last successful source collection ${time(option(page.last_success_at))}`) : null,
    stamp && stamp.preceding_gap.length ? styled('p', 'notice warning', `Archive continuity gap · ${words(branch(stamp.preceding_gap[0]))}`) : null,
    rows.length ? table(['Scoped node', 'Scope roles', 'Proposed blocks, cumulative', 'Blockmaking failures, cumulative'], rows.map(([id, node]) => {
      const row = observed.get(principal(id));
      const empty = stamp && !stamp.conflicted ? 'No row in sample' : 'Unavailable';
      return [el('code', principal(id)), node.roles.map(role => words(branch(role))).join(', '),
        row ? number(row.num_blocks_proposed_total) : empty, row ? number(row.num_block_failures_total) : empty];
    })) : null,
  );
}
