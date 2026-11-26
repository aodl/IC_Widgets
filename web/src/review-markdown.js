import { calculationNote, criteriaNote, geographyNote, governanceText, replayLabel, replayRegistryText } from './detail-model.js';
import { hex, number } from './view.js';

function escape(text) {
  return String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replace(/[\\`*_{}\[\]|]/g, '\\$&').replace(/\r?\n/g, ' ');
}

export function markdownTable({ headers, rows }) {
  const line = cells => '| ' + cells.map(escape).join(' | ') + ' |';
  return [line(headers), line(headers.map(() => '---')), ...rows.map(line)].join('\n');
}

export function reviewMarkdown(model, { vote = '?', tldr = '', mapImage = '', mapView = '', fullDistribution = false } = {}) {
  const map = /^https:\/\/[^\s()<>"']+$/i.test(mapImage.trim())
    ? '![Registry data-center map](' + mapImage.trim() + ')'
    : 'Upload the map PNG to include it in the report.';
  const composition = model.composition.filter(row => row.featured);
  const heading = ['Registered group', 'Before → proposed', 'Note'];
  const values = row => [row.label + ' · ' + row.group, row.delta.text, row.note || '—'];
  const coefficientChanges = (model.dimensions ?? []).filter(item => item.coefficientChanged);
  const blocks = [
    '# Proposal ' + model.ids.map(id => '#' + id).join(' + ') + ' Review',
    '**VOTE**: ' + (vote.trim() || '?'),
    ('**TLDR**: ' + tldr.trim()).trimEnd(),
    model.work === 'settled' ? '**Data loading complete**' : null,
    model.readiness ? 'Calculation · ' + model.readiness.calculation + ' · Governance · ' + model.readiness.governance : null,
    !model.finalVerified ? '**Provisional · Final Governance verification unavailable**' : null,
    escape(model.scenario + ' · ' + model.stateLabel + ' · Registry ' + number(model.version)),
    'Subnet `' + model.subnet + '`',
    model.membership,
    '## Subnet composition',
    criteriaNote,
    composition.length ? markdownTable({ headers: heading, rows: composition.map(values) }) : null,
    coefficientChanges.length ? '## Changed Nakamoto coefficients\n\n'
      + markdownTable({ headers: ['Grouping', 'Groups needed'], rows: coefficientChanges.map(item => [item.label, item.coefficient.text]) }) : null,
    model.publishing?.claims.length ? '## Proposer comparison\n\n'
      + 'These claims use the proposal’s stated groupings. Country comparisons use recorded Registry labels.\n\n'
      + markdownTable({ headers: ['Grouping', 'Proposer', 'Replicated calculation', 'Comparison'], rows: model.publishing.claims }) : null,
    '## Membership evidence',
    model.members.filter(node => node.role !== 'Retained').map(node => '- ' + (node.role === 'Added' ? 'Incoming' : 'Outgoing') + ' `' + node.id + '`'
      + (node.dc ? ' · ' + escape(node.dc) : '') + (node.region ? ' · ' + escape(node.region) : '')).join('\n'),
    model.notes.map(note => '- ' + escape(note)).join('\n'),
    '## Map', geographyNote,
    mapView ? 'Map view · ' + escape(mapView) : null, map,
    '## Provenance',
    model.governance.map(proposal => '- ' + governanceText(proposal, model.replay, true) + ' · Payload SHA-256 `' + hex(proposal.payload_hash) + '`').join('\n'),
    model.finalVerified ? 'Governance checked after the selected comparisons.' : 'Final Governance observation unavailable.',
    model.replay ? escape(replayLabel(model.replay)) : null,
    model.replay ? escape(replayRegistryText(model.replay)) : null,
    model.replay?.roleSupplement ? 'Synthetic NNS-role supplement · ' + escape(model.replay.roleSupplement) : null,
    'Membership preview revision `' + model.previewRevision + '`.',
    model.calculation ? 'Calculation input SHA-256 `' + model.calculation.inputHash + '` · analysis v'
      + model.calculation.analysis_version + '.' : null,
    calculationNote,
    fullDistribution && model.dimensions?.length ? '## Full recorded distribution' : null,
    ...(fullDistribution ? (model.dimensions ?? []).flatMap(item => [
      '### ' + item.label,
      'Distinct recorded groups · ' + item.distinct.text + (item.old.unknown || item.next.unknown ? ' · Grouping incomplete' : ''),
      markdownTable({ headers: ['Group', ...heading.slice(1)], rows: model.composition.filter(row => row.key === item.key)
        .map(row => [row.group, row.delta.text, row.note || '—']) }),
    ]) : []),
  ];
  return blocks.filter(Boolean).join('\n\n') + '\n';
}
