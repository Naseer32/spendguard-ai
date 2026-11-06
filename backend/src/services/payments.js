// Payment evaluation for agents, plus read access to payment requests.
//
// evaluatePaymentRequest runs in ONE write transaction (BEGIN IMMEDIATE):
//   idempotency check -> load agent, lists and today's reserved budget ->
//   deterministic policy engine -> insert request (+ reservation) -> audit.
// Two requests can never both see the same remaining budget, and a failed
// audit append rolls everything back.
//
// Input rules: values the database cannot hold (a non-canonical amount, a
// malformed idempotency key, an empty or oversized recipient) are rejected as
// ValidationError and not stored. Everything the policy can judge (zero
// amounts, invalid account ids, blocked recipients, limits) is stored and
// audited as a decision, including BLOCKED.

import { createHash } from 'node:crypto';
import { canonicalJson } from '../audit/auditChain.js';
import { withWriteTransaction } from '../db/database.js';
import { isYoctoString } from '../money/yocto.js';
import { utcBudgetDay } from '../policy/budget.js';
import { evaluatePayment } from '../policy/engine.js';
import { STATUS } from '../policy/lifecycle.js';
import { getAgent } from './agents.js';
import { IdempotencyConflictError, NotFoundError, ValidationError } from './errors.js';
import { getRecipientLists } from './recipients.js';
import { openRequest, requireRequestRow, toRequestView } from './requestState.js';
import { reservedForDay } from './reservations.js';
import {
  assertPlainObject,
  hasControlCharacters,
  rejectUnknownFields,
  requireContext,
} from './util.js';

const INPUT_FIELDS = ['idempotencyKey', 'recipient', 'amount', 'purpose'];
const KEY_RE = /^[A-Za-z0-9._:-]{8,128}$/;
const HASH_DOMAIN = 'spendguard-request-v1\n';
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function validateInput(input) {
  assertPlainObject(input, 'input');
  rejectUnknownFields(input, INPUT_FIELDS);

  if (typeof input.idempotencyKey !== 'string' || !KEY_RE.test(input.idempotencyKey)) {
    throw new ValidationError(
      'idempotencyKey must be 8 to 128 characters: letters, digits, . _ : -',
      'idempotencyKey',
    );
  }
  const { recipient } = input;
  if (
    typeof recipient !== 'string' ||
    recipient.length < 1 ||
    recipient.length > 128 ||
    hasControlCharacters(recipient)
  ) {
    throw new ValidationError('recipient must be 1 to 128 characters without control characters', 'recipient');
  }
  if (!isYoctoString(input.amount)) {
    throw new ValidationError('amount must be a yoctoNEAR amount string', 'amount');
  }

  let purpose = null;
  if (input.purpose !== undefined && input.purpose !== null) {
    if (typeof input.purpose !== 'string') {
      throw new ValidationError('purpose must be a string', 'purpose');
    }
    const trimmed = input.purpose.trim();
    if (trimmed.length > 500 || hasControlCharacters(trimmed)) {
      throw new ValidationError('purpose must be at most 500 characters without control characters', 'purpose');
    }
    purpose = trimmed === '' ? null : trimmed;
  }

  return {
    idempotencyKey: input.idempotencyKey,
    recipient,
    amount: input.amount,
    purpose,
  };
}

function hashRequest({ recipient, amount, purpose }) {
  return createHash('sha256')
    .update(HASH_DOMAIN + canonicalJson({ amount, purpose, recipient }))
    .digest('hex');
}

// Evaluates a payment request for an agent (the agent is identified by the
// caller, for example from its API key). Returns { request, replayed }.
// replayed is true when the idempotency key was already used with the same
// request; the original request is returned unchanged.
export function evaluatePaymentRequest(db, agentId, input, context, settings) {
  const { nowMs } = requireContext(context);
  const request = validateInput(input);
  const requestHash = hashRequest(request);

  return withWriteTransaction(db, () => {
    const agent = getAgent(db, agentId);

    const existing = db
      .prepare('SELECT * FROM payment_requests WHERE agent_id = ? AND idempotency_key = ?')
      .get(agent.id, request.idempotencyKey);
    if (existing !== undefined) {
      if (existing.request_hash !== requestHash) {
        throw new IdempotencyConflictError(
          'this idempotency key was already used with a different request',
        );
      }
      return { request: toRequestView(existing), replayed: true };
    }

    const lists = getRecipientLists(db, agent.id, request.recipient);
    const budgetDay = utcBudgetDay(nowMs);
    const reservedToday = reservedForDay(db, agent.id, budgetDay);
    const agentPolicy = {
      status: agent.status,
      dailyBudget: agent.dailyBudget,
      perTxLimit: agent.perTxLimit,
      approvalThreshold: agent.approvalThreshold,
    };

    const result = evaluatePayment({
      agent: agentPolicy,
      recipientLists: lists,
      reservedToday,
      request: { recipient: request.recipient, amount: request.amount },
    });

    const policySnapshot = {
      agent: agentPolicy,
      recipientLists: { onAllowlist: lists.onAllowlist, onBlocklist: lists.onBlocklist },
      reservedToday,
      budgetDay,
      remainingBudget: result.remainingBudget,
    };

    const opened = openRequest(
      db,
      {
        agentId: agent.id,
        recipient: request.recipient,
        amount: request.amount,
        purpose: request.purpose,
        idempotencyKey: request.idempotencyKey,
        requestHash,
        decision: result.decision,
        reasonCodes: result.reasonCodes,
        policySnapshot,
      },
      context,
      settings,
    );
    return { request: opened, replayed: false };
  });
}

export function getPaymentRequest(db, requestId) {
  return toRequestView(requireRequestRow(db, requestId));
}

// Agent-facing read: another agent's request looks like it does not exist.
export function getAgentPaymentRequest(db, agentId, requestId) {
  const row = requireRequestRow(db, requestId);
  if (typeof agentId !== 'string' || row.agent_id !== agentId) {
    throw new NotFoundError('payment request not found');
  }
  return toRequestView(row);
}

// Owner-facing list, newest first. Filters: { agentId?, status?, limit? }.
export function listPaymentRequests(db, filters = {}) {
  assertPlainObject(filters, 'filters');
  rejectUnknownFields(filters, ['agentId', 'status', 'limit']);
  const { agentId, status } = filters;
  const limit = filters.limit ?? DEFAULT_LIMIT;

  if (agentId !== undefined && typeof agentId !== 'string') {
    throw new ValidationError('agentId must be a string', 'agentId');
  }
  if (status !== undefined && !Object.values(STATUS).includes(status)) {
    throw new ValidationError('status is not a known payment status', 'status');
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new ValidationError(`limit must be an integer from 1 to ${MAX_LIMIT}`, 'limit');
  }

  const where = [];
  const params = [];
  if (agentId !== undefined) {
    where.push('agent_id = ?');
    params.push(agentId);
  }
  if (status !== undefined) {
    where.push('status = ?');
    params.push(status);
  }
  const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const rows = db
    .prepare(`SELECT * FROM payment_requests ${clause} ORDER BY created_at DESC, id DESC LIMIT ?`)
    .all(...params, limit);
  return rows.map(toRequestView);
}
