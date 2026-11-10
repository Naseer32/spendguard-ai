// Stage 3b-2: does a NEAR transaction match what SpendGuard authorized?
//
// Pure: no I/O, no clock, no randomness. Never throws; anything unexpected
// fails closed. Input is the `result` of a NEAR RPC `tx` call plus the
// authorization { txHash, signerId, receiverId, amount }.
//
// Signer and receiver are read from the RESPONSE (transaction.signer_id /
// receiver_id), never from the lookup parameter. Execution (finality, receipt
// chain) must pass checkExecution first. Chain ID, block time, hash
// uniqueness and RPC-error handling belong to later 3b steps.

import { checkExecution } from './executionOutcome.js';

export const MATCH_CODES = Object.freeze({
  MATCH: 'MATCH',
  BAD_AUTHORIZATION: 'BAD_AUTHORIZATION',
  EXECUTION_NOT_OK: 'EXECUTION_NOT_OK',
  MALFORMED: 'MALFORMED',
  HASH_MISMATCH: 'HASH_MISMATCH',
  SIGNER_MISMATCH: 'SIGNER_MISMATCH',
  RECEIVER_MISMATCH: 'RECEIVER_MISMATCH',
  ACTIONS_INVALID: 'ACTIONS_INVALID',
  AMOUNT_MISMATCH: 'AMOUNT_MISMATCH',
});

const AUTH_KEYS = ['amount', 'receiverId', 'signerId', 'txHash'];
const HASH_RE = /^[1-9A-HJ-NP-Za-km-z]{32,50}$/;
const AMOUNT_RE = /^[1-9][0-9]{0,39}$/;
const DEPOSIT_RE = /^(0|[1-9][0-9]{0,39})$/;

const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const isAccount = (v) => typeof v === 'string' && v.length > 0 && v.length <= 64;
const sameKeys = (obj, keys) => {
  const actual = Object.keys(obj).sort();
  return actual.length === keys.length && actual.every((k, i) => k === keys[i]);
};
const fail = (code, extra = {}) => Object.freeze({ ok: false, code, ...extra });

function validAuthorization(a) {
  return (
    isObject(a) &&
    sameKeys(a, AUTH_KEYS) &&
    typeof a.txHash === 'string' && HASH_RE.test(a.txHash) &&
    isAccount(a.signerId) &&
    isAccount(a.receiverId) &&
    typeof a.amount === 'string' && AMOUNT_RE.test(a.amount)
  );
}

function evaluate(result, auth) {
  if (!validAuthorization(auth)) return fail(MATCH_CODES.BAD_AUTHORIZATION);

  const exec = checkExecution(result);
  if (!exec.ok) return fail(MATCH_CODES.EXECUTION_NOT_OK, { executionCode: exec.code });

  const tx = result.transaction;
  if (!isObject(tx)) return fail(MATCH_CODES.MALFORMED);

  if (tx.hash !== auth.txHash || result.transaction_outcome.id !== auth.txHash) {
    return fail(MATCH_CODES.HASH_MISMATCH);
  }
  if (tx.signer_id !== auth.signerId) return fail(MATCH_CODES.SIGNER_MISMATCH);
  if (tx.receiver_id !== auth.receiverId) return fail(MATCH_CODES.RECEIVER_MISMATCH);

  // Exactly one action, and it is a plain Transfer.
  if (!Array.isArray(tx.actions) || tx.actions.length !== 1) return fail(MATCH_CODES.ACTIONS_INVALID);
  const action = tx.actions[0];
  if (!isObject(action) || !sameKeys(action, ['Transfer'])) return fail(MATCH_CODES.ACTIONS_INVALID);
  const transfer = action.Transfer;
  if (!isObject(transfer) || !sameKeys(transfer, ['deposit'])) return fail(MATCH_CODES.ACTIONS_INVALID);
  if (typeof transfer.deposit !== 'string' || !DEPOSIT_RE.test(transfer.deposit)) {
    return fail(MATCH_CODES.ACTIONS_INVALID);
  }

  if (BigInt(transfer.deposit) !== BigInt(auth.amount)) return fail(MATCH_CODES.AMOUNT_MISMATCH);

  return Object.freeze({ ok: true, code: MATCH_CODES.MATCH });
}

export function matchAuthorization(result, authorization) {
  try {
    return evaluate(result, authorization);
  } catch {
    return fail(MATCH_CODES.MALFORMED);
  }
}
