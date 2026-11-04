// Budget helpers. Pure: the current time is always passed in by the caller.
//
// A "budget day" is the UTC calendar date (YYYY-MM-DD). A reservation keeps
// the budget day it was created on, so a payment executed after midnight
// still counts against the day it was reserved.

import { parseYocto, formatYocto } from '../money/yocto.js';

const MIN_MS = 0; // 1970-01-01T00:00:00.000Z
const MAX_MS = 253402300799999; // 9999-12-31T23:59:59.999Z

const DAY_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

// Epoch milliseconds to the UTC budget day, for example "2026-11-04".
export function utcBudgetDay(nowMs) {
  if (!Number.isSafeInteger(nowMs) || nowMs < MIN_MS || nowMs > MAX_MS) {
    throw new RangeError('nowMs must be an integer epoch-millisecond value');
  }
  return new Date(nowMs).toISOString().slice(0, 10);
}

// True only for real calendar dates in YYYY-MM-DD form.
export function isBudgetDay(value) {
  if (typeof value !== 'string' || !DAY_RE.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

// Budget left for the day, as a yoctoNEAR string. Never negative: if limits
// were lowered below what is already reserved, nothing is left.
export function remainingBudget(dailyBudget, reserved) {
  const budget = parseYocto(dailyBudget);
  const used = parseYocto(reserved);
  return formatYocto(used >= budget ? 0n : budget - used);
}
