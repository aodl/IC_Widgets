import { el, option, styled, time } from './view.js';
import { governanceText } from './detail-model.js';
import { proposalHeading } from './dashboard.js';

export function terminalOutcome(proposal) {
  const executed = option(proposal.executed_at_seconds ?? []);
  if (proposal.lifecycle_status === 4 || executed > 0n) {
    return {
      label: 'Executed',
      explanation: 'The historical before-state is unavailable. A historical comparison requires verified pre-execution Registry evidence.',
      executed,
    };
  }
  if (proposal.lifecycle_status === 2) {
    return { label: 'Rejected', explanation: 'The proposal ended at the vote. The requested membership is proposal evidence only.' };
  }
  if (proposal.lifecycle_status === 5) {
    return { label: 'Failed', explanation: 'Governance recorded an execution error. The requested membership is proposal evidence only.' };
  }
}

export function terminalSummary(proposal, title, indexedFailure, replay) {
  const outcome = terminalOutcome(proposal);
  return el('article',
    el('h2', proposalHeading([proposal.id])),
    title ? el('p', title) : null,
    el('p', replay ? 'Recorded status: ' : '', styled('strong', 'terminal-lifecycle', outcome.label),
      replay ? null : ' · Observed ' + time(proposal.observed_at_nanos)),
    replay ? el('p', governanceText(proposal, replay, true).split(' · ').slice(2).join(' · ')) : null,
    outcome.executed > 0n ? el('p', 'Execution recorded at ' + time(outcome.executed * 1_000_000_000n)) : null,
    el('p', outcome.explanation),
    indexedFailure ? el('details', el('summary', 'Indexed execution error'), el('p', indexedFailure)) : null);
}
