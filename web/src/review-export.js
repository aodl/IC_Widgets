import { action, saveFile } from './review-map.js';
import { reviewMarkdown } from './review-markdown.js';
import { el, styled } from './view.js';

const disclose = (label, ...contents) => el('details', el('summary', label), ...contents);

export function markdownEditor(model, draft, exportMap) {
  const vote = el('input');
  vote.value = draft.vote ?? '?';
  const tldr = el('textarea');
  tldr.rows = 3;
  tldr.value = draft.tldr ?? '';
  const mapImage = el('input');
  mapImage.type = 'url';
  const inputHash = model.calculation?.inputHash;
  mapImage.disabled = !inputHash;
  mapImage.value = draft.mapImage?.inputHash === inputHash ? draft.mapImage?.url ?? '' : '';
  const previewVote = el('p');
  const previewTldr = el('p');
  const raw = el('textarea');
  raw.readOnly = true;
  raw.rows = 12;
  raw.setAttribute('aria-label', 'Generated Markdown');
  const status = styled('p', 'status');
  status.setAttribute('role', 'status');
  function update() {
    Object.assign(draft, { vote: vote.value, tldr: tldr.value });
    if (inputHash) draft.mapImage = { inputHash, url: mapImage.value };
    raw.value = reviewMarkdown(model, { ...draft, mapImage: mapImage.value });
    previewVote.replaceChildren(el('strong', 'VOTE'), ' ' + (vote.value.trim() || '?'));
    previewTldr.replaceChildren(el('strong', 'TLDR'), ' ' + tldr.value.trim());
  }
  for (const input of [vote, tldr, mapImage]) input.addEventListener('input', update);
  update();

  const preview = styled('article', 'markdown-preview', el('h4', 'Proposal ' + model.ids.map(id => '#' + id).join(' + ') + ' Review'),
    previewVote, previewTldr, el('p', model.membership), el('p', model.scenario + ' · ' + model.stateLabel + ' · Registry ' + model.version),
    el('ul', model.notes.map(note => el('li', note))),
    el('p', 'Use the exported PNG and the forum’s image upload to include the map.'));
  return styled('section', 'detail-section', el('h3', 'Review Markdown'),
    styled('div', 'markdown-fields', el('label', 'VOTE', vote), el('label', 'TLDR', tldr),
      el('label', 'Uploaded map image URL (optional)', mapImage)),
    styled('div', 'actions', exportMap, action('Copy Markdown', async event => {
      const copyButton = event.currentTarget;
      try {
        await navigator.clipboard.writeText(raw.value);
        status.textContent = 'Review Markdown copied.';
      } catch {
        const source = raw.closest('details');
        const wasOpen = source.open;
        source.open = true;
        raw.focus();
        raw.select();
        if (document.execCommand('copy')) {
          source.open = wasOpen;
          copyButton.focus();
          status.textContent = 'Review Markdown copied.';
        } else {
          status.textContent = 'Select and copy the generated Markdown from the field.';
        }
      }
    }), action('Download Markdown', () => saveFile('proposal-' + model.ids.join('-') + '-' + model.version + '-review.md', raw.value, 'text/markdown;charset=utf-8'))),
    status, disclose('Review preview', preview), disclose('Generated Markdown source', raw));
}
