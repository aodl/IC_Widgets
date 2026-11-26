import { calculationNote, geographyNote, governanceText } from './detail-model.js';
import { branch, hex, option, time, words } from './view.js';

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
    !model.finalVerified ? '**Provisional · Final Governance verification unavailable**' : model.gaps ? '**Finished with gaps**' : '**Finished**',
    escape(model.scenario + ' · ' + model.stateLabel + ' · Registry ' + model.version),
    'Subnet `' + model.subnet + '`',
    model.membership,
    '## Target Topology',
    escape(model.policyText),
    markdownTable({ headers: ['Measure', 'Proposed', 'Rule', 'Assessment'],
      rows: model.topology.map(row => [row.label + (row.groupLabel ? ' · ' + row.groupLabel : ''), (row.ready ? row.delta.text : row.evidence)
        + (row.ready && row.evidence ? ' · ' + row.evidence : ''), row.limit,
      row.assessment + (row.breach ? ' · ' + (row.breach === 'Improved' ? 'Improved, still exceeds the cap' : words(row.breach) + ' breach') : '')]) }),
    model.rule ? 'Adopted clause\n\n`' + model.rule.clause.replaceAll('`', '') + '`' : null,
    option(model.rule?.exception ?? []) ? escape(option(model.rule.exception)) : null,
    model.topology.flatMap(row => [
      ...(row.departures ?? []).map(group => '- ' + escape(group.label) + ' ' + group.delta.text + ' · Last member leaves this subnet.'),
      row.sharedProvider ? '- The incoming and outgoing nodes share recorded provider `' + row.sharedProvider.id + '`.' : null,
      ...(row.groupRows ?? []).slice(1).filter(group => group.breach.length || branch(group.assessment) === 'ExceedsLimit').map(group => {
        const change = option(group.breach);
        const wording = change ? branch(change) === 'Improved' ? 'Improved, still exceeds the cap.' : words(branch(change)) + ' breach.'
          : 'Exceeds limit.';
        return '- ' + escape(row.label) + ' · ' + escape(group.label) + ' · ' + wording;
      }),
    ]).filter(Boolean).join('\n'),
    model.publishing?.changes.length ? '## Changed Nakamoto coefficients\n\n'
      + markdownTable({ headers: ['Grouping', 'Groups needed'], rows: model.publishing.changes }) : null,
    model.publishing?.claims.length ? '## Proposer comparison\n\n'
      + 'These claims use the proposal’s stated groupings. Country comparisons use recorded Registry labels.\n\n'
      + markdownTable({ headers: ['Grouping', 'Proposer', 'Replicated calculation', 'Comparison'], rows: model.publishing.claims }) : null,
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
