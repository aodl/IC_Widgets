import { countryLabel } from './country-presentation.js';
import { dashboardLink } from './dashboard.js';
import { nodeFields, nodeHeaders, roles, shortIds } from './detail-model.js';
import { el, styled } from './view.js';

function nodeTable(nodes, labels, inspect) {
  const rows = nodes.map(node => {
    const role = node.role === 'Retained' ? '' : roles[node.role].label;
    const fields = nodeFields(node).map((field, index) => {
      if (field.country) return countryLabel(field.value, field.text);
      if (!field.value) return field.text;
      const label = field.principal ? labels.get(field.value) : field.value;
      const link = dashboardLink(field.entity, field.value, label);
      if (!field.principal) return link;
      if (index === 0 && inspect) {
        const button = styled('button', 'node-inspect', 'Details');
        button.type = 'button';
        button.setAttribute('aria-label', 'Inspect ' + label);
        button.addEventListener('click', () => inspect(node));
        return el('span', link, ' ', button);
      }
      const identity = el('code', field.value);
      if (field.entity) {
        const button = el('summary', 'Full ID');
        button.setAttribute('aria-label', 'Full ID for ' + label);
        return el('span', link, el('details', button, identity));
      }
      return el('details', el('summary', label), identity);
    });
    return Object.assign(styled('tr', 'node-row-' + node.role.toLowerCase(), [role, ...fields].map((cell, index) => {
      const label = styled('span', 'node-cell-label', nodeHeaders[index]);
      label.setAttribute('aria-hidden', 'true');
      return Object.assign(el('td', label, el('div', cell)), { role: 'cell' });
    })), { role: 'row' });
  });
  const headers = nodeHeaders.map(label => Object.assign(el('th', label), { scope: 'col', role: 'columnheader' }));
  const headings = Object.assign(el('thead', Object.assign(el('tr', headers), { role: 'row' })), { role: 'rowgroup' });
  return styled('div', 'table-wrap node-table', Object.assign(el('table', headings,
    Object.assign(el('tbody', rows), { role: 'rowgroup' })), { role: 'table' }));
}

export function nodeTables(members, { heading = 'h3', inspect } = {}) {
  const changed = members.filter(node => node.role !== 'Retained');
  const other = members.filter(node => node.role === 'Retained');
  const ids = shortIds(members.flatMap(node => [node.id, node.provider, node.operatorId]).filter(Boolean));
  return [
    styled('section', 'node-changes', el(heading, 'Node changes'),
      changed.length ? nodeTable(changed, ids, inspect) : el('p', 'No membership changes in the selected comparison.')),
    styled('details', 'other-nodes', el('summary', 'Other Nodes (' + other.length + ')'), nodeTable(other, ids, inspect)),
  ];
}
