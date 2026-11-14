// Pure rules for paying an APPROVED payment request from a NEAR wallet.
// No React, no network, no storage: everything here is unit-tested.
//
// The backend is the only authority on whether a payment happened. Nothing in
// this file (or anywhere in the frontend) decides that a request is EXECUTED.

export const NEAR_NETWORK = 'testnet';

const HASH_RE = /^[1-9A-HJ-NP-Za-km-z]{32,50}$/; // same shape backend/src/services/transactions.js accepts
const YOCTO_RE = /^[1-9][0-9]*$/; // positive whole yoctoNEAR, no leading zero
const ACCOUNT_RE = /^[a-z0-9._-]{2,64}$/;

export const isTxHash = (v) => typeof v === 'string' && HASH_RE.test(v);
export const isAccountId = (v) => typeof v === 'string' && ACCOUNT_RE.test(v);

/**
 * May this wallet sign this payment right now?
 * Resolves { ok: true } or { ok: false, code, message }. The backend re-checks everything.
 */
export function signEligibility({ payment, agent, accountId, isLive, now = Date.now() }) {
  const no = (code, message) => ({ ok: false, code, message });
  if (!isLive) return no('DEMO', 'Demo mode has no wallet or NEAR connection. Connect to your backend in Settings to pay a real request.');
  if (!payment || payment.status !== 'APPROVED') return no('NOT_APPROVED', 'Only APPROVED requests can be signed.');
  if (!agent || typeof agent.sourceAccount !== 'string') return no('NO_AGENT', 'The agent for this request could not be found.');
  if (!isAccountId(accountId)) return no('NO_WALLET', 'Connect a NEAR testnet wallet first.');
  if (accountId !== agent.sourceAccount) {
    return no('WRONG_ACCOUNT', `This request must be paid from the agent's source account ${agent.sourceAccount}. The connected wallet is ${accountId}.`);
  }
  if (typeof payment.expiresAt === 'string' && !(Date.parse(payment.expiresAt) > now)) {
    return no('EXPIRED', 'The authorization window has passed. Ask the agent to submit a new request.');
  }
  if (typeof payment.amount !== 'string' || !YOCTO_RE.test(payment.amount)) return no('BAD_AMOUNT', 'The approved amount is not a valid positive amount.');
  if (typeof payment.recipient !== 'string' || payment.recipient === '') return no('BAD_RECIPIENT', 'The approved recipient is missing.');
  return { ok: true };
}

/** The exact transfer that was authorized: the approved recipient and the approved amount, nothing else. */
export function buildTransfer(payment) {
  if (typeof payment?.recipient !== 'string' || payment.recipient === '') throw new Error('Missing recipient.');
  if (typeof payment.amount !== 'string' || !YOCTO_RE.test(payment.amount)) throw new Error('Invalid amount.');
  return Object.freeze({ receiverId: payment.recipient, deposit: payment.amount });
}

/** Wallet Selector resolves a FinalExecutionOutcome. Returns the tx hash or null. */
export function extractTxHash(outcome) {
  for (const c of [outcome?.transaction?.hash, outcome?.transaction_outcome?.id]) if (isTxHash(c)) return c;
  return null;
}

export function extractSignerId(outcome) {
  const s = outcome?.transaction?.signer_id;
  return isAccountId(s) ? s : null;
}

/** Plain-language view of a backend verdict. `settled` means no further reporting is needed. */
export function describeVerdict({ verdict, reason, payment } = {}) {
  const status = payment?.status ?? null;
  const detail = typeof reason === 'string' ? reason.slice(0, 200) : null;
  switch (verdict) {
    case 'VERIFIED':
      if (status === 'EXECUTED') return { tone: 'success', title: 'Verified by the backend', detail: 'The backend confirmed the transfer on-chain.', settled: true, retry: false };
      return { tone: 'neutral', title: 'Verdict received', detail: `The backend answered VERIFIED but the request status is ${status ?? 'unknown'}. Refresh before doing anything else.`, settled: false, retry: true };
    case 'FAILED':
      return { tone: 'danger', title: 'Transaction failed on-chain', detail, settled: true, retry: false };
    case 'MISMATCH':
      return { tone: 'warning', title: 'Transaction does not match the authorization', detail: detail ?? 'Do not send another payment for this request. Review it with the agent owner.', settled: true, retry: false };
    case 'HOLD':
      return { tone: 'warning', title: 'Verification is on hold', detail: detail ?? 'The request stays SUBMITTED. Do not sign again; re-check later.', settled: false, retry: true };
    case 'INCONCLUSIVE':
      return { tone: 'neutral', title: 'Verification is not conclusive yet', detail: detail ?? 'The transaction could not be confirmed yet. Re-check in a moment.', settled: false, retry: true };
    default:
      return { tone: 'neutral', title: 'Unrecognised verdict', detail: 'Refresh to see the current status.', settled: false, retry: true };
  }
}

/** Wallet errors never expose raw wallet text. Only a rejection proves nothing was sent. */
export function describeWalletError(error) {
  if (error?.code === 'ACCOUNT_MISMATCH') {
    return { kind: 'mismatch', message: "Your wallet is on a different account than this agent's source account. Switch accounts in the wallet and try again. Nothing was sent." };
  }
  const text = `${error?.name ?? ''} ${error?.message ?? ''}`.toLowerCase();
  if (/reject|denied|declin|cancel|closed|abort/.test(text)) {
    return { kind: 'rejected', message: 'You declined the request in your wallet. Nothing was sent.' };
  }
  if (/network|fetch|timeout|offline|unreachable/.test(text)) {
    return { kind: 'network', message: 'The wallet lost its connection. Check your wallet history before trying again: the transfer may have been sent.' };
  }
  return { kind: 'wallet', message: 'The wallet could not complete the request. Check your wallet history before trying again: the transfer may have been sent.' };
}

const CODE_MESSAGES = Object.freeze({
  SIGNER_NOT_SOURCE: "The backend says this wallet is not the agent's source account.",
  HASH_DIFFERS: 'A different transaction was already reported for this request.',
  HASH_ALREADY_USED: 'This transaction was already used for another request.',
  NOT_REPORTABLE: 'This request no longer accepts a transaction report. Its status has been refreshed.',
  REQUEST_EXPIRED: 'The authorization window passed before the transaction was reported.',
});

/** Turns a failed store result into { message, retryable }. A retry re-sends the same hash, which the backend allows. */
export function describeReportFailure(result) {
  const kind = result?.kind;
  if (kind === 'network' || kind === 'timeout' || kind === 'server' || kind === 'rate' || kind === 'shape') {
    return { message: 'The transaction was sent, but the report to the backend did not complete. Retry the report; do not send again.', retryable: true };
  }
  if (kind === 'auth') return { message: 'The backend rejected the owner token. Reconnect in Settings, then retry the report.', retryable: false };
  const known = CODE_MESSAGES[result?.code];
  return { message: known ?? (typeof result?.error === 'string' ? result.error : 'The backend refused the report.'), retryable: false };
}
