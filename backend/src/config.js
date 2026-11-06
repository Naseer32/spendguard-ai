// Startup configuration from environment variables.
//
// loadConfig validates EVERYTHING and reports all problems at once. Messages
// never contain the provided values, so a secret placed in the wrong variable
// cannot leak through an error. The raw OWNER_TOKEN is hashed and discarded.

import { isIP } from 'node:net';
import { hashOwnerToken } from './http/ownerAuth.js';

export class ConfigError extends Error {
  constructor(problems) {
    const list = problems.map((problem) => `- ${problem}`).join('\n');
    super(`invalid configuration (${problems.length} problem${problems.length === 1 ? '' : 's'}):\n${list}`);
    this.name = 'ConfigError';
    this.problems = Object.freeze([...problems]);
  }
}

export const BODY_LIMIT_BYTES = 16384;
export const LOG_LEVEL_NAMES = Object.freeze(['debug', 'info', 'warn', 'error', 'silent']);

const TOKEN_RE = /^[\x21-\x7e]{32,256}$/;
const MIN_DISTINCT_TOKEN_CHARS = 8;
const WINDOW_MIN_MS = 1000;
const WINDOW_MAX_MS = 2_592_000_000; // 30 days
const MAX_CORS_ORIGINS = 20;
const INTEGER_RE = /^(0|[1-9][0-9]{0,15})$/;

// Reads an optional whole-number variable. Pushes a problem and returns the
// default when the value is unusable.
function readInteger(env, name, { min, max, fallback }, problems) {
  const raw = env[name];
  if (raw === undefined) {
    return fallback;
  }
  if (typeof raw !== 'string') {
    problems.push(`${name}: must be a string`);
    return fallback;
  }
  if (raw === '') {
    problems.push(`${name}: must not be empty (unset it to use the default)`);
    return fallback;
  }
  if (!INTEGER_RE.test(raw)) {
    problems.push(`${name}: must be a whole number without sign, spaces or leading zeros`);
    return fallback;
  }
  const value = Number(raw);
  if (value < min || value > max) {
    problems.push(`${name}: must be between ${min} and ${max}`);
    return fallback;
  }
  return value;
}

function readOwnerTokenHash(env, problems) {
  const raw = env.OWNER_TOKEN;
  if (raw === undefined || raw === '') {
    problems.push('OWNER_TOKEN: is required');
    return null;
  }
  if (typeof raw !== 'string' || !TOKEN_RE.test(raw)) {
    problems.push('OWNER_TOKEN: must be 32 to 256 printable characters without spaces');
    return null;
  }
  if (new Set(raw).size < MIN_DISTINCT_TOKEN_CHARS) {
    problems.push('OWNER_TOKEN: is too repetitive; use random characters');
    return null;
  }
  return hashOwnerToken(raw);
}

function readDbPath(env, problems) {
  const raw = env.DB_PATH;
  if (raw === undefined) {
    return 'spendguard.sqlite';
  }
  // eslint-disable-next-line no-control-regex
  if (typeof raw !== 'string' || raw === '' || raw.length > 1024 || /[\u0000-\u001f\u007f]/.test(raw)) {
    problems.push('DB_PATH: must be a file path of 1 to 1024 characters without control characters');
    return 'spendguard.sqlite';
  }
  return raw;
}

function readHost(env, problems) {
  const raw = env.HOST;
  if (raw === undefined) {
    return '127.0.0.1';
  }
  if (typeof raw !== 'string' || (raw !== 'localhost' && isIP(raw) === 0)) {
    problems.push('HOST: must be an IP address or "localhost"');
    return '127.0.0.1';
  }
  return raw;
}

