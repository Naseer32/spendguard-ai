import assert from 'node:assert/strict';
import { test } from 'node:test';
import { newIdempotencyKey, validatePaymentRequest } from './paymentRequest.js';

const AGENT = { id: '11111111-2222-4333-8444-555555555555' };
const KEY = `sgk_${AGENT.id}_${'a'.repeat(64)}`;
const good = { recipient: 'bob.testnet', amount: '0.1', purpose: ' coffee ', agentKey: KEY };

test('a valid request becomes exact yocto and trimmed text', () => {
  const r = validatePaymentRequest(good, AGENT);
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, { recipient: 'bob.testnet', amount: '100000000000000000000000', purpose: 'coffee', agentKey: KEY });
});

test('purpose is optional', () => {
  assert.equal(validatePaymentRequest({ ...good, purpose: '' }, AGENT).value.purpose, null);
});

test('rejects a bad recipient, amount, purpose and key with a field message', () => {
  for (const [patch, field] of [
    [{ recipient: '' }, 'recipient'],
    [{ recipient: 'Bad Account' }, 'recipient'],
    [{ amount: '0' }, 'amount'],
    [{ amount: '-1' }, 'amount'],
    [{ amount: '1e3' }, 'amount'],
    [{ amount: '' }, 'amount'],
    [{ purpose: 'x'.repeat(501) }, 'purpose'],
    [{ purpose: 'a\u0000b' }, 'purpose'],
    [{ agentKey: '' }, 'agentKey'],
    [{ agentKey: 'nope' }, 'agentKey'],
  ]) {
    const r = validatePaymentRequest({ ...good, ...patch }, AGENT);
    assert.equal(r.ok, false, JSON.stringify(patch));
    assert.ok(r.errors[field], `expected an error on ${field}`);
  }
});

test("rejects another agent's key", () => {
  const other = `sgk_99999999-2222-4333-8444-555555555555_${'b'.repeat(64)}`;
  assert.match(validatePaymentRequest({ ...good, agentKey: other }, AGENT).errors.agentKey, /different agent/);
});

test('idempotency keys satisfy the backend rule and differ each time', () => {
  const a = newIdempotencyKey();
  assert.match(a, /^[A-Za-z0-9._:-]{8,128}$/);
  assert.notEqual(a, newIdempotencyKey());
});
