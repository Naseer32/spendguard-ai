import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ConflictError,
  IdempotencyConflictError,
  NotFoundError,
  ServiceError,
  ValidationError,
} from './errors.js';
import {
  assertPlainObject,
  hasControlCharacters,
  newId,
  rejectUnknownFields,
  requireContext,
  toIso,
} from './util.js';

describe('errors', () => {
  it('carry a name and a machine-readable code', () => {
    const cases = [
      [new ValidationError('x', 'f'), 'ValidationError', 'VALIDATION'],
      [new NotFoundError('x'), 'NotFoundError', 'NOT_FOUND'],
      [new ConflictError('x'), 'ConflictError', 'CONFLICT'],
      [new IdempotencyConflictError('x'), 'IdempotencyConflictError', 'IDEMPOTENCY_CONFLICT'],
    ];
    for (const [error, name, code] of cases) {
      assert.ok(error instanceof ServiceError);
      assert.ok(error instanceof Error);
      assert.equal(error.name, name);
      assert.equal(error.code, code);
    }
  });

  it('keeps the field on validation errors and subclasses conflicts', () => {
    assert.equal(new ValidationError('x', 'amount').field, 'amount');
    assert.equal(new ValidationError('x').field, null);
    assert.ok(new IdempotencyConflictError('x') instanceof ConflictError);
  });
});

describe('toIso', () => {
  it('formats epoch milliseconds as an ISO UTC timestamp', () => {
    assert.equal(toIso(0), '1970-01-01T00:00:00.000Z');
    assert.equal(toIso(Date.UTC(2026, 10, 4, 12)), '2026-11-04T12:00:00.000Z');
    assert.equal(toIso(253402300799999), '9999-12-31T23:59:59.999Z');
  });

  it('rejects invalid values', () => {
    for (const bad of [1.5, -1, NaN, Infinity, '5', null, undefined, 253402300800000, 10n, {}]) {
      assert.throws(() => toIso(bad), TypeError, String(bad));
    }
  });
});

describe('requireContext', () => {
  it('returns a frozen context', () => {
    const c = requireContext({ now: Date.UTC(2026, 10, 4, 12), actor: 'owner', extra: 1 });
    assert.equal(c.nowMs, Date.UTC(2026, 10, 4, 12));
    assert.equal(c.nowIso, '2026-11-04T12:00:00.000Z');
    assert.equal(c.actor, 'owner');
    assert.ok(Object.isFrozen(c));
    assert.equal('extra' in c, false);
  });

  it('rejects bad contexts', () => {
    const bad = [
      undefined, null, 'x', 5, {}, { now: 1 }, { actor: 'o' },
      { now: 1.5, actor: 'o' }, { now: '5', actor: 'o' }, { now: -1, actor: 'o' },
      { now: 0, actor: '' }, { now: 0, actor: 5 }, { now: 0, actor: 'x'.repeat(129) },
    ];
    bad.forEach((context, i) => {
      assert.throws(() => requireContext(context), TypeError, `context #${i}`);
    });
  });
});

describe('input helpers', () => {
  it('assertPlainObject accepts plain objects only', () => {
    assert.doesNotThrow(() => assertPlainObject({}));
    assert.doesNotThrow(() => assertPlainObject(Object.create(null)));
    for (const bad of [null, undefined, [], 'x', 5, new Date(), new (class Foo {})()]) {
      assert.throws(() => assertPlainObject(bad), ValidationError);
    }
  });

  it('rejectUnknownFields names the offending field', () => {
    assert.doesNotThrow(() => rejectUnknownFields({ a: 1 }, ['a', 'b']));
    assert.doesNotThrow(() => rejectUnknownFields({}, ['a']));
    assert.throws(
      () => rejectUnknownFields({ a: 1, evil: 2 }, ['a']),
      (e) => e instanceof ValidationError && e.field === 'evil',
    );
  });

  it('hasControlCharacters finds control characters', () => {
    assert.equal(hasControlCharacters('plain text'), false);
    assert.equal(hasControlCharacters('a\u0000b'), true);
    assert.equal(hasControlCharacters('a\nb'), true);
    assert.equal(hasControlCharacters('a\u007fb'), true);
  });

  it('newId returns unique UUIDs', () => {
    const a = newId();
    assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    assert.notEqual(a, newId());
  });
});
