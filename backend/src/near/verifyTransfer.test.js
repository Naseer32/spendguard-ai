import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTIONS as A,
  LOOKUP,
  NOT_FOUND_TIMEOUT_MS,
  REASONS as R,
  VERDICTS as V,
  verifyTransfer,
} from './verifyTransfer.js';

const OK = { ok: true, code: 'OK' };
const bad = (code) => ({ ok: false, code });
const found = (overrides = {}) => ({
  lookup: LOOKUP.FOUND,
  execution: OK,
  match: OK,
  time: OK,
  hashAlreadyUsed: false,
  ...overrides,
});

const expectVerdict = (res, verdict, reason, action, changesState = true) => {
  assert.equal(res.verdict, verdict);
  assert.equal(res.reason, reason);
  assert.equal(res.action, action);
  assert.equal(res.changesState, changesState);
};
const inconclusive = (res, reason) => expectVerdict(res, V.INCONCLUSIVE, reason, A.RETRY, false);
const held = (res, reason) => expectVerdict(res, V.HOLD, reason, A.KEEP_RESERVATION);
const mismatch = (res, reason) => expectVerdict(res, V.MISMATCH, reason, A.KEEP_RESERVATION);

describe('verifyTransfer: transaction not observed', () => {
  it('is inconclusive and retries, with no state change', () => {
    inconclusive(verifyTransfer({ lookup: LOOKUP.NOT_OBSERVED }), R.NOT_OBSERVED);
  });

  it('ignores any other evidence in the input', () => {
    inconclusive(
      verifyTransfer({ lookup: LOOKUP.NOT_OBSERVED, execution: bad('FAILED'), match: bad('X') }),
      R.NOT_OBSERVED,
    );
  });
});

describe('verifyTransfer: confirmed not found', () => {
  const at = (submittedAt, now) => ({ lookup: LOOKUP.NOT_FOUND, submittedAt, now });

  it('retries with no state change inside the 30 minute window', () => {
    inconclusive(verifyTransfer(at('2026-11-10T10:00:00Z', '2026-11-10T10:00:00Z')), R.NOT_FOUND_YET);
    inconclusive(verifyTransfer(at('2026-11-10T10:00:00Z', '2026-11-10T10:29:59.999999999Z')), R.NOT_FOUND_YET);
  });

  it('fails and releases the reservation once 30 minutes have passed', () => {
    assert.equal(NOT_FOUND_TIMEOUT_MS, 30 * 60 * 1000);
    expectVerdict(
      verifyTransfer(at('2026-11-10T10:00:00Z', '2026-11-10T10:30:00Z')),
      V.FAILED,
      R.NOT_FOUND_TIMEOUT,
      A.RELEASE_RESERVATION,
    );
    expectVerdict(
      verifyTransfer(at('2026-11-10T10:00:00Z', '2026-11-11T10:00:00Z')),
      V.FAILED,
      R.NOT_FOUND_TIMEOUT,
      A.RELEASE_RESERVATION,
    );
  });

  it('does not release when the clock runs backwards', () => {
    inconclusive(verifyTransfer(at('2026-11-10T10:00:00Z', '2026-11-10T09:00:00Z')), R.NOT_FOUND_YET);
  });

  it('holds, and never releases, when the times are bad or missing', () => {
    held(verifyTransfer(at('yesterday', '2026-11-10T10:30:00Z')), R.MALFORMED_EVIDENCE);
    held(verifyTransfer(at('2026-11-10T10:00:00Z', undefined)), R.MALFORMED_EVIDENCE);
    held(verifyTransfer({ lookup: LOOKUP.NOT_FOUND }), R.MALFORMED_EVIDENCE);
  });
});

