import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveSourceAccount } from './sourceAccount.js';

test('a connected wallet account is the source account, whatever was typed', () => {
  assert.deepEqual(
    resolveSourceAccount({ walletStatus: 'connected', walletAccountId: 'alice.testnet', typed: 'bob.testnet' }),
    { account: 'alice.testnet', fromWallet: true },
  );
});

test('without a connected wallet the typed account is used', () => {
  for (const walletStatus of [undefined, 'disconnected', 'connecting', 'error']) {
    assert.deepEqual(
      resolveSourceAccount({ walletStatus, walletAccountId: 'alice.testnet', typed: 'bob.testnet' }),
      { account: 'bob.testnet', fromWallet: false },
    );
  }
});

test('a connected wallet with a missing or invalid account id falls back to typed', () => {
  for (const walletAccountId of [null, undefined, '', 'X', 'Has Space.testnet']) {
    assert.deepEqual(
      resolveSourceAccount({ walletStatus: 'connected', walletAccountId, typed: 'bob.testnet' }),
      { account: 'bob.testnet', fromWallet: false },
    );
  }
});

test('nothing at all yields an empty account', () => {
  assert.deepEqual(resolveSourceAccount(), { account: '', fromWallet: false });
});
