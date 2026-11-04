import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { YoctoError, nearToYocto as N } from '../money/yocto.js';
import { AGENT_STATUS } from './reasonCodes.js';
import { evaluatePayment } from './engine.js';
import { utcBudgetDay, isBudgetDay, remainingBudget } from './budget.js';

const utc = (y, m, d, h = 0, min = 0, s = 0, ms = 0) =>
  Date.UTC(y, m - 1, d, h, min, s, ms);

describe('utcBudgetDay', () => {
  it('maps the epoch to 1970-01-01', () => {
    assert.equal(utcBudgetDay(0), '1970-01-01');
  });

  it('returns the UTC date for a normal timestamp', () => {
    assert.equal(utcBudgetDay(utc(2026, 11, 4, 12, 30)), '2026-11-04');
  });

  it('rolls over exactly at UTC midnight', () => {
    assert.equal(utcBudgetDay(utc(2026, 11, 4, 23, 59, 59, 999)), '2026-11-04');
    assert.equal(utcBudgetDay(utc(2026, 11, 5, 0, 0, 0, 0)), '2026-11-05');
    assert.equal(utcBudgetDay(utc(2026, 11, 4, 0, 0, 0, 0)), '2026-11-04');
    assert.equal(utcBudgetDay(utc(2026, 11, 3, 23, 59, 59, 999)), '2026-11-03');
  });

  it('handles month and year boundaries', () => {
    assert.equal(utcBudgetDay(utc(2026, 12, 31, 23, 59, 59, 999)), '2026-12-31');
    assert.equal(utcBudgetDay(utc(2027, 1, 1)), '2027-01-01');
    assert.equal(utcBudgetDay(utc(2026, 1, 31, 23, 59, 59, 999)), '2026-01-31');
    assert.equal(utcBudgetDay(utc(2026, 2, 1)), '2026-02-01');
  });

  it('handles leap days', () => {
    assert.equal(utcBudgetDay(utc(2028, 2, 29, 12)), '2028-02-29');
    assert.equal(utcBudgetDay(utc(2028, 3, 1)), '2028-03-01');
    assert.equal(utcBudgetDay(utc(2027, 3, 1)), '2027-03-01');
  });

  it('accepts the maximum supported timestamp', () => {
    assert.equal(utcBudgetDay(253402300799999), '9999-12-31');
  });

  it('rejects invalid timestamps', () => {
    const bad = [
      NaN, Infinity, -Infinity, 1.5, -1, 253402300800000,
      '0', null, undefined, 10n, {}, [],
    ];
    for (const value of bad) {
      assert.throws(() => utcBudgetDay(value), RangeError, String(value));
    }
  });
});

describe('isBudgetDay', () => {
  it('accepts real calendar dates', () => {
    for (const v of ['2026-11-04', '1970-01-01', '2028-02-29', '9999-12-31']) {
      assert.equal(isBudgetDay(v), true, v);
    }
  });

  it('rejects impossible or malformed dates', () => {
    const bad = [
      '2027-02-29', '2026-02-30', '2026-13-01', '2026-00-10', '2026-11-00',
      '2026-11-31', '2026-1-4', '26-11-04', '2026/11/04', '2026-11-04T00:00',
      ' 2026-11-04', '', null, undefined, 20261104,
    ];
    for (const v of bad) {
      assert.equal(isBudgetDay(v), false, String(v));
    }
  });

  it('accepts everything utcBudgetDay produces', () => {
    for (const ms of [0, utc(2026, 11, 4), utc(2028, 2, 29, 23, 59, 59, 999), 253402300799999]) {
      assert.equal(isBudgetDay(utcBudgetDay(ms)), true);
    }
  });
});

describe('remainingBudget', () => {
  it('subtracts reserved from budget', () => {
    assert.equal(remainingBudget(N('100'), N('30')), N('70'));
    assert.equal(remainingBudget(N('100'), '0'), N('100'));
  });

  it('returns zero when exactly used', () => {
    assert.equal(remainingBudget(N('100'), N('100')), '0');
  });

  it('never goes negative when over-reserved', () => {
    assert.equal(remainingBudget(N('100'), N('150')), '0');
    assert.equal(remainingBudget(N('100'), N('100') + '0'), '0');
  });

  it('handles a zero budget', () => {
    assert.equal(remainingBudget('0', '0'), '0');
    assert.equal(remainingBudget('0', '1'), '0');
  });

  it('is exact beyond float precision', () => {
    assert.equal(remainingBudget('9007199254740993', '1'), '9007199254740992');
    assert.equal(remainingBudget('9'.repeat(40), '9'.repeat(39) + '8'), '1');
  });

  it('throws on invalid input', () => {
    assert.throws(() => remainingBudget('x', '0'), YoctoError);
    assert.throws(() => remainingBudget('1', '-1'), YoctoError);
    assert.throws(() => remainingBudget(100, 0), YoctoError);
    assert.throws(() => remainingBudget(undefined, '0'), YoctoError);
  });
});

describe('consistency with the policy engine', () => {
  it('engine remainingBudget matches remainingBudget()', () => {
    const cases = [
      [N('100'), '0'],
      [N('100'), N('30')],
      [N('100'), N('100')],
      [N('100'), N('150')],
      ['0', '0'],
    ];
    for (const [dailyBudget, reservedToday] of cases) {
      const result = evaluatePayment({
        agent: {
          status: AGENT_STATUS.ACTIVE,
          dailyBudget,
          perTxLimit: N('100'),
          approvalThreshold: N('100'),
        },
        recipientLists: { onAllowlist: true, onBlocklist: false },
        reservedToday,
        request: { recipient: 'merchant.testnet', amount: '1' },
      });
      assert.equal(
        result.remainingBudget,
        remainingBudget(dailyBudget, reservedToday),
        `${dailyBudget} / ${reservedToday}`,
      );
    }
  });
});
