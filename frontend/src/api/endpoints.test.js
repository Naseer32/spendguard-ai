import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApiClient } from './client.js';
import { createEndpoints } from './endpoints.js';

const AID = '11111111-1111-4111-8111-111111111111';
const RID = '22222222-2222-4222-8222-222222222222';
const Y = '5000000000000000000000000';

const agent = (over = {}) => ({
  id: AID, name: 'A', status: 'ACTIVE', sourceAccount: 'src.example',
  dailyBudget: Y, perTxLimit: Y, approvalThreshold: Y,
  createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z', ...over,
});
const payment = (over = {}) => ({
  id: RID, agentId: AID, recipient: 'bob.example', amount: Y, purpose: null,
  decision: 'APPROVAL_REQUIRED', status: 'APPROVAL_REQUIRED', reasonCodes: ['OVER_THRESHOLD'],
  createdAt: '2026-11-01T00:00:00Z', decidedAt: null,
  idempotencyKey: 'SECRET-IDEM', policySnapshot: { x: 1 }, aiProvider: 'x', ...over,
});

function setup(reply) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const r = typeof reply === 'function' ? reply(url, init) : reply;
    return { ok: r.status < 400, status: r.status ?? 200, headers: { get: () => null }, text: async () => JSON.stringify(r.body) };
  };
  const client = createApiClient({ baseUrl: '', getToken: () => 't', fetchImpl });
  return { api: createEndpoints(client), calls };
}
const ok = (data) => ({ status: 200, body: { data } });

test('health requires status ok', async () => {
  assert.equal(await setup(ok({ status: 'ok' })).api.health(), true);
  await assert.rejects(setup(ok({ status: 'bad' })).api.health(), (e) => e.kind === 'shape');
});

test('listAgents maps agents and rejects malformed ones', async () => {
  const { api, calls } = setup(ok({ agents: [agent()] }));
  assert.equal((await api.listAgents())[0].name, 'A');
  assert.equal(calls[0].url, '/api/agents');
  await assert.rejects(setup(ok({ agents: [agent({ dailyBudget: '1.5' })] })).api.listAgents(), (e) => e.kind === 'shape');
  await assert.rejects(setup(ok({})).api.listAgents(), (e) => e.kind === 'shape');
});

test('createAgent and rotateKey return the one-time key and use the right routes', async () => {
  const { api, calls } = setup(ok({ agent: agent(), apiKey: 'sg_key_once' }));
  const made = await api.createAgent({ name: 'A', sourceAccount: 's.example', dailyBudget: Y, perTxLimit: Y, approvalThreshold: Y });
  assert.equal(made.apiKey, 'sg_key_once');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].url, '/api/agents');
  await api.rotateKey(AID);
  assert.equal(calls[1].url, `/api/agents/${AID}/rotate-key`);
  await assert.rejects(setup(ok({ agent: agent() })).api.rotateKey(AID), (e) => e.kind === 'shape');
});

test('limits, pause and resume hit the documented routes', async () => {
  const { api, calls } = setup(ok({ agent: agent() }));
  await api.updateLimits(AID, { dailyBudget: Y, perTxLimit: Y, approvalThreshold: Y });
  await api.pauseAgent(AID);
  await api.resumeAgent(AID);
  assert.deepEqual(calls.map((c) => [c.init.method, c.url]), [
    ['PUT', `/api/agents/${AID}/limits`],
    ['POST', `/api/agents/${AID}/pause`],
    ['POST', `/api/agents/${AID}/resume`],
  ]);
});

test('ids are validated before anything is sent', async () => {
  const { api, calls } = setup(ok({ agent: agent() }));
  await assert.rejects(api.pauseAgent('../x'), (e) => e.kind === 'config');
  await assert.rejects(api.getPayment('nope'), (e) => e.kind === 'config');
  await assert.rejects(api.setRecipient(AID, 'Bad Account!', { listType: 'ALLOW' }), (e) => e.kind === 'config');
  assert.equal(calls.length, 0);
});

