import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, test } from 'node:test';

import {
  EXIT, assertTestnet, createFileStateStore, deriveIdempotencyKey, nearToYocto, redact, run,
} from './agent.js';

const API_KEY = 'sgk_11111111-2222-3333-4444-555555555555_deadbeefdeadbeefdeadbeef';
const OWNER = 'owner-token-super-secret-value';
const PRIV = 'ed25519:5Ab3kLmNpQrStUvWxYz1234567890abcdefghijkmnopqrstuv';
const TX = '9xKQ3mT7vPz2LcRb4HnYd8WsFjA6eUgXoNiC5tBhVq1Z';
const SOURCE = 'agent-src.testnet';
const RECIPIENT = 'sickzone9097.testnet';
const ONE_TENTH = '100000000000000000000000';
const REQ = '3f2a6f0e-1b7c-4d11-9a55-0a1b2c3d4e5f';

const dirs = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

function tmpStore() {
  const d = mkdtempSync(join(tmpdir(), 'sg-agent-'));
  dirs.push(d);
  return createFileStateStore(join(d, 'state.json'));
}

const baseEnv = () => ({
  BACKEND_URL: 'http://localhost:3000',
  AGENT_API_KEY: API_KEY,
  OWNER_TOKEN: OWNER,
  SOURCE_ACCOUNT: SOURCE,
  SOURCE_PRIVATE_KEY: PRIV,
});

const ARGV = ['send', '0.1', RECIPIENT, 'coffee money'];

function payment(over = {}) {
  return {
    id: REQ, recipient: RECIPIENT, amount: ONE_TENTH, purpose: 'coffee money',
    decision: 'APPROVED', status: 'APPROVED', reasonCodes: ['WITHIN_POLICY'],
    expiresAt: new Date(Date.now() + 600_000).toISOString(), ...over,
  };
}

// A fake backend. `report` decides what tx-report answers; calls are recorded.
function fakeBackend({ evaluate = payment(), report } = {}) {
  const calls = [];
  const reportFn = report ?? (() => ({ status: 200, body: { verdict: 'VERIFIED', action: 'MARK_DONE', reason: 'ok', payment: { status: 'BACKEND_SAYS' } } }));
  const fetchImpl = async (url, init) => {
    const path = new URL(url).pathname;
    calls.push({ method: init.method, path, auth: init.headers.authorization, body: init.body === undefined ? null : JSON.parse(init.body) });
    const reply = (status, body) => ({ ok: status < 400, status, text: async () => JSON.stringify(body) });
    if (path === '/api/v1/payments/evaluate') return reply(201, { payment: evaluate, replayed: false });
    if (path === '/api/agents') return reply(200, { agents: [{ sourceAccount: SOURCE, perTxLimit: '5000000000000000000000000' }] });
    if (path.startsWith('/api/v1/payments/')) return reply(200, { payment: { ...evaluate, status: 'BACKEND_SAYS' } });
    if (path.endsWith('/tx-report')) {
      const r = reportFn();
      if (r instanceof Error) throw r;
      return reply(r.status, r.body);
    }
    return reply(404, { error: { code: 'NOT_FOUND', message: 'nope' } });
  };
  return { fetchImpl, calls };
}

function fakeSender() {
  const sends = [];
  return {
    sends,
    createSender: async () => ({
      send: async (args) => { sends.push(args); return { txHash: TX, signerId: SOURCE }; },
    }),
  };
}

async function runWith({ backend, sender, store, argv = ARGV, env = baseEnv() }) {
  const lines = [];
  const code = await run({
    argv, env,
    deps: { fetchImpl: backend.fetchImpl, createSender: sender.createSender, store, out: (l) => lines.push(l) },
  });
  return { code, text: lines.join('\n') };
}

describe('nearToYocto', () => {
  test('converts with exact integer math', () => {
    assert.equal(nearToYocto('0.1'), ONE_TENTH);
    assert.equal(nearToYocto('1'), '1000000000000000000000000');
    assert.equal(nearToYocto('12.5'), '12500000000000000000000000');
    assert.equal(nearToYocto('0.000000000000000000000001'), '1');
    assert.equal(nearToYocto('0.3'), '300000000000000000000000'); // floats would give 0.30000000000000004
  });

  test('rejects zero, negatives, exponents, junk and over-precise amounts', () => {
    for (const bad of ['0', '0.0', '-1', '1e3', '.5', '1.', ' 1', '0x10', 'abc', '', '0.0000000000000000000000001', '01']) {
      assert.throws(() => nearToYocto(bad), /Amount must be/, `should reject ${JSON.stringify(bad)}`);
    }
  });
});

