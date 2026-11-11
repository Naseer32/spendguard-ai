import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reducer } from './reducer.js';
import { createDemoState } from '../data/demoSeed.js';
import { validateAgentForm } from '../lib/validation.js';

const NOW = Date.parse('2026-11-10T12:00:00Z');
const T = '2026-11-10T12:30:00.000Z';
const fresh = () => createDemoState(NOW);

test('agent/create adds an ACTIVE agent and one audit entry', () => {
  const s = fresh();
  const { value } = validateAgentForm({
    name: 'New Agent', sourceAccount: 'new-source.example',
    dailyBudget: '50', perTxLimit: '20', approvalThreshold: '10',
  });
  const next = reducer(s, { type: 'agent/create', id: 'demo-agent-new', now: T, values: value });
  assert.equal(next.agents.length, s.agents.length + 1);
  const created = next.agents.at(-1);
  assert.equal(created.status, 'ACTIVE');
  assert.equal(created.dailyBudget, '50000000000000000000000000');
  assert.equal(next.audit.length, s.audit.length + 1);
  assert.equal(next.audit.at(-1).event, 'AGENT_CREATED');
  assert.equal(s.agents.length, 4, 'original state is not mutated');
});

test('agent/create refuses a duplicate id', () => {
  const s = fresh();
  assert.equal(reducer(s, { type: 'agent/create', id: 'demo-agent-1', now: T, values: {} }), s);
});

test('agent/setStatus pauses and resumes, and ignores no-ops', () => {
  const s = fresh();
  const paused = reducer(s, { type: 'agent/setStatus', agentId: 'demo-agent-1', status: 'PAUSED', now: T });
  assert.equal(paused.agents[0].status, 'PAUSED');
  assert.equal(paused.audit.at(-1).event, 'AGENT_PAUSED');

  assert.equal(reducer(paused, { type: 'agent/setStatus', agentId: 'demo-agent-1', status: 'PAUSED', now: T }), paused);
  const resumed = reducer(paused, { type: 'agent/setStatus', agentId: 'demo-agent-1', status: 'ACTIVE', now: T });
  assert.equal(resumed.audit.at(-1).event, 'AGENT_RESUMED');

  assert.equal(reducer(s, { type: 'agent/setStatus', agentId: 'nope', status: 'PAUSED', now: T }), s);
  assert.equal(reducer(s, { type: 'agent/setStatus', agentId: 'demo-agent-1', status: 'DELETED', now: T }), s);
});

test('agent/updateLimits updates limits and audits', () => {
  const s = fresh();
  const values = { dailyBudget: '7', perTxLimit: '5', approvalThreshold: '2' };
  const next = reducer(s, { type: 'agent/updateLimits', agentId: 'demo-agent-2', now: T, values });
  const a = next.agents.find((x) => x.id === 'demo-agent-2');
  assert.deepEqual([a.dailyBudget, a.perTxLimit, a.approvalThreshold], ['7', '5', '2']);
  assert.equal(next.audit.at(-1).event, 'AGENT_LIMITS_UPDATED');
  assert.equal(reducer(s, { type: 'agent/updateLimits', agentId: 'nope', now: T, values }), s);
});

test('recipient/set adds, then updates the same account instead of duplicating', () => {
  const s = fresh();
  const add = reducer(s, {
    type: 'recipient/set', agentId: 'demo-agent-3', id: 'r-new', now: T,
    values: { accountId: 'demo-new.example', listType: 'ALLOW', note: null },
  });
  assert.equal(add.recipients.length, s.recipients.length + 1);
  assert.equal(add.audit.at(-1).event, 'RECIPIENT_ADDED');

  const flip = reducer(add, {
    type: 'recipient/set', agentId: 'demo-agent-3', id: 'r-other', now: T,
    values: { accountId: 'demo-new.example', listType: 'BLOCK', note: 'changed' },
  });
  assert.equal(flip.recipients.length, add.recipients.length, 'no duplicate row');
  assert.equal(flip.recipients.find((r) => r.accountId === 'demo-new.example').listType, 'BLOCK');
  assert.equal(flip.audit.at(-1).event, 'RECIPIENT_UPDATED');
});

