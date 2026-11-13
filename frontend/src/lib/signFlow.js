// The sign-then-report sequence, with every collaborator injected so it is testable.
//
//   guard -> wallet signs the exact authorized transfer -> save the hash locally
//   -> POST tx-report { txHash, signerId } -> show the backend's verdict
//
// The status shown afterwards is whatever the backend returns. This module never produces EXECUTED.

import {
  buildTransfer, describeReportFailure, describeVerdict, describeWalletError,
  extractSignerId, extractTxHash, isAccountId, isTxHash, signEligibility,
} from './payTx.js';

const PENDING_KEY = 'spendguard.pendingTxReports';
const MAX_PENDING = 20;

// A transaction hash and an account id are public on-chain data, not secrets. They are kept only so a
// report that failed (or a HOLD) can be retried without sending money twice.
export function getPendingStorage() {
  try {
    const s = globalThis.sessionStorage;
    s.getItem(PENDING_KEY);
    return s;
  } catch {
    return null;
  }
}

function readAll(storage) {
  try {
    const parsed = JSON.parse(storage?.getItem(PENDING_KEY) ?? '{}');
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([, v]) => v && isTxHash(v.txHash) && isAccountId(v.signerId)));
  } catch {
    return {};
  }
}

function writeAll(storage, all) {
  try {
    storage?.setItem(PENDING_KEY, JSON.stringify(Object.fromEntries(Object.entries(all).slice(-MAX_PENDING))));
  } catch {
    /* storage blocked: the retry option is lost on reload, nothing else */
  }
}

export function loadPendingFor(storage, requestId) {
  const v = readAll(storage)[requestId];
  return v ? { txHash: v.txHash, signerId: v.signerId } : null;
}
export function savePending(storage, requestId, { txHash, signerId }) {
  writeAll(storage, { ...readAll(storage), [requestId]: { txHash, signerId } });
}
export function clearPending(storage, requestId) {
  const all = readAll(storage);
  delete all[requestId];
  writeAll(storage, all);
}

/** Report a transaction hash to the backend. Safe to repeat with the same hash. */
export async function submitReport({ requestId, txHash, signerId, reportTx, storage }) {
  const result = await reportTx(requestId, { txHash, signerId });
  if (!result?.ok) {
    return { ok: false, stage: 'report', txHash, signerId, ...describeReportFailure(result) };
  }
  const view = describeVerdict(result);
  if (view.settled) clearPending(storage, requestId);
  return { ok: true, stage: 'report', txHash, signerId, verdict: result.verdict, action: result.action, payment: result.payment, view };
}

export async function signAndReport({ payment, agent, accountId, isLive = true, signTransfer, reportTx, storage, now = Date.now() }) {
  const eligibility = signEligibility({ payment, agent, accountId, isLive, now });
  if (!eligibility.ok) return { ok: false, stage: 'guard', code: eligibility.code, message: eligibility.message };

  if (loadPendingFor(storage, payment.id)) {
    return { ok: false, stage: 'guard', code: 'ALREADY_SENT', message: 'A transaction for this request was already sent from this browser. Retry the report instead of signing again.' };
  }

  let outcome;
  try {
    outcome = await signTransfer(buildTransfer(payment));
  } catch (error) {
    return { ok: false, stage: 'wallet', ...describeWalletError(error) };
  }

  const txHash = extractTxHash(outcome);
  if (txHash === null) {
    return { ok: false, stage: 'wallet', kind: 'nohash', message: 'The wallet did not return a transaction hash. Check your wallet history before sending again.' };
  }
  const signerId = extractSignerId(outcome) ?? accountId;
  savePending(storage, payment.id, { txHash, signerId });
  return submitReport({ requestId: payment.id, txHash, signerId, reportTx, storage });
}
