import assert from 'node:assert/strict';
import test from 'node:test';
import { terminalOutcome } from '../src/terminal-outcome.js';

test('Governance lifecycle keeps prospective, executed, rejected, and failed outcomes distinct', () => {
  const proposal = lifecycle_status => ({ lifecycle_status, executed_at_seconds: [] });
  assert.equal(terminalOutcome(proposal(1)), undefined);
  assert.equal(terminalOutcome(proposal(3)), undefined);
  assert.equal(terminalOutcome(proposal(2)).label, 'Rejected');
  assert.equal(terminalOutcome(proposal(5)).label, 'Failed');
  assert.equal(terminalOutcome(proposal(4)).label, 'Executed');
  const reportedExecution = terminalOutcome({ ...proposal(3), executed_at_seconds: [1795679157n] });
  assert.equal(reportedExecution.executed, 1795679157n);
  assert.match(reportedExecution.explanation, /historical before-state is unavailable/);
});
