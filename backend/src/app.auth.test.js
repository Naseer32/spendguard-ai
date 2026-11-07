import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createAgent, pauseAgent, rotateApiKey } from './services/agents.js';
import { OWNER_TOKEN, startTestServer } from './testing/httpKit.js';
import { agentInput, svc } from './testing/serviceKit.js';
import { HIGH_FAILURE_LIMIT, MODULES, UNAUTHORIZED, UUID } from './testing/testRoutes.js';

describe('owner authentication', () => {
  let t;
  before(async () => {
    t = await startTestServer({ routeModules: MODULES, env: HIGH_FAILURE_LIMIT });
  });
  after(() => t.close());

  it('accepts the owner token', async () => {
    const res = await t.request('GET', '/api/test/owner', { token: OWNER_TOKEN });
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, { data: { principal: 'owner' } });
    const lower = await t.request('GET', '/api/test/owner', {
      headers: { authorization: `bearer ${OWNER_TOKEN}` },
    });
    assert.equal(lower.status, 200);
  });

  it('answers every authentication failure identically', async () => {
    const attempts = [
      {},
      { token: 'wrong-token-value-0123456789abcdef' },
      { token: `${OWNER_TOKEN}x` },
      { token: OWNER_TOKEN.toUpperCase() },
      { headers: { authorization: `Basic ${OWNER_TOKEN}` } },
      { headers: { authorization: OWNER_TOKEN } },
      { headers: { authorization: `Bearer  ${OWNER_TOKEN}` } },
      { headers: { authorization: 'Bearer' } },
      { headers: { authorization: '' } },
    ];
    for (const options of attempts) {
      const res = await t.request('GET', '/api/test/owner', options);
      assert.equal(res.status, 401, JSON.stringify(options));
      assert.deepEqual(res.json, UNAUTHORIZED);
      assert.equal(res.headers['www-authenticate'], 'Bearer');
    }
  });

  it('checks credentials on HEAD requests too', async () => {
    assert.equal((await t.request('HEAD', '/api/test/owner')).status, 401);
    assert.equal((await t.request('HEAD', '/api/test/owner', { token: OWNER_TOKEN })).status, 200);
  });

  it('authenticates before reading the body', async () => {
    const big = JSON.stringify({ a: 'x'.repeat(20000) });
    const res = await t.request('POST', '/api/test/echo', {
      body: big,
      headers: { 'content-type': 'application/json' },
    });
    assert.equal(res.status, 401);
    const text = await t.request('POST', '/api/test/echo', {
      body: 'not json',
      headers: { 'content-type': 'text/plain' },
    });
    assert.equal(text.status, 401);
  });
});

describe('agent authentication', () => {
  let t;
  let agent;
  let apiKey;
  before(async () => {
    t = await startTestServer({ routeModules: MODULES, env: HIGH_FAILURE_LIMIT });
    ({ agent, apiKey } = createAgent(t.db, agentInput(), svc()));
  });
  after(() => t.close());

  it('accepts the agent key and exposes the agent id', async () => {
    const res = await t.request('GET', '/api/test/agent', { token: apiKey });
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, { data: { principal: 'agent', agentId: agent.id } });
  });

  it('never lets one principal use the other credential', async () => {
    const ownerRoute = await t.request('GET', '/api/test/owner', { token: apiKey });
    assert.equal(ownerRoute.status, 401);
    const agentRoute = await t.request('GET', '/api/test/agent', { token: OWNER_TOKEN });
    assert.equal(agentRoute.status, 401);
    assert.deepEqual(agentRoute.json, UNAUTHORIZED);
  });

  it('rejects wrong, altered and malformed keys', async () => {
    const wrong = [
      apiKey.slice(0, -1) + (apiKey.endsWith('0') ? '1' : '0'),
      `sgk_${UUID}_${'a'.repeat(64)}`,
      `sgk_0123abcd-0123-4abc-8def-0123456789ab_${'f'.repeat(64)}`,
      'sgk_', 'garbage', apiKey.toUpperCase(),
    ];
    for (const token of wrong) {
      const res = await t.request('GET', '/api/test/agent', { token });
      assert.equal(res.status, 401, token);
    }
    assert.equal((await t.request('GET', '/api/test/agent')).status, 401);
  });

  it('stops accepting a key the moment it is rotated', async () => {
    const rotated = rotateApiKey(t.db, agent.id, svc());
    assert.equal((await t.request('GET', '/api/test/agent', { token: apiKey })).status, 401);
    assert.equal((await t.request('GET', '/api/test/agent', { token: rotated.apiKey })).status, 200);
    apiKey = rotated.apiKey;
  });

  it('still authenticates a paused agent (the policy engine blocks its payments)', async () => {
    pauseAgent(t.db, agent.id, svc());
    assert.equal((await t.request('GET', '/api/test/agent', { token: apiKey })).status, 200);
  });
});

describe('rate limits', () => {
  it('blocks a client after too many failed authentications, even with a correct token', async () => {
    const t = await startTestServer({
      routeModules: MODULES,
      env: { RATE_LIMIT_AUTH_FAILURES_PER_MINUTE: '3' },
    });
    try {
      for (let i = 0; i < 3; i += 1) {
        const res = await t.request('GET', '/api/test/owner', {
          token: 'wrong-token-value-0123456789abcdef',
        });
        assert.equal(res.status, 401);
      }
      const blocked = await t.request('GET', '/api/test/owner', { token: OWNER_TOKEN });
      assert.equal(blocked.status, 429);
      assert.equal(blocked.json.error.code, 'RATE_LIMITED');
      assert.ok(Number(blocked.headers['retry-after']) >= 1);
      assert.equal((await t.request('GET', '/api/test/agent')).status, 429);
      assert.equal((await t.request('GET', '/api/test/public')).status, 200); // public routes are unaffected
    } finally {
      await t.close();
    }
  });

  it('does not count successful requests as failures', async () => {
    const t = await startTestServer({
      routeModules: MODULES,
      env: { RATE_LIMIT_AUTH_FAILURES_PER_MINUTE: '3' },
    });
    try {
      for (let i = 0; i < 10; i += 1) {
        assert.equal((await t.request('GET', '/api/test/owner', { token: OWNER_TOKEN })).status, 200);
      }
    } finally {
      await t.close();
    }
  });

  it('limits owner requests per minute', async () => {
    const t = await startTestServer({
      routeModules: MODULES,
      env: { RATE_LIMIT_OWNER_PER_MINUTE: '3' },
    });
    try {
      for (let i = 0; i < 3; i += 1) {
        assert.equal((await t.request('GET', '/api/test/owner', { token: OWNER_TOKEN })).status, 200);
      }
      const limited = await t.request('GET', '/api/test/owner', { token: OWNER_TOKEN });
      assert.equal(limited.status, 429);
      assert.ok(Number(limited.headers['retry-after']) >= 1);
      assert.equal((await t.request('GET', '/api/test/public')).status, 200);
    } finally {
      await t.close();
    }
  });
});
