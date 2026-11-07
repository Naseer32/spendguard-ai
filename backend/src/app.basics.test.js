import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from './app.js';
import { ACCESS } from './http/routeKit.js';
import { createAgent } from './services/agents.js';
import { OWNER_TOKEN, makeDeps, startTestServer } from './testing/httpKit.js';
import { agentInput, svc } from './testing/serviceKit.js';
import {
  HIGH_FAILURE_LIMIT,
  MODULES,
  NOT_FOUND,
  UNAUTHORIZED,
  UUID,
  assertSecurityHeaders,
} from './testing/testRoutes.js';

describe('basics', () => {
  let t;
  before(async () => { t = await startTestServer({ routeModules: MODULES }); });
  after(() => t.close());

  it('serves the health check with security headers', async () => {
    const res = await t.request('GET', '/api/health');
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, { data: { status: 'ok' } });
    assert.match(res.headers['content-type'], /^application\/json/);
    assertSecurityHeaders(res);
  });

  it('gives every response its own request id', async () => {
    const a = await t.request('GET', '/api/health');
    const b = await t.request('GET', '/api/health');
    assert.notEqual(a.headers['x-request-id'], b.headers['x-request-id']);
  });

  it('answers unknown paths and methods with a plain 404', async () => {
    const cases = [
      ['GET', '/'], ['GET', '/api'], ['GET', '/api/nope'], ['POST', '/api/health'],
      ['DELETE', '/api/health'], ['PUT', '/api/test/public'], ['GET', '/admin'],
      ['OPTIONS', '/api/health'], ['PATCH', '/api/health'], ['TRACE', '/api/health'],
    ];
    for (const [method, path] of cases) {
      const res = await t.request(method, path);
      assert.equal(res.status, 404, `${method} ${path}`);
      assert.deepEqual(res.json, NOT_FOUND, `${method} ${path}`);
      assertSecurityHeaders(res);
    }
  });

  it('rejects unexpected query parameters by default', async () => {
    const res = await t.request('GET', '/api/health?x=1');
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, 'VALIDATION');
  });

  it('formats handler results', async () => {
    const refusal = await t.request('GET', '/api/test/refusal');
    assert.equal(refusal.status, 409);
    assert.deepEqual(refusal.json, {
      error: { code: 'REFUSED', message: 'refused' },
      data: { why: 'because' },
    });
    const bad = await t.request('GET', '/api/test/badstatus');
    assert.equal(bad.status, 500);
    assert.equal(bad.json.error.code, 'INTERNAL');
  });

  it('gives owner handlers a service context with the owner as actor', async () => {
    const started = Date.now();
    const res = await t.request('GET', '/api/test/context', { token: OWNER_TOKEN });
    assert.equal(res.json.data.actor, 'owner');
    assert.ok(res.json.data.now >= started && res.json.data.now <= Date.now());
  });
});

describe('route registration', () => {
  const noop = () => ({ body: null });

  function build(register) {
    const { db, config, logger } = makeDeps();
    try {
      return createApp({ db, config, logger, routeModules: [register] });
    } finally {
      db.close();
    }
  }

  it('records every route with its access level', async () => {
    const t = await startTestServer({ routeModules: MODULES });
    try {
      assert.ok(Object.isFrozen(t.routes));
      const health = t.routes.find((r) => r.path === '/api/health');
      assert.deepEqual(
        { ...health, params: [...health.params] },
        { method: 'GET', path: '/api/health', access: 'public', params: [] },
      );
      const params = t.routes.find((r) => r.path === '/api/test/params/:agentId');
      assert.deepEqual([...params.params], ['agentId']);
      assert.ok(t.routes.every((r) => Object.values(ACCESS).includes(r.access)));
    } finally {
      await t.close();
    }
  });

  it('refuses invalid registrations', () => {
    const bad = [
      (route) => route('PATCH', '/api/x', ACCESS.PUBLIC, noop),
      (route) => route('get', '/api/x', ACCESS.PUBLIC, noop),
      (route) => route('GET', 'api/x', ACCESS.PUBLIC, noop),
      (route) => route('GET', '/api/X', ACCESS.PUBLIC, noop),
      (route) => route('GET', '/api/x/*', ACCESS.PUBLIC, noop),
      (route) => route('GET', '/api/x/:unknown', ACCESS.PUBLIC, noop),
      (route) => route('GET', '/api/x', undefined, noop),
      (route) => route('GET', '/api/x', 'admin', noop),
      (route) => route('GET', '/api/x', ACCESS.PUBLIC, 'handler'),
      (route) => {
        route('GET', '/api/x', ACCESS.PUBLIC, noop);
        route('GET', '/api/x', ACCESS.OWNER, noop);
      },
    ];
    bad.forEach((register, i) => {
      assert.throws(() => build(register), TypeError, `registration #${i}`);
    });
    assert.doesNotThrow(() => build((route) => route('GET', '/api/x', ACCESS.PUBLIC, noop)));
  });

  it('validates the dependencies', () => {
    const { db, config, logger } = makeDeps();
    const bad = [
      {}, { db: null, config, logger }, { db, config: null, logger }, { db, config: {}, logger },
      { db, config, logger: null }, { db, config, logger: {} }, { db, config, logger, now: 'x' },
      { db, config, logger, routeModules: 'x' }, { db, config, logger, routeModules: [5] },
    ];
    bad.forEach((deps, i) => {
      assert.throws(() => createApp(deps), TypeError, `deps #${i}`);
    });
    assert.throws(() => createApp(), TypeError);
    db.close();
  });
});

describe('default route table', () => {
  let t;
  let agentKey;
  before(async () => {
    t = await startTestServer({ env: HIGH_FAILURE_LIMIT });
    ({ apiKey: agentKey } = createAgent(t.db, agentInput(), svc()));
  });
  after(() => t.close());

  const sample = (pattern) =>
    pattern.replace(':agentId', UUID).replace(':requestId', UUID).replace(':accountId', 'sample.testnet');

  it('has exactly one public route: GET /api/health', () => {
    const publicRoutes = t.routes.filter((r) => r.access === 'public').map((r) => `${r.method} ${r.path}`);
    assert.deepEqual(publicRoutes, ['GET /api/health']);
  });

  it('refuses every protected route without credentials, with bad ones and with the other principal', async () => {
    for (const r of t.routes.filter((x) => x.access !== 'public')) {
      const wrongPrincipal = r.access === 'owner' ? agentKey : OWNER_TOKEN;
      for (const token of [undefined, 'garbage-credential-0123456789', wrongPrincipal]) {
        const res = await t.request(r.method, sample(r.path), {
          token,
          json: r.method === 'POST' || r.method === 'PUT' ? {} : undefined,
        });
        assert.equal(res.status, 401, `${r.method} ${r.path}`);
        assert.deepEqual(res.json, UNAUTHORIZED);
      }
    }
  });
});
