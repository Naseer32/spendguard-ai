// Stage 3b-3: combine the evidence into ONE verdict, following the approved
// verdict table.
//
// Pure: no I/O, no clock reads (the caller passes `now`), no randomness. Never
// throws; anything unexpected becomes HOLD, which keeps the reservation.
//
//   Evidence                                   Verdict       Action
//   Transaction not observed                   INCONCLUSIVE  retry (after 30 min of
//                                                            confirmed not-found: FAILED, release)
//   Verified execution failure                 FAILED        release reservation
//   Not final or incomplete                    INCONCLUSIVE  retry, no state change
//   Malformed or unrecognized evidence         HOLD          keep reservation, owner resolves
//   Chain invalid or receipt missing           HOLD          keep reservation, owner resolves
//   Valid execution, authorization, block time VERIFIED      mark EXECUTED
//   Execution does not match authorization     MISMATCH      keep reservation, owner resolves
//
// matchAuthorization result codes are mapped explicitly:
//   MATCH                                      continue verification
//   MALFORMED, BAD_AUTHORIZATION               HOLD
//   HASH_MISMATCH, SIGNER_MISMATCH,
//   RECEIVER_MISMATCH, ACTIONS_INVALID,
//   AMOUNT_MISMATCH                            MISMATCH
//   EXECUTION_NOT_OK                           FAILED only if the execution check
//                                              verified a failure AND the caller
//                                              independently confirmed that the
//                                              authorization identity and transfer
//                                              details match (transferDetailsMatch
//                                              === true); MISMATCH if they do not;
//                                              HOLD if that was not supplied
//   anything else (unknown code or shape)      HOLD
//
// Safety properties (all covered by tests):
//   * Only VERIFIED marks a payment EXECUTED.
//   * The reservation is released only for a verified execution failure of a
//     transaction whose authorization identity and transfer details match, or
//     after the not-found window.
//   * INCONCLUSIVE never changes state (changesState: false), so retries create
//     no audit entries.
//   * Every HOLD and MISMATCH keeps the reservation.
//   * Unknown, missing or malformed evidence never produces VERIFIED, FAILED or
//     INCONCLUSIVE from the "found" path; it produces HOLD or MISMATCH.

import { EXECUTION_CODES } from './executionOutcome.js';
import { BLOCK_TIME_CODES, parseIsoUtcToNanos } from './blockTime.js';

export const NOT_FOUND_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

export const LOOKUP = Object.freeze({
  FOUND: 'FOUND', // the RPC returned the transaction
  NOT_OBSERVED: 'NOT_OBSERVED', // timeout or other "could not tell": not a confirmed not-found
  NOT_FOUND: 'NOT_FOUND', // the RPC definitively said it does not know the transaction
});

export const VERDICTS = Object.freeze({
  VERIFIED: 'VERIFIED',
  FAILED: 'FAILED',
  INCONCLUSIVE: 'INCONCLUSIVE',
  HOLD: 'HOLD',
  MISMATCH: 'MISMATCH',
});

export const ACTIONS = Object.freeze({
  MARK_EXECUTED: 'MARK_EXECUTED',
  RELEASE_RESERVATION: 'RELEASE_RESERVATION',
  RETRY: 'RETRY',
  KEEP_RESERVATION: 'KEEP_RESERVATION', // owner resolution required
});

export const REASONS = Object.freeze({
  OK: 'OK',
  NOT_OBSERVED: 'NOT_OBSERVED',
  NOT_FOUND_YET: 'NOT_FOUND_YET',
  NOT_FOUND_TIMEOUT: 'NOT_FOUND_TIMEOUT',
  NOT_FINAL: 'NOT_FINAL',
  EXECUTION_FAILED: 'EXECUTION_FAILED',
  MALFORMED_EVIDENCE: 'MALFORMED_EVIDENCE',
  CHAIN_INVALID: 'CHAIN_INVALID',
  RECEIPT_MISSING: 'RECEIPT_MISSING',
  AUTHORIZATION_MISMATCH: 'AUTHORIZATION_MISMATCH',
  BLOCK_BEFORE_AUTHORIZATION: 'BLOCK_BEFORE_AUTHORIZATION',
  HASH_ALREADY_USED: 'HASH_ALREADY_USED',
});

const ACTION_FOR = Object.freeze({
  [VERDICTS.VERIFIED]: ACTIONS.MARK_EXECUTED,
  [VERDICTS.FAILED]: ACTIONS.RELEASE_RESERVATION,
  [VERDICTS.INCONCLUSIVE]: ACTIONS.RETRY,
  [VERDICTS.HOLD]: ACTIONS.KEEP_RESERVATION,
  [VERDICTS.MISMATCH]: ACTIONS.KEEP_RESERVATION,
});

const NS_PER_MS = 1_000_000n;

// Result codes of matchAuthorization (src/near/matchAuthorization.js).
const MATCH = Object.freeze({
  MATCH: 'MATCH',
  EXECUTION_NOT_OK: 'EXECUTION_NOT_OK',
});
const MISMATCH_CODES = new Set([
  'HASH_MISMATCH',
  'SIGNER_MISMATCH',
  'RECEIVER_MISMATCH',
  'ACTIONS_INVALID',
  'AMOUNT_MISMATCH',
]);
// MALFORMED, BAD_AUTHORIZATION and any unrecognised code fall through to HOLD.

const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const isResult = (r) => isObject(r) && typeof r.ok === 'boolean' && typeof r.code === 'string';

