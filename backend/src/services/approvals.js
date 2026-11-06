// Human decisions and expiry for payment requests.
//
// approveRequest runs ONE write transaction:
//   pending check -> expiry check -> re-run the policy against current rules
//   and budget -> approval row -> APPROVED (reservation + audit).
// Human approval overrides only the "needs a human" reasons. If the recheck
// says BLOCKED, the request becomes BLOCKED and the approval is refused; no
// approval is recorded.
//
// Every status change goes through transitionRequest, so reservations and
// audit entries always change together with the status.

import { canonicalJson } from '../audit/auditChain.js';
import { withWriteTransaction } from '../db/database.js';
import { STATUS } from '../policy/lifecycle.js';
import { DECISION } from '../policy/reasonCodes.js';
import { ConflictError, ValidationError } from './errors.js';
import { evaluateCurrentPolicy } from './policyContext.js';
import {
  requireRequestRow,
  resolveSettings,
  transitionRequest,
} from './requestState.js';
import {
  assertPlainObject,
  hasControlCharacters,
  newId,
  rejectUnknownFields,
  requireContext,
  toIso,
} from './util.js';

const DEFAULT_SWEEP_LIMIT = 100;
const MAX_SWEEP_LIMIT = 1000;

function parseDecisionInput(input) {
  const source = input === undefined ? {} : input;
  assertPlainObject(source, 'input');
  rejectUnknownFields(source, ['comment']);
  const { comment } = source;
  if (comment === undefined || comment === null) {
    return { comment: null };
  }
  if (typeof comment !== 'string') {
    throw new ValidationError('comment must be a string', 'comment');
  }
  const trimmed = comment.trim();
  if (trimmed.length > 500 || hasControlCharacters(trimmed)) {
    throw new ValidationError('comment must be at most 500 characters without control characters', 'comment');
  }
  return { comment: trimmed === '' ? null : trimmed };
}

function toApprovalView(row) {
  return {
    id: row.id,
    requestId: row.request_id,
    decision: row.decision,
    decidedBy: row.decided_by,
    comment: row.comment ?? null,
    recheckResult: JSON.parse(row.recheck_result),
    decidedAt: row.decided_at,
  };
}

// The recorded human decision for a request, or null.
export function getApprovalForRequest(db, requestId) {
  if (typeof requestId !== 'string') {
    return null;
  }
  const row = db.prepare('SELECT * FROM approvals WHERE request_id = ?').get(requestId);
  return row === undefined ? null : toApprovalView(row);
}

