import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { nearToYocto as N } from '../money/yocto.js';
import { createAgent, pauseAgent } from '../services/agents.js';
import { setRecipient } from '../services/recipients.js';
import { count } from '../testing/dbKit.js';
import { startTestServer } from '../testing/httpKit.js';
import { agentInput, auditEvents, svc } from '../testing/serviceKit.js';
import { HIGH_FAILURE_LIMIT, UUID } from '../testing/testRoutes.js';

const PAYMENT_KEYS = [
  'amount', 'createdAt', 'decidedAt', 'decision', 'expiresAt', 'id',
  'purpose', 'reasonCodes', 'recipient', 'status', 'updatedAt',
];
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const EVALUATE = '/api/v1/payments/evaluate';

async function setup(env = {}) {
  const t = await startTestServer({ env: { ...HIGH_FAILURE_LIMIT, ...env } });
  const a = createAgent(t.db, agentInput({ name: 'Agent A' }), svc());
  const b = createAgent(t.db, agentInput({ name: 'Agent B' }), svc());
  setRecipient(t.db, a.agent.id, { accountId: 'merchant.testnet', listType: 'ALLOW' }, svc());
  return { t, a, b };
}

const evaluate = (t, apiKey, over = {}) =>
  t.request('POST', EVALUATE, {
    token: apiKey,
    json: { idempotencyKey: 'order-12345', recipient: 'merchant.testnet', amount: N('1'), ...over },
  });

describe('evaluating payments', () => {
  let t;
  let a;
  let b;
  before(async () => { ({ t, a, b } = await setup()); });
  after(() => t.close());

  it('approves a payment within policy and returns only the agent-safe view', async () => {
    const res = await evaluate(t, a.apiKey, { purpose: 'secret purpose text' });
    assert.equal(res.status, 201);
    assert.deepEqual(Object.keys(res.json.data).sort(), ['payment', 'replayed']);
    const { payment } = res.json.data;
    assert.equal(res.json.data.replayed, false);
    assert.deepEqual(Object.keys(payment).sort(), [...PAYMENT_KEYS].sort());
    assert.equal(payment.recipient, 'merchant.testnet');
    assert.equal(payment.amount, N('1'));
    assert.equal(payment.purpose, 'secret purpose text');
    assert.equal(payment.decision, 'APPROVED');
    assert.equal(payment.status, 'APPROVED');
    assert.deepEqual(payment.reasonCodes, ['WITHIN_POLICY']);
    for (const field of ['createdAt', 'decidedAt', 'expiresAt', 'updatedAt']) {
      assert.match(payment[field], ISO_RE, field);
    }
    assert.equal(Date.parse(payment.expiresAt) - Date.parse(payment.createdAt), 3_600_000);
    assert.ok(!res.text.includes('policySnapshot'));
    assert.ok(!res.text.includes('idempotencyKey'));
    assert.ok(!res.text.includes('aiExplanation'));
  });

  it('records the evaluation in the audit log under the agent', async () => {
    const event = auditEvents(t.db).filter((e) => e.event === 'PAYMENT_EVALUATED').at(-1);
    assert.equal(event.actor, `agent:${a.agent.id}`);
    assert.equal(event.payload.agentId, a.agent.id);
  });

  it('replays the same request with 200', async () => {
    const first = await evaluate(t, a.apiKey, { idempotencyKey: 'order-replay-1' });
    const again = await evaluate(t, a.apiKey, { idempotencyKey: 'order-replay-1' });
    assert.equal(first.status, 201);
    assert.equal(again.status, 200);
    assert.equal(again.json.data.replayed, true);
    assert.deepEqual(again.json.data.payment, first.json.data.payment);
  });

  it('rejects the same key with a different request', async () => {
    await evaluate(t, a.apiKey, { idempotencyKey: 'order-conflict-1' });
    const res = await evaluate(t, a.apiKey, { idempotencyKey: 'order-conflict-1', amount: N('2') });
    assert.equal(res.status, 409);
    assert.equal(res.json.error.code, 'IDEMPOTENCY_CONFLICT');
  });

  it('returns policy blocks as created requests, not HTTP errors', async () => {
    const over = await evaluate(t, a.apiKey, { idempotencyKey: 'order-over-1', amount: N('21') });
    assert.equal(over.status, 201);
    assert.equal(over.json.data.payment.status, 'BLOCKED');
    assert.deepEqual(over.json.data.payment.reasonCodes, ['EXCEEDS_TX_LIMIT']);
    assert.equal(over.json.data.payment.expiresAt, null);
    const unknown = await evaluate(t, a.apiKey, { idempotencyKey: 'order-new-1', recipient: 'other.testnet' });
    assert.equal(unknown.status, 201);
    assert.equal(unknown.json.data.payment.status, 'APPROVAL_REQUIRED');
    assert.deepEqual(unknown.json.data.payment.reasonCodes, ['RECIPIENT_NOT_ALLOWLISTED']);
    assert.equal(Date.parse(unknown.json.data.payment.expiresAt) - Date.parse(unknown.json.data.payment.createdAt), 86_400_000);
    const zero = await evaluate(t, a.apiKey, { idempotencyKey: 'order-zero-1', amount: '0' });
    assert.equal(zero.json.data.payment.status, 'BLOCKED');
    assert.deepEqual(zero.json.data.payment.reasonCodes, ['ZERO_AMOUNT']);
  });

  it('keeps idempotency keys separate per agent', async () => {
    const forA = await evaluate(t, a.apiKey, { idempotencyKey: 'shared-key-0001' });
    const forB = await evaluate(t, b.apiKey, { idempotencyKey: 'shared-key-0001' });
    assert.equal(forA.status, 201);
    assert.equal(forB.status, 201);
    assert.notEqual(forA.json.data.payment.id, forB.json.data.payment.id);
  });

  it('rejects malformed input without storing anything', async () => {
    const before = count(t.db, 'payment_requests');
    const ok = { idempotencyKey: 'order-bad-0001', recipient: 'merchant.testnet', amount: N('1') };
    const bad = [
      {}, { ...ok, idempotencyKey: 'short' }, { ...ok, recipient: '' }, { ...ok, amount: '1.5' },
      { ...ok, amount: 5 }, { ...ok, amount: '-1' }, { ...ok, purpose: 5 },
      { ...ok, agentId: UUID }, { ...ok, status: 'APPROVED' }, { ...ok, decision: 'APPROVED' },
    ];
    for (const json of bad) {
      const res = await t.request('POST', EVALUATE, { token: a.apiKey, json });
      assert.equal(res.status, 400, JSON.stringify(json));
      assert.equal(res.json.error.code, 'VALIDATION', JSON.stringify(json));
    }
    const arrayBody = await t.request('POST', EVALUATE, {
      token: a.apiKey, body: '[]', headers: { 'content-type': 'application/json' },
    });
    assert.equal(arrayBody.status, 400);
    const noBody = await t.request('POST', EVALUATE, { token: a.apiKey });
    assert.equal(noBody.status, 400);
    assert.equal(noBody.json.error.code, 'VALIDATION');
    const plain = await t.request('POST', EVALUATE, {
      token: a.apiKey, body: '{}', headers: { 'content-type': 'text/plain' },
    });
    assert.equal(plain.status, 415);
    assert.equal(count(t.db, 'payment_requests'), before);
  });

  it('never logs request purposes or keys', () => {
    const text = t.logs.join('\n');
    assert.ok(!text.includes('secret purpose text'));
    assert.ok(!text.includes(a.apiKey));
    assert.ok(!text.includes(a.apiKey.slice(-64)));
  });
});