function verdict(v, reason) {
  return Object.freeze({
    verdict: v,
    action: ACTION_FOR[v],
    reason,
    changesState: v !== VERDICTS.INCONCLUSIVE,
  });
}
const hold = (reason = REASONS.MALFORMED_EVIDENCE) => verdict(VERDICTS.HOLD, reason);

// A transaction the RPC has not shown us: retry, and only after a confirmed
// not-found for the whole window do we give up and release the budget.
function evaluateNotFound(input) {
  const submitted = parseIsoUtcToNanos(input.submittedAt);
  const now = parseIsoUtcToNanos(input.now);
  if (submitted === null || now === null) return hold();
  const windowNs = BigInt(NOT_FOUND_TIMEOUT_MS) * NS_PER_MS;
  return now - submitted >= windowNs
    ? verdict(VERDICTS.FAILED, REASONS.NOT_FOUND_TIMEOUT)
    : verdict(VERDICTS.INCONCLUSIVE, REASONS.NOT_FOUND_YET);
}

// Execution result -> 'ok' | 'failed' | a final verdict (inconclusive / hold).
function classifyExecution(execution) {
  if (!isResult(execution)) return hold();
  if (execution.ok) {
    return execution.code === EXECUTION_CODES.OK ? 'ok' : hold();
  }
  switch (execution.code) {
    case EXECUTION_CODES.NOT_FINAL:
    case EXECUTION_CODES.INCOMPLETE:
      return verdict(VERDICTS.INCONCLUSIVE, REASONS.NOT_FINAL);
    case EXECUTION_CODES.FAILED:
      return 'failed';
    case EXECUTION_CODES.RECEIPT_MISSING:
      return hold(REASONS.RECEIPT_MISSING);
    case EXECUTION_CODES.CHAIN_INVALID:
      return hold(REASONS.CHAIN_INVALID);
    default: // MALFORMED and any code we do not recognise
      return hold();
  }
}

// matchAuthorization result -> 'matched' | a final verdict (hold / mismatch).
// `execution` is the classified execution result ('ok' or 'failed' here).
function classifyMatch(match, execution, transferDetailsMatch) {
  if (!isResult(match)) return hold();
  if (match.ok) return match.code === MATCH.MATCH ? 'matched' : hold();
  if (match.code === MATCH.EXECUTION_NOT_OK) {
    // matchAuthorization says the execution is not OK. That only agrees with
    // our own execution check when that check also found a failure.
    if (execution !== 'failed') return hold();
    if (typeof transferDetailsMatch !== 'boolean') return hold();
    return transferDetailsMatch
      ? 'matched'
      : verdict(VERDICTS.MISMATCH, REASONS.AUTHORIZATION_MISMATCH);
  }
  if (MISMATCH_CODES.has(match.code)) {
    return verdict(VERDICTS.MISMATCH, REASONS.AUTHORIZATION_MISMATCH);
  }
  return hold(); // MALFORMED, BAD_AUTHORIZATION, unknown codes
}

function evaluateFound(input) {
  const execution = classifyExecution(input.execution);
  if (typeof execution !== 'string') return execution; // inconclusive or hold

  // Does the transaction match what was authorized? Returns 'matched' or a verdict.
  const match = classifyMatch(input.match, execution, input.transferDetailsMatch);
  if (typeof match !== 'string') return match;

  // A verified failure releases the budget only when the authorization identity
  // and transfer details match: either matchAuthorization said MATCH, or it said
  // EXECUTION_NOT_OK and the caller independently confirmed the details. Every
  // other case returned above.
  if (execution === 'failed') return verdict(VERDICTS.FAILED, REASONS.EXECUTION_FAILED);

  const time = input.time;
  if (!isResult(time)) return hold();
  if (!time.ok) {
    return time.code === BLOCK_TIME_CODES.BLOCK_BEFORE_AUTHORIZATION
      ? verdict(VERDICTS.MISMATCH, REASONS.BLOCK_BEFORE_AUTHORIZATION)
      : hold();
  }
  if (time.code !== BLOCK_TIME_CODES.OK) return hold();

  if (typeof input.hashAlreadyUsed !== 'boolean') return hold();
  if (input.hashAlreadyUsed) return verdict(VERDICTS.MISMATCH, REASONS.HASH_ALREADY_USED);

  return verdict(VERDICTS.VERIFIED, REASONS.OK);
}

// input: {
//   lookup: 'FOUND' | 'NOT_OBSERVED' | 'NOT_FOUND',
//   // lookup FOUND:
//   execution: result of checkExecution,
//   match: result of matchAuthorization ({ ok, code }),
//   transferDetailsMatch: boolean, needed only when match.code is
//     EXECUTION_NOT_OK: true only if the authorization identity and the
//     transfer details were independently confirmed to match,
//   time: result of checkBlockTime (needed only when execution succeeded),
//   hashAlreadyUsed: boolean (another request already uses this tx hash),
//   // lookup NOT_FOUND:
//   submittedAt, now: UTC ISO strings,
// }
export function verifyTransfer(input) {
  try {
    if (!isObject(input)) return hold();
    switch (input.lookup) {
      case LOOKUP.NOT_OBSERVED:
        return verdict(VERDICTS.INCONCLUSIVE, REASONS.NOT_OBSERVED);
      case LOOKUP.NOT_FOUND:
        return evaluateNotFound(input);
      case LOOKUP.FOUND:
        return evaluateFound(input);
      default:
        return hold();
    }
  } catch {
    return hold();
  }
}
