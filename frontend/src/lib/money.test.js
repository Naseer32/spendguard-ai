import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  compareYocto,
  formatNear,
  formatNearWithUnit,
  isYoctoString,
  nearToYocto,
  percentOf,
  sumYocto,
  yoctoToNear,
} from './money.js';

test('nearToYocto converts exactly, without floating point', () => {
  assert.equal(nearToYocto('1'), '1000000000000000000000000');
  assert.equal(nearToYocto('0.1'), '100000000000000000000000');
  assert.equal(nearToYocto('12.5'), '12500000000000000000000000');
  assert.equal(nearToYocto('0.000000000000000000000001'), '1');
  // A float would corrupt this; BigInt must not.
  assert.equal(nearToYocto('9007199254740993'), '9007199254740993000000000000000000000000');
});

test('nearToYocto accepts typed input forms and trims whitespace', () => {
  assert.equal(nearToYocto('  2  '), '2000000000000000000000000');
  assert.equal(nearToYocto('007.5'), '7500000000000000000000000');
  assert.equal(nearToYocto('0'), '0');
});

test('nearToYocto rejects invalid input', () => {
  for (const bad of ['', ' ', 'abc', '-1', '1e3', '1,5', '.5', '1.', '1.1.1', '0.0000000000000000000000001', null, undefined, 5]) {
    assert.equal(nearToYocto(bad), null, `should reject ${String(bad)}`);
  }
});

test('nearToYocto rejects amounts over 40 yocto digits', () => {
  assert.equal(nearToYocto('1' + '0'.repeat(16)), null); // 17 whole digits + 24 = 41 digits
  assert.notEqual(nearToYocto('9'.repeat(16)), null);
});

test('yoctoToNear round-trips and trims trailing zeros', () => {
  for (const text of ['0', '1', '12.5', '0.000000000000000000000001', '123456.789']) {
    assert.equal(yoctoToNear(nearToYocto(text)), text);
  }
  assert.equal(yoctoToNear('1500000000000000000000000'), '1.5');
});

test('yoctoToNear returns null for non-canonical input', () => {
  for (const bad of ['', '01', '-1', '1.5', 'x', null, 7, '1'.repeat(41)]) {
    assert.equal(yoctoToNear(bad), null);
  }
});

test('isYoctoString matches backend rules', () => {
  assert.ok(isYoctoString('0'));
  assert.ok(isYoctoString('123'));
  assert.ok(!isYoctoString('007'));
  assert.ok(!isYoctoString('1'.repeat(41)));
  assert.ok(!isYoctoString(5));
});

test('formatNear groups thousands, truncates and never rounds up', () => {
  assert.equal(formatNear(nearToYocto('1250.5')), '1,250.5');
  assert.equal(formatNear(nearToYocto('1234567')), '1,234,567');
  assert.equal(formatNear(nearToYocto('1.99999')), '1.9999'); // truncated, not 2
  assert.equal(formatNear(nearToYocto('0')), '0');
});

test('formatNear never shows a non-zero amount as zero', () => {
  assert.equal(formatNear('1'), '<0.0001');
  assert.equal(formatNear(nearToYocto('0.00001')), '<0.0001');
  assert.equal(formatNear(nearToYocto('0.0001')), '0.0001');
});

test('formatNear handles invalid input safely', () => {
  assert.equal(formatNear('abc'), '—');
  assert.equal(formatNearWithUnit(undefined), '—');
  assert.equal(formatNearWithUnit(nearToYocto('3')), '3 NEAR');
});

test('compareYocto, sumYocto and percentOf use exact BigInt arithmetic', () => {
  assert.equal(compareYocto('2', '10'), -1); // numeric, not lexicographic
  assert.equal(compareYocto('10', '10'), 0);
  assert.equal(compareYocto('11', '10'), 1);
  assert.equal(sumYocto(['1', '2', 'bad', '3']), '6');
  assert.equal(percentOf('25', '100'), 25);
  assert.equal(percentOf('250', '100'), 100); // clamped
  assert.equal(percentOf('5', '0'), 0);
  assert.equal(percentOf('x', '100'), 0);
});
