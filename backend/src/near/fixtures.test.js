// These tests pin down what we OBSERVED in real NEAR testnet responses.
// If one fails, either a fixture changed or an assumption in the transaction
// verifier (Stage 3b) needs to be revisited.
//
// Also observed (not testable offline): asking the RPC for the reverse
// transfer with the WRONG sender_account_id still returned it. The sender
// parameter is only a lookup hint, so the verifier must trust
// transaction.signer_id from the response, never the parameter.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEPOSIT,
  FIXTURE_FILES,
  RECIPIENT_ACCOUNT,
  REVERSE_TX_HASH,
  SOURCE_ACCOUNT,
  SUCCESS_BLOCK_HASH,
  SUCCESS_TX_HASH,
  loadFixture,
  readFixtureText,
} from '../testing/nearFixtures.js';

const SUCCESS = { SuccessValue: '' };

describe('fixture files', () => {
  it('are valid, small and free of secrets', () => {
    for (const name of Object.values(FIXTURE_FILES)) {
      const text = readFixtureText(name);
      assert.ok(text.length > 100 && text.length < 65_536, name);
      assert.doesNotThrow(() => JSON.parse(text), name);
      assert.ok(!/sgk_|OWNER_TOKEN|Bearer |private_key|seed phrase/i.test(text), name);
    }
  });
});

describe('the successful transfer (transaction lookup)', () => {
  const result = loadFixture(FIXTURE_FILES.success);

  it('has the five top-level fields we know about', () => {
    assert.deepEqual(Object.keys(result).sort(), [
      'final_execution_status', 'receipts_outcome', 'status', 'transaction', 'transaction_outcome',
    ]);
  });

  it('reached final execution with an empty success value', () => {
    assert.equal(result.final_execution_status, 'FINAL');
    assert.deepEqual(result.status, SUCCESS);
  });

  it('describes one Transfer from the source to the recipient', () => {
    const { transaction } = result;
    assert.deepEqual(Object.keys(transaction).sort(), [
      'actions', 'hash', 'nonce', 'priority_fee', 'public_key', 'receiver_id', 'signature', 'signer_id',
    ]);
    assert.equal(transaction.signer_id, SOURCE_ACCOUNT);
    assert.equal(transaction.receiver_id, RECIPIENT_ACCOUNT);
    assert.equal(transaction.hash, SUCCESS_TX_HASH);
    assert.equal(transaction.actions.length, 1);
    assert.deepEqual(Object.keys(transaction.actions[0]), ['Transfer']);
    assert.deepEqual(transaction.actions[0].Transfer, { deposit: DEPOSIT });
    assert.equal(typeof transaction.actions[0].Transfer.deposit, 'string');
  });

  it('repeats the hash in the outcome and names the block it was included in', () => {
    assert.equal(result.transaction_outcome.id, SUCCESS_TX_HASH);
    assert.equal(result.transaction_outcome.block_hash, SUCCESS_BLOCK_HASH);
    assert.equal(result.transaction_outcome.outcome.executor_id, SOURCE_ACCOUNT);
  });

  it('has two receipts, the transfer at the recipient and a refund at the source, both successful', () => {
    assert.equal(result.receipts_outcome.length, 2);
    assert.equal(result.receipts_outcome[0].outcome.executor_id, RECIPIENT_ACCOUNT);
    assert.equal(result.receipts_outcome[1].outcome.executor_id, SOURCE_ACCOUNT);
    for (const receipt of result.receipts_outcome) {
      assert.deepEqual(receipt.outcome.status, SUCCESS);
    }
  });

  it('does not contain a block timestamp (it must be fetched from the block)', () => {
    assert.ok(!/timestamp/.test(JSON.stringify(result)));
  });
});

describe('the reverse transfer (right amount, wrong signer for the source account)', () => {
  const result = loadFixture(FIXTURE_FILES.reverse);

  it('is signed by the recipient account and paid to the source account', () => {
    assert.equal(result.transaction.hash, REVERSE_TX_HASH);
    assert.equal(result.transaction.signer_id, RECIPIENT_ACCOUNT);
    assert.equal(result.transaction.receiver_id, SOURCE_ACCOUNT);
    assert.deepEqual(result.transaction.actions, [{ Transfer: { deposit: DEPOSIT } }]);
    assert.deepEqual(result.status, SUCCESS);
    assert.equal(typeof result.final_execution_status, 'string');
  });
});

describe('the block (time of inclusion)', () => {
  const block = loadFixture(FIXTURE_FILES.block);
  const { header } = block;

  it('has the three top-level fields we know about', () => {
    assert.deepEqual(Object.keys(block).sort(), ['author', 'chunks', 'header']);
  });

  it('is the block the transaction was included in', () => {
    assert.equal(header.hash, SUCCESS_BLOCK_HASH);
    assert.equal(header.hash, loadFixture(FIXTURE_FILES.success).transaction_outcome.block_hash);
    assert.equal(typeof header.height, 'number');
  });

  it('gives the exact time as a nanosecond string', () => {
    assert.equal(header.timestamp_nanosec, '1794229749101285803');
    assert.match(header.timestamp_nanosec, /^\d{19}$/);
    const ms = BigInt(header.timestamp_nanosec) / 1_000_000n;
    assert.equal(ms, 1794229749101n);
    assert.ok(Number(ms) > Date.UTC(2026, 0, 1));
  });

  it('has a "timestamp" number that must NOT be used: it has lost precision', () => {
    assert.equal(typeof header.timestamp, 'number');
    assert.equal(Number.isSafeInteger(header.timestamp), false);
    assert.notEqual(String(header.timestamp), header.timestamp_nanosec);
    assert.equal(header.timestamp, Number(header.timestamp_nanosec));
  });
});
