import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { transferDetailsMatch } from './transferDetails.js';
import { matchAuthorization } from './matchAuthorization.js';
import { checkExecution } from './executionOutcome.js';

// Synthetic data shaped like a real NEAR `tx` result for a native transfer.
const HASH = '4yxED39oZ2toc5GTDpjzVHscTJnXiKZQ4t4HRQKPkHfM';
const SOURCE = 'steephat8707.testnet';
const RECIPIENT = 'sickzone9097.testnet';
const AMOUNT = '100000000000000000000000'; // 0.1 NEAR

const ok = (receiptIds = []) => ({ status: { SuccessValue: '' }, receipt_ids: receiptIds });

function baseResult() {
  return {
    final_execution_status: 'FINAL',
    status: { SuccessValue: '' },
    transaction: {
      hash: HASH,
      signer_id: SOURCE,
      receiver_id: RECIPIENT,
      actions: [{ Transfer: { deposit: AMOUNT } }],
    },
    transaction_outcome: {
      id: HASH,
      block_hash: 'BLOCK',
      outcome: { status: { SuccessReceiptId: 'R1' }, receipt_ids: ['R1'] },
    },
    receipts_outcome: [
      { id: 'R1', block_hash: 'BLOCK', outcome: ok(['R2']) },
      { id: 'R2', block_hash: 'BLOCK', outcome: ok() },
    ],
  };
}

const baseAuth = () => ({ txHash: HASH, signerId: SOURCE, receiverId: RECIPIENT, amount: AMOUNT });

// Make the transaction FAIL (a receipt fails) without touching its details.
function failExecution(result) {
  result.receipts_outcome[0].outcome.status = { Failure: { ActionError: {} } };
  return result;
}

const clone = (v) => structuredClone(v);
const lastCharChanged = (s) => s.slice(0, -1) + (s.endsWith('M') ? 'N' : 'M');

