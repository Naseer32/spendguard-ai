import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { verifyOnChain } from './verifyOnChain.js';
import { VERDICTS as V, ACTIONS as A, REASONS as R } from './verifyTransfer.js';
import { RpcNetworkError, RpcRemoteError, RpcTimeoutError } from './rpcErrors.js';
import {
  DEPOSIT, FIXTURE_FILES, RECIPIENT_ACCOUNT, SOURCE_ACCOUNT, SUCCESS_TX_HASH, loadFixture,
} from '../testing/nearFixtures.js';

const blockMs = Number(BigInt(loadFixture(FIXTURE_FILES.block).header.timestamp_nanosec) / 1_000_000n);
const iso = (ms) => new Date(ms).toISOString();
const AUTHORIZED_AT = iso(blockMs - 3_600_000);
const NOW = iso(blockMs + 60_000);

const auth = () => ({ txHash: SUCCESS_TX_HASH, signerId: SOURCE_ACCOUNT, receiverId: RECIPIENT_ACCOUNT, amount: DEPOSIT });
const real = () => structuredClone(loadFixture(FIXTURE_FILES.success));

// rpc fake: each value is a result, an Error to throw, or omitted.
function fakeRpc({ tx = real(), status = { chain_id: 'testnet' }, block = loadFixture(FIXTURE_FILES.block) } = {}) {
  const calls = [];
  const table = { tx, status, block };
  return {
    calls,
    async call(method) {
      calls.push(method);
      const value = table[method];
      if (value instanceof Error) throw value;
      return structuredClone(value);
    },
  };
}

const run = (rpc, over = {}) => verifyOnChain({
  rpc, authorization: auth(), authorizedAt: AUTHORIZED_AT, submittedAt: AUTHORIZED_AT, now: NOW, hashAlreadyUsed: false, ...over,
});
const expectVerdict = (res, verdict, reason) => {
  assert.equal(res.verdict, verdict);
  if (reason) assert.equal(res.reason, reason);
};

describe('verifyOnChain: found transactions', () => {
  it('VERIFIES the real successful transfer', async () => {
    const rpc = fakeRpc();
    const res = await run(rpc);
    expectVerdict(res, V.VERIFIED, R.OK);
    assert.equal(res.action, A.MARK_EXECUTED);
    assert.deepEqual(rpc.calls, ['tx', 'status', 'block']);
  });

  it('holds on another chain', async () => {
    expectVerdict(await run(fakeRpc({ status: { chain_id: 'mainnet' } })), V.HOLD, R.WRONG_CHAIN);
  });

  it('holds when the chain id is missing', async () => {
    expectVerdict(await run(fakeRpc({ status: {} })), V.HOLD, R.WRONG_CHAIN);
  });

  it('is a MISMATCH when the amount differs, without asking for the block', async () => {
    const tx = real(); tx.transaction.actions[0].Transfer.deposit = '1';
    const rpc = fakeRpc({ tx });
    expectVerdict(await run(rpc), V.MISMATCH, R.AUTHORIZATION_MISMATCH);
    assert.deepEqual(rpc.calls, ['tx', 'status']);
  });

  it('is a MISMATCH for the wrong signer', async () => {
    const res = await run(fakeRpc(), { authorization: { ...auth(), signerId: RECIPIENT_ACCOUNT } });
    expectVerdict(res, V.MISMATCH, R.AUTHORIZATION_MISMATCH);
  });

  it('is a MISMATCH when the block is before the authorization', async () => {
    const res = await run(fakeRpc(), { authorizedAt: iso(blockMs + 3_600_000) });
    expectVerdict(res, V.MISMATCH, R.BLOCK_BEFORE_AUTHORIZATION);
  });

  it('is a MISMATCH when the hash is already used', async () => {
    expectVerdict(await run(fakeRpc(), { hashAlreadyUsed: true }), V.MISMATCH, R.HASH_ALREADY_USED);
  });

  it('holds when hashAlreadyUsed is not a boolean', async () => {
    expectVerdict(await run(fakeRpc(), { hashAlreadyUsed: undefined }), V.HOLD);
  });

  it('FAILS (release) a failed transaction whose details match', async () => {
    const tx = real(); tx.receipts_outcome[0].outcome.status = { Failure: { ActionError: {} } };
    const rpc = fakeRpc({ tx });
    const res = await run(rpc);
    expectVerdict(res, V.FAILED, R.EXECUTION_FAILED);
    assert.equal(res.action, A.RELEASE_RESERVATION);
    assert.deepEqual(rpc.calls, ['tx', 'status']);
  });

  it('keeps the reservation for a failed transaction whose details do not match', async () => {
    const tx = real();
    tx.receipts_outcome[0].outcome.status = { Failure: { ActionError: {} } };
    tx.transaction.actions[0].Transfer.deposit = '1';
    const res = await run(fakeRpc({ tx }));
    expectVerdict(res, V.MISMATCH);
    assert.equal(res.action, A.KEEP_RESERVATION);
  });

  it('is INCONCLUSIVE when the transaction is not final', async () => {
    const tx = real(); tx.final_execution_status = 'EXECUTED';
    expectVerdict(await run(fakeRpc({ tx })), V.INCONCLUSIVE, R.NOT_FINAL);
  });

  it('holds when the block header is unusable', async () => {
    expectVerdict(await run(fakeRpc({ block: { header: {} } })), V.HOLD);
  });

  it('is INCONCLUSIVE when the chain or block lookup fails', async () => {
    expectVerdict(await run(fakeRpc({ status: new RpcTimeoutError() })), V.INCONCLUSIVE, R.NOT_OBSERVED);
    expectVerdict(await run(fakeRpc({ block: new RpcNetworkError() })), V.INCONCLUSIVE, R.NOT_OBSERVED);
  });
});

