import { test } from 'node:test';
import assert from 'node:assert/strict';
import { auditEventLabel, describeEntry, agentIdOfEntry } from './audit.js';

const base = { seq: 1, ts: 't', actor: 'owner', payload: null };
const agentsById = { a1: { id: 'a1', name: 'Alpha' } };

test('labels: known events and a readable fallback', () => {
  assert.equal(auditEventLabel('AGENT_PAUSED'), 'Agent paused');
  assert.equal(auditEventLabel('PAYMENT_APPROVAL_REQUIRED'), 'Payment approval required');
  assert.equal(auditEventLabel(''), 'Unknown event');
});

test('agent id comes from entity, payload or the payment lookup', () => {
  assert.equal(agentIdOfEntry({ ...base, event: 'AGENT_PAUSED', entityId: 'a1' }), 'a1');
  assert.equal(agentIdOfEntry({ ...base, event: 'RECIPIENT_ADDED', entityId: 'x', payload: { agentId: 'a1' } }), 'a1');
  assert.equal(agentIdOfEntry({ ...base, event: 'PAYMENT_APPROVED', entityId: 'p1' }, { p1: { agentId: 'a1' } }), 'a1');
  assert.equal(agentIdOfEntry({ ...base, event: 'PAYMENT_APPROVED', entityId: 'p9' }), null);
});

test('summaries use the agent name and never crash on missing payloads', () => {
  const e = describeEntry({ ...base, event: 'AGENT_PAUSED', entityId: 'a1' }, { agentsById });
  assert.equal(e.summary, 'Alpha was paused.');
  assert.equal(e.agentId, 'a1');
  for (const event of ['AGENT_CREATED', 'AGENT_LIMITS_UPDATED', 'RECIPIENT_ADDED', 'RECIPIENT_REMOVED', 'PAYMENT_EVALUATED', 'PAYMENT_APPROVED', 'SOMETHING_NEW']) {
    const d = describeEntry({ ...base, event, entityId: null }, {});
    assert.equal(typeof d.summary, 'string');
    assert.ok(d.summary.length > 0);
  }
});

test('payment summaries show amounts as NEAR', () => {
  const d = describeEntry({ ...base, event: 'PAYMENT_APPROVED', entityId: 'abcdefgh-1', payload: { amount: '5000000000000000000000000' } }, {});
  assert.match(d.summary, /5 NEAR/);
});
