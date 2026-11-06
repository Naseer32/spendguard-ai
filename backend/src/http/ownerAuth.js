// Owner authentication helpers (framework-free).
//
// Only a hash of the owner token is ever kept (see config.js). Verification
// hashes the presented token and compares the two hashes with timingSafeEqual.
// A missing or malformed header costs the same as a wrong token.

import { createHash, timingSafeEqual } from 'node:crypto';

const DOMAIN = 'spendguard-owner-token-v1\n';
const HEX64_RE = /^[0-9a-f]{64}$/;
const BEARER_RE = /^bearer ([\x21-\x7e]{1,512})$/i;
const MAX_HEADER_LENGTH = 600;

export function hashOwnerToken(token) {
  if (typeof token !== 'string') {
    throw new TypeError('token must be a string');
  }
  return createHash('sha256').update(DOMAIN + token).digest('hex');
}

// Returns the token from "Authorization: Bearer <token>", or null.
// Exactly one space, printable ASCII token of 1 to 512 characters.
export function extractBearer(headerValue) {
  if (typeof headerValue !== 'string' || headerValue.length > MAX_HEADER_LENGTH) {
    return null;
  }
  const match = BEARER_RE.exec(headerValue);
  return match === null ? null : match[1];
}

// expectedHashHex: the 64-character lowercase hex hash from config.
export function verifyOwnerToken(headerValue, expectedHashHex) {
  if (typeof expectedHashHex !== 'string' || !HEX64_RE.test(expectedHashHex)) {
    throw new TypeError('expectedHashHex must be a 64-character lowercase hex string');
  }
  const token = extractBearer(headerValue);
  const presented = Buffer.from(hashOwnerToken(token ?? ''), 'hex');
  const expected = Buffer.from(expectedHashHex, 'hex');
  const equal = timingSafeEqual(presented, expected);
  return token !== null && equal;
}
