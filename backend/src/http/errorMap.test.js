import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ConflictError,
  IdempotencyConflictError,
  NotFoundError,
  ServiceError,
  ValidationError,
} from '../services/errors.js';
import { mapError } from './errorMap.js';
import {
  BadRequestError,
  ForbiddenError,
  HttpError,
  PayloadTooLargeError,
  RateLimitError,
  RouteNotFoundError,
  UnauthorizedError,
  UnsupportedMediaTypeError,
} from './httpErrors.js';

const SECRET = 'sgk_0123abcd-0123-4abc-8def-0123456789ab_' + 'f'.repeat(64);

describe('service errors', () => {
  it('maps validation errors to 400 with the field', () => {
    const r = mapError(new ValidationError('amount must be a yoctoNEAR amount string', 'amount'));
    assert.equal(r.status, 400);
    assert.deepEqual(r.body, {
      error: { code: 'VALIDATION', message: 'amount must be a yoctoNEAR amount string', field: 'amount' },
    });
    assert.equal(r.internal, false);
    assert.deepEqual({ ...r.headers }, {});
  });

  it('omits the field when there is none', () => {
    const r = mapError(new ValidationError('bad input'));
    assert.deepEqual(r.body, { error: { code: 'VALIDATION', message: 'bad input' } });
  });

  it('maps not found to 404', () => {
    const r = mapError(new NotFoundError('agent not found'));
    assert.equal(r.status, 404);
    assert.deepEqual(r.body, { error: { code: 'NOT_FOUND', message: 'agent not found' } });
  });

  it('maps conflicts to 409 and keeps their code', () => {
    for (const code of ['NOT_PENDING', 'ILLEGAL_TRANSITION', 'RESERVATION_STATE']) {
      const r = mapError(new ConflictError('conflict happened', code));
      assert.equal(r.status, 409);
      assert.equal(r.body.error.code, code);
    }
    assert.equal(mapError(new ConflictError('x')).body.error.code, 'CONFLICT');
  });

  it('maps idempotency conflicts to 409 with their own code', () => {
    const r = mapError(new IdempotencyConflictError('different request'));
    assert.equal(r.status, 409);
    assert.equal(r.body.error.code, 'IDEMPOTENCY_CONFLICT');
  });

  it('treats unknown service error subclasses as internal errors', () => {
    const r = mapError(new ServiceError('odd', 'WEIRD'));
    assert.equal(r.status, 500);
    assert.equal(r.internal, true);
  });
});

describe('HTTP errors', () => {
  const cases = [
    [new UnauthorizedError(), 401, 'UNAUTHORIZED', 'authentication required', { 'WWW-Authenticate': 'Bearer' }],
    [new ForbiddenError(), 403, 'FORBIDDEN', 'access denied', {}],
    [new RouteNotFoundError(), 404, 'NOT_FOUND', 'not found', {}],
    [new BadRequestError(), 400, 'BAD_REQUEST', 'invalid request', {}],
    [new BadRequestError('request body is not valid JSON', 'INVALID_JSON'), 400, 'INVALID_JSON', 'request body is not valid JSON', {}],
    [new PayloadTooLargeError(), 413, 'PAYLOAD_TOO_LARGE', 'request body too large', {}],
    [new UnsupportedMediaTypeError(), 415, 'UNSUPPORTED_MEDIA_TYPE', 'content type must be application/json', {}],
    [new RateLimitError(30), 429, 'RATE_LIMITED', 'too many requests', { 'Retry-After': '30' }],
  ];

  for (const [error, status, code, message, headers] of cases) {
    it(`maps ${error.name} (${code}) to ${status}`, () => {
      const r = mapError(error);
      assert.equal(r.status, status);
      assert.deepEqual(r.body, { error: { code, message } });
      assert.deepEqual({ ...r.headers }, headers);
      assert.equal(r.internal, false);
      assert.ok(error instanceof HttpError);
    });
  }

  it('validates the retry-after value', () => {
    for (const bad of [0, -1, 1.5, '5', null, undefined, 86401]) {
      assert.throws(() => new RateLimitError(bad), TypeError, String(bad));
    }
    assert.equal(new RateLimitError(1).headers['Retry-After'], '1');
    assert.equal(new RateLimitError(86400).headers['Retry-After'], '86400');
  });

  it('gives the same 401 for every authentication failure', () => {
    assert.deepEqual(mapError(new UnauthorizedError()), mapError(new UnauthorizedError()));
  });

  it('freezes error headers', () => {
    assert.ok(Object.isFrozen(new UnauthorizedError().headers));
  });
});

describe('internal errors', () => {
  it('never leaks the message, name, stack or cause of unknown errors', () => {
    const thrown = [
      new Error(`database exploded, key ${SECRET}`),
      new TypeError(`bad thing ${SECRET}`),
      new RangeError(SECRET),
      Object.assign(new Error('x', { cause: new Error(SECRET) }), { code: SECRET }),
      SECRET,
      { message: SECRET },
      null,
      undefined,
      42,
    ];
    for (const error of thrown) {
      const r = mapError(error);
      assert.equal(r.status, 500);
      assert.equal(r.internal, true);
      assert.deepEqual(r.body, { error: { code: 'INTERNAL', message: 'internal server error' } });
      assert.ok(!JSON.stringify(r).includes('sgk_'));
    }
  });

  it('maps a locked database to 503 with a retry hint', () => {
    for (const message of ['database is locked', 'database table is locked', 'SQLITE_BUSY: busy']) {
      const r = mapError(new Error(message));
      assert.equal(r.status, 503);
      assert.equal(r.body.error.code, 'UNAVAILABLE');
      assert.equal(r.headers['Retry-After'], '1');
      assert.equal(r.internal, true);
    }
  });

  it('returns frozen results', () => {
    const r = mapError(new Error('x'));
    assert.ok(Object.isFrozen(r));
    assert.ok(Object.isFrozen(r.body));
    assert.ok(Object.isFrozen(r.body.error));
    assert.ok(Object.isFrozen(r.headers));
  });
});
