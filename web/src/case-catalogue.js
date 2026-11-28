import { action, el, styled } from './view.js';
import { replayRegistryText } from './detail-model.js';

const path = row => '/test-cases/' + row.id;
const link = (title, href) => Object.assign(el('a', title), { href });
const utc = date => date?.replace('T', ' ').replace(/(?:Z|\+00:00)$/, ' UTC');
const caseIds = row => row.proposalIds.map(id => '#' + id).join(' + ');

function context(row) {
  return [
    el('p', row.lifecycleLabel + ' · ' + row.kind),
    row.registryVersion ? el('p', 'Pinned Registry ' + BigInt(row.registryVersion).toLocaleString('en-US')) : null,
    row.registryFrom ? el('p', replayRegistryText(row)) : null,
    row.actionEvidence.map(entry => el('p',
      entry.kind === 'synthetic-governance-action' ? 'Synthetic Governance action #' + entry.id
        : (entry.kind === 'recorded-governance-reply' ? 'Original Governance observation' : 'Original indexed observation')
          + ' #' + entry.id + ' · ' + (utc(entry.at) ?? 'Observation time unavailable'))),
    row.roleSupplement ? el('p', 'Synthetic supplement · ' + row.roleSupplement) : null,
    row.fault ? el('p', 'Exceptional condition · ' + row.fault.replaceAll('-', ' ')) : null,
  ];
}

export function showTestCatalogue(cases, row) {
  const root = document.querySelector('main');
  const nav = styled('nav', 'test-nav', link('Live review', '/'), link('Test cases', '/test-cases'));
  nav.setAttribute('aria-label', 'Evidence mode');
  document.querySelector('.masthead-row').append(nav);
  if (!row && !['/test-cases', '/test-cases/', '/test-cases.html'].includes(location.pathname)) return;
  document.querySelector('#open-performance').hidden = true;
  document.querySelector('#view-switch').hidden = true;
  const card = styled('section', 'card test-catalogue');
  if (row) {
    card.append(styled('p', 'local-note', 'Bundled test case · Fixture evidence'), el('h1', row.name + ' · ' + caseIds(row)), el('p', row.purpose), ...context(row).flat().filter(Boolean));
    if (row.limits) card.append(styled('p', 'muted', row.limits));
    const dropdown = el('select', cases.filter(item => item.asset).map(item =>
      Object.assign(el('option', item.name + ' · ' + caseIds(item)), { value: item.id })));
    dropdown.value = row.id;
    const open = action('Open selected test case', () => {
      const next = cases.find(item => item.id === dropdown.value);
      if (next) location.assign(path(next));
    });
    card.append(styled('div', 'controls', el('label', 'Switch test case', dropdown), ' ', open));
    if (row.asset) {
      root.querySelector('#proposal-search').before(card);
      return;
    }
    card.append(el('p', row.supportLabel + ' · Interactive review unavailable.'));
  } else {
    card.append(el('h1', 'Test cases'), el('p', 'These fixtures exercise IC Widgets with recorded and constructed evidence.'));
    const topics = new Map();
    for (const item of cases) {
      if (!topics.has(item.topic)) topics.set(item.topic, []);
      topics.get(item.topic).push(item);
    }
    for (const [topic, entries] of [...topics].sort(([a], [b]) => a.localeCompare(b))) {
      card.append(el('h2', topic), el('ul', entries.map(item => styled('li', 'test-case-item',
        el('strong', link(item.name + ' · ' + caseIds(item), path(item))),
        el('p', [item.actions.join(' + '), item.lifecycleLabel, item.kind, item.supportLabel].filter(Boolean).join(' · ')),
        el('p', item.purpose), item.fault ? el('p', 'Exceptional condition · ' + item.fault.replaceAll('-', ' ')) : null))));
    }
  }
  root.replaceChildren(card);
}
