
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from './app.js';
import { ACCESS, readQuery } from './http/routeKit.js';
import { createAgent, pauseAgent, rotateApiKey } from './services/agents.js';
import { ConflictError, ValidationError } from './services/errors.js';
import { OWNER_TOKEN, makeDeps, startTestServer } from './testing/httpKit.js';
import { agentInput, svc } from './testing/serviceKit.js';

const SECRET = `sgk_0123abcd-0123-4abc-8def-0123456789ab_${'f'.repeat(64)}`;
const UUID = '0123abcd-0123-4abc-8def-0123456789ab';
const REQUEST_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const NOT_FOUND = { error: { code: 'NOT_FOUND', message: 'not found' } };
const UNAUTHORIZED = { error: { code: 'UNAUTHORIZED', message: 'authentication required' } };

function testRoutes(route) {
  route('GET', '/api/test/public', ACCESS.PUBLIC, () => ({ body: { ok: true } }));
  route('GET', '/api/test/owner', ACCESS.OWNER, ({ principal }) => ({ body: { principal: principal.type } }));
  route('GET', '/api/test/agent', ACCESS.AGENT, ({ principal }) => ({
    body: { principal: principal.type, agentId: principal.agentId },
  }));
  route('POST', '/api/test/echo', ACCESS.OWNER, ({ body }) => ({ status: 201, body: { received: body ?? null } }));
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

const routeModules = [
  (route, deps) => import('./routes/health.js').then(() => {}) && undefined,
];
