// Maps any thrown value to an HTTP response description:
//   { status, headers, body: { error: { code, message, field? } }, internal }
// Unknown errors become a generic 500: their messages, stacks and causes are
// never sent to clients. `internal` is true for 5xx so callers know to log them.

import {
  ConflictError,
  IdempotencyConflictError,
  NotFoundError,
  ValidationError,
} from '../services/errors.js';
import { HttpError } from './httpErrors.js';

function describe(status, code, message, { field = null, headers = {}, internal = false } = {}) {
  const error = { code, message };
  if (typeof field === 'string' && field !== '') {
    error.field = field;
  }
  return Object.freeze({
    status,
    headers: Object.freeze({ ...headers }),
    body: Object.freeze({ error: Object.freeze(error) }),
    internal,
  });
}

function isBusy(error) {
  return error instanceof Error && /database is locked|database table is locked|busy/i.test(error.message);
}

export function mapError(error) {
  if (error instanceof HttpError) {
    return describe(error.status, error.code, error.message, { headers: error.headers });
  }
  if (error instanceof ValidationError) {
    return describe(400, 'VALIDATION', error.message, { field: error.field });
  }
  if (error instanceof NotFoundError) {
    return describe(404, 'NOT_FOUND', error.message);
  }
  if (error instanceof IdempotencyConflictError) {
    return describe(409, 'IDEMPOTENCY_CONFLICT', error.message);
  }
  if (error instanceof ConflictError) {
    return describe(409, error.code, error.message);
  }
  if (isBusy(error)) {
    return describe(503, 'UNAVAILABLE', 'service temporarily unavailable', {
      headers: { 'Retry-After': '1' },
      internal: true,
    });
  }
  return describe(500, 'INTERNAL', 'internal server error', { internal: true });
}
