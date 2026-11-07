import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createAgent } from './services/agents.js';
import { OWNER_TOKEN, startTestServer } from './testing/httpKit.js';
import { agentInput, svc } from './testing/serviceKit.js';
import { HIGH_FAILURE_LIMIT, MODULES, REQUEST_ID_RE } from './testing/testRoutes.js';

describe('request logging', () => {
  let t;
  let apiKey;
  before(async () => {
    t = await startTestServer({ routeModules: MODULES, env: HIGH_FAILURE_LIMIT });
    ({ apiKey } = createAgent(t.db, agentInput(), svc()));
  });
  after(() => t.close());

  it('logs one structured line per request and never secrets', async () => {
    const wrongToken = 'wrong-secret-token-value-xyz-123456';
    await t.request('GET', '/api/test/owner', { token: OWNER_TOKEN });
    await t.request('GET', '/api/test/owner', { token: wrongToken });
    await t.request('GET', '/api/test/agent', { token: apiKey });
    await t.request('POST', '/api/test/echo', { token: OWNER_TOKEN, json: { purpose: 'super-secret-purpose' } });
    await t.request('GET', '/api/test/query?limit=5&token=abc');

    const text = t.logs.join('\n');
    const secrets = [
      OWNER_TOKEN, wrongToken, apiKey, apiKey.slice(-64), 'super-secret-purpose', 'Bearer', 'authorization',
    ];
    for (const secret of secrets) {
      assert.ok(!text.includes(secret), `logs contain ${secret.slice(0, 12)}...`);
    }

    const entries = t.logs.map((line) => JSON.parse(line)).filter((e) => e.event === 'http.request');
    assert.equal(entries.length, 5);
    for (const entry of entries) {
      assert.match(entry.requestId, REQUEST_ID_RE);
      assert.equal(typeof entry.method, 'string');
      assert.equal(typeof entry.status, 'number');
      assert.equal(typeof entry.durationMs, 'number');
      assert.equal(entry.ip, '127.0.0.1');
    }
    assert.deepEqual(entries.map((e) => e.status), [200, 401, 200, 201, 400]);
    assert.deepEqual(entries.map((e) => e.level), ['info', 'warn', 'info', 'info', 'warn']);
    assert.equal(entries[0].principal, 'owner');
    assert.equal(entries[2].principal, 'agent');
    assert.match(entries[2].agentId, REQUEST_ID_RE);
    assert.equal(entries[4].path, '/api/test/query'); // the query string is not logged
  });
});
