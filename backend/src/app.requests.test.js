import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { OWNER_TOKEN, startTestServer } from './testing/httpKit.js';
import { MODULES, ORIGIN, UUID, assertSecurityHeaders } from './testing/testRoutes.js';

describe('request bodies', () => {
  let t;
  before(async () => { t = await startTestServer({ routeModules: MODULES }); });
  after(() => t.close());
  const echo = (options) => t.request('POST', '/api/test/echo', { token: OWNER_TOKEN, ...options });
  const JSON_TYPE = { 'content-type': 'application/json' };

  it('parses JSON objects', async () => {
    const res = await echo({ json: { a: 1, b: ['x'] } });
    assert.equal(res.status, 201);
    assert.deepEqual(res.json, { data: { received: { a: 1, b: ['x'] } } });
  });

  it('accepts a request without a body', async () => {
    const res = await echo({});
    assert.equal(res.status, 201);
    assert.deepEqual(res.json, { data: { received: null } });
  });

  it('accepts a JSON content type with a utf-8 charset', async () => {
    const res = await echo({
      body: '{"a":1}',
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
    assert.equal(res.status, 201);
  });

  it('refuses bodies that are not declared as JSON', async () => {
    const cases = [
      { body: '{"a":1}', headers: { 'content-type': 'text/plain' } },
      { body: '{"a":1}', headers: { 'content-type': 'application/x-www-form-urlencoded' } },
      { body: '{"a":1}', headers: {} },
      { body: '{"a":1}', headers: { 'content-type': 'application/json; charset=utf-16' } },
      { body: '{"a":1}', headers: { 'content-type': 'application/json', 'content-encoding': 'gzip' } },
    ];
    for (const options of cases) {
      const res = await echo(options);
      assert.equal(res.status, 415, JSON.stringify(options.headers));
      assert.equal(res.json.error.code, 'UNSUPPORTED_MEDIA_TYPE');
    }
  });

  it('refuses invalid JSON and non-container JSON', async () => {
    for (const body of ['{', '{"a":}', 'nope', '"text"', '42', 'null', "{'a':1}"]) {
      const res = await echo({ body, headers: JSON_TYPE });
      assert.equal(res.status, 400, body);
      assert.equal(res.json.error.code, 'INVALID_JSON', body);
    }
  });

  it('enforces the 16 KB limit exactly', async () => {
    const wrap = (size) => `{"a":"${'x'.repeat(size - 8)}"}`;
    const atLimit = wrap(16384);
    assert.equal(Buffer.byteLength(atLimit), 16384);
    const ok = await echo({ body: atLimit, headers: JSON_TYPE });
    assert.equal(ok.status, 201);
    const over = wrap(16385);
    assert.equal(Buffer.byteLength(over), 16385);
    const tooBig = await echo({ body: over, headers: JSON_TYPE });
    assert.equal(tooBig.status, 413);
    assert.equal(tooBig.json.error.code, 'PAYLOAD_TOO_LARGE');
  });

  it('keeps a __proto__ key as plain data and never pollutes prototypes', async () => {
    const res = await echo({ body: '{"__proto__":{"polluted":true}}', headers: JSON_TYPE });
    assert.equal(res.status, 201);
    assert.equal({}.polluted, undefined);
    assert.equal(Object.prototype.polluted, undefined);
  });
});

describe('errors and parameters', () => {
  let t;
  before(async () => { t = await startTestServer({ routeModules: MODULES }); });
  after(() => t.close());

  it('never leaks the details of an unexpected error', async () => {
    const res = await t.request('GET', '/api/test/boom');
    assert.equal(res.status, 500);
    assert.deepEqual(res.json, { error: { code: 'INTERNAL', message: 'internal server error' } });
    assert.ok(!res.text.includes('exploded'));
    assert.ok(!res.text.includes('sgk_'));
    assertSecurityHeaders(res);
    const logText = t.logs.join('\n');
    assert.ok(!logText.includes('exploded'));
    assert.ok(!logText.includes('sgk_'));
    const logged = t.logs.map((l) => JSON.parse(l)).find((l) => l.event === 'http.error');
    assert.equal(logged.status, 500);
    assert.deepEqual(logged.error, { name: 'Error' });
    assert.equal(logged.requestId, res.headers['x-request-id']);
  });

  it('maps service errors', async () => {
    const conflict = await t.request('GET', '/api/test/conflict');
    assert.equal(conflict.status, 409);
    assert.deepEqual(conflict.json, { error: { code: 'NOT_PENDING', message: 'already done' } });
    const invalid = await t.request('GET', '/api/test/invalid');
    assert.equal(invalid.status, 400);
    assert.deepEqual(invalid.json, {
      error: { code: 'VALIDATION', message: 'bad value', field: 'field' },
    });
  });

  it('validates path parameters', async () => {
    const ok = await t.request('GET', `/api/test/params/${UUID}`);
    assert.deepEqual(ok.json, { data: { agentId: UUID } });
    assert.equal((await t.request('GET', `/api/test/params/${UUID.toUpperCase()}`)).status, 200);
    for (const bad of ['abc', `${UUID}x`, '12345', '%E0%A4%A', '..%2F..%2Fetc', '%00']) {
      const res = await t.request('GET', `/api/test/params/${bad}`);
      assert.equal(res.status, 400, bad);
    }
  });

  it('parses declared query parameters strictly', async () => {
    const ok = await t.request('GET', '/api/test/query?limit=5&status=APPROVED');
    assert.deepEqual(ok.json, { data: { limit: 5, status: 'APPROVED' } });
    assert.deepEqual((await t.request('GET', '/api/test/query')).json, { data: {} });
    for (const bad of ['?other=1', '?limit=1&limit=2', '?limit=abc', '?limit=', '?limit=01', '?limit[a]=1']) {
      const res = await t.request('GET', `/api/test/query${bad}`);
      assert.equal(res.status, 400, bad);
    }
  });
});

describe('CORS', () => {
  let t;
  before(async () => {
    t = await startTestServer({ routeModules: MODULES, env: { CORS_ORIGINS: ORIGIN } });
  });
  after(() => t.close());

  it('allows a configured origin without credentials', async () => {
    const res = await t.request('GET', '/api/test/public', { headers: { origin: ORIGIN } });
    assert.equal(res.status, 200);
    assert.equal(res.headers['access-control-allow-origin'], ORIGIN);
    assert.equal(res.headers['access-control-expose-headers'], 'Retry-After, X-Request-Id');
    assert.equal(res.headers.vary, 'Origin');
    assert.equal(res.headers['access-control-allow-credentials'], undefined);
  });

  it('adds no CORS headers for other origins, but still serves the request', async () => {
    const others = ['https://evil.example.com', 'null', 'https://app.example.com.evil.com', `${ORIGIN}/`];
    for (const origin of others) {
      const res = await t.request('GET', '/api/test/public', { headers: { origin } });
      assert.equal(res.status, 200, origin);
      assert.equal(res.headers['access-control-allow-origin'], undefined, origin);
      assert.equal(res.headers.vary, 'Origin');
    }
  });

  it('adds nothing when there is no Origin header', async () => {
    const res = await t.request('GET', '/api/test/public');
    assert.equal(res.headers['access-control-allow-origin'], undefined);
    assert.equal(res.headers.vary, undefined);
  });

  it('answers a preflight from an allowed origin without authentication', async () => {
    const res = await t.request('OPTIONS', '/api/test/echo', {
      headers: { origin: ORIGIN, 'access-control-request-method': 'POST' },
    });
    assert.equal(res.status, 204);
    assert.equal(res.text, '');
    assert.equal(res.headers['access-control-allow-origin'], ORIGIN);
    assert.equal(res.headers['access-control-allow-methods'], 'GET, POST, PUT, DELETE');
    assert.equal(res.headers['access-control-allow-headers'], 'Authorization, Content-Type');
    assert.equal(res.headers['access-control-max-age'], '600');
    assert.equal(res.headers['access-control-allow-credentials'], undefined);
  });

  it('refuses a preflight from other origins', async () => {
    const res = await t.request('OPTIONS', '/api/test/echo', {
      headers: { origin: 'https://evil.example.com', 'access-control-request-method': 'POST' },
    });
    assert.equal(res.status, 403);
    assert.equal(res.json.error.code, 'FORBIDDEN');
    assert.equal(res.headers['access-control-allow-origin'], undefined);
  });

  it('gives no automatic answer to a plain OPTIONS request', async () => {
    const plain = await t.request('OPTIONS', '/api/test/echo');
    assert.equal(plain.status, 404);
    const withOrigin = await t.request('OPTIONS', '/api/test/echo', { headers: { origin: ORIGIN } });
    assert.equal(withOrigin.status, 404);
  });

  it('allows no origin at all by default', async () => {
    const plain = await startTestServer({ routeModules: MODULES });
    try {
      const res = await plain.request('GET', '/api/test/public', { headers: { origin: ORIGIN } });
      assert.equal(res.headers['access-control-allow-origin'], undefined);
      const pre = await plain.request('OPTIONS', '/api/test/echo', {
        headers: { origin: ORIGIN, 'access-control-request-method': 'POST' },
      });
      assert.equal(pre.status, 403);
    } finally {
      await plain.close();
    }
  });
});
