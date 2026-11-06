// The only place that creates payment requests or changes their status.
//
// openRequest and transitionRequest each, inside the caller's write
// transaction:
//   1. validate the move against the lifecycle table (policy/lifecycle.js)
//   2. apply the reservation effect from that table
//   3. update the request
//   4. append the audit entry
// If any step fails, the whole transaction rolls back (a failed audit append
// also marks the transaction as failed, so it cannot commit).

import { appendAudit, canonicalJson } from '../audit/auditChain.js';
import { utcBudgetDay } from '../policy/budget.js';
import {
  LifecycleError,
  RESERVATION_EFFECT as E,
  STATUS,
  initialState,
  transition,
} from '../policy/lifecycle.js';
import { ConflictError, NotFoundError } from './errors.js';
import {
  RESERVATION_STATUS,
  assertWriteTransaction,
  consumeReservation,
  createReservation,
  getReservation,
  releaseReservation,
} from './reservations.js';
import { newId, requireContext, toIso } from './util.js';

export const DEFAULT_SETTINGS = Object.freeze({
  approvalWindowMs: 86_400_000, // pending human approval expires after 24 hours
  authorizationWindowMs: 3_600_000, // an APPROVED payment expires after 60 minutes
});

const MIN_WINDOW_MS = 1000;
const MAX_WINDOW_MS = 2_592_000_000; // 30 days

export function resolveSettings(settings) {
  if (settings === undefined) {
    return DEFAULT_SETTINGS;
  }
  if (settings === null || typeof settings !== 'object' || Array.isArray(settings)) {
    throw new TypeError('settings must be an object');
  }
  for (const key of Object.keys(settings)) {
    if (!Object.hasOwn(DEFAULT_SETTINGS, key)) {
      throw new TypeError(`unknown setting ${key}`);
    }
  }
  const resolved = {};
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    const value = settings[key] ?? DEFAULT_SETTINGS[key];
    if (!Number.isInteger(value) || value < MIN_WINDOW_MS || value > MAX_WINDOW_MS) {
      throw new TypeError(`${key} must be an integer from ${MIN_WINDOW_MS} to ${MAX_WINDOW_MS}`);
    }
    resolved[key] = value;
  }
  return Object.freeze(resolved);
}

// The only shape in which a request leaves the services.
export function toRequestView(row) {
  return {
    id: row.id,
    agentId: row.agent_id,
    recipient: row.recipient,
    amount: row.amount,
    purpose: row.purpose ?? null,
    idempotencyKey: row.idempotency_key,
    decision: row.decision,
    status: row.status,
    reasonCodes: JSON.parse(row.reason_codes),
    policySnapshot: JSON.parse(row.policy_snapshot),
    aiExplanation: row.ai_explanation ?? null,
    aiProvider: row.ai_provider ?? null,
    createdAt: row.created_at,
    decidedAt: row.decided_at ?? null,
    expiresAt: row.expires_at ?? null,
    updatedAt: row.updated_at,
  };
}

export function getRequestRow(db, requestId) {
  if (typeof requestId !== 'string') {
    return undefined;
  }
  return db.prepare('SELECT * FROM payment_requests WHERE id = ?').get(requestId);
}

export function requireRequestRow(db, requestId) {
  const row = getRequestRow(db, requestId);
  if (row === undefined) {
    throw new NotFoundError('payment request not found');
  }
  return row;
}

// Creates a request in the state given by the policy decision, with its
// reservation (if APPROVED) and one audit entry.
// data: { agentId, recipient, amount, purpose, idempotencyKey, requestHash,
//         decision, reasonCodes, policySnapshot }
export function openRequest(db, data, context, settings) {
  assertWriteTransaction(db);
  const { nowMs, nowIso, actor } = requireContext(context);
  const { approvalWindowMs, authorizationWindowMs } = resolveSettings(settings);
  const { status, reservation } = initialState(data.decision);
  const id = newId();

  let expiresAt = null;
  if (status === STATUS.APPROVAL_REQUIRED) {
    expiresAt = toIso(nowMs + approvalWindowMs);
  } else if (status === STATUS.APPROVED) {
    expiresAt = toIso(nowMs + authorizationWindowMs);
  }
  // Blocked and approved requests are decided immediately; a human decides
  // APPROVAL_REQUIRED ones later.
  const decidedAt = status === STATUS.APPROVAL_REQUIRED ? null : nowIso;

  db.prepare(
    `INSERT INTO payment_requests
       (id, agent_id, recipient, amount, purpose, idempotency_key, request_hash,
        decision, status, reason_codes, policy_snapshot, ai_explanation, ai_provider,
        created_at, decided_at, expires_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?)`,
  ).run(
    id,
    data.agentId,
    data.recipient,
    data.amount,
    data.purpose,
    data.idempotencyKey,
    data.requestHash,
    data.decision,
    status,
    canonicalJson([...data.reasonCodes]),
    canonicalJson(data.policySnapshot),
    nowIso,
    decidedAt,
    expiresAt,
    nowIso,
  );

  const payload = {
    agentId: data.agentId,
    recipient: data.recipient,
    amount: data.amount,
    decision: data.decision,
    reasonCodes: [...data.reasonCodes],
    status,
    reservation,
  };
  if (reservation === E.CREATE) {
    const budgetDay = utcBudgetDay(nowMs);
    createReservation(
      db,
      { requestId: id, agentId: data.agentId, amount: data.amount, budgetDay },
      nowIso,
    );
    payload.budgetDay = budgetDay;
  }

  appendAudit(db, {
    ts: nowIso,
    actor,
    event: 'PAYMENT_EVALUATED',
    entityId: id,
    payload,
  });

  return toRequestView(requireRequestRow(db, id));
}

