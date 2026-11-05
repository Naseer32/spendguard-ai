// Agent management.
//
// API keys look like  sgk_<agentId>_<64 hex chars>.
// - The full key is returned ONLY by createAgent and rotateApiKey, once.
// - Only SHA-256(key) is stored. The key and the hash never appear in logs,
//   audit payloads or agent views.
// - Verification compares hashes with timingSafeEqual and does a dummy
//   comparison for unknown agents, so timing does not reveal whether an
//   agent exists.
// - Rotation replaces the hash in the same transaction as its audit entry,
//   so the old key stops working immediately.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { appendAudit } from '../audit/auditChain.js';
import { withWriteTransaction } from '../db/database.js';
import { compareYocto, isYoctoString } from '../money/yocto.js';
import { isValidNearAccountId } from '../policy/engine.js';
import { AGENT_STATUS } from '../policy/reasonCodes.js';
import { NotFoundError, ValidationError } from './errors.js';
import {
  assertPlainObject,
  hasControlCharacters,
  newId,
  rejectUnknownFields,
  requireContext,
} from './util.js';

const KEY_RE =
  /^sgk_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})_([0-9a-f]{64})$/;
const MAX_KEY_LENGTH = 200;
const CREATE_FIELDS = ['name', 'sourceAccount', 'dailyBudget', 'perTxLimit', 'approvalThreshold'];
const LIMIT_FIELDS = ['dailyBudget', 'perTxLimit', 'approvalThreshold'];

function hashKey(apiKey) {
  return createHash('sha256').update(apiKey).digest('hex');
}

const DUMMY_HASH = hashKey('sgk_dummy_hash_for_unknown_agents');

