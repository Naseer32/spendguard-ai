// Stage 3b-1: did a NEAR transaction AND every receipt it produced finish
// successfully, at final finality?
//
// Pure: no I/O, no clock, no randomness. Never throws; anything unexpected
// fails closed. Input is the `result` of a NEAR RPC `tx` call.
//
// A SuccessReceiptId status is only a handoff ("my work continues in receipt
// X"), never a final success. A handoff counts only when the receipt it names
// exists in `receipts_outcome` and itself finishes successfully, along with
// every receipt it produced in turn (refunds included). A missing, unknown,
// unreachable or failed receipt never yields ok: true.
//
// This module checks execution only. Chain ID, signer, receiver, amount,
// block time and hash uniqueness belong to later 3b steps.

export const EXECUTION_CODES = Object.freeze({
  OK: 'OK',
  NOT_FINAL: 'NOT_FINAL',
  FAILED: 'FAILED',
  INCOMPLETE: 'INCOMPLETE',
  RECEIPT_MISSING: 'RECEIPT_MISSING',
  CHAIN_INVALID: 'CHAIN_INVALID',
  MALFORMED: 'MALFORMED',
});

const PENDING_STATUSES = new Set(['NotStarted', 'Started', 'Unknown']);

const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const isId = (v) => typeof v === 'string' && v !== '';
const fail = (code) => Object.freeze({ ok: false, code });

// Returns one of:
//   { kind: 'value' }            SuccessValue (any string payload)
//   { kind: 'receipt', id }      SuccessReceiptId (handoff, not a final success)
//   { kind: 'failure' }          Failure
//   { kind: 'pending' }          NotStarted / Started / Unknown
//   { kind: 'malformed' }        anything else
function classifyStatus(status) {
  if (typeof status === 'string') {
    return PENDING_STATUSES.has(status) ? { kind: 'pending' } : { kind: 'malformed' };
  }
  if (!isObject(status)) return { kind: 'malformed' };
  const keys = Object.keys(status);
  if (keys.length !== 1) return { kind: 'malformed' };
  const key = keys[0];
  const value = status[key];
  if (key === 'SuccessValue') {
    return typeof value === 'string' ? { kind: 'value' } : { kind: 'malformed' };
  }
  if (key === 'SuccessReceiptId') {
    return isId(value) ? { kind: 'receipt', id: value } : { kind: 'malformed' };
  }
  if (key === 'Failure') return { kind: 'failure' };
  return { kind: 'malformed' };
}

function evaluate(result) {
  if (!isObject(result)) return fail(EXECUTION_CODES.MALFORMED);

  const finality = result.final_execution_status;
  if (typeof finality !== 'string') return fail(EXECUTION_CODES.MALFORMED);
  if (finality !== 'FINAL') return fail(EXECUTION_CODES.NOT_FINAL);

  // The overall status must be a final success value. It is necessary, never
  // sufficient: the receipt chain below decides the verdict.
  const top = classifyStatus(result.status);
  if (top.kind === 'failure') return fail(EXECUTION_CODES.FAILED);
  if (top.kind === 'pending') return fail(EXECUTION_CODES.INCOMPLETE);
  if (top.kind !== 'value') return fail(EXECUTION_CODES.MALFORMED);

  const txOutcome = isObject(result.transaction_outcome)
    ? result.transaction_outcome.outcome
    : undefined;
  if (!isObject(txOutcome)) return fail(EXECUTION_CODES.MALFORMED);
  if (!Array.isArray(result.receipts_outcome)) return fail(EXECUTION_CODES.MALFORMED);

  const byId = new Map();
  for (const entry of result.receipts_outcome) {
    if (!isObject(entry) || !isId(entry.id) || !isObject(entry.outcome)) {
      return fail(EXECUTION_CODES.MALFORMED);
    }
    if (byId.has(entry.id)) return fail(EXECUTION_CODES.CHAIN_INVALID);
    byId.set(entry.id, entry.outcome);
  }

  // Walk the whole tree: the transaction outcome, then every receipt it
  // produced, then every receipt those produced, and so on.
  const visited = new Set();
  const queue = [txOutcome];
  while (queue.length > 0) {
    const outcome = queue.shift();

    const status = classifyStatus(outcome.status);
    if (status.kind === 'failure') return fail(EXECUTION_CODES.FAILED);
    if (status.kind === 'pending') return fail(EXECUTION_CODES.INCOMPLETE);
    if (status.kind === 'malformed') return fail(EXECUTION_CODES.MALFORMED);

    const ids = outcome.receipt_ids;
    if (!Array.isArray(ids) || !ids.every(isId)) return fail(EXECUTION_CODES.MALFORMED);

    // A handoff must name a receipt this outcome actually produced.
    if (status.kind === 'receipt' && !ids.includes(status.id)) {
      return fail(EXECUTION_CODES.CHAIN_INVALID);
    }

    for (const id of ids) {
      if (visited.has(id)) return fail(EXECUTION_CODES.CHAIN_INVALID); // cycle or duplicate
      visited.add(id);
      const next = byId.get(id);
      if (next === undefined) return fail(EXECUTION_CODES.RECEIPT_MISSING);
      queue.push(next);
    }
  }

  // A transfer always produces at least one receipt.
  if (visited.size === 0) return fail(EXECUTION_CODES.RECEIPT_MISSING);
  // Every listed receipt must belong to the chain just walked.
  if (visited.size !== byId.size) return fail(EXECUTION_CODES.CHAIN_INVALID);

  return Object.freeze({ ok: true, code: EXECUTION_CODES.OK, receiptCount: visited.size });
}

export function checkExecution(result) {
  try {
    return evaluate(result);
  } catch {
    return fail(EXECUTION_CODES.MALFORMED);
  }
}
