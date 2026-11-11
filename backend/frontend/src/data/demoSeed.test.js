// Safety invariants for the demo data: it must never look like real chain data
// or contain secrets, and it must stay consistent with the UI vocabulary.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createDemoState } from './demoSeed.js';
import { REASON_INFO } from '../lib/reasons.js';
import { STATUS_META } from '../lib/status.js';
import { isValidNearAccountId } from '../lib/validation.js';
import { isYoctoString } from '../lib/money.js';

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = join(here, '..');
const demo = createDemoState(Date.parse('2026-11-10T12:00:00Z'));

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

test('demo data is internally consistent', () => {
  const agentIds = new Set(demo.agents.map((a) => a.id));
  assert.ok(demo.agents.length >= 3);
  for (const r of demo.requests) {
    assert.ok(agentIds.has(r.agentId), `${r.id} references a real demo agent`);
    assert.ok(isYoctoString(r.amount), `${r.id} amount is a yocto string`);
    assert.ok(STATUS_META[r.status], `${r.id} has a known status`);
    for (const code of r.reasonCodes) assert.ok(REASON_INFO[code], `known reason ${code}`);
    // Backend rule: a BLOCKED decision always has BLOCKED status.
    if (r.decision === 'BLOCKED') assert.equal(r.status, 'BLOCKED');
  }
  for (const rec of demo.recipients) assert.ok(agentIds.has(rec.agentId));
  demo.audit.forEach((e, i) => assert.equal(e.seq, i + 1));
});

test('agent limits obey approvalThreshold <= perTxLimit <= dailyBudget', () => {
  for (const a of demo.agents) {
    assert.ok(BigInt(a.approvalThreshold) <= BigInt(a.perTxLimit), a.id);
    assert.ok(BigInt(a.perTxLimit) <= BigInt(a.dailyBudget), a.id);
  }
});

test('every demo account id is valid-format but clearly fake (.example)', () => {
  const accounts = [
    ...demo.agents.map((a) => a.sourceAccount),
    ...demo.recipients.map((r) => r.accountId),
    ...demo.requests.map((r) => r.recipient),
  ];
  for (const acct of accounts) {
    assert.ok(isValidNearAccountId(acct), acct);
    assert.ok(acct.endsWith('.example') && acct.startsWith('demo-'), `${acct} must be clearly fake`);
  }
});

test('demo data contains no transaction hashes, keys or hash-like values', () => {
  const json = JSON.stringify(demo);
  assert.ok(!/sgk_/i.test(json), 'no API keys');
  assert.ok(!/\b[0-9a-f]{64}\b/i.test(json), 'no 64-hex hashes');
  assert.ok(!/\b[1-9A-HJ-NP-Za-km-z]{43,44}\b/.test(json), 'no base58 NEAR tx hashes');
  for (const r of demo.requests) {
    for (const key of ['txHash', 'transactionHash', 'nearTxHash', 'hash']) {
      assert.ok(!(key in r), `request must not carry ${key}`);
    }
  }
  for (const e of demo.audit) assert.ok(!('hash' in e) && !('prevHash' in e));
});

test('demo free-text is labelled as demo', () => {
  for (const a of demo.agents) assert.match(a.name, /^Demo /);
  for (const r of demo.requests) assert.match(r.purpose, /^Demo:/);
});

test('source has no secrets, key material or real-network endpoints', () => {
  const files = walk(srcRoot).filter((f) => /\.(jsx?|css)$/.test(f) && !f.endsWith('.test.js'));
  assert.ok(files.length > 10);
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    const rel = f.slice(srcRoot.length + 1);
    assert.ok(!/sgk_[0-9a-f]{8}-/.test(text), `${rel}: API key literal`);
    assert.ok(!/\b[0-9a-f]{64}\b/i.test(text), `${rel}: 64-hex literal`);
    assert.ok(!/ed25519:/i.test(text), `${rel}: NEAR key literal`);
    assert.ok(!/https?:\/\/(?!www\.w3\.org)/.test(text), `${rel}: unexpected network URL`);
    assert.ok(!/\bfetch\s*\(|XMLHttpRequest|axios|WebSocket/.test(text), `${rel}: network call (no backend integration yet)`);
  }
});

test('reason codes cover every backend reason (when the backend folder is present)', async () => {
  const path = join(srcRoot, '..', '..', 'backend', 'src', 'policy', 'reasonCodes.js');
  if (!existsSync(path)) return; // frontend checked out on its own
  const { REASON } = await import(pathToFileURL(path).href);
  for (const code of Object.values(REASON)) {
    assert.ok(REASON_INFO[code], `frontend is missing reason code ${code}`);
  }
});
