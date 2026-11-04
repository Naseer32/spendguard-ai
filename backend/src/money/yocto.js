// yoctoNEAR money helpers. 1 NEAR = 10^24 yoctoNEAR.
// Rules: amounts are decimal strings, all arithmetic uses BigInt,
// and floating point is never used for money.

export const NEAR_DECIMALS = 24;
export const YOCTO_PER_NEAR = 10n ** 24n;
export const MAX_YOCTO_DIGITS = 40;

const YOCTO_RE = /^(0|[1-9][0-9]*)$/;
const NEAR_RE = /^(0|[1-9][0-9]*)(?:\.([0-9]{1,24}))?$/;

export class YoctoError extends Error {
  constructor(message) {
    super(message);
    this.name = 'YoctoError';
  }
}

// True only for canonical non-negative integer strings of at most 40 digits.
export function isYoctoString(value) {
  return (
    typeof value === 'string' &&
    value.length <= MAX_YOCTO_DIGITS &&
    YOCTO_RE.test(value)
  );
}

export function parseYocto(value) {
  if (!isYoctoString(value)) {
    throw new YoctoError('invalid yoctoNEAR amount');
  }
  return BigInt(value);
}

export function tryParseYocto(value) {
  return isYoctoString(value) ? BigInt(value) : null;
}

export function formatYocto(amount) {
  if (typeof amount !== 'bigint' || amount < 0n) {
    throw new YoctoError('amount must be a non-negative bigint');
  }
  const text = amount.toString();
  if (text.length > MAX_YOCTO_DIGITS) {
    throw new YoctoError('amount exceeds maximum size');
  }
  return text;
}

// Returns -1, 0 or 1.
export function compareYocto(a, b) {
  const x = parseYocto(a);
  const y = parseYocto(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

export function addYocto(a, b) {
  return formatYocto(parseYocto(a) + parseYocto(b));
}

export function subYocto(a, b) {
  const result = parseYocto(a) - parseYocto(b);
  if (result < 0n) {
    throw new YoctoError('result would be negative');
  }
  return formatYocto(result);
}

export function sumYocto(values) {
  let total = 0n;
  for (const value of values) {
    total += parseYocto(value);
  }
  return formatYocto(total);
}

// Decimal NEAR string (for example "1.5") to yoctoNEAR string.
// At most 24 decimal places; anything else is rejected.
export function nearToYocto(value) {
  if (typeof value !== 'string') {
    throw new YoctoError('invalid NEAR amount');
  }
  const match = NEAR_RE.exec(value);
  if (!match) {
    throw new YoctoError('invalid NEAR amount');
  }
  const whole = match[1];
  const fraction = (match[2] ?? '').padEnd(NEAR_DECIMALS, '0');
  return formatYocto(BigInt(whole + fraction));
}

// yoctoNEAR string to decimal NEAR string, trailing zeros trimmed.
export function yoctoToNear(value) {
  const amount = parseYocto(value);
  const whole = amount / YOCTO_PER_NEAR;
  const remainder = amount % YOCTO_PER_NEAR;
  if (remainder === 0n) {
    return whole.toString();
  }
  const fraction = remainder
    .toString()
    .padStart(NEAR_DECIMALS, '0')
    .replace(/0+$/, '');
  return `${whole}.${fraction}`;
}