describe('verifyTransfer: found transaction', () => {
  it('verifies when execution, match, time and hash uniqueness all pass', () => {
    expectVerdict(verifyTransfer(found()), V.VERIFIED, R.OK, A.MARK_EXECUTED);
  });

  it('fails and releases on a verified execution failure of a matching transaction', () => {
    expectVerdict(
      verifyTransfer(found({ execution: bad('FAILED'), time: undefined })),
      V.FAILED,
      R.EXECUTION_FAILED,
      A.RELEASE_RESERVATION,
    );
  });

  it('is inconclusive when execution is not final or incomplete, needing no other evidence', () => {
    for (const code of ['NOT_FINAL', 'INCOMPLETE']) {
      inconclusive(
        verifyTransfer({ lookup: LOOKUP.FOUND, execution: bad(code) }),
        R.NOT_FINAL,
      );
    }
  });

  it('holds on a missing receipt or an invalid receipt chain', () => {
    held(verifyTransfer(found({ execution: bad('RECEIPT_MISSING') })), R.RECEIPT_MISSING);
    held(verifyTransfer(found({ execution: bad('CHAIN_INVALID') })), R.CHAIN_INVALID);
  });

  it('holds on malformed or unrecognised execution evidence', () => {
    for (const execution of [bad('MALFORMED'), bad('SOMETHING_NEW'), undefined, null, {}, 'ok', { ok: 'yes', code: 'OK' }, { ok: true, code: 'WEIRD' }, { ok: false, code: 'OK' }]) {
      held(verifyTransfer(found({ execution })), R.MALFORMED_EVIDENCE);
    }
  });

  it('keeps the reservation on any authorization mismatch', () => {
    for (const code of ['SIGNER_MISMATCH', 'RECEIVER_MISMATCH', 'AMOUNT_MISMATCH', 'ACTION_MISMATCH', 'ANYTHING_ELSE']) {
      mismatch(verifyTransfer(found({ match: bad(code) })), R.AUTHORIZATION_MISMATCH);
    }
  });

  it('holds when the match evidence is malformed or missing', () => {
    held(verifyTransfer(found({ match: bad('MALFORMED') })), R.MALFORMED_EVIDENCE);
    for (const match of [undefined, null, {}, 'ok', { ok: 1, code: 'OK' }]) {
      held(verifyTransfer(found({ match })), R.MALFORMED_EVIDENCE);
    }
  });

  it('never releases a failed transaction that does not match the authorization', () => {
    mismatch(
      verifyTransfer(found({ execution: bad('FAILED'), match: bad('SIGNER_MISMATCH') })),
      R.AUTHORIZATION_MISMATCH,
    );
    held(verifyTransfer(found({ execution: bad('FAILED'), match: undefined })), R.MALFORMED_EVIDENCE);
  });

  it('keeps the reservation when the block is before the authorization', () => {
    mismatch(
      verifyTransfer(found({ time: bad('BLOCK_BEFORE_AUTHORIZATION') })),
      R.BLOCK_BEFORE_AUTHORIZATION,
    );
  });

  it('holds when the block-time evidence is malformed or missing', () => {
    held(verifyTransfer(found({ time: bad('MALFORMED') })), R.MALFORMED_EVIDENCE);
    for (const time of [undefined, null, {}, 'ok', { ok: true, code: 'WEIRD' }]) {
      held(verifyTransfer(found({ time })), R.MALFORMED_EVIDENCE);
    }
  });

  it('keeps the reservation when the transaction hash is already used', () => {
    mismatch(verifyTransfer(found({ hashAlreadyUsed: true })), R.HASH_ALREADY_USED);
  });

  it('holds when hash uniqueness was not checked', () => {
    for (const hashAlreadyUsed of [undefined, null, 'false', 0, 1]) {
      held(verifyTransfer(found({ hashAlreadyUsed })), R.MALFORMED_EVIDENCE);
    }
  });
});

describe('verifyTransfer: bad input', () => {
  it('holds on an unknown or missing lookup', () => {
    for (const lookup of [undefined, null, 'found', 'MAYBE', 5]) {
      held(verifyTransfer({ lookup }), R.MALFORMED_EVIDENCE);
    }
  });

  it('holds, without throwing, on non-object input', () => {
    for (const v of [undefined, null, 0, 'x', [], true]) {
      held(verifyTransfer(v), R.MALFORMED_EVIDENCE);
    }
  });

  it('never throws on hostile input', () => {
    const hostile = { lookup: LOOKUP.FOUND };
    Object.defineProperty(hostile, 'execution', {
      get() {
        throw new Error('boom');
      },
    });
    held(verifyTransfer(hostile), R.MALFORMED_EVIDENCE);
  });

  it('does not mutate its input and returns frozen results', () => {
    const input = found();
    const before = JSON.stringify(input);
    const res = verifyTransfer(input);
    assert.equal(JSON.stringify(input), before);
    assert.ok(Object.isFrozen(res));
  });
});

describe('verifyTransfer: safety invariants over every combination', () => {
  const executions = [OK, bad('NOT_FINAL'), bad('INCOMPLETE'), bad('FAILED'), bad('RECEIPT_MISSING'), bad('CHAIN_INVALID'), bad('MALFORMED'), bad('NEW_CODE'), undefined, null];
  const matches = [OK, bad('SIGNER_MISMATCH'), bad('AMOUNT_MISMATCH'), bad('MALFORMED'), undefined, null];
  const times = [OK, bad('BLOCK_BEFORE_AUTHORIZATION'), bad('MALFORMED'), undefined, null];
  const hashes = [false, true, undefined, null];

  function everyCombination(fn) {
    let count = 0;
    for (const execution of executions) {
      for (const match of matches) {
        for (const time of times) {
          for (const hashAlreadyUsed of hashes) {
            const input = { lookup: LOOKUP.FOUND, execution, match, time, hashAlreadyUsed };
            fn(verifyTransfer(input), input);
            count += 1;
          }
        }
      }
    }
    return count;
  }

  it('covers a meaningful number of combinations', () => {
    assert.equal(everyCombination(() => {}), 10 * 6 * 5 * 4);
  });

  it('VERIFIED happens only when every check passed', () => {
    everyCombination((res, input) => {
      const allGood =
        input.execution === OK && input.match === OK && input.time === OK && input.hashAlreadyUsed === false;
      assert.equal(res.verdict === V.VERIFIED, allGood);
      assert.equal(res.action === A.MARK_EXECUTED, allGood);
    });
  });

  it('the reservation is released only for a failed transaction that matches the authorization', () => {
    everyCombination((res, input) => {
      if (res.action === A.RELEASE_RESERVATION) {
        assert.equal(res.verdict, V.FAILED);
        assert.equal(input.execution.code, 'FAILED');
        assert.equal(input.match, OK);
      }
    });
  });

  it('inconclusive results never change state, and nothing else claims not to', () => {
    everyCombination((res) => {
      assert.equal(res.changesState, res.verdict !== V.INCONCLUSIVE);
    });
  });

  it('every non-verified, non-failed, non-inconclusive result keeps the reservation', () => {
    everyCombination((res) => {
      if (res.verdict === V.HOLD || res.verdict === V.MISMATCH) {
        assert.equal(res.action, A.KEEP_RESERVATION);
      }
    });
  });
});
