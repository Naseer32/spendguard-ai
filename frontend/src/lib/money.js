// Money helpers for display and form input.
//
// Mirrors the backend rules (backend/src/money/yocto.js): amounts are decimal
// strings of yoctoNEAR (1 NEAR = 10^24), all arithmetic uses BigInt, and
// floating point is never used. This is a client-side copy for UI purposes
// only; the backend remains the source of truth.

export const NEAR_DECIMALS = 24;
export const YOCTO_PER_NEAR = 10n ** 24n;
export const MAX_YOCTO_DIGITS = 40;

const YOCTO_RE = /^(0|[1-9][0-9]*)$/;
// Form input is a little more forgiving than the backend: "01.5" is accepted
// and normalised, because users type it. Output is always canonical.
const NEAR_INPUT_RE = /^([0-9]+)(?:\.([0-9]{1,24}))?$/;

export function isYoctoString(value) {
  return (
    typeof value === 'string' &&
    value.length <= MAX_YOCTO_DIGITS &&
    YOCTO_RE.test(value)
  );
}

/** Decimal NEAR text (e.g. "1.5") to a yoctoNEAR string, or null if invalid. */
export function nearToYocto(text) {
  if (typeof text !== 'string') return null;
  const match = NEAR_INPUT_RE.exec(text.trim());
  if (!match) return null;
  const fraction = (match[2] ?? '').padEnd(NEAR_DECIMALS, '0');
  const yocto = (BigInt(match[1]) * YOCTO_PER_NEAR + BigInt(fraction)).toString();
  return yocto.length <= MAX_YOCTO_DIGITS ? yocto : null;
}

/** yoctoNEAR string to exact decimal NEAR string (trailing zeros trimmed). */
export function yoctoToNear(yocto) {
  if (!isYoctoString(yocto)) return null;
  const amount = BigInt(yocto);
  const whole = amount / YOCTO_PER_NEAR;
  const rest = amount % YOCTO_PER_NEAR;
  if (rest === 0n) return whole.toString();
  const fraction = rest.toString().padStart(NEAR_DECIMALS, '0').replace(/0+$/, '');
  return `${whole}.${fraction}`;
}

function groupThousands(digits) {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Human display of a yocto amount, e.g. "1,250.5". Fractions are truncated
 * (never rounded up) to `maxDecimals`; a non-zero amount that would show as
 * zero is displayed as "<0.0001" so it is never mistaken for zero.
 * Returns "—" for invalid input.
 */
export function formatNear(yocto, maxDecimals = 4) {
  const exact = yoctoToNear(yocto);
  if (exact === null) return '—';
  const [whole, fraction = ''] = exact.split('.');
  const shown = fraction.slice(0, maxDecimals).replace(/0+$/, '');
  if (whole === '0' && shown === '' && fraction !== '') {
    return `<0.${'0'.repeat(Math.max(maxDecimals - 1, 0))}1`;
  }
  return shown ? `${groupThousands(whole)}.${shown}` : groupThousands(whole);
}

export function formatNearWithUnit(yocto, maxDecimals = 4) {
  const text = formatNear(yocto, maxDecimals);
  return text === '—' ? text : `${text} NEAR`;
}

/** -1, 0 or 1. Invalid input compares as 0 (callers validate first). */
export function compareYocto(a, b) {
  if (!isYoctoString(a) || !isYoctoString(b)) return 0;
  const x = BigInt(a);
  const y = BigInt(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

export function sumYocto(values) {
  let total = 0n;
  for (const v of values) {
    if (isYoctoString(v)) total += BigInt(v);
  }
  return total.toString();
}

/** Whole-number percentage of `used` over `total`, clamped to 0..100. */
export function percentOf(used, total) {
  if (!isYoctoString(used) || !isYoctoString(total)) return 0;
  const t = BigInt(total);
  if (t === 0n) return 0;
  const pct = (BigInt(used) * 100n) / t;
  return Number(pct > 100n ? 100n : pct);
}
