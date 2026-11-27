import { countryLabel, countryName } from './country-presentation.js';
import { dashboardLink } from './dashboard.js';
import { nodeFields, nodeHeaders, roles, shortIds } from './detail-model.js';
import { el, styled } from './view.js';

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

function nodeTable(nodes, labels, caption, sorting) {
  const rows = nodes.map(node => {
    const role = node.role === 'Retained' ? '' : roles[node.role].label;
    const evidence = nodeFields(node);
    const fields = evidence.map(field => {
      if (field.country) return countryLabel(field.value, field.text);
      if (!field.value) return field.text;
      const label = field.principal ? labels.get(field.value) : field.value;
      const link = dashboardLink(field.entity, field.value, label);
      if (!field.principal) return link;
      if (link instanceof HTMLAnchorElement) return link;
      return Object.assign(el('code', label), { title: field.value });
    });
    const values = [role, ...evidence.map(field => field.country ? countryName(field.value)?.name : field.value)];
    const row = Object.assign(styled('tr', 'node-row-' + node.role.toLowerCase(), [role, ...fields].map((cell, index) => {
      const label = styled('span', 'node-cell-label', nodeHeaders[index]);
      label.setAttribute('aria-hidden', 'true');
      return Object.assign(el('td', label, el('div', cell)), { role: 'cell' });
    })), { role: 'row' });
    return { row, values };
  });
  const body = Object.assign(el('tbody'), { role: 'rowgroup' });
  const choices = el('select');
  choices.setAttribute('aria-label', 'Sort ' + caption);
  choices.append(Object.assign(el('option', 'Original order'), { value: '' }));
  const headers = nodeHeaders.map((label, column) => {
    for (const [direction, suffix] of [['ascending', 'A–Z'], ['descending', 'Z–A']]) {
      choices.append(Object.assign(el('option', label + ' (' + suffix + ')'), { value: column + '/' + direction }));
    }
    const indicator = styled('span', 'node-sort-indicator', '↕');
    indicator.setAttribute('aria-hidden', 'true');
    const button = styled('button', 'node-sort-heading', label, indicator);
    button.type = 'button';
    button.addEventListener('click', () => {
      const direction = sorting.column === column && sorting.direction === 'ascending' ? 'descending' : 'ascending';
      update(column, direction);
    });
    const header = el('th', button, styled('span', 'node-sort-label', label));
    return Object.assign(header, { scope: 'col', role: 'columnheader' });
  });
  function update(column, direction) {
    const restore = body.contains(document.activeElement) ? document.activeElement : undefined;
    Object.assign(sorting, { column, direction });
    choices.value = direction ? column + '/' + direction : '';
    for (const [index, heading] of headers.entries()) {
      const active = index === column && direction;
      if (active) heading.setAttribute('aria-sort', direction);
      else heading.removeAttribute('aria-sort');
      heading.querySelector('.node-sort-indicator').textContent = !active ? '↕' : direction === 'ascending' ? '↑' : '↓';
    }
    const sorted = direction ? [...rows].sort((a, b) => {
      const first = a.values[column], second = b.values[column];
      if (!first || !second) return Number(!first) - Number(!second);
      return collator.compare(first, second) * (direction === 'ascending' ? 1 : -1);
    }) : rows;
    body.append(...sorted.map(({ row }) => row));
    restore?.focus({ preventScroll: true });
  }
  choices.addEventListener('change', () => {
    const [column, direction] = choices.value.split('/');
    update(direction ? Number(column) : undefined, direction);
  });
  update(sorting.column, sorting.direction);
  const headings = Object.assign(el('thead', Object.assign(el('tr', headers), { role: 'row' })), { role: 'rowgroup' });
  return styled('div', 'table-wrap node-table', styled('label', 'node-sort-mobile', 'Sort by', choices),
    Object.assign(el('table', headings, body), { role: 'table' }));
}

export function nodeTables(members, { heading = 'h3', sorting = { changes: {}, other: {} } } = {}) {
  const changed = members.filter(node => node.role !== 'Retained');
  const other = members.filter(node => node.role === 'Retained');
  const ids = shortIds(members.flatMap(node => [node.id, node.provider, node.operatorId]).filter(Boolean));
  return [
    styled('section', 'node-changes', el(heading, 'Node changes'),
      changed.length ? nodeTable(changed, ids, 'node changes', sorting.changes) : el('p', 'No membership changes in the selected comparison.')),
    styled('details', 'other-nodes', el('summary', 'Other Nodes (' + other.length + ')'), nodeTable(other, ids, 'other nodes', sorting.other)),
  ];
}