test('recipients: list filter, put and delete', async () => {
  const rec = { id: 'r1', agentId: AID, accountId: 'bob.example', listType: 'ALLOW', note: null, createdAt: '2026-11-01T00:00:00Z' };
  const { api, calls } = setup(ok({ recipients: [rec], recipient: rec }));
  assert.equal((await api.listRecipients(AID, 'ALLOW')).length, 1);
  assert.equal(calls[0].url, `/api/agents/${AID}/recipients?list=ALLOW`);
  await api.listRecipients(AID);
  assert.equal(calls[1].url, `/api/agents/${AID}/recipients`);
  await api.setRecipient(AID, 'bob.example', { listType: 'ALLOW', note: null });
  assert.equal(calls[2].url, `/api/agents/${AID}/recipients/bob.example`);
  assert.equal(calls[2].init.body, '{"listType":"ALLOW"}');
  await api.removeRecipient(AID, 'bob.example');
  assert.equal(calls[3].init.method, 'DELETE');
});

test('listPayments passes filters, caps limit at 200 and drops sensitive fields', async () => {
  const { api, calls } = setup(ok({ payments: [payment()] }));
  const [p] = await api.listPayments({ agentId: AID, status: 'APPROVED' });
  assert.equal(calls[0].url, `/api/payments?agentId=${AID}&status=APPROVED&limit=200`);
  assert.equal('idempotencyKey' in p, false);
  assert.equal('policySnapshot' in p, false);
  assert.equal(JSON.stringify(p).includes('SECRET-IDEM'), false);
  await assert.rejects(api.listPayments({ limit: 201 }), (e) => e.kind === 'config');
  await assert.rejects(api.listPayments({ limit: 0 }), (e) => e.kind === 'config');
});

test('getPayment merges the approval comment', async () => {
  const { api } = setup(ok({ payment: payment({ status: 'APPROVED' }), approval: { requestId: RID, decision: 'APPROVE', comment: 'fine' } }));
  const r = await api.getPayment(RID);
  assert.equal(r.payment.decisionComment, 'fine');
  const none = await setup(ok({ payment: payment(), approval: null })).api.getPayment(RID);
  assert.equal(none.payment.decisionComment, null);
  assert.equal(none.approval, null);
});

test('approve/reject send only a comment; a 409 refusal keeps its data', async () => {
  const { api, calls } = setup(ok({ outcome: 'APPROVED', payment: payment({ status: 'APPROVED' }) }));
  const r = await api.approvePayment(RID, 'ok');
  assert.equal(r.payment.status, 'APPROVED');
  assert.equal(calls[0].init.body, '{"comment":"ok"}');
  await api.rejectPayment(RID);
  assert.equal(calls[1].init.body, '{}');
  assert.equal(calls[1].url, `/api/payments/${RID}/reject`);

  const refused = setup({ status: 409, body: { error: { code: 'APPROVAL_REFUSED', message: 'no' }, data: { reasons: ['DAILY_BUDGET_EXCEEDED'] } } });
  await assert.rejects(refused.api.approvePayment(RID), (e) => e.status === 409 && e.data.reasons[0] === 'DAILY_BUDGET_EXCEEDED');
});

test('listAudit validates and maps; hashes are dropped', async () => {
  const entry = { seq: 3, ts: '2026-11-01T00:00:00Z', actor: 'owner', event: 'AGENT_PAUSED', entityId: AID, payload: {}, hash: 'abc', prevHash: 'def' };
  const { api, calls } = setup(ok({ entries: [entry], hasMore: true, nextAfterSeq: 3, head: { seq: 9 } }));
  const r = await api.listAudit({ afterSeq: 2, limit: 50, event: 'AGENT_PAUSED' });
  assert.equal(calls[0].url, '/api/audit?afterSeq=2&limit=50&event=AGENT_PAUSED');
  assert.deepEqual([r.hasMore, r.nextAfterSeq, r.headSeq], [true, 3, 9]);
  assert.equal('hash' in r.entries[0], false);
  await assert.rejects(api.listAudit({ limit: 501 }), (e) => e.kind === 'config');
  await assert.rejects(setup(ok({ entries: [], hasMore: false })).api.listAudit(), (e) => e.kind === 'shape');
});

test('verifyAudit maps the result without hashes', async () => {
  const { api } = setup(ok({ verification: { valid: false, entries: 4, problems: [{ seq: 2, code: 'HASH_MISMATCH', message: 'm', expected: 'x', actual: 'y' }] } }));
  const v = await api.verifyAudit();
  assert.equal(v.valid, false);
  assert.deepEqual(Object.keys(v.problems[0]).sort(), ['code', 'message', 'seq']);
});