describe('transferDetailsMatch', () => {
  it('is true when hash, signer, receiver, action and amount all match', () => {
    assert.equal(transferDetailsMatch(baseResult(), baseAuth()), true);
  });

  it('is true even when the transaction failed (it ignores execution status)', () => {
    assert.equal(transferDetailsMatch(failExecution(baseResult()), baseAuth()), true);
  });

  it('is false for each single difference', () => {
    const cases = {
      'tx hash differs': (r) => { r.transaction.hash = lastCharChanged(HASH); },
      'outcome id differs': (r) => { r.transaction_outcome.id = lastCharChanged(HASH); },
      'signer differs': (r) => { r.transaction.signer_id = 'other.testnet'; },
      'receiver differs': (r) => { r.transaction.receiver_id = 'other.testnet'; },
      'reversed direction': (r) => { r.transaction.signer_id = RECIPIENT; r.transaction.receiver_id = SOURCE; },
      'two actions': (r) => { r.transaction.actions.push({ Transfer: { deposit: AMOUNT } }); },
      'no actions': (r) => { r.transaction.actions = []; },
      'actions is not an array': (r) => { r.transaction.actions = { Transfer: { deposit: AMOUNT } }; },
      'not a transfer': (r) => { r.transaction.actions = [{ Stake: { stake: AMOUNT } }]; },
      'extra key on the action': (r) => { r.transaction.actions[0].Extra = 1; },
      'extra key on the transfer': (r) => { r.transaction.actions[0].Transfer.extra = 1; },
      'empty transfer': (r) => { r.transaction.actions[0].Transfer = {}; },
      'null transfer': (r) => { r.transaction.actions[0].Transfer = null; },
      'deposit one yocto more': (r) => { r.transaction.actions[0].Transfer.deposit = '100000000000000000000001'; },
      'deposit one yocto less': (r) => { r.transaction.actions[0].Transfer.deposit = '99999999999999999999999'; },
      'deposit zero': (r) => { r.transaction.actions[0].Transfer.deposit = '0'; },
      'deposit is a number': (r) => { r.transaction.actions[0].Transfer.deposit = 1e23; },
      'deposit has a leading zero': (r) => { r.transaction.actions[0].Transfer.deposit = '0100000000000000000000000'; },
      'deposit has 41 digits': (r) => { r.transaction.actions[0].Transfer.deposit = '1'.repeat(41); },
      'deposit is not digits': (r) => { r.transaction.actions[0].Transfer.deposit = '0.1'; },
      'transaction missing': (r) => { delete r.transaction; },
      'transaction is null': (r) => { r.transaction = null; },
      'transaction is an array': (r) => { r.transaction = []; },
      'transaction_outcome missing': (r) => { delete r.transaction_outcome; },
    };
    for (const [name, mutate] of Object.entries(cases)) {
      const result = baseResult();
      mutate(result);
      assert.equal(transferDetailsMatch(result, baseAuth()), false, name);
      assert.equal(transferDetailsMatch(failExecution(result), baseAuth()), false, `${name} (failed)`);
    }
  });

  it('compares amounts exactly beyond Number precision', () => {
    const big = '9007199254740993'; // 2^53 + 1
    const result = baseResult();
    result.transaction.actions[0].Transfer.deposit = big;
    assert.equal(transferDetailsMatch(result, { ...baseAuth(), amount: big }), true);
    assert.equal(transferDetailsMatch(result, { ...baseAuth(), amount: '9007199254740992' }), false);
    const forty = `9${'0'.repeat(39)}`;
    result.transaction.actions[0].Transfer.deposit = forty;
    assert.equal(transferDetailsMatch(result, { ...baseAuth(), amount: forty }), true);
  });

  it('is false for an invalid authorization', () => {
    const badAuths = {
      'amount differs by one': { ...baseAuth(), amount: '100000000000000000000001' },
      'amount zero': { ...baseAuth(), amount: '0' },
      'amount leading zero': { ...baseAuth(), amount: '0100000000000000000000000' },
      'amount is a number': { ...baseAuth(), amount: 1e23 },
      'amount has 41 digits': { ...baseAuth(), amount: '1'.repeat(41) },
      'hash too short': { ...baseAuth(), txHash: 'abc' },
      'hash has an invalid character': { ...baseAuth(), txHash: `0${HASH.slice(1)}` },
      'signer empty': { ...baseAuth(), signerId: '' },
      'signer too long': { ...baseAuth(), signerId: 'a'.repeat(65) },
      'receiver missing': { txHash: HASH, signerId: SOURCE, amount: AMOUNT },
      'extra key': { ...baseAuth(), memo: 'x' },
      null: null,
      undefined,
      array: [],
      string: 'auth',
    };
    for (const [name, auth] of Object.entries(badAuths)) {
      assert.equal(transferDetailsMatch(baseResult(), auth), false, name);
    }
  });

  it('is false, and never throws, for a malformed result', () => {
    for (const r of [undefined, null, 0, 'x', [], true, {}]) {
      assert.equal(transferDetailsMatch(r, baseAuth()), false);
    }
  });

  it('never throws on hostile input', () => {
    const hostile = baseResult();
    Object.defineProperty(hostile, 'transaction', {
      get() {
        throw new Error('boom');
      },
    });
    assert.equal(transferDetailsMatch(hostile, baseAuth()), false);
    const hostileAuth = baseAuth();
    Object.defineProperty(hostileAuth, 'amount', {
      get() {
        throw new Error('boom');
      },
      enumerable: true,
    });
    assert.equal(transferDetailsMatch(baseResult(), hostileAuth), false);
  });

  it('does not mutate its inputs and returns a strict boolean', () => {
    const result = baseResult();
    const auth = baseAuth();
    const before = JSON.stringify([result, auth]);
    assert.equal(typeof transferDetailsMatch(result, auth), 'boolean');
    assert.equal(JSON.stringify([result, auth]), before);
  });
});