describe('idempotency key', () => {
  test('is stable for the same command and differs when anything changes', () => {
    const a = { sourceAccount: SOURCE, recipient: RECIPIENT, amountYocto: ONE_TENTH, purpose: 'x' };
    assert.equal(deriveIdempotencyKey(a), deriveIdempotencyKey({ ...a }));
    assert.notEqual(deriveIdempotencyKey(a), deriveIdempotencyKey({ ...a, amountYocto: '1' }));
    assert.notEqual(deriveIdempotencyKey(a), deriveIdempotencyKey({ ...a, salt: 'again' }));
    assert.match(deriveIdempotencyKey(a), /^[A-Za-z0-9._:-]{8,128}$/);
  });
});

describe('only APPROVED is sent', () => {
  for (const [name, over] of [
    ['APPROVAL_REQUIRED', { decision: 'APPROVAL_REQUIRED', status: 'APPROVAL_REQUIRED', reasonCodes: ['RECIPIENT_NOT_ALLOWLISTED'] }],
    ['BLOCKED', { decision: 'BLOCKED', status: 'BLOCKED', reasonCodes: ['EXCEEDS_TX_LIMIT'] }],
    ['APPROVED decision but a different status', { decision: 'APPROVED', status: 'SUBMITTED' }],
    ['expired approval', { expiresAt: new Date(Date.now() - 1000).toISOString() }],
    ['approval for another amount', { amount: '1' }],
  ]) {
    test(`does not send for ${name}`, async () => {
      const backend = fakeBackend({ evaluate: payment(over) });
      const sender = fakeSender();
      const { code, text } = await runWith({ backend, sender, store: tmpStore() });
      assert.equal(sender.sends.length, 0);
      assert.notEqual(code, EXIT.OK);
      assert.equal(backend.calls.some((c) => c.path.endsWith('/tx-report')), false);
      if (over.reasonCodes) assert.match(text, new RegExp(over.reasonCodes[0]));
    });
  }

  test('sends exactly the approved transfer, reports with the owner token, and prints only the backend verdict', async () => {
    const backend = fakeBackend();
    const sender = fakeSender();
    const { code, text } = await runWith({ backend, sender, store: tmpStore() });
    assert.equal(code, EXIT.OK);
    assert.deepEqual(sender.sends, [{ receiverId: RECIPIENT, amountYocto: ONE_TENTH }]);
    const evalCall = backend.calls.find((c) => c.path === '/api/v1/payments/evaluate');
    assert.equal(evalCall.auth, `Bearer ${API_KEY}`);
    assert.deepEqual(Object.keys(evalCall.body).sort(), ['amount', 'idempotencyKey', 'purpose', 'recipient']);
    const report = backend.calls.find((c) => c.path === `/api/payments/${REQ}/tx-report`);
    assert.equal(report.auth, `Bearer ${OWNER}`);
    assert.deepEqual(report.body, { txHash: TX, signerId: SOURCE });
    assert.match(text, /Backend status:\s+BACKEND_SAYS/);
    assert.doesNotMatch(text, /EXECUTED/); // the script never produces that word itself
  });
});

describe('backend verdict is shown, never invented', () => {
  test('HOLD leaves the run unsettled and prints the backend status as returned', async () => {
    const backend = fakeBackend({
      report: () => ({ status: 200, body: { verdict: 'HOLD', action: 'WAIT', reason: 'not final', payment: { status: 'SUBMITTED' } } }),
    });
    const { code, text } = await runWith({ backend, sender: fakeSender(), store: tmpStore() });
    assert.equal(code, EXIT.UNSETTLED);
    assert.match(text, /Backend status:\s+SUBMITTED/);
    assert.doesNotMatch(text, /EXECUTED/);
  });
});

describe('exactly once', () => {
  test('a second run for the same command never sends again and only retries the report', async () => {
    const store = tmpStore();
    const sender = fakeSender();
    let attempt = 0;
    const backend = fakeBackend({
      report: () => (++attempt === 1 ? new Error('boom') : { status: 200, body: { verdict: 'VERIFIED', action: 'A', reason: 'r', payment: { status: 'S2' } } }),
    });

    const first = await runWith({ backend, sender, store });
    assert.equal(first.code, EXIT.UNSETTLED);
    assert.equal(sender.sends.length, 1);
    assert.match(first.text, /Re-run the same command/);

    const second = await runWith({ backend, sender, store });
    assert.equal(second.code, EXIT.OK);
    assert.equal(sender.sends.length, 1, 'no second transfer');
    assert.equal(backend.calls.filter((c) => c.path === '/api/v1/payments/evaluate').length, 1, 'no second evaluation');
    assert.equal(backend.calls.filter((c) => c.path.endsWith('/tx-report')).length, 2);

    const third = await runWith({ backend, sender, store });
    assert.equal(sender.sends.length, 1);
    assert.equal(third.code, EXIT.OK);
    assert.equal(backend.calls.filter((c) => c.path.endsWith('/tx-report')).length, 2, 'settled payments are not re-reported');
  });

  test('refuses to resend when an earlier attempt never recorded a hash', async () => {
    const store = tmpStore();
    const key = deriveIdempotencyKey({ sourceAccount: SOURCE, recipient: RECIPIENT, amountYocto: ONE_TENTH, purpose: 'coffee money' });
    store.begin(key, { phase: 'sending', requestId: REQ });
    const sender = fakeSender();
    const backend = fakeBackend();
    const { code, text } = await runWith({ backend, sender, store });
    assert.equal(code, EXIT.ERROR);
    assert.equal(sender.sends.length, 0);
    assert.equal(backend.calls.length, 0);
    assert.match(text, /may or may not have been sent/);
  });

  test('a failed send is never retried automatically', async () => {
    const store = tmpStore();
    const backend = fakeBackend();
    const failing = { createSender: async () => ({ send: async () => { throw new Error('rpc timeout'); } }) };
    const first = await runWith({ backend, sender: failing, store });
    assert.equal(first.code, EXIT.ERROR);
    const sender = fakeSender();
    const second = await runWith({ backend, sender, store });
    assert.equal(second.code, EXIT.ERROR);
    assert.equal(sender.sends.length, 0);
  });

  test('the state store refuses to begin the same key twice', () => {
    const store = tmpStore();
    store.begin('k', { phase: 'sending' });
    assert.throws(() => store.begin('k', { phase: 'sending' }), /already started/);
  });
});

