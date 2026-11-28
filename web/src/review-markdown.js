import { boundaryNote, countryMarkdown, countryToken } from './country-presentation.js';
import { dashboardUrl } from './dashboard.js';
import { calculationNote, comparisonCaption, criteriaNote, distanceHelp, distanceTitle, distributionTables, geographyNote,
  governanceText, nodeFields, nodeHeaders, replayLabel, replayRegistryText, roles } from './detail-model.js';
import { evidenceReceipt, receiptHeaders } from './review-checks.js';
import { statementExcerpt } from './proposer-statement.js';
import { mapCoverage, mapLocations, siteLabel } from './review-map.js';
import { hex, number, option, principal, time } from './view.js';

export function reportSnapshot(model, receipts, reviewChecks, proposalText = []) {
  const { ids, order, step, scenario, stateLabel, subnet, version, members, dimensions, countries, distances, membership,
    summary, notes, governance, replay, previewRevision, evidenceNotes } = model;
  const { inputHash, analysis_version: analysisVersion } = model.calculation;
  const scope = { ids, order, step, state: stateLabel, subnet, registry: String(version), inputHash };
  const sources = receipts.flatMap(({ response, type }) => (response?.receipts ?? []).map(row =>
    [type === 'Lifecycle' ? 'Final Governance verification' : type ? 'Registry enrichment · ' + type
      : row.method === 'get_proposal_info' ? 'Membership preview · Governance' : 'Membership preview · Registry', ...evidenceReceipt(row)]));
  const snapshot = structuredClone({ scope, scenario, stateLabel, version, members, dimensions, countries, distances, membership,
    summary, notes, evidenceNotes, reviewChecks, proposalText, governance: governance.map(({ id, lifecycle_status, observed_at_nanos, payload_hash }) => ({
      id, lifecycle_status, observed_at_nanos, payload_hash: Array.from(payload_hash),
    })), replay, previewRevision, analysisVersion, sources });
  snapshot.geography = mapLocations(snapshot.members, snapshot.countries);
  function freeze(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      for (const child of Object.values(value)) freeze(child);
      Object.freeze(value);
    }
  }
  freeze(snapshot);
  return snapshot;
}

export function reportScope(model) {
  return model.scenario + ' · ' + model.stateLabel + ' · Step ' + model.scope.step + ' of ' + model.scope.ids.length;
}

