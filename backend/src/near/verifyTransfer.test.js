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
const MATCHED = { ok: true, code: 'MATCH' };
const bad = (code) => ({ ok: false, code });
const found = (overrides = {}) => ({
  lookup: LOOKUP.FOUND,
  chainOk: true,
  execution: OK,
  match: MATCHED,
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

  it('fails and releases on a verified execution failure when matchAuthorization says MATCH', () => {
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
        verifyTransfer({ lookup: LOOKUP.FOUND, chainOk: true, execution: bad(code) }),
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

  it('keeps the reservation on every mismatch code', () => {
    for (const code of ['HASH_MISMATCH', 'SIGNER_MISMATCH', 'RECEIVER_MISMATCH', 'ACTIONS_INVALID', 'AMOUNT_MISMATCH']) {
      mismatch(verifyTransfer(found({ match: bad(code) })), R.AUTHORIZATION_MISMATCH);
    }
  });

  it('holds on MALFORMED and BAD_AUTHORIZATION', () => {
    for (const code of ['MALFORMED', 'BAD_AUTHORIZATION']) {
      held(verifyTransfer(found({ match: bad(code) })), R.MALFORMED_EVIDENCE);
    }
  });

  it('holds on unknown match codes and on missing or malformed match results', () => {
    const odd = [
      bad('SOMETHING_NEW'),
      bad('MATCH'), // ok: false with the success code is contradictory
      { ok: true, code: 'OK' }, // success must be exactly MATCH
      { ok: true, code: 'SOMETHING_NEW' },
      undefined, null, {}, 'MATCH', { ok: 1, code: 'MATCH' },
    ];
    for (const match of odd) {
      held(verifyTransfer(found({ match })), R.MALFORMED_EVIDENCE);
    }
  });

  it('never lets a mismatch through, even if execution also failed', () => {
    for (const code of ['HASH_MISMATCH', 'SIGNER_MISMATCH', 'RECEIVER_MISMATCH', 'ACTIONS_INVALID', 'AMOUNT_MISMATCH']) {
      mismatch(
        verifyTransfer(found({ execution: bad('FAILED'), match: bad(code), transferDetailsMatch: true })),
        R.AUTHORIZATION_MISMATCH,
      );
    }
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

describe('verifyTransfer: chain check', () => {
  it('holds when the evidence came from another network', () => {
    held(verifyTransfer(found({ chainOk: false })), R.WRONG_CHAIN);
  });

  it('holds when the chain was not confirmed or the value is not a boolean', () => {
    for (const chainOk of [undefined, null, 'true', 'testnet', 1, 0, {}]) {
      held(verifyTransfer(found({ chainOk })), R.MALFORMED_EVIDENCE);
    }
  });

  it('checks the chain before anything else, even when execution is not final', () => {
    held(
      verifyTransfer({ lookup: LOOKUP.FOUND, chainOk: false, execution: bad('NOT_FINAL') }),
      R.WRONG_CHAIN,
    );
    held(
      verifyTransfer(found({ chainOk: false, execution: bad('FAILED'), match: MATCHED })),
      R.WRONG_CHAIN,
    );
  });

  it('does not affect lookups that found nothing', () => {
    inconclusive(verifyTransfer({ lookup: LOOKUP.NOT_OBSERVED, chainOk: false }), R.NOT_OBSERVED);
  });
});

describe('verifyTransfer: EXECUTION_NOT_OK from matchAuthorization', () => {
  const notOk = (overrides = {}) =>
    found({ execution: bad('FAILED'), match: bad('EXECUTION_NOT_OK'), time: undefined, ...overrides });

  it('fails and releases only when the details were independently confirmed to match', () => {
    expectVerdict(
      verifyTransfer(notOk({ transferDetailsMatch: true })),
      V.FAILED,
      R.EXECUTION_FAILED,
      A.RELEASE_RESERVATION,
    );
  });

  it('is a mismatch when the details do not independently match', () => {
    mismatch(verifyTransfer(notOk({ transferDetailsMatch: false })), R.AUTHORIZATION_MISMATCH);
  });

  it('holds when the independent confirmation was not supplied or is not a boolean', () => {
    for (const transferDetailsMatch of [undefined, null, 'true', 1, 0, {}]) {
      held(verifyTransfer(notOk({ transferDetailsMatch })), R.MALFORMED_EVIDENCE);
    }
    held(verifyTransfer(notOk()), R.MALFORMED_EVIDENCE);
  });

  it('holds when our own execution check disagrees (execution looked fine)', () => {
    held(
      verifyTransfer(found({ match: bad('EXECUTION_NOT_OK'), transferDetailsMatch: true })),
      R.MALFORMED_EVIDENCE,
    );
  });

  it('stays inconclusive when our execution check is not final', () => {
    inconclusive(
      verifyTransfer({ lookup: LOOKUP.FOUND, chainOk: true, execution: bad('NOT_FINAL'), match: bad('EXECUTION_NOT_OK'), transferDetailsMatch: true }),
      R.NOT_FINAL,
    );
  });

  it('holds on a missing receipt or chain error regardless of the match result', () => {
    held(
      verifyTransfer(notOk({ execution: bad('RECEIPT_MISSING'), transferDetailsMatch: true })),
      R.RECEIPT_MISSING,
    );
    held(
      verifyTransfer(notOk({ execution: bad('CHAIN_INVALID'), transferDetailsMatch: true })),
      R.CHAIN_INVALID,
    );
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
  const NOT_OK = bad('EXECUTION_NOT_OK');
  const executions = [OK, bad('NOT_FINAL'), bad('INCOMPLETE'), bad('FAILED'), bad('RECEIPT_MISSING'), bad('CHAIN_INVALID'), bad('MALFORMED'), bad('NEW_CODE'), undefined, null];
  const matches = [MATCHED, NOT_OK, bad('HASH_MISMATCH'), bad('SIGNER_MISMATCH'), bad('AMOUNT_MISMATCH'), bad('MALFORMED'), bad('BAD_AUTHORIZATION'), bad('NEW_CODE'), undefined, null];
  const times = [OK, bad('BLOCK_BEFORE_AUTHORIZATION'), bad('MALFORMED'), undefined, null];
  const hashes = [false, true, undefined, null];
  const details = [true, false, undefined];
  const chains = [true, false, undefined];

  function everyCombination(fn) {
    let count = 0;
    for (const execution of executions) {
      for (const match of matches) {
        for (const time of times) {
          for (const hashAlreadyUsed of hashes) {
            for (const transferDetailsMatch of details) {
              for (const chainOk of chains) {
                const input = { lookup: LOOKUP.FOUND, chainOk, execution, match, time, hashAlreadyUsed, transferDetailsMatch };
                fn(verifyTransfer(input), input);
                count += 1;
              }
            }
          }
        }
      }
    }
    return count;
  }

  it('covers a meaningful number of combinations', () => {
    assert.equal(everyCombination(() => {}), 10 * 10 * 5 * 4 * 3 * 3);
  });

  it('VERIFIED happens only when every check passed', () => {
    everyCombination((res, input) => {
      const allGood =
        input.chainOk === true &&
        input.execution === OK &&
        input.match === MATCHED &&
        input.time === OK &&
        input.hashAlreadyUsed === false;
      assert.equal(res.verdict === V.VERIFIED, allGood);
      assert.equal(res.action === A.MARK_EXECUTED, allGood);
    });
  });

  it('the reservation is released only for a verified failure whose details match', () => {
    everyCombination((res, input) => {
      if (res.action === A.RELEASE_RESERVATION) {
        assert.equal(res.verdict, V.FAILED);
        assert.equal(input.chainOk, true);
        assert.equal(input.execution.code, 'FAILED');
        const matchedByAuthorizer = input.match === MATCHED;
        const matchedIndependently = input.match === NOT_OK && input.transferDetailsMatch === true;
        assert.ok(matchedByAuthorizer || matchedIndependently);
      }
    });
  });

  it('a mismatch, malformed or unknown match code never releases or executes', () => {
    everyCombination((res, input) => {
      const code = input.match?.code;
      const dangerous = [V.VERIFIED, V.FAILED, V.INCONCLUSIVE];
      const blocked = ['HASH_MISMATCH', 'SIGNER_MISMATCH', 'AMOUNT_MISMATCH', 'MALFORMED', 'BAD_AUTHORIZATION', 'NEW_CODE'];
      const executionDecided = input.execution === OK || input.execution?.code === 'FAILED';
      if (executionDecided && (input.match === undefined || input.match === null || blocked.includes(code))) {
        assert.ok(!dangerous.includes(res.verdict), `${res.verdict} for match ${code}`);
      }
    });
  });

  it('inconclusive results never change state, and nothing else claims not to', () => {
    everyCombination((res) => {
      assert.equal(res.changesState, res.verdict !== V.INCONCLUSIVE);
    });
  });

  it('every HOLD and MISMATCH keeps the reservation', () => {
    everyCombination((res) => {
      if (res.verdict === V.HOLD || res.verdict === V.MISMATCH) {
        assert.equal(res.action, A.KEEP_RESERVATION);
      }
    });
  });
});