function insertApproval(db, { requestId, decision, decidedBy, comment, recheck, nowIso }) {
  const id = newId();
  db.prepare(
    `INSERT INTO approvals (id, request_id, decision, decided_by, comment, recheck_result, decided_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, requestId, decision, decidedBy, comment, canonicalJson(recheck), nowIso);
  return id;
}

// Approves a pending (APPROVAL_REQUIRED) request.
// Returns { approved, outcome, refusalReasons, request, approval }:
//   outcome APPROVED: approved is true and the budget is reserved
//   outcome BLOCKED:  the recheck failed; refusalReasons says why
//   outcome EXPIRED:  the approval window had already passed
// Throws ConflictError (NOT_PENDING) if the request is not awaiting approval.
export function approveRequest(db, requestId, input, context, settings) {
  const ctx = requireContext(context);
  const { comment } = parseDecisionInput(input);
  const { authorizationWindowMs } = resolveSettings(settings);

  return withWriteTransaction(db, () => {
    const row = requireRequestRow(db, requestId);
    if (row.status !== STATUS.APPROVAL_REQUIRED) {
      throw new ConflictError(
        `request is ${row.status}; only APPROVAL_REQUIRED requests can be approved`,
        'NOT_PENDING',
      );
    }

    if (row.expires_at !== null && row.expires_at <= ctx.nowIso) {
      const expired = transitionRequest(db, row.id, STATUS.EXPIRED, context);
      return { approved: false, outcome: 'EXPIRED', refusalReasons: [], request: expired, approval: null };
    }

    const { result, snapshot } = evaluateCurrentPolicy(
      db,
      row.agent_id,
      { recipient: row.recipient, amount: row.amount },
      ctx.nowMs,
    );

    if (result.decision === DECISION.BLOCKED) {
      const reasons = [...result.reasonCodes];
      const blocked = transitionRequest(db, row.id, STATUS.BLOCKED, context, {
        reasonCodes: reasons,
        markDecided: true,
        expiresAt: null,
        event: 'APPROVAL_REFUSED',
        payload: { reasonCodes: reasons },
      });
      return { approved: false, outcome: 'BLOCKED', refusalReasons: reasons, request: blocked, approval: null };
    }

    const approvalId = insertApproval(db, {
      requestId: row.id,
      decision: 'APPROVE',
      decidedBy: ctx.actor,
      comment,
      recheck: {
        decision: result.decision,
        reasonCodes: [...result.reasonCodes],
        reservedToday: snapshot.reservedToday,
        remainingBudget: snapshot.remainingBudget,
        budgetDay: snapshot.budgetDay,
      },
      nowIso: ctx.nowIso,
    });
    const approved = transitionRequest(db, row.id, STATUS.APPROVED, context, {
      markDecided: true,
      expiresAt: toIso(ctx.nowMs + authorizationWindowMs),
      payload: { approvalId, recheckDecision: result.decision },
    });
    return {
      approved: true,
      outcome: 'APPROVED',
      refusalReasons: [],
      request: approved,
      approval: getApprovalForRequest(db, row.id),
    };
  });
}

// Rejects a pending request. Always allowed while the request is still
// APPROVAL_REQUIRED, even past its expiry time (rejecting is safe).
// Returns { request, approval }.
export function rejectRequest(db, requestId, input, context) {
  const ctx = requireContext(context);
  const { comment } = parseDecisionInput(input);

  return withWriteTransaction(db, () => {
    const row = requireRequestRow(db, requestId);
    if (row.status !== STATUS.APPROVAL_REQUIRED) {
      throw new ConflictError(
        `request is ${row.status}; only APPROVAL_REQUIRED requests can be rejected`,
        'NOT_PENDING',
      );
    }
    const approvalId = insertApproval(db, {
      requestId: row.id,
      decision: 'REJECT',
      decidedBy: ctx.actor,
      comment,
      recheck: {},
      nowIso: ctx.nowIso,
    });
    const rejected = transitionRequest(db, row.id, STATUS.REJECTED, context, {
      markDecided: true,
      expiresAt: null,
      payload: { approvalId },
    });
    return { request: rejected, approval: getApprovalForRequest(db, row.id) };
  });
}

// Cancels an APPROVED (not yet submitted) request and releases its budget.
// Any other status throws ConflictError (ILLEGAL_TRANSITION).
export function cancelRequest(db, requestId, context) {
  requireContext(context);
  return withWriteTransaction(db, () =>
    transitionRequest(db, requestId, STATUS.CANCELLED, context),
  );
}

// Expires pending approvals and stale authorizations whose expires_at has
// passed (expires_at <= now), releasing reserved budget. SUBMITTED and later
// states are never expired here. Processes at most `limit` requests per call;
// `more` tells the caller to call again.
// Returns { expired, requestIds, more }.
export function expireDueRequests(db, context, options = {}) {
  const ctx = requireContext(context);
  assertPlainObject(options, 'options');
  rejectUnknownFields(options, ['limit']);
  const limit = options.limit ?? DEFAULT_SWEEP_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_SWEEP_LIMIT) {
    throw new ValidationError(`limit must be an integer from 1 to ${MAX_SWEEP_LIMIT}`, 'limit');
  }

  return withWriteTransaction(db, () => {
    const due = db
      .prepare(
        `SELECT id FROM payment_requests
         WHERE status IN ('APPROVAL_REQUIRED', 'APPROVED')
           AND expires_at IS NOT NULL AND expires_at <= ?
         ORDER BY expires_at ASC, id ASC
         LIMIT ?`,
      )
      .all(ctx.nowIso, limit + 1);
    const batch = due.slice(0, limit);
    for (const { id } of batch) {
      transitionRequest(db, id, STATUS.EXPIRED, context);
    }
    return {
      expired: batch.length,
      requestIds: batch.map((row) => row.id),
      more: due.length > limit,
    };
  });
}
