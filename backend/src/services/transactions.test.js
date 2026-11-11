import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { migrate, openDatabase, isInWriteTransaction } from '../db/database.js';
import { reportTransaction } from './transactions.js';
import { evaluatePaymentRequest } from './payments.js';
import { setRecipient } from './recipients.js';
import { getReservation } from './reservations.js';
import { ConflictError } from './errors.js';
import { RpcTimeoutError } from '../near/rpcErrors.js';
import { auditEvents, seedAgent } from '../testing/serviceKit.js';
import {
  DEPOSIT, FIXTURE_FILES, RECIPIENT_ACCOUNT, SOURCE_ACCOUNT, SUCCESS_TX_HASH, loadFixture,
} from '../testing/nearFixtures.js';

const blockMs = Number(BigInt(loadFixture(FIXTURE_FILES.block).header.timestamp_nanosec) / 1_000_000n);
const AUTH_MS = blockMs - 30 * 60_000; // approved 30 minutes before the block
const REPORT_MS = blockMs + 5 * 60_000; // reported 5 minutes after it
const ctx = (now, actor = 'owner') => ({ now, actor });
const real = () => structuredClone(loadFixture(FIXTURE_FILES.success));

function setup() {
  const db = openDatabase();
  if (db.prepare("SELECT name FROM sqlite_master WHERE name = 'agents'").get() === undefined) migrate(db);
  const { agent } = seedAgent(db, { sourceAccount: SOURCE_ACCOUNT }, ctx(AUTH_MS));
  setRecipient(db, agent.id, { accountId: RECIPIENT_ACCOUNT, listType: 'ALLOW' }, ctx(AUTH_MS));
  let n = 0;
  const approved = () => {
    n += 1;
    evaluatePaymentRequest(
      db, agent.id,
      { idempotencyKey: `report-test-key-${n}`, recipient: RECIPIENT_ACCOUNT, amount: DEPOSIT },
      ctx(AUTH_MS, `agent:${agent.id}`), undefined,
    );
    return db.prepare('SELECT id, status FROM payment_requests ORDER BY created_at DESC, rowid DESC LIMIT 1').get();
  };
  return { db, agent, approved };
}

function fakeRpc(db, { tx = real(), status = { chain_id: 'testnet' }, block = loadFixture(FIXTURE_FILES.block) } = {}) {
  const calls = [];
  const table = { tx, status, block };
  return {
    calls,
    async call(method) {
      assert.equal(isInWriteTransaction(db), false, 'RPC must run outside a write transaction');
      calls.push(method);
      const value = table[method];
      if (value instanceof Error) throw value;
      return structuredClone(value);
    },
  };
}

const report = (db, rpc, id, over = {}) =>
  reportTransaction(db, rpc, id, { txHash: SUCCESS_TX_HASH, signerId: SOURCE_ACCOUNT, ...over }, ctx(REPORT_MS));
const reservation = (db, id) => getReservation(db, id).status;
const txRow = (db, id) => db.prepare('SELECT * FROM transactions WHERE request_id = ?').get(id);

describe('reportTransaction: verified', () => {
  it('executes the real successful transfer and consumes the reservation', async () => {
    const { db, approved } = setup();
    const p = approved();
    assert.equal(p.status, 'APPROVED');
    const res = await report(db, fakeRpc(db), p.id);
    assert.equal(res.verdict, 'VERIFIED');
    assert.equal(res.request.status, 'EXECUTED');
    assert.equal(reservation(db, p.id), 'CONSUMED');
    assert.equal(txRow(db, p.id).verification_status, 'VERIFIED');
    assert.notEqual(txRow(db, p.id).verified_at, null);
    const events = auditEvents(db).filter((e) => e.entityId === p.id).map((e) => e.event);
    assert.ok(events.includes('PAYMENT_SUBMITTED'));
    assert.ok(events.includes('PAYMENT_EXECUTED'));
  });
});