describe('reading payments', () => {
  let t;
  let a;
  let b;
  before(async () => { ({ t, a, b } = await setup()); });
  after(() => t.close());

  it('returns the agent its own request', async () => {
    const created = await evaluate(t, a.apiKey);
    const id = created.json.data.payment.id;
    const res = await t.request('GET', `/api/v1/payments/${id}`, { token: a.apiKey });
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, { data: { payment: created.json.data.payment } });
  });

  it("hides another agent's request and unknown ids the same way", async () => {
    const created = await evaluate(t, a.apiKey);
    const id = created.json.data.payment.id;
    const other = await t.request('GET', `/api/v1/payments/${id}`, { token: b.apiKey });
    const unknown = await t.request('GET', `/api/v1/payments/${UUID}`, { token: a.apiKey });
    assert.equal(other.status, 404);
    assert.equal(unknown.status, 404);
    assert.deepEqual(other.json, unknown.json);
  });

  it('validates the id', async () => {
    for (const bad of ['abc', '12345', `${UUID}x`]) {
      const res = await t.request('GET', `/api/v1/payments/${bad}`, { token: a.apiKey });
      assert.equal(res.status, 400, bad);
    }
  });
});

describe('a paused agent', () => {
  let t;
  let a;
  before(async () => {
    ({ t, a } = await setup());
    pauseAgent(t.db, a.agent.id, svc());
  });
  after(() => t.close());

  it('can still ask, and is blocked', async () => {
    const res = await evaluate(t, a.apiKey);
    assert.equal(res.status, 201);
    assert.equal(res.json.data.payment.status, 'BLOCKED');
    assert.deepEqual(res.json.data.payment.reasonCodes, ['AGENT_PAUSED']);
  });
});

describe('the evaluate rate limit', () => {
  it('limits each agent separately and only evaluation calls', async () => {
    const { t, a, b } = await setup({ RATE_LIMIT_EVALUATE_PER_MINUTE: '3' });
    try {
      for (let i = 1; i <= 3; i += 1) {
        const res = await evaluate(t, a.apiKey, { idempotencyKey: `rate-key-000${i}` });
        assert.equal(res.status, 201, `call ${i}`);
      }
      const limited = await evaluate(t, a.apiKey, { idempotencyKey: 'rate-key-0004' });
      assert.equal(limited.status, 429);
      assert.equal(limited.json.error.code, 'RATE_LIMITED');
      assert.ok(Number(limited.headers['retry-after']) >= 1);
      const other = await evaluate(t, b.apiKey, { idempotencyKey: 'rate-key-0001' });
      assert.equal(other.status, 201);
      const read = await t.request('GET', `/api/v1/payments/${UUID}`, { token: a.apiKey });
      assert.equal(read.status, 404); // reads are not rate limited by the evaluate limit
    } finally {
      await t.close();
    }
  });
});
