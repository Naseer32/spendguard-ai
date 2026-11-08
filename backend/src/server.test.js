import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';

const SERVER = path.resolve(import.meta.dirname, 'server.js');
const TOKEN = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function parseLines(text) {
  return text
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    })
    .filter((entry) => entry !== null);
}

function runOnce(env) {
  const result = spawnSync(process.execPath, [SERVER], { env, encoding: 'utf8', timeout: 15_000 });
  return { status: result.status, entries: parseLines(result.stdout ?? ''), stdout: result.stdout ?? '' };
}

function startChild(env) {
  const child = spawn(process.execPath, [SERVER], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const entries = [];
  let buffer = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    let index = buffer.indexOf('\n');
    while (index >= 0) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      try { entries.push(JSON.parse(line)); } catch { /* not a log line */ }
      index = buffer.indexOf('\n');
    }
  });
  child.stderr.resume();
  const exited = new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })));
  async function waitFor(event, ms = 10_000) {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      const found = entries.find((entry) => entry.event === event);
      if (found) return found;
      await sleep(25);
    }
    throw new Error(`timed out waiting for ${event}`);
  }
  return { child, entries, exited, waitFor };
}

function get(port, requestPath, token) {
  return new Promise((resolve, reject) => {
    const headers = token === undefined ? {} : { authorization: `Bearer ${token}` };
    http
      .get({ host: '127.0.0.1', port, path: requestPath, headers }, (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
      })
      .on('error', reject);
  });
}

describe('server.js configuration errors', () => {
  it('exits with code 1 and says what is missing, without any value', () => {
    const result = runOnce({});
    assert.equal(result.status, 1);
    const entry = result.entries.find((e) => e.event === 'startup.config_invalid');
    assert.equal(entry.level, 'error');
    assert.ok(entry.problems.includes('OWNER_TOKEN: is required'));
  });

  it('reports every problem and never echoes a value', () => {
    const result = runOnce({ OWNER_TOKEN: TOKEN, PORT: 'not-a-port-secret-value', LOG_LEVEL: 'loud' });
    assert.equal(result.status, 1);
    const entry = result.entries.find((e) => e.event === 'startup.config_invalid');
    assert.equal(entry.problems.length, 2);
    assert.ok(entry.problems.some((p) => p.startsWith('PORT:')));
    assert.ok(entry.problems.some((p) => p.startsWith('LOG_LEVEL:')));
    assert.ok(!result.stdout.includes('not-a-port-secret-value'));
    assert.ok(!result.stdout.includes(TOKEN));
  });
});

describe('server.js as a running process', () => {
  it('starts, serves requests, and shuts down cleanly on SIGTERM', async () => {
    const run = startChild({ OWNER_TOKEN: TOKEN, PORT: '0', DB_PATH: ':memory:' });
    try {
      const started = await run.waitFor('server.started');
      assert.equal(started.host, '127.0.0.1');
      assert.ok(started.port > 0);
      const health = await get(started.port, '/api/health');
      assert.equal(health.status, 200);
      assert.equal((await get(started.port, '/api/agents')).status, 401);
      assert.equal((await get(started.port, '/api/agents', TOKEN)).status, 200);

      run.child.kill('SIGTERM');
      const result = await Promise.race([run.exited, sleep(10_000).then(() => 'timeout')]);
      assert.notEqual(result, 'timeout', 'the process did not exit after SIGTERM');
      assert.equal(result.code, 0);
      assert.ok(run.entries.some((e) => e.event === 'shutdown.started' && e.signal === 'SIGTERM'));
      assert.ok(run.entries.some((e) => e.event === 'server.stopped'));
      assert.ok(!JSON.stringify(run.entries).includes(TOKEN));
    } finally {
      run.child.kill('SIGKILL');
    }
  });

  it('exits with code 1 and a hint when the port is taken', async () => {
    const first = startChild({ OWNER_TOKEN: TOKEN, PORT: '0', DB_PATH: ':memory:' });
    try {
      const started = await first.waitFor('server.started');
      const second = runOnce({ OWNER_TOKEN: TOKEN, PORT: String(started.port), DB_PATH: ':memory:' });
      assert.equal(second.status, 1);
      const failed = second.entries.find((e) => e.event === 'startup.failed');
      assert.equal(failed.code, 'EADDRINUSE');
      assert.equal(failed.hint, 'the port is already in use');
      assert.ok(!second.stdout.includes(TOKEN));
      first.child.kill('SIGTERM');
      assert.equal((await first.exited).code, 0);
    } finally {
      first.child.kill('SIGKILL');
    }
  });
});
