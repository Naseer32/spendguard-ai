import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from './config.js';
import { openDatabase } from './db/database.js';
import { createLogger } from './http/logger.js';
import { nearToYocto as N } from './money/yocto.js';
import { SERVER_TIMEOUTS, startServer } from './runtime.js';
import { OWNER_TOKEN } from './testing/httpKit.js';
import { HOUR, makeClock } from './testing/ownerKit.js';
import { agentInput } from './testing/serviceKit.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function makeConfig(env = {}) {
  return loadConfig({ OWNER_TOKEN, PORT: '0', DB_PATH: ':memory:', ...env });
}

function makeLogs() {
  const lines = [];
  const logger = createLogger({ level: 'debug', write: (line) => lines.push(line) });
  return { logger, entries: () => lines.map((line) => JSON.parse(line)), text: () => lines.join('\n') };
}

function call(port, method, path, { token, json, agent } = {}) {
  return new Promise((resolve, reject) => {
    const headers = {};
    if (token !== undefined) headers.authorization = `Bearer ${token}`;
    let payload;
    if (json !== undefined) {
      payload = JSON.stringify(json);
      headers['content-type'] = 'application/json';
      headers['content-length'] = String(Buffer.byteLength(payload));
    }
    const req = http.request({ host: '127.0.0.1', port, method, path, headers, agent: agent ?? false }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let parsed = null;
        try { parsed = JSON.parse(text); } catch { parsed = null; }
        resolve({ status: res.statusCode, json: parsed, text });
      });
    });
    req.on('error', reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

describe('starting and stopping', () => {
  it('serves requests and refuses connections after close', async () => {
    const logs = makeLogs();
    const running = await startServer({ config: makeConfig(), logger: logs.logger });
    const { port } = running;
    try {
      assert.ok(Number.isInteger(port) && port > 0);
      assert.equal((await call(port, 'GET', '/api/health')).status, 200);
      assert.equal((await call(port, 'GET', '/api/agents')).status, 401);
      const created = await call(port, 'POST', '/api/agents', { token: OWNER_TOKEN, json: agentInput() });
      assert.equal(created.status, 201);
    } finally {
      await running.close();
    }
    await running.close(); // closing twice is fine
    await assert.rejects(call(port, 'GET', '/api/health'), (error) => error.code === 'ECONNREFUSED');
    assert.ok(logs.entries().some((e) => e.event === 'server.stopped'));
  });

  it('applies the network timeouts', async () => {
    const running = await startServer({ config: makeConfig(), logger: makeLogs().logger });
    try {
      assert.equal(running.server.headersTimeout, SERVER_TIMEOUTS.headersTimeout);
      assert.equal(running.server.requestTimeout, SERVER_TIMEOUTS.requestTimeout);
      assert.equal(running.server.keepAliveTimeout, SERVER_TIMEOUTS.keepAliveTimeout);
      assert.deepEqual({ ...SERVER_TIMEOUTS }, { headersTimeout: 15_000, requestTimeout: 30_000, keepAliveTimeout: 5_000 });
    } finally {
      await running.close();
    }
  });

  it('logs a startup line without any secret', async () => {
    const logs = makeLogs();
    const config = makeConfig({ CORS_ORIGINS: 'https://app.example.com' });
    const running = await startServer({ config, logger: logs.logger });
    await running.close();
    const started = logs.entries().find((e) => e.event === 'server.started');
    assert.equal(started.host, '127.0.0.1');
    assert.equal(started.port, running.port);
    assert.equal(started.dbPath, ':memory:');
    assert.deepEqual(started.corsOrigins, ['https://app.example.com']);
    assert.equal(started.settings.authorizationWindowMs, 3_600_000);
    assert.ok(started.routes >= 20);
    assert.ok(!logs.text().includes(OWNER_TOKEN));
    assert.ok(!logs.text().includes(config.ownerTokenHash));
  });

  it('rejects invalid arguments', async () => {
    const { logger } = makeLogs();
    await assert.rejects(startServer(), TypeError);
    await assert.rejects(startServer({ config: {}, logger }), TypeError);
    await assert.rejects(startServer({ config: makeConfig(), logger: {} }), TypeError);
    await assert.rejects(startServer({ config: makeConfig(), logger, graceMs: -1 }), TypeError);
    await assert.rejects(startServer({ config: makeConfig(), logger, routeModules: [5] }), TypeError);
  });

  it('fails cleanly when the port is already in use', async () => {
    const first = await startServer({ config: makeConfig(), logger: makeLogs().logger });
    try {
      await assert.rejects(
        startServer({ config: makeConfig({ PORT: String(first.port) }), logger: makeLogs().logger }),
        (error) => error.code === 'EADDRINUSE',
      );
      assert.equal((await call(first.port, 'GET', '/api/health')).status, 200); // the first one is unaffected
    } finally {
      await first.close();
    }
  });

  it('only closes a database it opened itself', async () => {
    const own = await startServer({ config: makeConfig(), logger: makeLogs().logger });
    await own.close();
    assert.throws(() => own.db.prepare('SELECT 1').get());

    const shared = openDatabase(':memory:');
    const running = await startServer({ config: makeConfig(), logger: makeLogs().logger, db: shared });
    assert.equal(running.db, shared);
    await running.close();
    assert.doesNotThrow(() => shared.prepare('SELECT 1').get());
    shared.close();
  });

  it('closes quickly even with an idle keep-alive connection open', async () => {
    const running = await startServer({ config: makeConfig(), logger: makeLogs().logger });
    const agent = new http.Agent({ keepAlive: true });
    try {
      assert.equal((await call(running.port, 'GET', '/api/health', { agent })).status, 200);
      const started = Date.now();
      await Promise.race([
        running.close(),
        sleep(3000).then(() => { throw new Error('close() took longer than 3 seconds'); }),
      ]);
      assert.ok(Date.now() - started < 3000);
    } finally {
      agent.destroy();
    }
  });
});

describe('persistence across restarts', () => {
  it('keeps data in a file database after a restart', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spendguard-runtime-'));
    const file = path.join(dir, 'app.sqlite');
    try {
      const first = await startServer({ config: makeConfig({ DB_PATH: file }), logger: makeLogs().logger });
      let agentId;
      try {
        const created = await call(first.port, 'POST', '/api/agents', {
          token: OWNER_TOKEN, json: agentInput({ name: 'Survivor' }),
        });
        assert.equal(created.status, 201);
        agentId = created.json.data.agent.id;
      } finally {
        await first.close();
      }
      const second = await startServer({ config: makeConfig({ DB_PATH: file }), logger: makeLogs().logger });
      try {
        const read = await call(second.port, 'GET', `/api/agents/${agentId}`, { token: OWNER_TOKEN });
        assert.equal(read.status, 200);
        assert.equal(read.json.data.agent.name, 'Survivor');
        const verified = await call(second.port, 'GET', '/api/audit/verify', { token: OWNER_TOKEN });
        assert.equal(verified.json.data.verification.valid, true);
      } finally {
        await second.close();
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('expiry sweeping inside the server', () => {
  async function setupPending(running) {
    const created = await call(running.port, 'POST', '/api/agents', { token: OWNER_TOKEN, json: agentInput() });
    const apiKey = created.json.data.apiKey;
    const evaluated = await call(running.port, 'POST', '/api/v1/payments/evaluate', {
      token: apiKey,
      json: { idempotencyKey: 'sweep-test-0001', recipient: 'other.testnet', amount: N('1') },
    });
    assert.equal(evaluated.status, 201);
    assert.equal(evaluated.json.data.payment.status, 'APPROVAL_REQUIRED');
    return evaluated.json.data.payment.id;
  }
  const statusOf = async (running, id) =>
    (await call(running.port, 'GET', `/api/payments/${id}`, { token: OWNER_TOKEN })).json.data.payment.status;

  it('can be triggered manually', async () => {
    const clock = makeClock();
    const running = await startServer({ config: makeConfig(), logger: makeLogs().logger, now: clock.now });
    try {
      const id = await setupPending(running);
      assert.equal(await statusOf(running, id), 'APPROVAL_REQUIRED');
      clock.advance(24 * HOUR);
      assert.equal(running.sweeper.runNow().expired, 1);
      assert.equal(await statusOf(running, id), 'EXPIRED');
    } finally {
      await running.close();
    }
  });

  it('runs on its own timer', async () => {
    const clock = makeClock();
    const config = makeConfig({ SWEEP_INTERVAL_MS: '1000' });
    const running = await startServer({ config, logger: makeLogs().logger, now: clock.now });
    try {
      const id = await setupPending(running);
      clock.advance(24 * HOUR);
      let status = 'APPROVAL_REQUIRED';
      for (let i = 0; i < 60 && status !== 'EXPIRED'; i += 1) {
        await sleep(100);
        status = await statusOf(running, id);
      }
      assert.equal(status, 'EXPIRED');
      assert.ok(running.sweeper.stats().runs >= 1);
    } finally {
      await running.close();
    }
  });

  it('stops sweeping once the server is closed', async () => {
    const running = await startServer({
      config: makeConfig({ SWEEP_INTERVAL_MS: '1000' }), logger: makeLogs().logger,
    });
    await running.close();
    assert.equal(running.sweeper.stats().running, false);
  });
});
