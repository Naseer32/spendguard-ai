// Loader and constants for the real NEAR testnet fixtures captured with
// scripts/inspect-tx.js. Not imported by production code.

import fs from 'node:fs';

export const FIXTURE_FILES = Object.freeze({
  success: 'transfer-success.json',
  reverse: 'transfer-reverse.json',
  block: 'block-transfer-success.json',
  successReceipts: 'transfer-success-receipts.json',
  rpcTimeout: 'rpc-error-tx-timeout.json',
  rpcUnknown: 'rpc-error-unknown-transaction.json',
});

// 0.1 NEAR from SOURCE_ACCOUNT to RECIPIENT_ACCOUNT, included in SUCCESS_BLOCK_HASH.
export const SUCCESS_TX_HASH = '4yxED39oZ2toc5GTDpjzVHscTJnXiKZQ4t4HRQKPkHfM';
export const SUCCESS_BLOCK_HASH = '12E4MqAhaRrzvbZhiB1EaUVHJhrhAbdAhJgf73YzzRru';
// 0.1 NEAR the other way round: right amount, wrong signer for an agent funded from SOURCE_ACCOUNT.
export const REVERSE_TX_HASH = 'GjzE6AEEAbMCHtVfCew5QEJvAMMcuqCTaq4uwh9Bwuzh';
export const SOURCE_ACCOUNT = 'steephat8707.testnet';
export const RECIPIENT_ACCOUNT = 'sickzone9097.testnet';
export const DEPOSIT = '100000000000000000000000'; // 0.1 NEAR in yoctoNEAR

export function readFixtureText(name) {
  return fs.readFileSync(new URL(`../near/fixtures/${name}`, import.meta.url), 'utf8');
}

export function loadFixture(name) {
  return JSON.parse(readFixtureText(name));
}

// First receipt of the successful transfer: the transaction outcome hands off to it.
export const SUCCESS_RECEIPT_ID = '9tmxpzH1PUynkWWbCUPvKGjiZazabJi1WXwx4q7Cfk6F';