function readCorsOrigins(env, problems) {
  const raw = env.CORS_ORIGINS;
  if (raw === undefined) {
    return [];
  }
  if (typeof raw !== 'string' || raw === '') {
    problems.push('CORS_ORIGINS: must be a comma-separated list of origins (unset it to allow none)');
    return [];
  }
  const parts = raw.split(',');
  if (parts.length > MAX_CORS_ORIGINS) {
    problems.push(`CORS_ORIGINS: at most ${MAX_CORS_ORIGINS} origins are allowed`);
    return [];
  }
  const origins = [];
  for (const part of parts) {
    if (part === '*') {
      problems.push('CORS_ORIGINS: a wildcard is not allowed; list exact origins');
      continue;
    }
    let url = null;
    try {
      url = new URL(part);
    } catch {
      url = null;
    }
    if (
      url === null ||
      (url.protocol !== 'http:' && url.protocol !== 'https:') ||
      url.origin !== part
    ) {
      problems.push(
        'CORS_ORIGINS: each entry must be an exact lowercase origin like https://example.com (no path, no trailing slash, no default port)',
      );
      continue;
    }
    if (!origins.includes(part)) {
      origins.push(part);
    }
  }
  return origins;
}

function readLogLevel(env, problems) {
  const raw = env.LOG_LEVEL;
  if (raw === undefined) {
    return 'info';
  }
  if (typeof raw !== 'string' || !LOG_LEVEL_NAMES.includes(raw)) {
    problems.push(`LOG_LEVEL: must be one of ${LOG_LEVEL_NAMES.join(', ')}`);
    return 'info';
  }
  return raw;
}

// env defaults to process.env. Returns a frozen config or throws ConfigError.
export function loadConfig(env = process.env) {
  if (env === null || typeof env !== 'object') {
    throw new TypeError('env must be an object');
  }
  const problems = [];

  const ownerTokenHash = readOwnerTokenHash(env, problems);
  const dbPath = readDbPath(env, problems);
  const host = readHost(env, problems);
  const port = readInteger(env, 'PORT', { min: 0, max: 65535, fallback: 3000 }, problems);
  const corsOrigins = readCorsOrigins(env, problems);
  const windowBounds = { min: WINDOW_MIN_MS, max: WINDOW_MAX_MS };
  const approvalWindowMs = readInteger(
    env, 'APPROVAL_WINDOW_MS', { ...windowBounds, fallback: 86_400_000 }, problems,
  );
  const authorizationWindowMs = readInteger(
    env, 'AUTHORIZATION_WINDOW_MS', { ...windowBounds, fallback: 3_600_000 }, problems,
  );
  const sweepIntervalMs = readInteger(
    env, 'SWEEP_INTERVAL_MS', { min: 1000, max: 3_600_000, fallback: 60_000 }, problems,
  );
  const rateBounds = { min: 1, max: 100_000 };
  const authFailuresPerMinute = readInteger(
    env, 'RATE_LIMIT_AUTH_FAILURES_PER_MINUTE', { ...rateBounds, fallback: 10 }, problems,
  );
  const evaluatePerMinute = readInteger(
    env, 'RATE_LIMIT_EVALUATE_PER_MINUTE', { ...rateBounds, fallback: 60 }, problems,
  );
  const ownerPerMinute = readInteger(
    env, 'RATE_LIMIT_OWNER_PER_MINUTE', { ...rateBounds, fallback: 300 }, problems,
  );
  const logLevel = readLogLevel(env, problems);

  if (problems.length > 0) {
    throw new ConfigError(problems);
  }

  return Object.freeze({
    ownerTokenHash,
    dbPath,
    host,
    port,
    corsOrigins: Object.freeze(corsOrigins),
    settings: Object.freeze({ approvalWindowMs, authorizationWindowMs }),
    rateLimits: Object.freeze({ authFailuresPerMinute, evaluatePerMinute, ownerPerMinute }),
    bodyLimitBytes: BODY_LIMIT_BYTES,
    sweepIntervalMs,
    logLevel,
  });
}

// A safe summary for startup logs: it never includes the token hash.
export function describeConfig(config) {
  return {
    ownerTokenConfigured: typeof config.ownerTokenHash === 'string',
    dbPath: config.dbPath,
    host: config.host,
    port: config.port,
    corsOrigins: [...config.corsOrigins],
    settings: { ...config.settings },
    rateLimits: { ...config.rateLimits },
    bodyLimitBytes: config.bodyLimitBytes,
    sweepIntervalMs: config.sweepIntervalMs,
    logLevel: config.logLevel,
  };
}
