import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { migrate, openDatabase } from './db/database.js';
import { createLogger } from './http/logger.js';
import { createSubmittedSweeper } from './submittedSweeper.js';
import { evaluatePaymentRequest } from './services/payments.js';
import { setRecipient } from './services/recipients.js';
import { getReservation } from './services/reservations.js';
import { reportTransaction } from './services/transactions.js';
import { RpcTimeoutError } from './near/rpcErrors.js';
import { auditEvents, seedAgent } from './testing/serviceKit.js';
import {
  DEPOSIT, FIXTURE_FILES, RECIPIENT_ACCOUNT, SOURCE_ACCOUNT, SUCCESS_TX_HASH, loadFixture,
} from './testing/nearFixtures.js';

const blockMs = Number(BigInt(loadFixture(FIXTURE_FILES.block).header.timestamp_nanosec) / 1_000_000n);
const AUTH_MS = blockMs - 30 * 60_000;
const REPORT_MS = blockMs + 5 * 60_000;
const SWEEP_MS = blockMs + 10 * 60_000;
const ctx = (now, actor = 'owner') => ({ now, actor });
const logs = () => createLogger({ level: 'debug', write: () => {}, now: () => SWEEP_MS });

function fakeRpc({ tx = loadFixture(FIXTURE_FILES.success), status = { chain_id: 'testnet' }, delayMs = 0 } = {}) {
  const table = { tx, status, block: loadFixture(FIXTURE_FILES.block) };
  return {
    async call(method) {
      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
      const value = table[method];
      if (value instanceof Error) throw value;
      return structuredClone(value);
    },
  };
}

// An APPROVED request that the owner reported once, with an inconclusive result: SUBMITTED.
async function submitted() {
  const db = openDatabase();
  if (db.prepare("SELECT name FROM sqlite_master WHERE name = 'agents'").get() === undefined) migrate(db);
  const { agent } = seedAgent(db, { sourceAccount: SOURCE_ACCOUNT }, ctx(AUTH_MS));
  setRecipient(db, agent.id, { accountId: RECIPIENT_ACCOUNT, listType: 'ALLOW' }, ctx(AUTH_MS));
  evaluatePaymentRequest(
    db, agent.id,
    { idempotencyKey: 'sweeper-test-key-1', recipient: RECIPIENT_ACCOUNT, amount: DEPOSIT },
    ctx(AUTH_MS, `agent:${agent.id}`), undefined,
  );
  const { id } = db.prepare('SELECT id FROM payment_requests LIMIT 1').get();
  const first = await reportTransaction(
    db, fakeRpc({ tx: new RpcTimeoutError() }), id, { txHash: SUCCESS_TX_HASH, signerId: SOURCE_ACCOUNT }, ctx(REPORT_MS),
  );
  assert.equal(first.request.status, 'SUBMITTED');
  return { db, id };
}

const sweeper = (db, rpc, over = {}) => createSubmittedSweeper({
  db, rpc, logger: logs(), now: () => SWEEP_MS, intervalMs: 1000, ...over,
});
const status = (db, id) => db.prepare('SELECT status FROM payment_requests WHERE id = ?').get(id).status;

describe('submitted sweeper', () => {
  it('validates its options', async () => {
    const { db } = await submitted();
    const ok = { db, rpc: fakeRpc(), logger: logs(), intervalMs: 1000 };
    for (const bad of [undefined, null, 'x', {}, { ...ok, db: null }, { ...ok, rpc: {} }, { ...ok, logger: {} },
      { ...ok, now: 'x' }, { ...ok, intervalMs: 0 }, { ...ok, batchLimit: 0 }, { ...ok, batchLimit: 101 }]) {
      assert.throws(() => createSubmittedSweeper(bad), TypeError);
    }
    assert.doesNotThrow(() => createSubmittedSweeper(ok));
  });

  it('settles a stuck SUBMITTED payment once the chain can be read, using the real fixture', async () => {
    const { db, id } = await submitted();
    const res = await sweeper(db, fakeRpc()).runNow();
    assert.equal(res.ok, true);
    assert.equal(res.settled, 1);
    assert.equal(status(db, id), 'EXECUTED');
    assert.equal(getReservation(db, id).status, 'CONSUMED');
    assert.ok(auditEvents(db).some((e) => e.event === 'PAYMENT_EXECUTED' && e.actor === 'system'));
  });

  it('changes nothing and audits nothing while the RPC is still inconclusive', async () => {
    const { db, id } = await submitted();
    const before = auditEvents(db).length;
    const res = await sweeper(db, fakeRpc({ tx: new RpcTimeoutError() })).runNow();
    assert.equal(res.inconclusive, 1);
    assert.equal(status(db, id), 'SUBMITTED');
    assert.equal(getReservation(db, id).status, 'ACTIVE');
    assert.equal(auditEvents(db).length, before);
  });

  it('keeps a HOLD in place and does not audit it on every sweep', async () => {
    const { db, id } = await submitted();
    const before = auditEvents(db).length;
    const s = sweeper(db, fakeRpc({ status: { chain_id: 'mainnet' } }));
    for (let i = 0; i < 3; i += 1) assert.equal((await s.runNow()).held, 1);
    assert.equal(status(db, id), 'SUBMITTED');
    assert.equal(getReservation(db, id).status, 'ACTIVE');
    assert.equal(auditEvents(db).length, before);
  });

  it('releases the budget for a verified failure found on a later sweep', async () => {
    const { db, id } = await submitted();
    const tx = loadFixture(FIXTURE_FILES.success);
    tx.receipts_outcome[0].outcome.status = { Failure: { ActionError: {} } };
    await sweeper(db, fakeRpc({ tx })).runNow();
    assert.equal(status(db, id), 'FAILED');
    assert.equal(getReservation(db, id).status, 'RELEASED');
  });

  it('skips a run while another is in flight and never throws', async () => {
    const { db, id } = await submitted();
    const s = sweeper(db, fakeRpc({ delayMs: 30 }));
    const [a, b] = await Promise.all([s.runNow(), s.runNow()]);
    assert.equal([a, b].filter((r) => r.skipped).length, 1);
    assert.equal(status(db, id), 'EXECUTED');
    const broken = sweeper(db, { async call() { throw new Error('boom'); } });
    assert.equal((await broken.runNow()).ok, true);
  });

  it('starts and stops its timer', async () => {
    const { db } = await submitted();
    const s = sweeper(db, fakeRpc());
    s.start(); s.start();
    assert.equal(s.stats().running, true);
    s.stop();
    assert.equal(s.stats().running, false);
  });
});
