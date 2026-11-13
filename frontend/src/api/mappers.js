// Turns backend JSON into the models the UI uses, and checks the shape on the
// way in. If the backend sends something unexpected, the app shows a clear
// "unexpected response" error instead of crashing on undefined fields.
//
// Only the fields the UI needs are copied. Notably NOT copied: idempotencyKey,
// policySnapshot, aiProvider, and audit chain hashes.

import { isYoctoString } from '../lib/money.js';
import { ApiError } from './errors.js';

function shapeError(what) {
  return new ApiError('shape', `Unexpected ${what} in the backend response.`);
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isString = (v) => typeof v === 'string';
const isNullableString = (v) => v === null || v === undefined || typeof v === 'string';

export function expectArray(value, what) {
  if (!Array.isArray(value)) throw shapeError(what);
  return value;
}

export function mapAgent(raw) {
  if (
    !isObject(raw) ||
    !isString(raw.id) ||
    !isString(raw.name) ||
    (raw.status !== 'ACTIVE' && raw.status !== 'PAUSED') ||
    !isString(raw.sourceAccount) ||
    !isYoctoString(raw.dailyBudget) ||
    !isYoctoString(raw.perTxLimit) ||
    !isYoctoString(raw.approvalThreshold) ||
    !isString(raw.createdAt) ||
    !isString(raw.updatedAt)
  ) {
    throw shapeError('agent');
  }
  return {
    id: raw.id,
    name: raw.name,
    status: raw.status,
    sourceAccount: raw.sourceAccount,
    dailyBudget: raw.dailyBudget,
    perTxLimit: raw.perTxLimit,
    approvalThreshold: raw.approvalThreshold,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

export function mapPayment(raw) {
  if (
    !isObject(raw) ||
    !isString(raw.id) ||
    !isString(raw.agentId) ||
    !isString(raw.recipient) ||
    !isYoctoString(raw.amount) ||
    !isString(raw.decision) ||
    !isString(raw.status) ||
    !Array.isArray(raw.reasonCodes) ||
    !raw.reasonCodes.every(isString) ||
    !isString(raw.createdAt) ||
    !isNullableString(raw.decidedAt) ||
    !isNullableString(raw.purpose)
  ) {
    throw shapeError('payment request');
  }
  return {
    id: raw.id,
    agentId: raw.agentId,
    recipient: raw.recipient,
    amount: raw.amount,
    purpose: raw.purpose ?? null,
    decision: raw.decision,
    status: raw.status,
    reasonCodes: [...raw.reasonCodes],
    createdAt: raw.createdAt,
    decidedAt: raw.decidedAt ?? null,
    expiresAt: isString(raw.expiresAt) ? raw.expiresAt : null,
    updatedAt: isString(raw.updatedAt) ? raw.updatedAt : raw.createdAt,
    aiExplanation: isString(raw.aiExplanation) ? raw.aiExplanation : null,
    // Filled in from the approval record when a single payment is opened.
    decisionComment: null,
  };
}

export function mapApproval(raw) {
  if (raw === null || raw === undefined) return null;
  if (!isObject(raw) || !isString(raw.requestId) || !isString(raw.decision) || !isNullableString(raw.comment)) {
    throw shapeError('approval');
  }
  return {
    id: isString(raw.id) ? raw.id : null,
    requestId: raw.requestId,
    decision: raw.decision,
    decidedBy: isString(raw.decidedBy) ? raw.decidedBy : null,
    comment: raw.comment ?? null,
    decidedAt: isString(raw.decidedAt) ? raw.decidedAt : null,
  };
}

export function mapRecipient(raw) {
  if (
    !isObject(raw) ||
    !isString(raw.id) ||
    !isString(raw.agentId) ||
    !isString(raw.accountId) ||
    (raw.listType !== 'ALLOW' && raw.listType !== 'BLOCK') ||
    !isNullableString(raw.note) ||
    !isString(raw.createdAt)
  ) {
    throw shapeError('recipient');
  }
  return {
    id: raw.id,
    agentId: raw.agentId,
    accountId: raw.accountId,
    listType: raw.listType,
    note: raw.note ?? null,
    createdAt: raw.createdAt,
  };
}

export function mapAuditEntry(raw) {
  if (
    !isObject(raw) ||
    !Number.isSafeInteger(raw.seq) ||
    !isString(raw.ts) ||
    !isString(raw.actor) ||
    !isString(raw.event) ||
    !isNullableString(raw.entityId)
  ) {
    throw shapeError('audit entry');
  }
  return {
    seq: raw.seq,
    ts: raw.ts,
    actor: raw.actor,
    event: raw.event,
    entityId: raw.entityId ?? null,
    payload: isObject(raw.payload) ? raw.payload : null,
  };
}

/** Result of GET /api/audit/verify. Hashes are intentionally not copied. */
export function mapVerification(raw) {
  if (!isObject(raw) || typeof raw.valid !== 'boolean' || !Number.isSafeInteger(raw.entries)) {
    throw shapeError('audit verification');
  }
  const problems = Array.isArray(raw.problems) ? raw.problems : [];
  return {
    valid: raw.valid,
    entries: raw.entries,
    truncated: raw.truncated === true,
    problems: problems.slice(0, 20).map((p) => ({
      seq: Number.isSafeInteger(p?.seq) ? p.seq : null,
      code: isString(p?.code) ? p.code : 'UNKNOWN',
      message: isString(p?.message) ? p.message : '',
    })),
  };
}

export function mapKeyIssue(raw) {
  if (!isObject(raw) || !isString(raw.apiKey) || raw.apiKey === '') throw shapeError('API key');
  return { agent: mapAgent(raw.agent), apiKey: raw.apiKey };
}
