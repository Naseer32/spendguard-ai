// Deterministic spending policy engine.
//
// Pure and total: no I/O, no clock, no randomness, no AI. It never throws;
// any bad input or internal error fails closed to BLOCKED.
//
// All applicable rules are evaluated and every triggered reason is returned.
// Severity: BLOCKED > APPROVAL_REQUIRED > APPROVED.
//
// Rule order (this is also the order of reason codes in the result):
//   Blocking:  AGENT_PAUSED, INVALID_RECIPIENT / RECIPIENT_BLOCKED,
//              INVALID_AMOUNT / ZERO_AMOUNT,
//              EXCEEDS_TX_LIMIT, EXCEEDS_DAILY_BUDGET
//   Approval:  RECIPIENT_NOT_ALLOWLISTED, ABOVE_APPROVAL_THRESHOLD
//
// Input:
//   agent:          { status, dailyBudget, perTxLimit, approvalThreshold }
//   recipientLists: { onAllowlist: boolean, onBlocklist: boolean }
//   reservedToday:  yoctoNEAR string (ACTIVE + CONSUMED reservations today)
//   request:        { recipient, amount }  (amount is a yoctoNEAR string)
//
// Output (frozen):
//   { decision, reasonCodes, remainingBudget }
//   remainingBudget is the budget left BEFORE this payment (yocto string),
//   or null when it could not be computed.

import { tryParseYocto } from '../money/yocto.js';
import { AGENT_STATUS, DECISION, REASON } from './reasonCodes.js';

// NEAR account ID rules: 2-64 chars, lowercase letters and digits,
// separators "-", "_" and "." between alphanumeric parts.
const ACCOUNT_ID_RE = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

export function isValidNearAccountId(value) {
  return (
    typeof value === 'string' &&
    value.length >= 2 &&
    value.length <= 64 &&
    ACCOUNT_ID_RE.test(value)
  );
}

function isObject(value) {
  return value !== null && typeof value === 'object';
}

function makeResult(decision, reasonCodes, remaining) {
  return Object.freeze({
    decision,
    reasonCodes: Object.freeze([...reasonCodes]),
    remainingBudget: remaining === null ? null : remaining.toString(),
  });
}

function evaluateUnsafe(input) {
  const { agent, recipientLists, reservedToday, request } = input ?? {};

  // 1. Validate agent configuration (fail closed).
  const dailyBudget = tryParseYocto(agent?.dailyBudget);
  const perTxLimit = tryParseYocto(agent?.perTxLimit);
  const approvalThreshold = tryParseYocto(agent?.approvalThreshold);
  const statusOk =
    isObject(agent) &&
    (agent.status === AGENT_STATUS.ACTIVE ||
      agent.status === AGENT_STATUS.PAUSED);

  if (
    !statusOk ||
    dailyBudget === null ||
    perTxLimit === null ||
    approvalThreshold === null
  ) {
    return makeResult(DECISION.BLOCKED, [REASON.INVALID_AGENT_CONFIG], null);
  }

  // 2. Validate evaluation context (fail closed).
  const reserved = tryParseYocto(reservedToday);
  const listsOk =
    isObject(recipientLists) &&
    typeof recipientLists.onAllowlist === 'boolean' &&
    typeof recipientLists.onBlocklist === 'boolean';

  if (reserved === null || !listsOk) {
    return makeResult(DECISION.BLOCKED, [REASON.INVALID_CONTEXT], null);
  }

  // Budget left before this payment. If limits were lowered below what is
  // already reserved, nothing is left (never negative).
  const remaining = reserved >= dailyBudget ? 0n : dailyBudget - reserved;

  // 3. Blocking rules.
  const blocks = [];

  if (agent.status === AGENT_STATUS.PAUSED) {
    blocks.push(REASON.AGENT_PAUSED);
  }

  if (!isValidNearAccountId(request?.recipient)) {
    blocks.push(REASON.INVALID_RECIPIENT);
  } else if (recipientLists.onBlocklist) {
    blocks.push(REASON.RECIPIENT_BLOCKED);
  }

  const amount = tryParseYocto(request?.amount);
  if (amount === null) {
    blocks.push(REASON.INVALID_AMOUNT);
  } else if (amount === 0n) {
    blocks.push(REASON.ZERO_AMOUNT);
  } else {
    if (amount > perTxLimit) {
      blocks.push(REASON.EXCEEDS_TX_LIMIT);
    }
    if (amount > remaining) {
      blocks.push(REASON.EXCEEDS_DAILY_BUDGET);
    }
  }

  if (blocks.length > 0) {
    return makeResult(DECISION.BLOCKED, blocks, remaining);
  }

  // 4. Human-approval rules (amount is valid and positive here).
  const approvals = [];

  if (!recipientLists.onAllowlist) {
    approvals.push(REASON.RECIPIENT_NOT_ALLOWLISTED);
  }
  if (amount > approvalThreshold) {
    approvals.push(REASON.ABOVE_APPROVAL_THRESHOLD);
  }

  if (approvals.length > 0) {
    return makeResult(DECISION.APPROVAL_REQUIRED, approvals, remaining);
  }

  return makeResult(DECISION.APPROVED, [REASON.WITHIN_POLICY], remaining);
}

export function evaluatePayment(input) {
  try {
    return evaluateUnsafe(input);
  } catch {
    return makeResult(DECISION.BLOCKED, [REASON.INTERNAL_ERROR], null);
  }
}
