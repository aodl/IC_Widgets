import { dashboardLink } from './dashboard.js';
import { el, option, styled } from './view.js';

// A deliberately small Markdown subset. Everything is rendered as text or
// locally created formatting elements. Links and images never load resources.
function inline(text) {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map(part =>
    part.startsWith('**') && part.endsWith('**') && part.length > 4 ? el('strong', part.slice(2, -2))
      : part.startsWith('`') && part.endsWith('`') && part.length > 2 ? el('code', part.slice(1, -1)) : part);
}

export function renderStatement(text) {
  const blocks = [];
  let paragraph = [], items = [];
  const flush = () => {
    if (paragraph.length) blocks.push(el('p', inline(paragraph.join(' '))));
    if (items.length) blocks.push(el('ul', items.map(item => el('li', inline(item)))));
    paragraph = [];
    items = [];
  };
  for (const line of text.split(/\r?\n/)) {
    const heading = /^\s*#{1,6}\s+(.+)$/.exec(line);
    const item = /^\s*(?:[-*+]|\d+\.)\s+(.+)$/.exec(line);
    if (heading) {
      flush();
      blocks.push(el('h4', inline(heading[1])));
    } else if (item) {
      if (paragraph.length) flush();
      items.push(item[1]);
    } else if (!line.trim()) flush();
    else {
      if (items.length) flush();
      paragraph.push(line.trim());
    }
  }
  flush();
  return blocks;
}

export function statements(rows) {
  return (option(rows ?? []) ?? []).map(row => ({
    id: String(row.id), title: option(row.title), text: row.summary, truncated: row.truncated,
  }));
}

export function statementExcerpt(row) {
  const text = row.text.trim();
  const lines = text.split(/\r?\n/);
  if (lines[0]?.replace(/^#+\s+/, '').trim() === row.title) lines.shift();
  const cleaned = lines.join('\n').trim();
  const marker = /^\s*(?:#{1,6}\s+)?\*{0,2}(?:motivation|reason|purpose)\*{0,2}(?:\s*:\s*(.*)|\s*)$/im.exec(cleaned);
  const candidate = marker
    ? [marker[1], cleaned.slice(marker.index + marker[0].length).trim()].filter(Boolean).join('\n').trim()
    : cleaned;
  const excerpt = candidate.split(/\n\s*\n|\n\s*#{1,6}\s+/)[0]?.trim() || cleaned;
  return excerpt.length > 320 ? excerpt.slice(0, 310).replace(/\s+\S*$/, '') + '…' : excerpt;
}

export function proposerStatement(row) {
  const text = row.text.trim();
  const excerpt = statementExcerpt(row);
  return styled('section', 'proposer-statement',
    el('h3', 'Proposer’s stated purpose'), excerpt ? renderStatement(excerpt) : el('p', 'No proposer statement was captured.'),
    (excerpt !== text || row.truncated) ? el('details', el('summary', 'Read proposer’s full statement'),
      styled('div', 'proposer-full', renderStatement(text)),
      row.truncated ? el('p', 'This captured statement was truncated.') : null,
      dashboardLink('proposal', row.id, 'Open original proposal on the IC Dashboard'))
      : el('p', dashboardLink('proposal', row.id, 'Open original proposal on the IC Dashboard')));
}