function escape(text) {
  return String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replace(/[\\`*_{}\[\]|]/g, '\\$&').replace(/\r?\n/g, ' ');
}

export function markdownTable({ headers, rows }) {
  const line = cells => '| ' + cells.map(cell => cell?.href ? '[' + escape(cell.text) + '](' + cell.href + ')' : escape(cell)).join(' | ') + ' |';
  return [line(headers), line(headers.map(() => '---')), ...rows.map(line)].join('\n');
}

const list = rows => rows.map(row => '- ' + escape(row)).join('\n');
const collapsed = (title, contents) => '<details>\n<summary>' + title + '</summary>\n\n' + contents + '\n\n</details>';
const renderedLink = (text, href) => href ? { text, href } : text;
const markdownLink = (entity, id, label = id) => {
  const href = dashboardUrl(entity, id);
  return href ? '[' + escape(label) + '](' + href + ')' : escape(label);
};

export function reviewMarkdown(model, { vote = '', summary = '', attribution = '' } = {}) {
  const { scope, members, dimensions, distances, geography } = model;
  const unchanged = members.filter(node => node.role === 'Retained');
  const changed = members.filter(node => node.role !== 'Retained');
  const rows = nodes => nodes.map(node => [node.role === 'Retained' ? '' : roles[node.role].label,
    ...nodeFields(node).map(field => field.country ? countryMarkdown(field.value, field.text)
      : renderedLink(field.text, dashboardUrl(field.entity, field.value)))]);
  const regionRows = [...new Map(members.filter(node => node.region).map(node =>
    [JSON.stringify([node.dc, node.region]), [renderedLink(node.dc ?? '—', dashboardUrl('center', node.dc)),
      node.region, countryToken(node.region) ?? '—']])).values()];
  const countryRows = model.countries?.groups.map(group => [countryMarkdown(group.token), group.delta.text]) ?? [];
  const thresholds = dimensions.find(item => item.thresholds?.[0] !== undefined || item.thresholds?.[1] !== undefined)?.thresholds;
  const threshold = thresholds?.[0] === thresholds?.[1] ? thresholds?.[0] : thresholds?.map(value => value ?? 'Unavailable').join(' → ');
  const partial = dimensions.filter(item => item.partial).map(item => item.label + ' members with missing grouping: ' + item.unknown.text);
  const blocks = [
    '# Proposal review · ' + scope.ids.map(id => markdownLink('proposal', id, '#' + id)).join(' + '),
    escape(reportScope(model)), 'Subnet ' + markdownLink('subnet', scope.subnet),
    model.replay && escape(replayLabel(model.replay)),
    vote.trim() && '## Reviewer vote\n\n' + escape(vote.trim()),
    summary.trim() && '## Reviewer summary\n\n' + summary.trim().split(/\n\s*\n/).map(escape).join('\n\n'),
    attribution.trim() && '**Reviewer attribution** ' + escape(attribution.trim()),
    ...(model.proposalText ?? []).flatMap(row => [
      '## Proposer’s stated purpose · #' + row.id,
      row.title && escape(row.title),
      escape(statementExcerpt(row)),
      '[Full proposer statement](' + dashboardUrl('proposal', row.id) + ')',
      row.truncated && 'The captured proposer statement was truncated.',
    ]),
    '## Summary', escape(model.summary), escape(model.membership), escape(model.notes[0] ?? ''), list(model.evidenceNotes ?? []),
    '## Evidence scope',
    'Pinned Registry version **' + number(model.version) + '**. Governance checked after the selected comparisons.',
    list(model.governance.map(proposal => governanceText(proposal, model.replay, true))),
    list(model.notes.slice(1)), model.replay && escape(replayRegistryText(model.replay)),
    model.replay?.roleSupplement && 'Synthetic NNS-role supplement · ' + escape(model.replay.roleSupplement),
    model.reviewChecks && [
      '## Review checks',
      model.reviewChecks.assumption,
      ...model.reviewChecks.instructions.flatMap(row => [
        '### ' + escape(row.title), escape(row.overview), ...row.margins.map(escape), collapsed('Instruction and margin arithmetic', row.details.map(item => '- ' + escape(item.text)).join('\n')),
      ]),
      escape(model.reviewChecks.interactions.overview),
      ...model.reviewChecks.interactions.observations.map(text => '- ' + escape(text)),
      ...model.reviewChecks.interactions.findings.map(item => '- ' + escape(item.text)
        + (item.url ? ' [' + item.label + '](' + item.url + ')' : '')),
    ].join('\n\n'),
    '## Map', '![Map of registered node locations for the selected comparison](map.png)',
    'Add (green) · Remove (red) · Unchanged (blue). ' + mapCoverage(geography) + '. ' + geographyNote,
    boundaryNote,
    model.countries?.note,
    geography.changed.length && 'Changed sites · ' + geography.changed.map(siteLabel).map(escape).join(' · '),
    '## Node changes',
    changed.length ? markdownTable({ headers: nodeHeaders, rows: rows(changed) })
      : 'No membership changes in the selected comparison.',
    collapsed('Other Nodes (' + unchanged.length + ')', markdownTable({ headers: nodeHeaders, rows: rows(unchanged) })),
    '## Decentralisation', comparisonCaption,
    ...distributionTables.flatMap(({ key, title, help }) => [
      '### ' + title, help,
      key === 'coefficient' && threshold !== undefined ? 'Node threshold: ' + threshold + '.' : null,
      markdownTable({ headers: dimensions.map(item => item.label), rows: [dimensions.map(item => item[key]?.text ?? 'Unavailable')] }),
    ]),
    partial.length && '≥ marks a recorded minimum. ' + partial.join(' · ') + '.',
    '### ' + distanceTitle, distanceHelp,
    distances && markdownTable({ headers: distances.columns.map(column => column.label),
      rows: [distances.columns.map(column => column.delta.text)] }),
    distances?.coverage, criteriaNote,
    countryRows.length && collapsed('Recorded country membership', markdownTable({ headers: ['Country (recorded token)', 'Subnet members'], rows: countryRows })),
    '## Sources and calculation',
    'Membership preview revision `' + model.previewRevision + '`.',
    'Calculation input SHA-256 `' + scope.inputHash + '` · analysis v' + model.analysisVersion + '.',
    calculationNote,
    list(model.governance.map(proposal => '#' + proposal.id + ' executable payload SHA-256 ' + hex(proposal.payload_hash))),
    distances && collapsed('Exact distance evidence in metres',
      markdownTable({ headers: ['Distance', 'Before', 'Proposed'],
        rows: distances.columns.map(column => [column.label, ...column.metres.map(value => value ?? 'Unavailable')]) })),
    regionRows.length && collapsed('Registered geography evidence', markdownTable({ headers: ['Data center', 'Original Registry region', 'Country token'], rows: regionRows })),
    model.sources.length && collapsed('Membership and Registry source receipts (' + model.sources.length + ')',
      markdownTable({ headers: ['Evidence stage', ...receiptHeaders], rows: model.sources })),
    model.reviewChecks?.interactions.receipts?.length && collapsed('Accepted Governance discovery source receipts ('
      + model.reviewChecks.interactions.receipts.length + ')',
      markdownTable({ headers: receiptHeaders, rows: model.reviewChecks.interactions.receipts })),

  ];
  return blocks.filter(Boolean).join('\n\n') + '\n';
}
