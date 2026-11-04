import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  YoctoError,
  YOCTO_PER_NEAR,
  isYoctoString,
  parseYocto,
  tryParseYocto,
  formatYocto,
  compareYocto,
  addYocto,
  subYocto,
  sumYocto,
  nearToYocto,
  yoctoToNear,
} from './yocto.js';

const MAX_40 = '9'.repeat(40);

describe('isYoctoString', () => {
  it('accepts canonical non-negative integers', () => {
    for (const v of ['0', '1', '123', '9007199254740993', '1' + '0'.repeat(39), MAX_40]) {
      assert.equal(isYoctoString(v), true, v);
    }
  });

  it('rejects malformed strings', () => {
    const bad = [
      '', '00', '01', '-1', '+1', '1.5', '1e24', ' 1', '1 ', '1\n',
      '0x10', 'abc', '1,000', '\u0661\u0662\u0663', '1'.repeat(41),
    ];
    for (const v of bad) {
      assert.equal(isYoctoString(v), false, JSON.stringify(v));
    }
  });

  it('rejects non-string types', () => {
    for (const v of [1, 0, 1.5, 10n, null, undefined, {}, [], true]) {
      assert.equal(isYoctoString(v), false);
    }
  });
});

describe('parseYocto / tryParseYocto', () => {
  it('parses values beyond 2^53 and 2^63 exactly', () => {
    assert.equal(parseYocto('9007199254740993'), 9007199254740993n);
    assert.equal(parseYocto('9223372036854775808'), 2n ** 63n);
    assert.equal(parseYocto(MAX_40), 10n ** 40n - 1n);
  });

  it('throws YoctoError on invalid input', () => {
    assert.throws(() => parseYocto('01'), YoctoError);
    assert.throws(() => parseYocto(5), YoctoError);
    assert.throws(() => parseYocto(null), YoctoError);
  });

  it('tryParseYocto returns null instead of throwing', () => {
    assert.equal(tryParseYocto('abc'), null);
    assert.equal(tryParseYocto(undefined), null);
    assert.equal(tryParseYocto('42'), 42n);
  });
});

describe('formatYocto', () => {
  it('formats valid bigints', () => {
    assert.equal(formatYocto(0n), '0');
    assert.equal(formatYocto(10n ** 24n), '1' + '0'.repeat(24));
  });

  it('rejects negatives, non-bigints and oversize values', () => {
    assert.throws(() => formatYocto(-1n), YoctoError);
    assert.throws(() => formatYocto(5), YoctoError);
    assert.throws(() => formatYocto('5'), YoctoError);
    assert.throws(() => formatYocto(10n ** 40n), YoctoError);
  });
});

describe('compareYocto', () => {
  it('compares numerically, not lexicographically', () => {
    assert.equal(compareYocto('9', '10'), -1);
    assert.equal(compareYocto('10', '9'), 1);
    assert.equal(compareYocto('100', '100'), 0);
  });

  it('is exact one yocto apart at huge magnitudes', () => {
    assert.equal(compareYocto('9007199254740993', '9007199254740992'), 1);
    assert.equal(compareYocto(MAX_40, '9'.repeat(39) + '8'), 1);
  });

  it('throws on invalid input', () => {
    assert.throws(() => compareYocto('x', '1'), YoctoError);
  });
});

describe('addYocto / subYocto / sumYocto', () => {
  it('adds exactly beyond float precision', () => {
    assert.equal(addYocto('9007199254740992', '1'), '9007199254740993');
  });

  it('rejects results above 40 digits', () => {
    assert.equal(addYocto('9'.repeat(39), '1'), '1' + '0'.repeat(39));
    assert.throws(() => addYocto(MAX_40, '1'), YoctoError);
  });

  it('subtracts and never goes negative', () => {
    assert.equal(subYocto('10', '3'), '7');
    assert.equal(subYocto('5', '5'), '0');
    assert.throws(() => subYocto('4', '5'), YoctoError);
  });

  it('sums lists, including an empty list', () => {
    assert.equal(sumYocto([]), '0');
    assert.equal(sumYocto(['1', '2', '3']), '6');
    assert.equal(
      sumYocto(['9007199254740992', '1', '1']),
      '9007199254740994',
    );
  });

  it('sum rejects any invalid element', () => {
    assert.throws(() => sumYocto(['1', 'x']), YoctoError);
  });
});

describe('nearToYocto', () => {
  it('converts whole and fractional NEAR', () => {
    assert.equal(nearToYocto('1'), '1' + '0'.repeat(24));
    assert.equal(nearToYocto('0'), '0');
    assert.equal(nearToYocto('0.0'), '0');
    assert.equal(nearToYocto('0.5'), '5' + '0'.repeat(23));
    assert.equal(nearToYocto('1.5'), '15' + '0'.repeat(23));
    assert.equal(nearToYocto('1000000'), '1' + '0'.repeat(30));
  });

  it('supports the full 24 decimals, one yocto exactly', () => {
    assert.equal(nearToYocto('0.' + '0'.repeat(23) + '1'), '1');
  });

  it('rejects more than 24 decimals', () => {
    assert.throws(() => nearToYocto('1.' + '0'.repeat(24) + '1'), YoctoError);
  });

  it('rejects malformed input', () => {
    for (const v of ['', '.5', '1.', '-1', '01', '1e3', ' 1', 'abc', '1,5']) {
      assert.throws(() => nearToYocto(v), YoctoError, JSON.stringify(v));
    }
    assert.throws(() => nearToYocto(1.5), YoctoError);
    assert.throws(() => nearToYocto(null), YoctoError);
  });

  it('enforces the 40-digit yocto cap', () => {
    assert.equal(nearToYocto('9999999999999999').length, 40);
    assert.throws(() => nearToYocto('10000000000000000'), YoctoError);
  });
});

describe('yoctoToNear', () => {
  it('formats with trailing zeros trimmed', () => {
    assert.equal(yoctoToNear('0'), '0');
    assert.equal(yoctoToNear(YOCTO_PER_NEAR.toString()), '1');
    assert.equal(yoctoToNear('15' + '0'.repeat(23)), '1.5');
    assert.equal(yoctoToNear('1' + '0'.repeat(23)), '0.1');
    assert.equal(yoctoToNear('1'), '0.' + '0'.repeat(23) + '1');
  });

  it('formats large values exactly', () => {
    assert.equal(
      yoctoToNear('123456789012345678901234567890'),
      '123456.78901234567890123456789',
    );
  });

  it('throws on invalid input', () => {
    assert.throws(() => yoctoToNear('1.5'), YoctoError);
    assert.throws(() => yoctoToNear(''), YoctoError);
  });

  it('round-trips with nearToYocto', () => {
    const samples = [
      '0', '1', '999999999999999999999999', '1' + '0'.repeat(24),
      '15' + '0'.repeat(23), '123456789012345678901234567890', MAX_40,
    ];
    for (const yocto of samples) {
      assert.equal(nearToYocto(yoctoToNear(yocto)), yocto, yocto);
    }
  });
});
