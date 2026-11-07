// Shared pieces for the HTTP tests. Not imported by production code.

import assert from 'node:assert/strict';
import { ACCESS } from '../http/routeKit.js';
import { registerHealthRoutes } from '../routes/health.js';
import { ConflictError, ValidationError } from '../services/errors.js';

export const SECRET = `sgk_0123abcd-0123-4abc-8def-0123456789ab_${'f'.repeat(64)}`;
export const UUID = '0123abcd-0123-4abc-8def-0123456789ab';
export const ORIGIN = 'https://app.example.com';
export const REQUEST_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const NOT_FOUND = { error: { code: 'NOT_FOUND', message: 'not found' } };
export const UNAUTHORIZED = { error: { code: 'UNAUTHORIZED', message: 'authentication required' } };

// Tests that make many failed logins use this, so the failure limiter
// (tested separately) cannot interfere.
export const HIGH_FAILURE_LIMIT = Object.freeze({ RATE_LIMIT_AUTH_FAILURES_PER_MINUTE: '100000' });

export const SECURITY_HEADERS = Object.freeze({
  'x-content-type-options': 'nosniff',
  'cache-control': 'no-store',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
});

export function assertSecurityHeaders(res) {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    assert.equal(res.headers[name], value, name);
  }
  assert.equal(res.headers['x-powered-by'], undefined);
  assert.match(res.headers['x-request-id'], REQUEST_ID_RE);
}

// Extra routes that exist only in tests.
export function testRoutes(route) {
  route('GET', '/api/test/public', ACCESS.PUBLIC, () => ({ body: { ok: true } }));
  route('GET', '/api/test/owner', ACCESS.OWNER, ({ principal }) => ({ body: { principal: principal.type } }));
  route('GET', '/api/test/agent', ACCESS.AGENT, ({ principal }) => ({
    body: { principal: principal.type, agentId: principal.agentId },
  }));
  route('POST', '/api/test/echo', ACCESS.OWNER, ({ body }) => ({
    status: 201,
    body: { received: body ?? null },
  }));
  route('GET', '/api/test/boom', ACCESS.PUBLIC, () => {
    throw new Error(`exploded with ${SECRET}`);
  });
  route('GET', '/api/test/conflict', ACCESS.PUBLIC, () => {
    throw new ConflictError('already done', 'NOT_PENDING');
  });
  route('GET', '/api/test/invalid', ACCESS.PUBLIC, () => {
    throw new ValidationError('bad value', 'field');
  });
  route('GET', '/api/test/refusal', ACCESS.PUBLIC, () => ({
    status: 409,
    error: { code: 'REFUSED', message: 'refused' },
    body: { why: 'because' },
  }));
  route('GET', '/api/test/badstatus', ACCESS.PUBLIC, () => ({ status: 700, body: {} }));
  route('GET', '/api/test/params/:agentId', ACCESS.PUBLIC, ({ params }) => ({ body: params }));
  route('GET', '/api/test/query', ACCESS.PUBLIC, ({ query }) => ({ body: query }), {
    query: { limit: 'int', status: 'string' },
  });
  route('GET', '/api/test/context', ACCESS.OWNER, ({ serviceContext }) => ({ body: serviceContext() }));
}

export const MODULES = Object.freeze([registerHealthRoutes, testRoutes]);