describe('verifyOnChain: transaction lookup errors', () => {
  it('keeps the captured HANDLER_ERROR / TIMEOUT_ERROR / NOT_OBSERVED INCONCLUSIVE', async () => {
    const captured = loadFixture(FIXTURE_FILES.rpcTimeout).error;
    const error = new RpcRemoteError({ rpcCode: captured.code, rpcMessage: captured.message, remote: JSON.stringify(captured) });
    const res = await run(fakeRpc({ tx: error }));
    expectVerdict(res, V.INCONCLUSIVE, R.NOT_OBSERVED);
    assert.equal(res.action, A.RETRY);
    assert.equal(res.changesState, false);
  });

  it('is INCONCLUSIVE for timeouts and network errors', async () => {
    expectVerdict(await run(fakeRpc({ tx: new RpcTimeoutError() })), V.INCONCLUSIVE, R.NOT_OBSERVED);
    expectVerdict(await run(fakeRpc({ tx: new RpcNetworkError() })), V.INCONCLUSIVE, R.NOT_OBSERVED);
    expectVerdict(await run(fakeRpc({ tx: new Error('boom') })), V.INCONCLUSIVE, R.NOT_OBSERVED);
  });

  // Synthetic: the documented NEAR shape for a transaction the node does not know.
  const unknown = () => new RpcRemoteError({
    rpcCode: -32000,
    remote: JSON.stringify({ name: 'HANDLER_ERROR', cause: { name: 'UNKNOWN_TRANSACTION', info: {} }, code: -32000 }),
  });

  it('retries a confirmed not-found inside the 30 minute window', async () => {
    const res = await run(fakeRpc({ tx: unknown() }), { submittedAt: iso(blockMs - 60_000), now: NOW });
    expectVerdict(res, V.INCONCLUSIVE, R.NOT_FOUND_YET);
  });

  it('fails (release) a confirmed not-found after 30 minutes', async () => {
    const res = await run(fakeRpc({ tx: unknown() }), { submittedAt: iso(blockMs - 31 * 60_000), now: iso(blockMs) });
    expectVerdict(res, V.FAILED, R.NOT_FOUND_TIMEOUT);
  });

  it('never treats a timeout as not-found, however long it has been', async () => {
    const res = await run(fakeRpc({ tx: new RpcTimeoutError() }), { submittedAt: iso(blockMs - 86_400_000), now: NOW });
    expectVerdict(res, V.INCONCLUSIVE, R.NOT_OBSERVED);
  });
});

describe('verifyOnChain: safety', () => {
  it('holds on invalid input and never throws', async () => {
    for (const input of [undefined, null, 5, {}, { rpc: {} }, { rpc: { call: () => {} } }]) {
      expectVerdict(await verifyOnChain(input), V.HOLD);
    }
    const throwing = { call() { throw new Error('sync boom'); } };
    expectVerdict(await run(throwing), V.INCONCLUSIVE, R.NOT_OBSERVED);
  });

  it('only VERIFIED marks executed, across the cases above', async () => {
    const variants = [
      fakeRpc({ status: { chain_id: 'mainnet' } }),
      fakeRpc({ tx: new RpcTimeoutError() }),
      fakeRpc({ block: { header: {} } }),
    ];
    for (const rpc of variants) {
      assert.notEqual((await run(rpc)).action, A.MARK_EXECUTED);
    }
  });
});

describe('verifyOnChain: unknown transaction probe (real captured responses)', () => {
  const asRemote = (captured) => new RpcRemoteError({
    rpcCode: captured.code, rpcMessage: captured.message, remote: JSON.stringify(captured),
  });
  const timeout = () => asRemote(loadFixture(FIXTURE_FILES.rpcTimeout).error);
  const unknown = () => asRemote(loadFixture(FIXTURE_FILES.rpcUnknown).error);

  // FINAL lookups time out; NONE lookups answer with `probe` (a result or an Error).
  function probeRpc(probe) {
    const calls = [];
    return {
      calls,
      async call(method, params) {
        calls.push(`${method}:${params?.wait_until ?? ''}`);
        if (method !== 'tx') throw new Error('unexpected method');
        const value = params.wait_until === 'NONE' ? probe : timeout();
        if (value instanceof Error) throw value;
        return structuredClone(value);
      },
    };
  }

  it('retries a confirmed not-found inside the 30 minute window', async () => {
    const rpc = probeRpc(unknown());
    const res = await run(rpc, { submittedAt: iso(blockMs - 60_000), now: NOW });
    expectVerdict(res, V.INCONCLUSIVE, R.NOT_FOUND_YET);
    assert.deepEqual(rpc.calls, ['tx:FINAL', 'tx:NONE']);
  });

  it('fails (release) a confirmed not-found after 30 minutes', async () => {
    const res = await run(probeRpc(unknown()), { submittedAt: iso(blockMs - 31 * 60_000), now: iso(blockMs) });
    expectVerdict(res, V.FAILED, R.NOT_FOUND_TIMEOUT);
    assert.equal(res.action, A.RELEASE_RESERVATION);
  });

  it('never releases when the node knows the transaction, however old', async () => {
    const res = await run(probeRpc(real()), { submittedAt: iso(blockMs - 86_400_000), now: NOW });
    expectVerdict(res, V.INCONCLUSIVE, R.NOT_OBSERVED);
  });

  it('never releases when the probe itself times out or fails', async () => {
    for (const probe of [timeout(), new RpcTimeoutError(), new RpcNetworkError(), new Error('boom')]) {
      const res = await run(probeRpc(probe), { submittedAt: iso(blockMs - 86_400_000), now: NOW });
      expectVerdict(res, V.INCONCLUSIVE, R.NOT_OBSERVED);
    }
  });
});
