import { calculationNote, geographyNote, governanceText } from './detail-model.js';
import { hex, option, time, words } from './view.js';

function escape(text) {
  return String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replace(/[\\`*_{}\[\]|]/g, '\\$&').replace(/\r?\n/g, ' ');
}

export function markdownTable({ headers, rows }) {
  const line = cells => '| ' + cells.map(escape).join(' | ') + ' |';
  return [line(headers), line(headers.map(() => '---')), ...rows.map(line)].join('\n');
}

export function reviewMarkdown(model, { vote = '?', tldr = '', mapImage = '' } = {}) {
  const map = /^https:\/\/[^\s()<>"']+$/i.test(mapImage.trim())
    ? '![Registry data-center map](' + mapImage.trim() + ')'
    : 'Upload the map PNG to include it in the report.';
  const motion = model.source;
  const blocks = [
    '# Proposal ' + model.ids.map(id => '#' + id).join(' + ') + ' Review',
    '**VOTE**: ' + (vote.trim() || '?'),
    ('**TLDR**: ' + tldr.trim()).trimEnd(),
    model.gaps ? '**Finished with gaps**' : '**Finished**',
    escape(model.scenario + ' · ' + model.stateLabel + ' · Registry ' + model.version),
    'Subnet `' + model.subnet + '`',
    model.membership,
    '## Target Topology',
    escape(model.policyText),
    markdownTable({ headers: ['Measure', 'Proposed', 'Rule', 'Assessment'],
      rows: model.topology.map(row => [row.label, (row.ready ? row.delta.text : row.evidence)
        + (row.ready && row.evidence ? ' · ' + row.evidence : ''), row.limit,
      row.assessment + (row.breach ? ' · ' + words(row.breach) + ' breach' : '')]) }),
    model.rule ? 'Adopted clause\n\n`' + model.rule.clause.replaceAll('`', '') + '`' : null,
    option(model.rule?.exception ?? []) ? escape(option(model.rule.exception)) : null,
    '## Membership evidence',
    model.members.filter(node => node.role !== 'Retained').map(node => '- ' + node.role + ' `' + node.id + '`'
      + (node.dc ? ' · ' + escape(node.dc) : '') + (node.region ? ' · ' + escape(node.region) : '')).join('\n'),
    model.notes.map(note => '- ' + escape(note)).join('\n'),
    '## Map', geographyNote, map,
    '## Provenance',
    model.governance.map(proposal => '- ' + governanceText(proposal) + ' · Payload SHA-256 `' + hex(proposal.payload_hash) + '`').join('\n'),
    model.finalVerified ? 'Governance checked after the selected comparisons.' : 'Final Governance observation unavailable.',
    motion && option(motion.raw_hash) ? 'Policy motion #' + motion.id + ' observed ' + time(option(motion.observed_at))
      + ' · Reply SHA-256 `' + hex(option(motion.raw_hash)) + '`.' : null,
    model.policy ? 'Policy evidence digest `' + hex(model.policy.digest) + '`.' : null,
    'Membership preview revision `' + model.previewRevision + '`.',
    model.calculation ? 'Calculation input SHA-256 `' + model.calculation.inputHash + '` · analysis v'
      + model.calculation.analysis_version + '.' : null,
    calculationNote,
  ];
  return blocks.filter(Boolean).join('\n\n') + '\n';
}
