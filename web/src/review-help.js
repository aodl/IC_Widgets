import { el, styled } from './view.js';

let nextId = 0;
let openHelp;
if (typeof document !== 'undefined') {
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && openHelp) {
      if (openHelp.wrapper.isConnected) event.stopPropagation();
      openHelp.dismiss();
    }
  }, true);
  document.addEventListener('pointerdown', event => {
    if (openHelp && !openHelp.wrapper.contains(event.target)) openHelp.dismiss();
  });
}
// The tooltip stays in the wrapper’s hit region and holds no interactive
// content. Touch toggles it, and Escape dismisses without moving focus.
export function help(term, explanation) {
  const button = styled('button', 'metric-help-button', 'i');
  button.type = 'button';
  button.setAttribute('aria-label', 'About ' + term);
  const tooltip = styled('span', 'metric-tooltip', explanation);
  tooltip.id = 'review-help-' + ++nextId;
  tooltip.setAttribute('role', 'tooltip');
  tooltip.hidden = true;
  button.setAttribute('aria-describedby', tooltip.id);
  const wrapper = styled('span', 'metric-help', button, tooltip);
  let pinned = false;
  const current = { wrapper, dismiss() {
    pinned = false;
    tooltip.hidden = true;
    if (openHelp === current) openHelp = undefined;
  } };
  const reveal = () => {
    if (openHelp !== current) openHelp?.dismiss();
    openHelp = current;
    tooltip.hidden = false;
  };
  wrapper.addEventListener('mouseenter', reveal);
  button.addEventListener('focus', reveal);
  button.addEventListener('blur', () => {
    if (!pinned && !wrapper.matches(':hover')) current.dismiss();
  });
  button.addEventListener('click', () => {
    if (pinned) current.dismiss();
    else { reveal(); pinned = true; }
  });
  return wrapper;
}