const OPTION_KEYS = ['expiresAt', 'reasonCodes', 'markDecided', 'event', 'payload', 'releaseReason'];
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const REASON_RE = /^[A-Z][A-Z_]{0,63}$/;

function checkOptions(options) {
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('options must be an object');
  }
  for (const key of Object.keys(options)) {
    if (!OPTION_KEYS.includes(key)) {
      throw new TypeError(`unknown option ${key}`);
    }
  }
  const { expiresAt, reasonCodes, markDecided, event, payload, releaseReason } = options;
  if (
    expiresAt !== undefined &&
    expiresAt !== null &&
    !(typeof expiresAt === 'string' && ISO_RE.test(expiresAt))
  ) {
    throw new TypeError('expiresAt must be an ISO UTC timestamp or null');
  }
  if (
    reasonCodes !== undefined &&
    (!Array.isArray(reasonCodes) ||
      reasonCodes.length < 1 ||
      reasonCodes.length > 20 ||
      !reasonCodes.every((code) => typeof code === 'string' && REASON_RE.test(code)))
  ) {
    throw new TypeError('reasonCodes must be 1 to 20 reason code strings');
  }
  if (markDecided !== undefined && typeof markDecided !== 'boolean') {
    throw new TypeError('markDecided must be a boolean');
  }
  if (event !== undefined && (typeof event !== 'string' || event.length < 1 || event.length > 64)) {
    throw new TypeError('event must be a string of 1 to 64 characters');
  }
  if (payload !== undefined && (payload === null || typeof payload !== 'object' || Array.isArray(payload))) {
    throw new TypeError('payload must be an object');
  }
  if (
    releaseReason !== undefined &&
    (typeof releaseReason !== 'string' || releaseReason.length < 1 || releaseReason.length > 100)
  ) {
    throw new TypeError('releaseReason must be a string of 1 to 100 characters');
  }
}

// Moves a request to a new status. Returns the updated request view.
// options (all optional):
//   expiresAt:     ISO timestamp or null; replaces expires_at
//   reasonCodes:   array of reason codes; replaces the stored reasons
//   markDecided:   true to set decided_at to now
//   event:         audit event name (default PAYMENT_<STATUS>)
//   payload:       extra audit fields (they cannot override the core fields)
//   releaseReason: reason stored when the reservation is released (default: the new status)
export function transitionRequest(db, requestId, to, context, options = {}) {
  assertWriteTransaction(db);
  const { nowMs, nowIso, actor } = requireContext(context);
  checkOptions(options);
  const row = requireRequestRow(db, requestId);

  let step;
  try {
    step = transition(row.status, to);
  } catch (error) {
    if (error instanceof LifecycleError) {
      throw new ConflictError(error.message, 'ILLEGAL_TRANSITION');
    }
    throw error;
  }

  const existing = getReservation(db, row.id);
  let budgetDay = null;
  let releaseReason = null;

  switch (step.reservation) {
    case E.CREATE:
      if (existing !== undefined) {
        throw new ConflictError('a reservation already exists for this request', 'RESERVATION_STATE');
      }
      budgetDay = utcBudgetDay(nowMs);
      createReservation(
        db,
        { requestId: row.id, agentId: row.agent_id, amount: row.amount, budgetDay },
        nowIso,
      );
      break;
    case E.HOLD:
      if (existing === undefined || existing.status !== RESERVATION_STATUS.ACTIVE) {
        throw new ConflictError('the reservation is not active', 'RESERVATION_STATE');
      }
      break;
    case E.CONSUME:
      consumeReservation(db, row.id, nowIso);
      break;
    case E.RELEASE:
      releaseReason = options.releaseReason ?? to;
      releaseReservation(db, row.id, releaseReason, nowIso);
      break;
    case E.NONE:
      if (existing !== undefined) {
        throw new ConflictError('unexpected reservation for this request', 'RESERVATION_STATE');
      }
      break;
    default:
      throw new ConflictError('unknown reservation effect', 'RESERVATION_STATE');
  }

  const sets = ['status = ?', 'updated_at = ?'];
  const params = [to, nowIso];
  if (options.markDecided === true) {
    sets.push('decided_at = ?');
    params.push(nowIso);
  }
  if (options.expiresAt !== undefined) {
    sets.push('expires_at = ?');
    params.push(options.expiresAt);
  }
  if (options.reasonCodes !== undefined) {
    sets.push('reason_codes = ?');
    params.push(canonicalJson([...options.reasonCodes]));
  }
  params.push(row.id);
  db.prepare(`UPDATE payment_requests SET ${sets.join(', ')} WHERE id = ?`).run(...params);

  const payload = {
    ...(options.payload ?? {}),
    agentId: row.agent_id,
    amount: row.amount,
    from: row.status,
    to,
    reservation: step.reservation,
  };
  if (budgetDay !== null) {
    payload.budgetDay = budgetDay;
  }
  if (releaseReason !== null) {
    payload.releaseReason = releaseReason;
  }
  appendAudit(db, {
    ts: nowIso,
    actor,
    event: options.event ?? `PAYMENT_${to}`,
    entityId: row.id,
    payload,
  });

  return toRequestView(requireRequestRow(db, row.id));
}
