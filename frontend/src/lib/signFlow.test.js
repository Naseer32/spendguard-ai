import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { clearPending, loadPendingFor, savePending, signAndReport, submitReport } from './signFlow.js';

const HASH = 'Ez4F8mJx9kQ2cVbN7rT5wYpL3sHdUaG6nKfXqZvBc';
const NOW = Date.parse('2026-11-13T12:00:00.000Z');
const payment = { id: 'req-1', status: 'APPROVED', recipient: 'merchant.testnet', amount: '2000000000000000000000000', expiresAt: '2026-11-13T12:30:00.000Z' };
const agent = { id: 'a1', sourceAccount: 'agent-src.testnet' };

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) };
}

function harness({ sign, reports = [], status = 'APPROVED', accountId = 'agent-src.testnet', isLive = true, storage = memoryStorage() } = {}) {
  const spy = { sign: [], report: [] };
  const queue = [...reports];
  const signTransfer = async (t) => {
    spy.sign.push(t);
    if (sign instanceof Error) throw sign;
    return sign === undefined ? { transaction: { hash: HASH, signer_id: 'agent-src.testnet' } } : sign;
  };
  const reportTx = async (id, body) => {
    spy.report.push([id, body]);
    return queue.length > 1 ? queue.shift() : queue[0];
  };
  const run = () => signAndReport({ payment: { ...payment, status }, agent, accountId, isLive, signTransfer, reportTx, storage, now: NOW });
  return { spy, run, storage, reportTx };
}
const verdict = (v, st, extra = {}) => ({ ok: true, verdict: v, action: 'X', reason: null, payment: { id: 'req-1', status: st }, ...extra });

describe('signing is restricted before the wallet is touched', () => {
  for (const status of ['APPROVAL_REQUIRED', 'BLOCKED', 'SUBMITTED', 'EXECUTED', 'MISMATCH']) {
    it(`never calls the wallet for ${status}`, async () => {
      const h = harness({ status, reports: [verdict('VERIFIED', 'EXECUTED')] });
      const r = await h.run();
      assert.equal(r.ok, false);
      assert.equal(r.stage, 'guard');
      assert.equal(h.spy.sign.length, 0);
      assert.equal(h.spy.report.length, 0);
    });
  }
  it('never calls the wallet in demo mode, with the wrong wallet, or with no wallet', async () => {
    for (const over of [{ isLive: false }, { accountId: 'other.testnet' }, { accountId: null }]) {
      const h = harness(over);
      assert.equal((await h.run()).stage, 'guard');
      assert.equal(h.spy.sign.length, 0);
    }
  });
});

