// Daily budget reservations.
//
// A reservation holds part of an agent's daily budget for one payment request.
// - ACTIVE and CONSUMED reservations count against the budget day they were
//   created on (UTC). RELEASED ones do not.
// - Amounts are summed in JavaScript with BigInt, never with SQL SUM.
// - Changing reservations is only allowed inside a write transaction.
//   Services must not call the mutating functions directly; requestState.js is
//   the only caller (a test enforces this).

import { isInWriteTransaction } from '../db/database.js';
import { sumYocto } from '../money/yocto.js';
import { isBudgetDay } from '../policy/budget.js';
import { ConflictError, NotFoundError, ValidationError } from './errors.js';
import { newId } from './util.js';

export const RESERVATION_STATUS = Object.freeze({
  ACTIVE: 'ACTIVE',
  CONSUMED: 'CONSUMED',
  RELEASED: 'RELEASED',
});

export function assertWriteTransaction(db) {
  if (!isInWriteTransaction(db)) {
    throw new Error('this operation must run inside a write transaction');
  }
}

// Total reserved (ACTIVE + CONSUMED) for one agent on one UTC budget day.
export function reservedForDay(db, agentId, budgetDay) {
  if (typeof agentId !== 'string') {
    throw new ValidationError('agentId must be a string', 'agentId');
  }
  if (!isBudgetDay(budgetDay)) {
    throw new ValidationError('budgetDay must be a YYYY-MM-DD date', 'budgetDay');
  }
  const rows = db
    .prepare(
      `SELECT amount FROM budget_reservations
       WHERE agent_id = ? AND budget_day = ? AND status IN ('ACTIVE', 'CONSUMED')`,
    )
    .all(agentId, budgetDay);
  return sumYocto(rows.map((row) => row.amount));
}

// Raw reservation row for a request, or undefined.
export function getReservation(db, requestId) {
  if (typeof requestId !== 'string') {
    return undefined;
  }
  return db
    .prepare('SELECT * FROM budget_reservations WHERE request_id = ?')
    .get(requestId);
}

// input: { requestId, agentId, amount, budgetDay }
export function createReservation(db, input, nowIso) {
  assertWriteTransaction(db);
  db.prepare(
    `INSERT INTO budget_reservations
       (id, request_id, agent_id, amount, budget_day, status, release_reason, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'ACTIVE', NULL, ?, ?)`,
  ).run(newId(), input.requestId, input.agentId, input.amount, input.budgetDay, nowIso, nowIso);
  return getReservation(db, input.requestId);
}

function requireActive(db, requestId) {
  const row = getReservation(db, requestId);
  if (row === undefined) {
    throw new NotFoundError('reservation not found');
  }
  if (row.status !== RESERVATION_STATUS.ACTIVE) {
    throw new ConflictError(`reservation is already ${row.status}`, 'RESERVATION_STATE');
  }
  return row;
}

// ACTIVE -> CONSUMED (the payment was verified on-chain).
export function consumeReservation(db, requestId, nowIso) {
  assertWriteTransaction(db);
  requireActive(db, requestId);
  db.prepare(
    `UPDATE budget_reservations SET status = 'CONSUMED', updated_at = ? WHERE request_id = ?`,
  ).run(nowIso, requestId);
  return getReservation(db, requestId);
}

// ACTIVE -> RELEASED (budget returned). The reason is stored.
export function releaseReservation(db, requestId, reason, nowIso) {
  assertWriteTransaction(db);
  if (typeof reason !== 'string' || reason.length < 1 || reason.length > 100) {
    throw new ValidationError('release reason must be 1 to 100 characters', 'reason');
  }
  requireActive(db, requestId);
  db.prepare(
    `UPDATE budget_reservations
     SET status = 'RELEASED', release_reason = ?, updated_at = ? WHERE request_id = ?`,
  ).run(reason, nowIso, requestId);
  return getReservation(db, requestId);
}
