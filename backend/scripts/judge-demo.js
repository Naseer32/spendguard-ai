// Zero-setup demo of the AMANA Guard policy flow. No NEAR account, no wallet, no keys, no network.
//
//   cd backend && npm install && npm run demo
//
// It starts a throwaway backend (random owner token, temporary database, random port), creates an agent,
// then sends payment requests as that agent and prints the decision for each. Nothing is paid.
// To pay and verify a real NEAR Testnet transfer, follow the README ("Run the autonomous agent").

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const NEAR = (n) => (BigInt(Math.round(n * 1e4)) * 10n ** 20n).toString(); // 4 decimals is enough for a demo
const PORT = 3900 + Math.floor(Math.random() * 90);
const BASE = `http://127.0.0.1:${PORT}`;
const OWNER = randomBytes(32).toString('hex');
const dir = mkdtempSync(join(tmpdir(), 'spendguard-demo-'));
const server = spawn(process.execPath, [fileURLToPath(new URL('../src/server.js', import.meta.url))], {
  env: { ...process.env, OWNER_TOKEN: OWNER, PORT: String(PORT), HOST: '127.0.0.1', DB_PATH: join(dir, 'demo.sqlite'), LOG_LEVEL: 'error' },
  stdio: ['ignore', 'ignore', 'inherit'],
});

function stop(code) {
  server.kill();
  rmSync(dir, { recursive: true, force: true });
  process.exit(code);
}

async function call(method, path, token, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${json?.error?.code}: ${json?.error?.message}`);
  return json.data;
}

async function waitForServer() {
  for (let i = 0; i < 50; i += 1) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('The demo backend did not start.');
}

const line = (s = '') => console.log(s);

try {
  await waitForServer();
  const owner = (m, p, b) => call(m, p, OWNER, b);

  line('AMANA Guard policy demo (nothing is paid, no NEAR account needed)');
  line('');
  const { agent, apiKey } = await owner('POST', '/api/agents', {
    name: 'demo-agent',
    sourceAccount: 'demo-agent.testnet',
    dailyBudget: NEAR(10),
    perTxLimit: NEAR(5),
    approvalThreshold: NEAR(2),
  });
  line('Owner created an agent. Limits: daily 10 NEAR, per payment 5 NEAR, owner approval above 2 NEAR.');
  await owner('PUT', `/api/agents/${agent.id}/recipients/trusted.testnet`, { listType: 'ALLOW', note: 'known supplier' });
  await owner('PUT', `/api/agents/${agent.id}/recipients/scammer.testnet`, { listType: 'BLOCK', note: 'reported scam' });
  line('Recipient lists: trusted.testnet is allowed, scammer.testnet is blocked.');
  line('');

  const ask = async (label, recipient, amount, key) => {
    const { payment, replayed } = await call('POST', '/api/v1/payments/evaluate', apiKey, {
      idempotencyKey: key ?? `judge-demo-${randomBytes(6).toString('hex')}`, recipient, amount: NEAR(amount), purpose: label,
    });
    line(`Agent asks: ${String(amount).padStart(4)} NEAR to ${recipient.padEnd(18)} -> ${payment.decision.padEnd(17)} ${payment.reasonCodes.join(', ')}${replayed ? ' (replayed, same request, no double reservation)' : ''}`);
    return payment;
  };

  await ask('within limits to an allowed recipient', 'trusted.testnet', 0.5, 'judge-demo-fixed-key-1');
  await ask('within limits to an allowed recipient', 'trusted.testnet', 0.5, 'judge-demo-fixed-key-1');
  const held = await ask('unknown recipient', 'stranger.testnet', 0.5);
  await ask('blocked recipient', 'scammer.testnet', 0.5);
  await ask('over the per-payment limit', 'trusted.testnet', 6);
  await ask('above the approval threshold', 'trusted.testnet', 3);

  line('');
  line('The owner reviews the held request from the unknown recipient and approves it:');
  const approved = await owner('POST', `/api/payments/${held.id}/approve`, { comment: 'checked, fine' });
  line(`  status is now ${approved.payment.status} (the agent may now pay it; it is only marked executed after the transaction is verified on NEAR)`);

  const audit = (await owner('GET', '/api/audit/verify')).verification;
  line('');
  line(`Audit log check: ${audit?.valid ? 'valid' : 'INVALID'}, ${audit?.entries} entries (tamper-evident hash chain)`);
  line('');
  line('Next: pay and verify a real NEAR Testnet transfer with the agent demo. See the README.');
  stop(0);
} catch (error) {
  console.error(`Demo failed: ${error.message}`);
  stop(1);
}
