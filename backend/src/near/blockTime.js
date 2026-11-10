// Stage 3b-3: block-time check.
//
// Pure: no I/O, no clock reads, no floats for time values. Never throws;
// anything unexpected fails closed.
//
// A payment may only be verified by a transaction that was included in a block
// AFTER the payment was authorized (decided_at, the moment it became APPROVED).
// Because the backend clock and the chain clock can differ slightly, a block
// time up to `toleranceMs` BEFORE the authorization time is still accepted.
//
//   ok  <=>  blockTimeNs >= authorizedAtNs - toleranceNs
//
// NEAR reports block time as `header.timestamp_nanosec`, a decimal string of
// nanoseconds since the Unix epoch (about 1.8e18, beyond Number's exact range),
// so everything here is BigInt.

export const CLOCK_SKEW_TOLERANCE_MS = 120_000; // 2 minutes

export const BLOCK_TIME_CODES = Object.freeze({
  OK: 'OK',
  BLOCK_BEFORE_AUTHORIZATION: 'BLOCK_BEFORE_AUTHORIZATION',
  MALFORMED: 'MALFORMED',
});

const NS_PER_MS = 1_000_000n;
const ISO_UTC = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?Z$/;
const NANOS = /^\d{1,25}$/;

const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const result = (ok, code) => Object.freeze({ ok, code });

// "2026-11-09T13:09:09.101285803Z" -> nanoseconds since epoch (BigInt), or null.
// Accepts UTC ISO strings only ("Z", optional 1-9 fractional digits). Rejects
// impossible dates such as 2026-02-30, which Date.parse would silently roll over.
export function parseIsoUtcToNanos(iso) {
  if (typeof iso !== 'string') return null;
  const m = ISO_UTC.exec(iso);
  if (m === null) return null;
  const ms = Date.parse(`${m[1]}Z`);
  if (!Number.isFinite(ms)) return null;
  if (new Date(ms).toISOString().slice(0, 19) !== m[1]) return null;
  const fraction = BigInt((m[2] ?? '').padEnd(9, '0'));
  return BigInt(ms) * NS_PER_MS + fraction;
}

// NEAR `timestamp_nanosec` (decimal string of digits) -> BigInt, or null.
export function parseBlockTimestampNanos(value) {
  if (typeof value !== 'string' || !NANOS.test(value)) return null;
  return BigInt(value);
}

function evaluate(input) {
  if (!isObject(input)) return result(false, BLOCK_TIME_CODES.MALFORMED);
  const { blockTimestampNanosec, authorizedAt } = input;
  const toleranceMs = input.toleranceMs === undefined ? CLOCK_SKEW_TOLERANCE_MS : input.toleranceMs;

  if (!Number.isSafeInteger(toleranceMs) || toleranceMs < 0) {
    return result(false, BLOCK_TIME_CODES.MALFORMED);
  }
  const blockNs = parseBlockTimestampNanos(blockTimestampNanosec);
  const authorizedNs = parseIsoUtcToNanos(authorizedAt);
  if (blockNs === null || authorizedNs === null) {
    return result(false, BLOCK_TIME_CODES.MALFORMED);
  }

  const earliestAcceptedNs = authorizedNs - BigInt(toleranceMs) * NS_PER_MS;
  return blockNs >= earliestAcceptedNs
    ? result(true, BLOCK_TIME_CODES.OK)
    : result(false, BLOCK_TIME_CODES.BLOCK_BEFORE_AUTHORIZATION);
}

// input: { blockTimestampNanosec: string, authorizedAt: string (UTC ISO),
//          toleranceMs?: non-negative safe integer (default 120000) }
export function checkBlockTime(input) {
  try {
    return evaluate(input);
  } catch {
    return result(false, BLOCK_TIME_CODES.MALFORMED);
  }
}
