import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createEndpoints } from './endpoints.js';

const ID = '123e4567-e89b-42d3-a456-426614174000';
const HASH = 'Ez4F8mJx9kQ2cVbN7rT5wYpL3sHdUaG6nKfXqZvBc';
const rawPayment = {
  id: ID, agentId: '123e4567-e89b-42d3-a456-426614174001', recipient: 'merchant.testnet', amount: '1000000000000000000000000',
  decision: 'APPROVED', status: 'SUBMITTED', reasonCodes: ['WITHIN_POLICY'], createdAt: '2026-11-13T12:00:00.000Z',
  decidedAt: '2026-11-13T12:00:00.000Z', purpose: null,
};

function fake(data) {
  const calls = [];
  return { calls, client: { async request(args) { calls.push(args); return data; } } };
}

describe('reportTransaction endpoint', () => {
  it('POSTs exactly { txHash, signerId } to the existing tx-report route and returns the backend verdict', async () => {
    const { calls, client } = fake({ verdict: 'HOLD', action: 'HOLD', reason: 'too new', payment: rawPayment });
    const out = await createEndpoints(client).reportTransaction(ID, { txHash: HASH, signerId: 'agent-src.testnet' });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, 'POST');
    assert.equal(calls[0].path, `/api/payments/${ID}/tx-report`);
    assert.deepEqual(calls[0].body, { txHash: HASH, signerId: 'agent-src.testnet' });
    assert.equal(out.verdict, 'HOLD');
    assert.equal(out.payment.status, 'SUBMITTED');
  });
  it('rejects a malformed request id before any request is made', async () => {
    const { calls, client } = fake({});
    await assert.rejects(createEndpoints(client).reportTransaction('nope', { txHash: HASH, signerId: 'a.testnet' }));
    assert.equal(calls.length, 0);
  });
  it('rejects a response without a verdict or payment', async () => {
    for (const data of [null, {}, { verdict: 'VERIFIED' }]) {
      await assert.rejects(createEndpoints(fake(data).client).reportTransaction(ID, { txHash: HASH, signerId: 'a.testnet' }), (e) => e.kind === 'shape');
    }
  });
});
