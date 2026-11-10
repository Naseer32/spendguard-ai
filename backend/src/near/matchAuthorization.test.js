import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { matchAuthorization, MATCH_CODES as M } from './matchAuthorization.js';
import {
  DEPOSIT,
  FIXTURE_FILES,
  RECIPIENT_ACCOUNT,
  REVERSE_TX_HASH,
  SOURCE_ACCOUNT,
  SUCCESS_TX_HASH,
  loadFixture,
} from '../testing/nearFixtures.js';

const auth = (o = {}) => ({
  txHash: SUCCESS_TX_HASH,
  signerId: SOURCE_ACCOUNT,
  receiverId: RECIPIENT_ACCOUNT,
  amount: DEPOSIT,
  ...o,
});
const real = () => structuredClone(loadFixture(FIXTURE_FILES.success));
const expectFail = (res, code) => {
  assert.equal(res.ok, false);
  assert.equal(res.code, code);
};

describe('matchAuthorization: real successful transfer', () => {
  it('matches the real transaction', () => {
    const res = matchAuthorization(real(), auth());
    assert.equal(res.ok, true);
    assert.equal(res.code, M.MATCH);
  });

  it('matches the real transaction from the receipts lookup', () => {
    const res = matchAuthorization(loadFixture(FIXTURE_FILES.successReceipts), auth());
    assert.equal(res.ok, true);
  });

  it('does not mutate its inputs', () => {
    const r = real();
    const a = auth();
    const before = JSON.stringify([r, a]);
    matchAuthorization(r, a);
    assert.equal(JSON.stringify([r, a]), before);
  });

  it('rejects the wrong hash, signer, receiver and amount', () => {
    expectFail(matchAuthorization(real(), auth({ txHash: REVERSE_TX_HASH })), M.HASH_MISMATCH);
    expectFail(matchAuthorization(real(), auth({ signerId: RECIPIENT_ACCOUNT })), M.SIGNER_MISMATCH);
    expectFail(matchAuthorization(real(), auth({ receiverId: SOURCE_ACCOUNT })), M.RECEIVER_MISMATCH);
    expectFail(matchAuthorization(real(), auth({ amount: (BigInt(DEPOSIT) + 1n).toString() })), M.AMOUNT_MISMATCH);
    expectFail(matchAuthorization(real(), auth({ amount: (BigInt(DEPOSIT) - 1n).toString() })), M.AMOUNT_MISMATCH);
  });

  it('trusts the response, not the authorization, when the response is altered', () => {
    const a = real(); a.transaction.hash = REVERSE_TX_HASH;
    expectFail(matchAuthorization(a, auth()), M.HASH_MISMATCH);
    const b = real(); b.transaction_outcome.id = REVERSE_TX_HASH;
    expectFail(matchAuthorization(b, auth()), M.HASH_MISMATCH);
    const c = real(); c.transaction.signer_id = RECIPIENT_ACCOUNT;
    expectFail(matchAuthorization(c, auth()), M.SIGNER_MISMATCH);
    const d = real(); d.transaction.receiver_id = SOURCE_ACCOUNT;
    expectFail(matchAuthorization(d, auth()), M.RECEIVER_MISMATCH);
    const e = real(); e.transaction.actions[0].Transfer.deposit = '1';
    expectFail(matchAuthorization(e, auth()), M.AMOUNT_MISMATCH);
  });
});

describe('matchAuthorization: the real reverse transfer', () => {
  it('never matches an authorization for the source account', () => {
    const res = matchAuthorization(loadFixture(FIXTURE_FILES.reverse), auth({ txHash: REVERSE_TX_HASH }));
    assert.equal(res.ok, false);
    assert.ok([M.SIGNER_MISMATCH, M.EXECUTION_NOT_OK].includes(res.code));
  });
});

