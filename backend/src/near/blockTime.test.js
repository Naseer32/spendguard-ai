import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  BLOCK_TIME_CODES as C,
  CLOCK_SKEW_TOLERANCE_MS,
  checkBlockTime,
  parseBlockTimestampNanos,
  parseIsoUtcToNanos,
} from './blockTime.js';

// timestamp_nanosec of the real Testnet block 12E4MqAh... (tx 4yxED39o...),
// copied as a literal so this test does not depend on any fixture file.
// It is 2026-11-09T13:09:09.101285803Z and exceeds Number's exact integer range.
const BLOCK = '1794229749101285803';

const check = (authorizedAt, extra = {}) =>
  checkBlockTime({ blockTimestampNanosec: BLOCK, authorizedAt, ...extra });

const assertOk = (res) => {
  assert.equal(res.ok, true);
  assert.equal(res.code, C.OK);
};
const assertFails = (res, code) => {
  assert.equal(res.ok, false);
  assert.equal(res.code, code);
};

describe('parseIsoUtcToNanos', () => {
  it('converts whole seconds', () => {
    assert.equal(parseIsoUtcToNanos('1970-01-01T00:00:01Z'), 1_000_000_000n);
  });

  it('keeps every fractional digit, up to nanoseconds', () => {
    assert.equal(parseIsoUtcToNanos('1970-01-01T00:00:00.5Z'), 500_000_000n);
    assert.equal(parseIsoUtcToNanos('1970-01-01T00:00:00.000000001Z'), 1n);
    assert.equal(parseIsoUtcToNanos('2026-11-09T13:09:09.101285803Z'), BigInt(BLOCK));
  });

  it('rejects everything that is not a valid UTC ISO timestamp', () => {
    const bad = [
      '', 'x', '2026-11-09', '2026-11-09T13:09:09', '2026-11-09 13:09:09Z',
      '2026-11-09T13:09:09+00:00', '2026-11-09T13:09:09.Z', '2026-11-09T13:09:09.1234567890Z',
      '2026-02-30T00:00:00Z', '2026-02-29T00:00:00Z', '2026-13-01T00:00:00Z',
      '2026-11-09T24:00:00Z', '2026-11-09T13:60:00Z', ' 2026-11-09T13:09:09Z',
      null, undefined, 5, {}, [],
    ];
    for (const v of bad) assert.equal(parseIsoUtcToNanos(v), null, String(v));
  });

  it('accepts a real leap day', () => {
    assert.notEqual(parseIsoUtcToNanos('2028-02-29T00:00:00Z'), null);
  });
});

describe('parseBlockTimestampNanos', () => {
  it('parses a nanosecond string exactly', () => {
    assert.equal(parseBlockTimestampNanos(BLOCK), 1794229749101285803n);
  });

  it('rejects numbers, signs, decimals, empty and oversized values', () => {
    const bad = [1794229749101285803, '', '-1', '+1', '1.5', '1e18', ' 1', 'abc', '1'.repeat(26), null, undefined, {}];
    for (const v of bad) assert.equal(parseBlockTimestampNanos(v), null, String(v));
  });
});

describe('checkBlockTime', () => {
  it('uses a two minute default tolerance', () => {
    assert.equal(CLOCK_SKEW_TOLERANCE_MS, 120_000);
  });

  it('accepts a block after authorization', () => {
    assertOk(check('2026-11-09T13:00:00.000Z'));
    assertOk(check('2026-11-09T13:09:09.101285802Z')); // 1 ns before the block
  });

  it('accepts a block at exactly the authorization time', () => {
    assertOk(check('2026-11-09T13:09:09.101285803Z'));
  });

  it('accepts a block slightly before authorization, within the tolerance', () => {
    assertOk(check('2026-11-09T13:10:09.101285803Z')); // block is 60 s early
  });

  it('accepts exactly the tolerance boundary and rejects one nanosecond past it', () => {
    assertOk(check('2026-11-09T13:11:09.101285803Z')); // block is exactly 120 s early
    assertFails(check('2026-11-09T13:11:09.101285804Z'), C.BLOCK_BEFORE_AUTHORIZATION);
  });

  it('rejects a block well before authorization', () => {
    assertFails(check('2026-11-09T14:00:00Z'), C.BLOCK_BEFORE_AUTHORIZATION);
    assertFails(check('2027-01-01T00:00:00Z'), C.BLOCK_BEFORE_AUTHORIZATION);
  });

  it('honours a custom tolerance, including zero', () => {
    assertOk(check('2026-11-09T13:09:09.101285803Z', { toleranceMs: 0 }));
    assertFails(check('2026-11-09T13:09:09.101285804Z', { toleranceMs: 0 }), C.BLOCK_BEFORE_AUTHORIZATION);
    assertOk(check('2026-11-09T13:09:19.101285803Z', { toleranceMs: 10_000 }));
    assertFails(check('2026-11-09T13:09:19.101285804Z', { toleranceMs: 10_000 }), C.BLOCK_BEFORE_AUTHORIZATION);
  });

  it('compares exactly, with no floating point rounding', () => {
    // Two block times that are equal as Numbers (both round to 1794229749101285800)
    // but differ by one nanosecond must still be told apart.
    const auth = '2026-11-09T13:09:09.101285804Z';
    assertFails(
      checkBlockTime({ blockTimestampNanosec: '1794229749101285803', authorizedAt: auth, toleranceMs: 0 }),
      C.BLOCK_BEFORE_AUTHORIZATION,
    );
    assertOk(
      checkBlockTime({ blockTimestampNanosec: '1794229749101285804', authorizedAt: auth, toleranceMs: 0 }),
    );
  });

  it('fails closed on a bad timestamp, date or tolerance', () => {
    assertFails(checkBlockTime({ blockTimestampNanosec: 1794229749101285803, authorizedAt: '2026-11-09T13:00:00Z' }), C.MALFORMED);
    assertFails(checkBlockTime({ blockTimestampNanosec: 'abc', authorizedAt: '2026-11-09T13:00:00Z' }), C.MALFORMED);
    assertFails(checkBlockTime({ blockTimestampNanosec: BLOCK, authorizedAt: 'yesterday' }), C.MALFORMED);
    assertFails(checkBlockTime({ blockTimestampNanosec: BLOCK }), C.MALFORMED);
    assertFails(checkBlockTime({ authorizedAt: '2026-11-09T13:00:00Z' }), C.MALFORMED);
    for (const t of [-1, 1.5, NaN, Infinity, '120000', null, 2 ** 60]) {
      assertFails(check('2026-11-09T13:00:00Z', { toleranceMs: t }), C.MALFORMED);
    }
  });

  it('fails closed, without throwing, on non-object input', () => {
    for (const v of [undefined, null, 0, 'x', [], true]) {
      assertFails(checkBlockTime(v), C.MALFORMED);
    }
  });

  it('never throws on hostile input', () => {
    const hostile = {};
    Object.defineProperty(hostile, 'authorizedAt', {
      get() {
        throw new Error('boom');
      },
    });
    assertFails(checkBlockTime(hostile), C.MALFORMED);
  });
});
