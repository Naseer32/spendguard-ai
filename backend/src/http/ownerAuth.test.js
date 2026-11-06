import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { extractBearer, hashOwnerToken, verifyOwnerToken } from './ownerAuth.js';

const TOKEN = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';
const HASH = hashOwnerToken(TOKEN);

describe('hashOwnerToken', () => {
  it('is a domain-separated SHA-256 in lowercase hex', () => {
    const expected = createHash('sha256').update(`spendguard-owner-token-v1\n${TOKEN}`).digest('hex');
    assert.equal(HASH, expected);
    assert.match(HASH, /^[0-9a-f]{64}$/);
  });

  it('is deterministic and token-specific', () => {
    assert.equal(hashOwnerToken(TOKEN), hashOwnerToken(TOKEN));
    assert.notEqual(hashOwnerToken(TOKEN), hashOwnerToken(`${TOKEN}x`));
    assert.notEqual(hashOwnerToken(TOKEN), hashOwnerToken(TOKEN.toUpperCase()));
  });

  it('rejects non-strings', () => {
    for (const bad of [undefined, null, 5, {}, []]) {
      assert.throws(() => hashOwnerToken(bad), TypeError);
    }
  });
});

describe('extractBearer', () => {
  it('extracts the token', () => {
    assert.equal(extractBearer('Bearer abc'), 'abc');
    assert.equal(extractBearer(`Bearer ${TOKEN}`), TOKEN);
    assert.equal(extractBearer('Bearer !@#$%^&*()_+-=[]{};:,.<>/?'), '!@#$%^&*()_+-=[]{};:,.<>/?');
  });

  it('accepts the scheme in any letter case', () => {
    assert.equal(extractBearer('bearer abc'), 'abc');
    assert.equal(extractBearer('BEARER abc'), 'abc');
    assert.equal(extractBearer('BeArEr abc'), 'abc');
  });

  it('enforces the token length limits', () => {
    assert.equal(extractBearer(`Bearer ${'x'.repeat(512)}`), 'x'.repeat(512));
    assert.equal(extractBearer(`Bearer ${'x'.repeat(513)}`), null);
    assert.equal(extractBearer('Bearer x'), 'x');
    assert.equal(extractBearer(`Bearer ${'x'.repeat(2000)}`), null);
  });

  it('rejects anything that is not exactly "Bearer <token>"', () => {
    const bad = [
      undefined, null, 5, {}, ['Bearer abc'], '', 'Bearer', 'Bearer ', 'Bearer  abc',
      'Basic abc', 'Bearerabc', 'Bearer a b', 'Bearer abc ', ' Bearer abc', 'Bearer\tabc',
      'Bearer abc\n', 'Bearer ab\nc', 'Bearer \u00e9', 'Bearer abc\u0000', 'Bearer\u00a0abc',
      'abc', TOKEN, 'Token abc',
    ];
    bad.forEach((value, i) => {
      assert.equal(extractBearer(value), null, `header #${i}`);
    });
  });
});

describe('verifyOwnerToken', () => {
  it('accepts the correct token', () => {
    assert.equal(verifyOwnerToken(`Bearer ${TOKEN}`, HASH), true);
    assert.equal(verifyOwnerToken(`bearer ${TOKEN}`, HASH), true);
  });

  it('accepts the longest token', () => {
    const long = 'k9'.repeat(128);
    assert.equal(verifyOwnerToken(`Bearer ${long}`, hashOwnerToken(long)), true);
  });

  it('rejects wrong, altered and partial tokens', () => {
    const bad = [
      `Bearer ${TOKEN}x`, `Bearer ${TOKEN.slice(1)}`, `Bearer ${TOKEN.slice(0, -1)}`,
      `Bearer ${TOKEN.toUpperCase()}`, `Bearer ${'0'.repeat(32)}`, 'Bearer x',
      `Bearer ${TOKEN.slice(0, -1)}${TOKEN.endsWith('6') ? '7' : '6'}`,
    ];
    for (const header of bad) {
      assert.equal(verifyOwnerToken(header, HASH), false, header);
    }
  });

  it('rejects missing and malformed headers', () => {
    for (const header of [undefined, null, '', 'Bearer', TOKEN, `Basic ${TOKEN}`, `Bearer  ${TOKEN}`, 5, {}]) {
      assert.equal(verifyOwnerToken(header, HASH), false, String(header));
    }
  });

  it('rejects a token verified against another token hash', () => {
    assert.equal(verifyOwnerToken(`Bearer ${TOKEN}`, hashOwnerToken('another-token-value-0123456789abc')), false);
  });

  it('throws on an invalid expected hash (a configuration error)', () => {
    const bad = [undefined, null, '', 'abc', HASH.toUpperCase(), `${HASH}0`, HASH.slice(1), 5, {}];
    for (const expected of bad) {
      assert.throws(() => verifyOwnerToken(`Bearer ${TOKEN}`, expected), TypeError, String(expected));
    }
  });
});

describe('source guard', () => {
  const source = fs.readFileSync(new URL('./ownerAuth.js', import.meta.url), 'utf8');

  it('compares hashes in constant time and never logs', () => {
    assert.ok(source.includes('timingSafeEqual('));
    assert.ok(!/\bconsole\s*\./.test(source));
  });
});