describe('matchAuthorization: actions', () => {
  it('requires exactly one plain Transfer', () => {
    const two = real(); two.transaction.actions = [two.transaction.actions[0], two.transaction.actions[0]];
    expectFail(matchAuthorization(two, auth()), M.ACTIONS_INVALID);

    const none = real(); none.transaction.actions = [];
    expectFail(matchAuthorization(none, auth()), M.ACTIONS_INVALID);

    const call = real(); call.transaction.actions = [{ FunctionCall: { method_name: 'x', args: '', gas: 1, deposit: DEPOSIT } }];
    expectFail(matchAuthorization(call, auth()), M.ACTIONS_INVALID);

    const extra = real(); extra.transaction.actions = [{ Transfer: { deposit: DEPOSIT, extra: 1 } }];
    expectFail(matchAuthorization(extra, auth()), M.ACTIONS_INVALID);

    const num = real(); num.transaction.actions = [{ Transfer: { deposit: 1e23 } }];
    expectFail(matchAuthorization(num, auth()), M.ACTIONS_INVALID);

    const zeros = real(); zeros.transaction.actions = [{ Transfer: { deposit: `0${DEPOSIT}` } }];
    expectFail(matchAuthorization(zeros, auth()), M.ACTIONS_INVALID);

    const notArray = real(); notArray.transaction.actions = { Transfer: { deposit: DEPOSIT } };
    expectFail(matchAuthorization(notArray, auth()), M.ACTIONS_INVALID);
  });
});

describe('matchAuthorization: execution must pass first', () => {
  it('rejects a failed receipt even when everything else matches', () => {
    const r = real();
    r.receipts_outcome[0].outcome.status = { Failure: {} };
    const res = matchAuthorization(r, auth());
    expectFail(res, M.EXECUTION_NOT_OK);
    assert.equal(res.executionCode, 'FAILED');
  });

  it('rejects a result that is not final', () => {
    const r = real();
    r.final_execution_status = 'EXECUTED';
    const res = matchAuthorization(r, auth());
    expectFail(res, M.EXECUTION_NOT_OK);
    assert.equal(res.executionCode, 'NOT_FINAL');
  });

  it('rejects a missing transaction object', () => {
    const r = real(); delete r.transaction;
    expectFail(matchAuthorization(r, auth()), M.MALFORMED);
  });
});

describe('matchAuthorization: bad authorization', () => {
  const bad = [
    null, undefined, 'x', 5, [], {},
    { ...auth(), extra: 1 },
    { ...auth(), txHash: 'abc' },
    { ...auth(), txHash: 5 },
    { ...auth(), signerId: '' },
    { ...auth(), receiverId: null },
    { ...auth(), signerId: 'a'.repeat(65) },
    { ...auth(), amount: '0' },
    { ...auth(), amount: '01' },
    { ...auth(), amount: 1 },
    { ...auth(), amount: '-1' },
    { ...auth(), amount: '1.5' },
    { ...auth(), amount: '1'.repeat(41) },
  ];
  bad.forEach((a, i) => {
    it(`rejects bad authorization #${i}`, () => {
      expectFail(matchAuthorization(real(), a), M.BAD_AUTHORIZATION);
    });
  });
});

describe('matchAuthorization: captured RPC timeout and hostile input', () => {
  it('never matches the captured HANDLER_ERROR / TIMEOUT_ERROR / NOT_OBSERVED response', () => {
    const response = loadFixture(FIXTURE_FILES.rpcTimeout);
    for (const input of [response, response.error, null]) {
      const res = matchAuthorization(input, auth());
      assert.equal(res.ok, false);
      assert.notEqual(res.code, M.MATCH);
      assert.equal(res.code, M.EXECUTION_NOT_OK);
    }
  });

  it('never throws on hostile input', () => {
    const hostile = [undefined, null, 0, 'x', [], {}, () => {}, Symbol('s'), 10n, { get transaction() { throw new Error('x'); } }];
    for (const r of hostile) {
      for (const a of [auth(), undefined, null, { get txHash() { throw new Error('x'); } }]) {
        assert.doesNotThrow(() => matchAuthorization(r, a));
        assert.equal(matchAuthorization(r, a).ok, false);
      }
    }
  });
});
