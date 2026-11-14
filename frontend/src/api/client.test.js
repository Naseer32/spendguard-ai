import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApiClient } from './client.js';
import { ApiError } from './errors.js';

function fakeFetch(handler) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    return handler(url, init);
  };
  fn.calls = calls;
  return fn;
}
const json = (status, body, headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (k) => headers[k] ?? null },
  text: async () => (body === undefined ? '' : JSON.stringify(body)),
});

test('owner requests send a Bearer token and safe fetch options', async () => {
  const f = fakeFetch(() => json(200, { data: { agents: [] } }));
  const c = createApiClient({ baseUrl: 'https://api.example.com', getToken: () => 'tok-123', fetchImpl: f });
  const data = await c.request({ path: '/api/agents', query: { status: 'x', skip: undefined, e: '' } });
  assert.deepEqual(data, { agents: [] });
  const { url, init } = f.calls[0];
  assert.equal(url, 'https://api.example.com/api/agents?status=x');
  assert.equal(init.headers.Authorization, 'Bearer tok-123');
  assert.equal(init.credentials, 'omit');
  assert.equal(init.redirect, 'error');
  assert.equal(init.referrerPolicy, 'no-referrer');
});

test('public requests send no Authorization header', async () => {
  const f = fakeFetch(() => json(200, { data: { status: 'ok' } }));
  const c = createApiClient({ getToken: () => 'secret', fetchImpl: f });
  await c.request({ path: '/api/health', auth: 'none' });
  assert.equal('Authorization' in f.calls[0].init.headers, false);
});

test('a missing token is an auth error and nothing is sent', async () => {
  const f = fakeFetch(() => json(200, { data: {} }));
  const c = createApiClient({ getToken: () => null, fetchImpl: f });
  await assert.rejects(c.request({ path: '/api/agents' }), (e) => e.kind === 'auth');
  assert.equal(f.calls.length, 0);
});

test('JSON bodies get a content type', async () => {
  const f = fakeFetch(() => json(200, { data: {} }));
  const c = createApiClient({ getToken: () => 't', fetchImpl: f });
  await c.request({ method: 'POST', path: '/api/agents', body: { a: 1 } });
  assert.equal(f.calls[0].init.headers['Content-Type'], 'application/json');
  assert.equal(f.calls[0].init.body, '{"a":1}');
});

test('bad paths are rejected before any request', async () => {
  const f = fakeFetch(() => json(200, { data: {} }));
  const c = createApiClient({ getToken: () => 't', fetchImpl: f });
  for (const path of ['/agents', '/api/../x', '/api/a b', '/api/a?x=1', '/api/a#h', 'https://evil.example/api/x']) {
    await assert.rejects(c.request({ path }), (e) => e.kind === 'config', path);
  }
  assert.equal(f.calls.length, 0);
});

test('error statuses map to kinds and carry code, field and data', async () => {
  const cases = [
    [401, 'auth'], [403, 'client'], [404, 'client'], [409, 'client'], [422, 'client'], [429, 'rate'], [500, 'server'], [503, 'server'],
  ];
  for (const [status, kind] of cases) {
    const f = fakeFetch(() => json(status, { error: { code: 'X_CODE', message: 'nope', field: 'amount' }, data: { reasons: ['A'] } }, { 'Retry-After': '7' }));
    const c = createApiClient({ getToken: () => 't', fetchImpl: f });
    await assert.rejects(c.request({ path: '/api/agents' }), (e) => {
      assert.ok(e instanceof ApiError);
      assert.equal(e.kind, kind);
      assert.equal(e.status, status);
      assert.equal(e.code, 'X_CODE');
      assert.equal(e.field, 'amount');
      assert.deepEqual(e.data, { reasons: ['A'] });
      if (kind === 'rate') assert.equal(e.retryAfter, 7);
      return true;
    });
  }
});

test('non-JSON failures and odd successes do not crash', async () => {
  let c = createApiClient({ getToken: () => 't', fetchImpl: fakeFetch(() => ({ ok: false, status: 502, headers: { get: () => null }, text: async () => '<html>' })) });
  await assert.rejects(c.request({ path: '/api/agents' }), (e) => e.kind === 'server');
  c = createApiClient({ getToken: () => 't', fetchImpl: fakeFetch(() => json(200, { nope: 1 })) });
  await assert.rejects(c.request({ path: '/api/agents' }), (e) => e.kind === 'shape');
  c = createApiClient({ getToken: () => 't', fetchImpl: fakeFetch(() => json(200, undefined)) });
  await assert.rejects(c.request({ path: '/api/agents' }), (e) => e.kind === 'shape');
});

test('network failures and timeouts are distinct and never leak the token', async () => {
  let c = createApiClient({ getToken: () => 'SECRET-TOKEN', fetchImpl: async () => { throw new TypeError('fetch failed SECRET-TOKEN'); } });
  await assert.rejects(c.request({ path: '/api/agents' }), (e) => {
    assert.equal(e.kind, 'network');
    assert.equal(e.message.includes('SECRET-TOKEN'), false);
    return true;
  });
  c = createApiClient({
    getToken: () => 't', timeoutMs: 10,
    fetchImpl: (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('a'), { name: 'AbortError' })))),
  });
  await assert.rejects(c.request({ path: '/api/agents' }), (e) => e.kind === 'timeout');
});

test('a one-off bearer credential is sent instead of the owner token, and an empty one sends nothing', async () => {
  const f = fakeFetch(() => json(201, { data: { ok: true } }));
  const c = createApiClient({ baseUrl: '', getToken: () => 'owner-tok', fetchImpl: f });
  await c.request({ method: 'POST', path: '/api/v1/payments/evaluate', body: {}, auth: { bearer: 'sgk_agent_key' } });
  assert.equal(f.calls[0].init.headers.Authorization, 'Bearer sgk_agent_key');
  await assert.rejects(
    c.request({ method: 'POST', path: '/api/v1/payments/evaluate', body: {}, auth: { bearer: '' } }),
    (e) => e instanceof ApiError && e.kind === 'auth',
  );
  assert.equal(f.calls.length, 1);
});