test('recipient/remove removes only the matching row', () => {
  const s = fresh();
  const next = reducer(s, { type: 'recipient/remove', agentId: 'demo-agent-1', accountId: 'demo-recipient-c.example', now: T });
  assert.equal(next.recipients.length, s.recipients.length - 1);
  assert.equal(next.audit.at(-1).event, 'RECIPIENT_REMOVED');
  assert.equal(reducer(next, { type: 'recipient/remove', agentId: 'demo-agent-1', accountId: 'demo-recipient-c.example', now: T }), next);
});

test('approval/decide approves an APPROVAL_REQUIRED request without changing its decision', () => {
  const s = fresh();
  const next = reducer(s, { type: 'approval/decide', requestId: 'demo-req-02', decision: 'APPROVE', comment: 'ok', now: T });
  const r = next.requests.find((x) => x.id === 'demo-req-02');
  assert.equal(r.status, 'APPROVED');
  assert.equal(r.decision, 'APPROVAL_REQUIRED', 'engine decision is immutable');
  assert.equal(r.decisionComment, 'ok');
  assert.equal(r.decidedAt, T);
  assert.equal(next.audit.at(-1).event, 'PAYMENT_APPROVED');
});

test('approval can never produce EXECUTED, SUBMITTED or a transaction', () => {
  const s = fresh();
  const next = reducer(s, { type: 'approval/decide', requestId: 'demo-req-02', decision: 'APPROVE', now: T });
  const r = next.requests.find((x) => x.id === 'demo-req-02');
  assert.notEqual(r.status, 'EXECUTED');
  assert.notEqual(r.status, 'SUBMITTED');
  assert.equal('txHash' in r, false);
});

test('approval/decide rejects and records the comment', () => {
  const s = fresh();
  const next = reducer(s, { type: 'approval/decide', requestId: 'demo-req-05', decision: 'REJECT', comment: 'unknown vendor', now: T });
  const r = next.requests.find((x) => x.id === 'demo-req-05');
  assert.equal(r.status, 'REJECTED');
  assert.equal(r.decisionComment, 'unknown vendor');
  assert.equal(next.audit.at(-1).event, 'PAYMENT_REJECTED');
});

test('approval/decide ignores requests that are not awaiting approval', () => {
  const s = fresh();
  for (const id of ['demo-req-01', 'demo-req-03', 'demo-req-04', 'demo-req-12', 'missing']) {
    assert.equal(reducer(s, { type: 'approval/decide', requestId: id, decision: 'APPROVE', now: T }), s, id);
  }
  assert.equal(reducer(s, { type: 'approval/decide', requestId: 'demo-req-02', decision: 'MAYBE', now: T }), s);
  // A decided request cannot be decided twice.
  const once = reducer(s, { type: 'approval/decide', requestId: 'demo-req-02', decision: 'REJECT', now: T });
  assert.equal(reducer(once, { type: 'approval/decide', requestId: 'demo-req-02', decision: 'APPROVE', now: T }), once);
});

test('audit sequence numbers stay contiguous and append-only', () => {
  let s = fresh();
  const before = s.audit.map((e) => ({ ...e }));
  s = reducer(s, { type: 'agent/setStatus', agentId: 'demo-agent-1', status: 'PAUSED', now: T });
  s = reducer(s, { type: 'approval/decide', requestId: 'demo-req-09', decision: 'APPROVE', now: T });
  s.audit.forEach((e, i) => assert.equal(e.seq, i + 1));
  assert.deepEqual(s.audit.slice(0, before.length), before, 'earlier entries untouched');
});

test('unknown actions return the same state', () => {
  const s = fresh();
  assert.equal(reducer(s, { type: 'something/else' }), s);
});
