// Structured one-line JSON logger that never logs secrets.
//
// Redaction, applied to every field before anything is written:
//  - by key name: authorization, cookies, tokens, secrets, passwords, API keys
//    and key hashes, private keys, seeds, headers, request bodies and free-text
//    user content (purpose, comment, note) become "[REDACTED]";
//  - by value: SpendGuard API keys, "Bearer ..." tokens, runs of 64+ hex
//    characters (hashes) and ed25519/secp256k1 keys are masked inside strings.
// Strings are truncated, depth and size are capped, and logging never throws.
// Callers must still avoid passing request objects, headers or bodies.

import { ServiceError } from '../services/errors.js';

export const LOG_LEVELS = Object.freeze({ debug: 10, info: 20, warn: 30, error: 40, silent: 100 });

const EVENT_RE = /^[a-z0-9_.:-]{1,64}$/;
const SENSITIVE_KEY_RE =
  /(authorization|cookie|token|secret|password|passwd|api[-_]?key|key[-_]?hash|private|seed|mnemonic|credential)/i;
const BLOCKED_KEY_RE = /^(body|rawbody|requestbody|headers|payload|purpose|comment|notes?)$/i;
const API_KEY_RE = /sgk_[0-9a-f-]{36}_[0-9a-f]{64}/gi;
const BEARER_RE = /\bBearer\s+[^\s"']+/gi;
const NEAR_KEY_RE = /\b(?:ed25519|secp256k1):[1-9A-HJ-NP-Za-km-z]{20,}/g;
const HEX_RE = /[0-9a-f]{64,}/gi;

const MAX_STRING = 200;
const MAX_INPUT_STRING = 10_000;
const MAX_DEPTH = 4;
const MAX_ARRAY = 20;
const MAX_KEYS = 50;
const MAX_LINE = 8000;
const OPTION_KEYS = ['level', 'write', 'now'];

export function redactText(text) {
  return String(text)
    .slice(0, MAX_INPUT_STRING)
    .replace(API_KEY_RE, '[REDACTED_API_KEY]')
    .replace(BEARER_RE, 'Bearer [REDACTED]')
    .replace(NEAR_KEY_RE, '[REDACTED_KEY]')
    .replace(HEX_RE, '[REDACTED_HEX64]');
}

function clip(text) {
  return text.length > MAX_STRING ? `${text.slice(0, MAX_STRING)}…` : text;
}

function safeText(text) {
  return clip(redactText(text));
}

function isPlainObject(value) {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function describeError(error) {
  const out = { name: safeText(error.name) };
  if (typeof error.code === 'string') {
    out.code = safeText(error.code);
  }
  // Only service errors carry client-safe messages.
  if (error instanceof ServiceError) {
    out.message = safeText(error.message);
  }
  return out;
}

function sanitize(value, depth, seen) {
  if (value === null) return null;
  switch (typeof value) {
    case 'string':
      return safeText(value);
    case 'boolean':
      return value;
    case 'number':
      return Number.isFinite(value) ? value : String(value);
    case 'bigint':
      return value.toString();
    case 'undefined':
      return undefined;
    case 'object':
      break;
    default:
      return '[UNSUPPORTED]';
  }
  if (value instanceof Error) return describeError(value);
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? '[INVALID_DATE]' : value.toISOString();
  }
  if (depth >= MAX_DEPTH) return '[DEPTH]';
  if (seen.has(value)) return '[CIRCULAR]';
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      const items = value.slice(0, MAX_ARRAY).map((item) => {
        const clean = sanitize(item, depth + 1, seen);
        return clean === undefined ? null : clean;
      });
      if (value.length > MAX_ARRAY) {
        items.push(`[+${value.length - MAX_ARRAY} more]`);
      }
      return items;
    }
    if (!isPlainObject(value)) return '[UNSUPPORTED]';
    return sanitizeObject(value, depth, seen);
  } finally {
    seen.delete(value);
  }
}

function sanitizeObject(object, depth, seen) {
  const out = {};
  const keys = Object.keys(object);
  for (const key of keys.slice(0, MAX_KEYS)) {
    const name = safeText(key);
    if (BLOCKED_KEY_RE.test(key) || SENSITIVE_KEY_RE.test(key)) {
      out[name] = '[REDACTED]';
      continue;
    }
    const clean = sanitize(object[key], depth + 1, seen);
    if (clean !== undefined) {
      out[name] = clean;
    }
  }
  if (keys.length > MAX_KEYS) {
    out._truncatedKeys = keys.length - MAX_KEYS;
  }
  return out;
}

// Sanitizes the fields of a log entry. Exported for tests.
export function redactFields(fields) {
  if (fields === undefined) return {};
  if (fields === null || typeof fields !== 'object' || Array.isArray(fields) || !isPlainObject(fields)) {
    return { fields: '[INVALID]' };
  }
  return sanitizeObject(fields, 0, new Set());
}

function defaultWrite(line) {
  process.stdout.write(`${line}\n`);
}

function safeEvent(event) {
  return typeof event === 'string' && EVENT_RE.test(event) ? event : 'invalid_event';
}

function buildLine(levelName, event, fields, nowMs) {
  const base = {
    ts: new Date(nowMs).toISOString(),
    level: levelName,
    event: safeEvent(event),
  };
  const data = redactFields(fields);
  const record = { ...base };
  for (const [key, value] of Object.entries(data)) {
    if (!(key in base)) {
      record[key] = value; // ts, level and event cannot be overridden
    }
  }
  const line = JSON.stringify(record);
  return line.length > MAX_LINE ? JSON.stringify({ ...base, truncated: true }) : line;
}

// options: { level = 'info', write = stdout writer, now = Date.now }
export function createLogger(options = {}) {
  if (options === null || typeof options !== 'object') {
    throw new TypeError('options must be an object');
  }
  for (const key of Object.keys(options)) {
    if (!OPTION_KEYS.includes(key)) {
      throw new TypeError(`unknown option ${key}`);
    }
  }
  const { level = 'info', write = defaultWrite, now = Date.now } = options;
  if (typeof level !== 'string' || !Object.hasOwn(LOG_LEVELS, level)) {
    throw new TypeError('level must be debug, info, warn, error or silent');
  }
  if (typeof write !== 'function' || typeof now !== 'function') {
    throw new TypeError('write and now must be functions');
  }
  const threshold = LOG_LEVELS[level];

  function emit(levelName, event, fields) {
    if (LOG_LEVELS[levelName] < threshold) {
      return;
    }
    let line;
    try {
      line = buildLine(levelName, event, fields, now());
    } catch {
      try {
        line = JSON.stringify({
          ts: new Date(now()).toISOString(),
          level: levelName,
          event: safeEvent(event),
          logError: true,
        });
      } catch {
        return;
      }
    }
    try {
      write(line);
    } catch {
      // logging must never break the caller
    }
  }

  return Object.freeze({
    level,
    debug: (event, fields) => emit('debug', event, fields),
    info: (event, fields) => emit('info', event, fields),
    warn: (event, fields) => emit('warn', event, fields),
    error: (event, fields) => emit('error', event, fields),
  });
}
