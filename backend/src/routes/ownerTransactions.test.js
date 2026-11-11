import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { migrate, openDatabase } from '../db/database.js';
import { ACCESS } from '../http/routeKit.js';
import { DEFAULT_ROUTE_MODULES } from './index.js';
import { registerOwnerTransactionRoutes } from './ownerTransactions.js';
import { evaluatePaymentRequest } from '../services/payments.js';
import { setRecipient } from '../services/recipients.js';
import { ConflictError } from '../services/errors.js';
import { seedAgent } from '../testing/serviceKit.js';
import {
  DEPOSIT, FIXTURE_FILES, RECIPIENT_ACCOUNT, SOURCE_ACCOUNT, SUCCESS_TX_HASH, loadFixture,
} from '../testing/nearFixtures.js';

const blockMs = Number(BigInt(loadFixture(FIXTURE_FILES.block).header.timestamp_nanosec) / 1_000_000n);
const AUTH_MS = blockMs - 30 * 60_000;
const REPORT_MS = blockMs + 5 * 60_000;
const ctx = (now, actor = 'owner') => ({ now, actor });

function fakeRpc() {
  const table = {
    tx: loadFixture(FIXTURE_FILES.success),
    status: { chain_id: 'testnet' },
    block: loadFixture(FIXTURE_FILES.block),
  };
  return { async call(method) { return structuredClone(table[method]); } };
}

// Registers the module against a collector and returns the one handler.
function handlerFor(deps) {
  const routes = [];
  registerOwnerTransactionRoutes((method, pattern, access, handler) => routes.push({ method, pattern, access, handler }), deps);
  return routes;
}

function setup() {
  const db = openDatabase();
  if (db.prepare("SELECT name FROM sqlite_master WHERE name = 'agents'").get() === undefined) migrate(db);
  const { agent } = seedAgent(db, { sourceAccount: SOURCE_ACCOUNT }, ctx(AUTH_MS));
  setRecipient(db, agent.id, { accountId: RECIPIENT_ACCOUNT, listType: 'ALLOW' }, ctx(AUTH_MS));
  evaluatePaymentRequest(
    db, agent.id,
    { idempotencyKey: 'route-test-key-1', recipient: RECIPIENT_ACCOUNT, amount: DEPOSIT },
    ctx(AUTH_MS, `agent:${agent.id}`), undefined,
  );
  const { id } = db.prepare('SELECT id FROM payment_requests LIMIT 1').get();
  return { db, id };
}

describe('owner tx-report route', () => {
  it('is registered once, as an owner-only POST, in the default modules', () => {
    assert.ok(DEFAULT_ROUTE_MODULES.includes(registerOwnerTransactionRoutes));
    const routes = handlerFor({ db: {}, config: {} });
    assert.equal(routes.length, 1);
    assert.equal(routes[0].method, 'POST');
    assert.equal(routes[0].pattern, '/api/payments/:requestId/tx-report');
    assert.equal(routes[0].access, ACCESS.OWNER);
  });

  it('verifies the real transfer and returns the verdict with the updated payment', async () => {
    const { db, id } = setup();
    const [{ handler }] = handlerFor({ db, config: {}, rpc: fakeRpc() });
    const res = await handler({
      params: { requestId: id },
      body: { txHash: SUCCESS_TX_HASH, signerId: SOURCE_ACCOUNT },
      serviceContext: () => ctx(REPORT_MS),
    });
    assert.equal(res.body.verdict, 'VERIFIED');
    assert.equal(res.body.action, 'MARK_EXECUTED');
    assert.equal(res.body.payment.status, 'EXECUTED');
    assert.equal(res.status, undefined);
  });

  it('refuses a wrong signer and unknown body fields without calling the RPC', async () => {
    const { db, id } = setup();
    let calls = 0;
    const rpc = { async call() { calls += 1; return {}; } };
    const [{ handler }] = handlerFor({ db, config: {}, rpc });
    const run = (body) => handler({ params: { requestId: id }, body, serviceContext: () => ctx(REPORT_MS) });

    await assert.rejects(run({ txHash: SUCCESS_TX_HASH, signerId: 'someone.testnet' }),
      (e) => e instanceof ConflictError && e.code === 'SIGNER_NOT_SOURCE');
    await assert.rejects(run({ txHash: SUCCESS_TX_HASH, signerId: SOURCE_ACCOUNT, extra: 1 }));
    await assert.rejects(run({}));
    assert.equal(calls, 0);
  });
});
