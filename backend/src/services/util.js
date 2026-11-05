// Small helpers shared by services.

import { randomUUID } from 'node:crypto';
import { ValidationError } from './errors.js';

const MAX_MS = 253402300799999; // 9999-12-31T23:59:59.999Z
const CONTROL_RE = /[\u0000-\u001f\u007f]/;

export function newId() {
  return randomUUID();
}

// Epoch milliseconds to an ISO UTC timestamp with milliseconds.
export function toIso(nowMs) {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0 || nowMs > MAX_MS) {
    throw new TypeError('now must be an integer epoch-millisecond value');
  }
  return new Date(nowMs).toISOString();
}

// Every service call receives { now, actor }:
//   now:   epoch milliseconds, passed in so tests control the clock
//   actor: who is acting, for the audit log ("owner", "agent:<id>", "system")
// A bad context is a programming error, so it throws TypeError.
export function requireContext(context) {
  if (context === null || typeof context !== 'object') {
    throw new TypeError('context must be an object with now and actor');
  }
  const { now, actor } = context;
  const nowIso = toIso(now);
  if (typeof actor !== 'string' || actor.length < 1 || actor.length > 128) {
    throw new TypeError('actor must be a string of 1 to 128 characters');
  }
  return Object.freeze({ nowMs: now, nowIso, actor });
}

export function hasControlCharacters(text) {
  return CONTROL_RE.test(text);
}

export function assertPlainObject(value, name = 'input') {
  const proto = value === null || typeof value !== 'object' ? undefined : Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    throw new ValidationError(`${name} must be an object`, name);
  }
}

export function rejectUnknownFields(object, allowed) {
  for (const key of Object.keys(object)) {
    if (!allowed.includes(key)) {
      throw new ValidationError(`unknown field ${JSON.stringify(key.slice(0, 50))}`, key.slice(0, 50));
    }
  }
}
