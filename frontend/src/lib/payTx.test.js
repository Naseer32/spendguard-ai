import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTransfer, describeReportFailure, describeVerdict, describeWalletError,
  extractSignerId, extractTxHash, isTxHash, signEligibility,
} from './payTx.js';

const HASH = 'Ez4F8mJx9kQ2cVbN7rT5wYpL3sHdUaG6nKfXqZvBc';
const NOW = Date.parse('2026-11-13T12:00:00.000Z');
const payment = { id: 'p1', status: 'APPROVED', recipient: 'merchant.testnet', amount: '1000000000000000000000000', expiresAt: '2026-11-13T12:30:00.000Z' };
const agent = { id: 'a1', sourceAccount: 'agent-src.testnet' };
const ok = (over = {}) => signEligibility({ payment, agent, accountId: 'agent-src.testnet', isLive: true, now: NOW, ...over });

describe('signing restrictions', () => {
  it('allows an APPROVED, unexpired payment from the agent source account', () => {
    assert.deepEqual(ok(), { ok: true });
  });
  it('blocks every status except APPROVED', () => {
    for (const status of ['APPROVAL_REQUIRED', 'BLOCKED', 'REJECTED', 'EXPIRED', 'CANCELLED', 'SUBMITTED', 'EXECUTED', 'FAILED', 'MISMATCH', 'PENDING']) {
      const r = ok({ payment: { ...payment, status } });
      assert.equal(r.ok, false, status);
      assert.equal(r.code, 'NOT_APPROVED', status);
    }
  });
  it('blocks demo mode, missing wallet, wrong wallet, unknown agent', () => {
    assert.equal(ok({ isLive: false }).code, 'DEMO');
    assert.equal(ok({ accountId: null }).code, 'NO_WALLET');
    assert.equal(ok({ accountId: 'someone.testnet' }).code, 'WRONG_ACCOUNT');
    assert.equal(ok({ agent: undefined }).code, 'NO_AGENT');
  });
  it('blocks an expired or unparseable authorization window', () => {
    assert.equal(ok({ now: Date.parse('2026-11-13T12:30:00.000Z') }).code, 'EXPIRED');
    assert.equal(ok({ payment: { ...payment, expiresAt: 'garbage' } }).code, 'EXPIRED');
  });
  it('blocks bad amounts and recipients', () => {
    for (const amount of ['0', '01', '-5', '1.5', 5, null]) assert.equal(ok({ payment: { ...payment, amount } }).code, 'BAD_AMOUNT', String(amount));
    assert.equal(ok({ payment: { ...payment, recipient: '' } }).code, 'BAD_RECIPIENT');
  });
});

describe('the authorized transfer', () => {
  it('is exactly the approved recipient and amount', () => {
    const t = buildTransfer(payment);
    assert.deepEqual(t, { receiverId: 'merchant.testnet', deposit: '1000000000000000000000000' });
    assert.ok(Object.isFrozen(t));
  });
  it('refuses invalid payments', () => {
    assert.throws(() => buildTransfer({ ...payment, amount: '0' }));
    assert.throws(() => buildTransfer({ ...payment, recipient: '' }));
    assert.throws(() => buildTransfer(null));
  });
});

describe('reading the wallet outcome', () => {
  it('finds the hash and signer in a FinalExecutionOutcome', () => {
    assert.equal(extractTxHash({ transaction: { hash: HASH, signer_id: 'agent-src.testnet' } }), HASH);
    assert.equal(extractTxHash({ transaction_outcome: { id: HASH } }), HASH);
    assert.equal(extractSignerId({ transaction: { signer_id: 'agent-src.testnet' } }), 'agent-src.testnet');
  });
  it('rejects anything that is not a hash', () => {
    for (const o of [undefined, null, {}, { transaction: { hash: 'short' } }, { transaction: { hash: `${HASH}0` } }, { transaction: { hash: 5 } }]) {
      assert.equal(extractTxHash(o), null);
    }
    assert.ok(isTxHash(HASH));
  });
});

describe('backend verdicts', () => {
  it('shows success only when the backend status is EXECUTED', () => {
    const v = describeVerdict({ verdict: 'VERIFIED', payment: { status: 'EXECUTED' } });
    assert.equal(v.tone, 'success');
    assert.equal(v.settled, true);
    const odd = describeVerdict({ verdict: 'VERIFIED', payment: { status: 'SUBMITTED' } });
    assert.equal(odd.tone, 'neutral');
    assert.equal(odd.settled, false);
  });
  it('treats HOLD and INCONCLUSIVE as unsettled and retryable', () => {
    for (const verdict of ['HOLD', 'INCONCLUSIVE', 'SOMETHING_NEW']) {
      const v = describeVerdict({ verdict, payment: { status: 'SUBMITTED' } });
      assert.equal(v.settled, false, verdict);
      assert.equal(v.retry, true, verdict);
    }
  });
  it('treats MISMATCH and FAILED as settled, with no retry', () => {
    for (const verdict of ['MISMATCH', 'FAILED']) {
      const v = describeVerdict({ verdict, payment: { status: verdict } });
      assert.equal(v.settled, true);
      assert.equal(v.retry, false);
      assert.notEqual(v.tone, 'success');
    }
  });
});

describe('errors', () => {
  it('separates a wallet rejection from unknown failures', () => {
    assert.equal(describeWalletError(new Error('User rejected the request')).kind, 'rejected');
    assert.equal(describeWalletError({ name: 'WalletError', message: 'User closed the window' }).kind, 'rejected');
    assert.equal(describeWalletError(new Error('fetch failed')).kind, 'network');
    const other = describeWalletError(new Error('secret internal text'));
    assert.equal(other.kind, 'wallet');
    assert.ok(!other.message.includes('secret'));
    assert.match(other.message, /may have been sent/);
  });
  it('retries only transient report failures', () => {
    for (const kind of ['network', 'timeout', 'server', 'rate', 'shape']) assert.equal(describeReportFailure({ kind }).retryable, true, kind);
    assert.equal(describeReportFailure({ kind: 'auth' }).retryable, false);
    const c = describeReportFailure({ kind: 'client', status: 409, code: 'SIGNER_NOT_SOURCE', error: 'x' });
    assert.equal(c.retryable, false);
    assert.match(c.message, /source account/);
    assert.equal(describeReportFailure({ kind: 'client', error: 'Plain backend text' }).message, 'Plain backend text');
  });
});