describe('sign and report', () => {
  it('signs exactly the approved transfer, then reports exactly { txHash, signerId }', async () => {
    const h = harness({ reports: [verdict('VERIFIED', 'EXECUTED')] });
    const r = await h.run();
    assert.deepEqual(h.spy.sign, [{ receiverId: 'merchant.testnet', deposit: '2000000000000000000000000' }]);
    assert.equal(h.spy.report.length, 1);
    const [id, body] = h.spy.report[0];
    assert.equal(id, 'req-1');
    assert.deepEqual(body, { txHash: HASH, signerId: 'agent-src.testnet' });
    assert.deepEqual(Object.keys(body).sort(), ['signerId', 'txHash']);
    assert.equal(r.ok, true);
    assert.equal(r.view.tone, 'success');
    assert.equal(loadPendingFor(h.storage, 'req-1'), null); // settled: nothing left to retry
  });
  it('takes the signer from the wallet outcome when present, else the connected account', async () => {
    const h = harness({ sign: { transaction: { hash: HASH } }, reports: [verdict('VERIFIED', 'EXECUTED')] });
    await h.run();
    assert.equal(h.spy.report[0][1].signerId, 'agent-src.testnet');
  });
  it('reports the status the backend returned, never one of its own', async () => {
    const h = harness({ reports: [verdict('HOLD', 'SUBMITTED')] });
    const r = await h.run();
    assert.equal(r.ok, true);
    assert.equal(r.payment.status, 'SUBMITTED');
    assert.equal(r.view.settled, false);
    assert.notEqual(r.view.tone, 'success');
  });
  it('keeps the hash after HOLD so it can be re-checked, and blocks signing again', async () => {
    const h = harness({ reports: [verdict('HOLD', 'SUBMITTED'), verdict('VERIFIED', 'EXECUTED')] });
    await h.run();
    assert.deepEqual(loadPendingFor(h.storage, 'req-1'), { txHash: HASH, signerId: 'agent-src.testnet' });
    const again = await h.run();
    assert.equal(again.code, 'ALREADY_SENT');
    assert.equal(h.spy.sign.length, 1);
    const retry = await submitReport({ requestId: 'req-1', ...loadPendingFor(h.storage, 'req-1'), reportTx: h.reportTx, storage: h.storage });
    assert.equal(retry.view.tone, 'success');
    assert.equal(loadPendingFor(h.storage, 'req-1'), null);
    assert.deepEqual(h.spy.report[1], h.spy.report[0]); // same hash re-sent
  });
  it('treats MISMATCH as final and not successful', async () => {
    const h = harness({ reports: [verdict('MISMATCH', 'MISMATCH', { reason: 'AMOUNT_DIFFERS' })] });
    const r = await h.run();
    assert.equal(r.view.tone, 'warning');
    assert.equal(r.view.settled, true);
    assert.equal(r.payment.status, 'MISMATCH');
  });
});

describe('errors', () => {
  it('does not report when the wallet rejects', async () => {
    const h = harness({ sign: new Error('User rejected the request') });
    const r = await h.run();
    assert.equal(r.stage, 'wallet');
    assert.equal(r.kind, 'rejected');
    assert.equal(h.spy.report.length, 0);
    assert.equal(loadPendingFor(h.storage, 'req-1'), null);
  });
  it('does not report when the wallet returns no hash, and warns not to resend blindly', async () => {
    const h = harness({ sign: {} });
    const r = await h.run();
    assert.equal(r.kind, 'nohash');
    assert.match(r.message, /wallet history/);
    assert.equal(h.spy.report.length, 0);
  });
  it('keeps the hash and offers a retry when the report fails on the network', async () => {
    const h = harness({ reports: [{ ok: false, kind: 'network', error: 'down' }, verdict('VERIFIED', 'EXECUTED')] });
    const r = await h.run();
    assert.equal(r.ok, false);
    assert.equal(r.stage, 'report');
    assert.equal(r.retryable, true);
    assert.equal(r.txHash, HASH);
    assert.deepEqual(loadPendingFor(h.storage, 'req-1'), { txHash: HASH, signerId: 'agent-src.testnet' });
    const retry = await submitReport({ requestId: 'req-1', txHash: r.txHash, signerId: r.signerId, reportTx: h.reportTx, storage: h.storage });
    assert.equal(retry.ok, true);
    assert.equal(h.spy.sign.length, 1); // never signed twice
  });
  it('maps backend refusals without retrying them', async () => {
    const h = harness({ reports: [{ ok: false, kind: 'client', status: 409, code: 'SIGNER_NOT_SOURCE', error: 'raw' }] });
    const r = await h.run();
    assert.equal(r.retryable, false);
    assert.match(r.message, /source account/);
    assert.ok(loadPendingFor(h.storage, 'req-1')); // the sent transaction is still remembered
  });
  it('works when browser storage is blocked', async () => {
    const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
    const h = harness({ storage: blocked, reports: [verdict('VERIFIED', 'EXECUTED')] });
    assert.equal((await h.run()).ok, true);
    assert.equal(loadPendingFor(null, 'x'), null);
  });
  it('ignores corrupt pending data', () => {
    const s = { getItem: () => '{"req-1":{"txHash":"nope","signerId":5}}', setItem() {} };
    assert.equal(loadPendingFor(s, 'req-1'), null);
    savePending(memoryStorage(), 'a', { txHash: HASH, signerId: 'x.testnet' });
    clearPending(s, 'req-1');
  });
});