describe('reportTransaction: nothing is settled without evidence', () => {
  it('stays SUBMITTED and writes nothing on a timeout, then verifies on retry', async () => {
    const { db, approved } = setup();
    const p = approved();
    const first = await report(db, fakeRpc(db, { tx: new RpcTimeoutError() }), p.id);
    assert.equal(first.verdict, 'INCONCLUSIVE');
    assert.equal(first.request.status, 'SUBMITTED');
    assert.equal(reservation(db, p.id), 'ACTIVE');
    assert.equal(txRow(db, p.id).verification_status, 'PENDING');
    const auditCount = auditEvents(db).length;

    const second = await report(db, fakeRpc(db, { tx: new RpcTimeoutError() }), p.id);
    assert.equal(second.verdict, 'INCONCLUSIVE');
    assert.equal(auditEvents(db).length, auditCount, 'INCONCLUSIVE must not add audit entries');

    const third = await report(db, fakeRpc(db), p.id);
    assert.equal(third.verdict, 'VERIFIED');
    assert.equal(third.request.status, 'EXECUTED');
    assert.equal(reservation(db, p.id), 'CONSUMED');
  });

  it('releases the budget for a verified failure with matching details', async () => {
    const { db, approved } = setup();
    const p = approved();
    const tx = real(); tx.receipts_outcome[0].outcome.status = { Failure: { ActionError: {} } };
    const res = await report(db, fakeRpc(db, { tx }), p.id);
    assert.equal(res.verdict, 'FAILED');
    assert.equal(res.request.status, 'FAILED');
    assert.equal(reservation(db, p.id), 'RELEASED');
    assert.equal(txRow(db, p.id).verification_status, 'FAILED');
  });

  it('keeps the budget held on a mismatch', async () => {
    const { db, approved } = setup();
    const p = approved();
    const tx = real(); tx.transaction.actions[0].Transfer.deposit = '1';
    const res = await report(db, fakeRpc(db, { tx }), p.id);
    assert.equal(res.verdict, 'MISMATCH');
    assert.equal(res.request.status, 'MISMATCH');
    assert.equal(reservation(db, p.id), 'ACTIVE');
    assert.equal(txRow(db, p.id).verification_status, 'MISMATCH');
  });

  it('holds on another chain: still SUBMITTED, reservation held, audited', async () => {
    const { db, approved } = setup();
    const p = approved();
    const res = await report(db, fakeRpc(db, { status: { chain_id: 'mainnet' } }), p.id);
    assert.equal(res.verdict, 'HOLD');
    assert.equal(res.request.status, 'SUBMITTED');
    assert.equal(reservation(db, p.id), 'ACTIVE');
    assert.equal(txRow(db, p.id).verification_status, 'PENDING');
    assert.ok(auditEvents(db).some((e) => e.event === 'PAYMENT_VERIFICATION_HOLD' && e.entityId === p.id));
  });
});

describe('reportTransaction: refusals happen before any RPC call', () => {
  it('rejects a signer that is not the agent source account', async () => {
    const { db, approved } = setup();
    const p = approved();
    const rpc = fakeRpc(db);
    await assert.rejects(report(db, rpc, p.id, { signerId: RECIPIENT_ACCOUNT }),
      (e) => e instanceof ConflictError && e.code === 'SIGNER_NOT_SOURCE');
    assert.deepEqual(rpc.calls, []);
    assert.equal(db.prepare('SELECT status FROM payment_requests WHERE id = ?').get(p.id).status, 'APPROVED');
  });

  it('rejects a hash already used by another request', async () => {
    const { db, approved } = setup();
    const a = approved();
    await report(db, fakeRpc(db), a.id);
    const b = approved();
    const rpc = fakeRpc(db);
    await assert.rejects(report(db, rpc, b.id),
      (e) => e instanceof ConflictError && e.code === 'HASH_ALREADY_USED');
    assert.deepEqual(rpc.calls, []);
  });

  it('rejects a second, different hash for a SUBMITTED request', async () => {
    const { db, approved } = setup();
    const p = approved();
    await report(db, fakeRpc(db, { tx: new RpcTimeoutError() }), p.id);
    await assert.rejects(report(db, fakeRpc(db), p.id, { txHash: 'B'.repeat(44) }),
      (e) => e instanceof ConflictError && e.code === 'HASH_DIFFERS');
  });

  it('rejects a request that is already EXECUTED', async () => {
    const { db, approved } = setup();
    const p = approved();
    await report(db, fakeRpc(db), p.id);
    await assert.rejects(report(db, fakeRpc(db), p.id),
      (e) => e instanceof ConflictError && e.code === 'HASH_DIFFERS' || e.code === 'NOT_REPORTABLE');
  });

  it('rejects an expired authorization', async () => {
    const { db, approved } = setup();
    const p = approved();
    await assert.rejects(
      reportTransaction(db, fakeRpc(db), p.id, { txHash: SUCCESS_TX_HASH, signerId: SOURCE_ACCOUNT }, ctx(AUTH_MS + 24 * 3_600_000)),
      (e) => e instanceof ConflictError && e.code === 'REQUEST_EXPIRED',
    );
  });

  it('rejects bad input before any RPC call or write', async () => {
    const { db, approved } = setup();
    const p = approved();
    const good = { txHash: SUCCESS_TX_HASH, signerId: SOURCE_ACCOUNT };
    const bad = [
      undefined, null, 'x', 5, [], {},
      { txHash: 'x', signerId: SOURCE_ACCOUNT },
      { txHash: SUCCESS_TX_HASH },
      { signerId: SOURCE_ACCOUNT },
      { ...good, extra: 1 },
      { ...good, txHash: 5 },
      { ...good, signerId: '' },
    ];
    for (const input of bad) {
      const rpc = fakeRpc(db);
      await assert.rejects(reportTransaction(db, rpc, p.id, input, ctx(REPORT_MS)), JSON.stringify(input));
      assert.deepEqual(rpc.calls, []);
    }
    assert.equal(db.prepare('SELECT status FROM payment_requests WHERE id = ?').get(p.id).status, 'APPROVED');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM transactions').get().n, 0);
  });
});
