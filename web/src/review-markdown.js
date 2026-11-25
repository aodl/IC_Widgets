import { calculationNote, eligibility, geographyNote, proposalUrl, thresholdNote } from './detail-model.js';

function escape(text) {
  return String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replace(/[\\`*_{}\[\]|]/g, '\\$&').replace(/\r?\n/g, ' ');
}

export function markdownTable({ headers, rows }) {
  if (!rows.length) return 'None.';
  const cell = value => value && typeof value === 'object'
    ? '[' + escape(value.label) + '](' + value.url + ')' : escape(value);
  const line = cells => '| ' + cells.join(' | ') + ' |';
  return [
    line(headers.map(escape)), line(headers.map(() => '---')),
    ...rows.map(row => line(row.map(cell))),
  ].join('\n');
}

export function reviewMarkdown(model, { vote = '?', tldr = '', mapImage = '' } = {}) {
  const title = model.ids.map(id => '#' + id).join(' + ');
  const links = model.ids.map(id => '[Proposal #' + id + '](' + proposalUrl(id) + ')').join(' · ');
  const map = /^https:\/\/[^\s()<>"']+$/i.test(mapImage.trim())
    ? '![Registry data-center map](' + mapImage.trim() + ')'
    : 'Export the PNG from the Network Nexus map, upload it to the forum, then insert its image link here.';
  const blocks = [
    '# Proposal ' + title + ' Review',
    '**VOTE**: ' + (vote.trim() || '?'),
    ('**TLDR**: ' + tldr.trim()).trimEnd(),
    '## Proposed membership and selected scenario',
    links + ' · [Subnet ' + model.subnet + '](' + model.subnetLink.url + ')',
    model.scenario + ' · ' + model.stateLabel + ' · Registry version ' + model.version,
    model.membership,
    '## Findings and evidence limits',
    [...(model.findings?.length ? model.findings.map(finding => finding.title + '. ' + finding.explanation +
      (finding.metrics.length ? ' ' + finding.metrics.map(metric => metric.name + ' ' + metric.value + ' ' + metric.before + ' → ' + metric.after +
        (metric.coefficient.every(value => value !== undefined) && metric.coefficient[0] !== metric.coefficient[1]
          ? ' (coefficient ' + metric.coefficient.join(' → ') + ')' : '')).join(' · ') + '.' : '')) : model.consequences),
    ...model.notes].map(note => '- ' + escape(note)).join('\n'),
  ];
  for (const table of [...model.tables.filter(table => !table.title.endsWith(' nodes')),
    ...model.dimensions.map(row => ({ ...row.table, note: row.note })),
    ...model.tables.filter(table => table.title.endsWith(' nodes'))]) {
    blocks.push('### ' + table.title);
    if (table.title === 'Decentralisation and concentration') blocks.push(thresholdNote);
    if (table.title === 'Geographic distances') blocks.push(geographyNote);
    if (table.note) blocks.push(escape(table.note));
    if (table.title === 'Proposer claims and independent calculation') {
      blocks.push('Claimed figures come from the Governance summary. The comparison uses Registry groups and the greater-than-one-third threshold. Where shown, the aggregate tests the five published dimensions plus node operator. A numerical match leaves the proposer’s exact inputs and health claims unverified.');
    }
    blocks.push(markdownTable(table));
  }
  blocks.push('## Map', 'Plus marks identify additions, minus marks identify removals, and neutral counts include retained nodes. A PNG may show a focused viewport or role filter. The review tables cover the full selected scenario and step. Nodes without usable registered coordinates are listed separately in the interface.', map,
    '## Sources', '- NNS Governance `get_proposal_info`, observations listed above.\n- NNS Registry `get_value` at version ' + model.version
    + '.\n- Natural Earth public-domain land outline.\n- ' + eligibility,
    ...model.payloads.map(value => '`' + value + '`'),
  );
  if (model.previewRevision) blocks.push('Membership preview revision `' + model.previewRevision + '`.');
  if (model.calculation) blocks.push(
    'Calculation input SHA-256 `' + model.calculation.inputHash + '` · analysis v' + model.calculation.analysis_version + '.',
    calculationNote + ' The exact Candid input is available in Evidence under Method and exact inputs.',
  );
  return blocks.join('\n\n') + '\n';
}