function hashesEqual(aHex, bHex) {
  const a = Buffer.from(aHex, 'hex');
  const b = Buffer.from(bHex, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

function generateKey(agentId) {
  return `sgk_${agentId}_${randomBytes(32).toString('hex')}`;
}

// The only shape in which an agent leaves this module. It never includes the
// API key or its hash.
function toView(row) {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    sourceAccount: row.source_account,
    dailyBudget: row.daily_budget,
    perTxLimit: row.per_tx_limit,
    approvalThreshold: row.approval_threshold,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function readRow(db, agentId) {
  if (typeof agentId !== 'string') {
    return undefined;
  }
  return db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId);
}

function requireRow(db, agentId) {
  const row = readRow(db, agentId);
  if (row === undefined) {
    throw new NotFoundError('agent not found');
  }
  return row;
}

function validateName(value) {
  if (typeof value !== 'string') {
    throw new ValidationError('name must be a string', 'name');
  }
  const name = value.trim();
  if (name.length < 1 || name.length > 100 || hasControlCharacters(name)) {
    throw new ValidationError('name must be 1 to 100 characters without control characters', 'name');
  }
  return name;
}

// Rules: approvalThreshold <= perTxLimit <= dailyBudget (all yoctoNEAR strings).
function validateLimits(limits) {
  for (const field of LIMIT_FIELDS) {
    if (!isYoctoString(limits[field])) {
      throw new ValidationError(`${field} must be a yoctoNEAR amount string`, field);
    }
  }
  if (compareYocto(limits.approvalThreshold, limits.perTxLimit) > 0) {
    throw new ValidationError('approvalThreshold must not exceed perTxLimit', 'approvalThreshold');
  }
  if (compareYocto(limits.perTxLimit, limits.dailyBudget) > 0) {
    throw new ValidationError('perTxLimit must not exceed dailyBudget', 'perTxLimit');
  }
  return {
    dailyBudget: limits.dailyBudget,
    perTxLimit: limits.perTxLimit,
    approvalThreshold: limits.approvalThreshold,
  };
}

// Returns { agent, apiKey }. apiKey is shown to the caller exactly once.
export function createAgent(db, input, context) {
  const { nowIso, actor } = requireContext(context);
  assertPlainObject(input, 'input');
  rejectUnknownFields(input, CREATE_FIELDS);
  const name = validateName(input.name);
  if (!isValidNearAccountId(input.sourceAccount)) {
    throw new ValidationError('sourceAccount must be a valid NEAR account id', 'sourceAccount');
  }
  const limits = validateLimits(input);

  const id = newId();
  const apiKey = generateKey(id);
  const apiKeyHash = hashKey(apiKey);

  return withWriteTransaction(db, () => {
    db.prepare(
      `INSERT INTO agents (id, name, status, api_key_hash, source_account,
         daily_budget, per_tx_limit, approval_threshold, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id, name, AGENT_STATUS.ACTIVE, apiKeyHash, input.sourceAccount,
      limits.dailyBudget, limits.perTxLimit, limits.approvalThreshold, nowIso, nowIso,
    );
    appendAudit(db, {
      ts: nowIso,
      actor,
      event: 'AGENT_CREATED',
      entityId: id,
      payload: { name, sourceAccount: input.sourceAccount, ...limits },
    });
    return { agent: toView(readRow(db, id)), apiKey };
  });
}

export function getAgent(db, agentId) {
  return toView(requireRow(db, agentId));
}

export function listAgents(db) {
  return db
    .prepare('SELECT * FROM agents ORDER BY created_at ASC, id ASC')
    .all()
    .map(toView);
}

// Returns the agent view when the key is valid, otherwise null.
// A paused agent still authenticates; the policy engine blocks its payments.
export function authenticateAgent(db, apiKey) {
  if (typeof apiKey !== 'string' || apiKey.length > MAX_KEY_LENGTH) {
    return null;
  }
  const match = KEY_RE.exec(apiKey);
  if (match === null) {
    return null;
  }
  const row = readRow(db, match[1]);
  const presented = hashKey(apiKey);
  const stored = row === undefined ? DUMMY_HASH : row.api_key_hash;
  const equal = hashesEqual(presented, stored);
  return row !== undefined && equal ? toView(row) : null;
}

// Changes any subset of the three limits. The final combination must satisfy
// approvalThreshold <= perTxLimit <= dailyBudget.
export function updateLimits(db, agentId, changes, context) {
  const { nowIso, actor } = requireContext(context);
  assertPlainObject(changes, 'changes');
  rejectUnknownFields(changes, LIMIT_FIELDS);
  if (Object.keys(changes).length === 0) {
    throw new ValidationError('no limits provided', 'changes');
  }

  return withWriteTransaction(db, () => {
    const row = requireRow(db, agentId);
    const before = {
      dailyBudget: row.daily_budget,
      perTxLimit: row.per_tx_limit,
      approvalThreshold: row.approval_threshold,
    };
    const merged = { ...before };
    for (const field of LIMIT_FIELDS) {
      if (Object.hasOwn(changes, field)) {
        merged[field] = changes[field];
      }
    }
    const after = validateLimits(merged);

    db.prepare(
      `UPDATE agents SET daily_budget = ?, per_tx_limit = ?, approval_threshold = ?,
         updated_at = ? WHERE id = ?`,
    ).run(after.dailyBudget, after.perTxLimit, after.approvalThreshold, nowIso, row.id);
    appendAudit(db, {
      ts: nowIso,
      actor,
      event: 'AGENT_LIMITS_UPDATED',
      entityId: row.id,
      payload: { before, after },
    });
    return toView(readRow(db, row.id));
  });
}

function setStatus(db, agentId, status, event, context) {
  const { nowIso, actor } = requireContext(context);
  return withWriteTransaction(db, () => {
    const row = requireRow(db, agentId);
    if (row.status === status) {
      return toView(row); // already in that state: nothing to change or audit
    }
    db.prepare('UPDATE agents SET status = ?, updated_at = ? WHERE id = ?').run(
      status, nowIso, row.id,
    );
    appendAudit(db, {
      ts: nowIso,
      actor,
      event,
      entityId: row.id,
      payload: { from: row.status, to: status },
    });
    return toView(readRow(db, row.id));
  });
}

export function pauseAgent(db, agentId, context) {
  return setStatus(db, agentId, AGENT_STATUS.PAUSED, 'AGENT_PAUSED', context);
}

export function resumeAgent(db, agentId, context) {
  return setStatus(db, agentId, AGENT_STATUS.ACTIVE, 'AGENT_RESUMED', context);
}

// Issues a new key and invalidates the old one immediately.
// Returns { agent, apiKey }. apiKey is shown to the caller exactly once.
export function rotateApiKey(db, agentId, context) {
  const { nowIso, actor } = requireContext(context);
  const apiKey = generateKey(String(agentId));
  const apiKeyHash = hashKey(apiKey);

  return withWriteTransaction(db, () => {
    const row = requireRow(db, agentId);
    db.prepare('UPDATE agents SET api_key_hash = ?, updated_at = ? WHERE id = ?').run(
      apiKeyHash, nowIso, row.id,
    );
    appendAudit(db, {
      ts: nowIso,
      actor,
      event: 'AGENT_KEY_ROTATED',
      entityId: row.id,
      payload: {},
    });
    return { agent: toView(readRow(db, row.id)), apiKey };
  });
}
