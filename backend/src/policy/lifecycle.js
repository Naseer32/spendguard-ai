// Payment request lifecycle: the allowed status transitions and the budget
// reservation effect of each one. Pure data and logic, no I/O.
//
// A request starts from the engine decision (see initialState), then moves
// forward only. There are no cycles, and APPROVED never means EXECUTED:
// EXECUTED is reachable only from SUBMITTED, after on-chain verification.

import { DECISION } from './reasonCodes.js';

export const STATUS = Object.freeze({
  BLOCKED: 'BLOCKED',
  APPROVAL_REQUIRED: 'APPROVAL_REQUIRED',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  EXPIRED: 'EXPIRED',
  CANCELLED: 'CANCELLED',
  SUBMITTED: 'SUBMITTED',
  EXECUTED: 'EXECUTED',
  FAILED: 'FAILED',
  MISMATCH: 'MISMATCH',
});

// What happens to the daily-budget reservation on a transition.
//   NONE:    no reservation exists before or after
//   CREATE:  a new ACTIVE reservation is created
//   HOLD:    the reservation stays ACTIVE
//   CONSUME: the reservation becomes CONSUMED (money spent, verified)
//   RELEASE: the reservation is released (budget returned)
export const RESERVATION_EFFECT = Object.freeze({
  NONE: 'NONE',
  CREATE: 'CREATE',
  HOLD: 'HOLD',
  CONSUME: 'CONSUME',
  RELEASE: 'RELEASE',
});

export class LifecycleError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LifecycleError';
  }
}

const S = STATUS;
const E = RESERVATION_EFFECT;

// from -> { to: reservation effect }
const TRANSITIONS = Object.freeze({
  [S.BLOCKED]: Object.freeze({}),
  [S.APPROVAL_REQUIRED]: Object.freeze({
    [S.APPROVED]: E.CREATE, // owner approves; budget is rechecked first
    [S.REJECTED]: E.NONE,
    [S.EXPIRED]: E.NONE,
    [S.BLOCKED]: E.NONE, // approval-time recheck failed
  }),
  [S.APPROVED]: Object.freeze({
    [S.SUBMITTED]: E.HOLD, // owner reported a transaction hash
    [S.EXPIRED]: E.RELEASE,
    [S.CANCELLED]: E.RELEASE,
  }),
  [S.SUBMITTED]: Object.freeze({
    [S.EXECUTED]: E.CONSUME, // verified on-chain
    [S.FAILED]: E.RELEASE, // transaction failed or not found
    [S.MISMATCH]: E.HOLD, // succeeded on-chain but differs from authorization
  }),
  [S.REJECTED]: Object.freeze({}),
  [S.EXPIRED]: Object.freeze({}),
  [S.CANCELLED]: Object.freeze({}),
  [S.EXECUTED]: Object.freeze({}),
  [S.FAILED]: Object.freeze({}),
  [S.MISMATCH]: Object.freeze({}),
});

// Statuses whose reservation counts toward the daily budget.
const HOLDS_BUDGET = new Set([S.APPROVED, S.SUBMITTED, S.EXECUTED, S.MISMATCH]);

function label(value) {
  return typeof value === 'string' ? value : `<${typeof value}>`;
}

function outgoing(status) {
  if (typeof status !== 'string' || !Object.hasOwn(TRANSITIONS, status)) {
    return null;
  }
  return TRANSITIONS[status];
}

function requireKnown(status) {
  const out = outgoing(status);
  if (out === null) {
    throw new LifecycleError(`unknown status ${label(status)}`);
  }
  return out;
}

export function canTransition(from, to) {
  const out = outgoing(from);
  return out !== null && typeof to === 'string' && Object.hasOwn(out, to);
}

// Returns { from, to, reservation } or throws LifecycleError.
export function transition(from, to) {
  if (!canTransition(from, to)) {
    throw new LifecycleError(
      `illegal transition ${label(from)} -> ${label(to)}`,
    );
  }
  return Object.freeze({ from, to, reservation: TRANSITIONS[from][to] });
}

export function isTerminal(status) {
  return Object.keys(requireKnown(status)).length === 0;
}

export function holdsBudget(status) {
  requireKnown(status);
  return HOLDS_BUDGET.has(status);
}

// Maps an engine decision to the request's first status and reservation effect.
export function initialState(decision) {
  switch (decision) {
    case DECISION.BLOCKED:
      return Object.freeze({ status: S.BLOCKED, reservation: E.NONE });
    case DECISION.APPROVAL_REQUIRED:
      return Object.freeze({ status: S.APPROVAL_REQUIRED, reservation: E.NONE });
    case DECISION.APPROVED:
      return Object.freeze({ status: S.APPROVED, reservation: E.CREATE });
    default:
      throw new LifecycleError(`unknown decision ${label(decision)}`);
  }
}