describe('redaction', () => {
  test('removes keys, bearer tokens and exact secret values', () => {
    const text = `a ${API_KEY} b ${PRIV} c Authorization: Bearer abc.DEF-123 d ${OWNER} e api_key=hunter22 f secp256k1:${'A'.repeat(30)}`;
    const out = redact(text, [OWNER]);
    for (const leaked of [API_KEY, PRIV, 'abc.DEF-123', OWNER, 'hunter22', 'A'.repeat(30)]) {
      assert.equal(out.includes(leaked), false, `leaked ${leaked.slice(0, 8)}`);
    }
    assert.match(out, /\[REDACTED\]/);
  });

  test('a backend error that echoes a secret never reaches the output', async () => {
    const backend = {
      calls: [],
      fetchImpl: async () => ({
        ok: false, status: 401,
        text: async () => JSON.stringify({ error: { code: 'UNAUTHORIZED', message: `bad key ${API_KEY} and ${OWNER}` } }),
      }),
    };
    const { text } = await runWith({ backend, sender: fakeSender(), store: tmpStore() });
    assert.equal(text.includes(API_KEY), false);
    assert.equal(text.includes(OWNER), false);
    assert.match(text, /UNAUTHORIZED/);
  });
});

describe('testnet only', () => {
  const ok = { network: 'testnet', rpcUrl: 'https://rpc.testnet.near.org', sourceAccount: SOURCE, recipient: RECIPIENT };

  test('accepts a testnet setup', () => {
    assert.doesNotThrow(() => assertTestnet(ok));
  });

  test('refuses mainnet network, RPC, accounts and plain http', () => {
    assert.throws(() => assertTestnet({ ...ok, network: 'mainnet' }), /testnet/);
    assert.throws(() => assertTestnet({ ...ok, rpcUrl: 'https://rpc.mainnet.near.org' }), /testnet endpoint/);
    assert.throws(() => assertTestnet({ ...ok, rpcUrl: 'http://rpc.testnet.near.org' }), /https/);
    assert.throws(() => assertTestnet({ ...ok, rpcUrl: 'https://user:pw@rpc.testnet.near.org' }), /https/);
    assert.throws(() => assertTestnet({ ...ok, sourceAccount: 'agent.near' }), /SOURCE_ACCOUNT/);
    assert.throws(() => assertTestnet({ ...ok, recipient: 'bob.near' }), /recipient/);
  });

  test('run() stops before any network call when configured for mainnet', async () => {
    const backend = fakeBackend();
    const sender = fakeSender();
    for (const patch of [{ NEAR_NETWORK: 'mainnet' }, { NEAR_RPC_URL: 'https://rpc.mainnet.near.org' }, { SOURCE_ACCOUNT: 'agent.near' }]) {
      const { code } = await runWith({ backend, sender, store: tmpStore(), env: { ...baseEnv(), ...patch } });
      assert.equal(code, EXIT.ERROR);
    }
    const { code } = await runWith({ backend, sender, store: tmpStore(), argv: ['send', '0.1', 'bob.near', 'x'] });
    assert.equal(code, EXIT.ERROR);
    assert.equal(backend.calls.length, 0);
    assert.equal(sender.sends.length, 0);
  });

  test('secrets are never accepted as options', async () => {
    const { code, text } = await runWith({
      backend: fakeBackend(), sender: fakeSender(), store: tmpStore(),
      argv: ['send', '0.1', RECIPIENT, '--api-key', 'x'],
    });
    assert.equal(code, EXIT.ERROR);
    assert.match(text, /no options/);
  });
});