describe('transferDetailsMatch stays in step with matchAuthorization', () => {
  // Every case is run with a successful transaction and with a failed one.
  // On success the two must agree exactly. On failure matchAuthorization stops
  // at EXECUTION_NOT_OK (or BAD_AUTHORIZATION), while transferDetailsMatch must
  // give the same answer as it did for the successful version.
  const resultCases = {
    'unchanged': () => {},
    'tx hash differs': (r) => { r.transaction.hash = lastCharChanged(HASH); },
    'outcome id differs': (r) => { r.transaction_outcome.id = lastCharChanged(HASH); },
    'signer differs': (r) => { r.transaction.signer_id = 'other.testnet'; },
    'receiver differs': (r) => { r.transaction.receiver_id = 'other.testnet'; },
    'two actions': (r) => { r.transaction.actions.push({ Transfer: { deposit: AMOUNT } }); },
    'no actions': (r) => { r.transaction.actions = []; },
    'not a transfer': (r) => { r.transaction.actions = [{ Stake: {} }]; },
    'extra key on the transfer': (r) => { r.transaction.actions[0].Transfer.extra = 1; },
    'deposit one more': (r) => { r.transaction.actions[0].Transfer.deposit = '100000000000000000000001'; },
    'deposit is a number': (r) => { r.transaction.actions[0].Transfer.deposit = 1e23; },
    'deposit leading zero': (r) => { r.transaction.actions[0].Transfer.deposit = '0100000000000000000000000'; },
    'deposit zero': (r) => { r.transaction.actions[0].Transfer.deposit = '0'; },
    'transaction is null': (r) => { r.transaction = null; },
    'transaction missing': (r) => { delete r.transaction; },
    'outcome missing': (r) => { delete r.transaction_outcome; },
  };
  const authCases = {
    'valid': baseAuth(),
    'amount differs by one': { ...baseAuth(), amount: '100000000000000000000001' },
    'amount zero': { ...baseAuth(), amount: '0' },
    'amount is a number': { ...baseAuth(), amount: 1e23 },
    'bad hash': { ...baseAuth(), txHash: 'abc' },
    'extra key': { ...baseAuth(), memo: 'x' },
    'missing receiver': { txHash: HASH, signerId: SOURCE, amount: AMOUNT },
    'null': null,
  };

  it('agrees with matchAuthorization on every successful transaction', () => {
    let checked = 0;
    for (const [rName, mutate] of Object.entries(resultCases)) {
      for (const [aName, auth] of Object.entries(authCases)) {
        const result = baseResult();
        mutate(result);
        const expected = matchAuthorization(clone(result), auth).ok;
        assert.equal(transferDetailsMatch(result, auth), expected, `${rName} / ${aName}`);
        checked += 1;
      }
    }
    assert.equal(checked, Object.keys(resultCases).length * Object.keys(authCases).length);
  });

  it('gives the same answer for a failed transaction, where matchAuthorization stops early', () => {
    for (const [rName, mutate] of Object.entries(resultCases)) {
      for (const [aName, auth] of Object.entries(authCases)) {
        const okResult = baseResult();
        mutate(okResult);
        const failedResult = failExecution(clone(okResult));
        assert.equal(
          transferDetailsMatch(failedResult, auth),
          transferDetailsMatch(okResult, auth),
          `${rName} / ${aName}`,
        );
        const code = matchAuthorization(clone(failedResult), auth).code;
        assert.ok(['EXECUTION_NOT_OK', 'BAD_AUTHORIZATION'].includes(code), `${rName} / ${aName}: ${code}`);
      }
    }
  });

  it('uses a successful-execution base the execution check accepts', () => {
    assert.equal(checkExecution(baseResult()).ok, true);
    assert.equal(checkExecution(failExecution(baseResult())).ok, false);
  });
});
