// Read-only access to the audit log for the owner endpoints.
// Listing is cursor-based (afterSeq) so pages stay stable as entries are added.

import { getAuditHead, verifyChain } from '../audit/auditChain.js';
import { ValidationError } from './errors.js';
import { assertPlainObject, rejectUnknownFields } from './util.js';

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

function toEntryView(row) {
  let payload;
  try {
    payload = JSON.parse(row.payload);
  } catch {
    payload = null; // a damaged row must not break listing; verification reports it
  }
  return {
    seq: row.seq,
    ts: row.ts,
    actor: row.actor,
    event: row.event,
    entityId: row.entity_id ?? null,
    payload,
    prevHash: row.prev_hash,
    hash: row.hash,
  };
}

// The current end of the chain: { seq, hash }.
export function getAuditHeadView(db) {
  const head = getAuditHead(db);
  return { seq: head.seq, hash: head.hash };
}

// Filters: { afterSeq = 0, limit = 100, event?, entityId? }.
// Returns { entries, hasMore, nextAfterSeq, head }. To get the next page, pass
// nextAfterSeq as afterSeq.
export function listAuditEntries(db, filters = {}) {
  assertPlainObject(filters, 'filters');
  rejectUnknownFields(filters, ['afterSeq', 'limit', 'event', 'entityId']);
  const afterSeq = filters.afterSeq ?? 0;
  const limit = filters.limit ?? DEFAULT_LIMIT;
  const { event, entityId } = filters;

  if (!Number.isSafeInteger(afterSeq) || afterSeq < 0) {
    throw new ValidationError('afterSeq must be a non-negative integer', 'afterSeq');
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new ValidationError(`limit must be an integer from 1 to ${MAX_LIMIT}`, 'limit');
  }
  if (event !== undefined && (typeof event !== 'string' || event.length < 1 || event.length > 64)) {
    throw new ValidationError('event must be a string of 1 to 64 characters', 'event');
  }
  if (entityId !== undefined && (typeof entityId !== 'string' || entityId.length < 1 || entityId.length > 128)) {
    throw new ValidationError('entityId must be a string of 1 to 128 characters', 'entityId');
  }

  const where = ['seq > ?'];
  const params = [afterSeq];
  if (event !== undefined) {
    where.push('event = ?');
    params.push(event);
  }
  if (entityId !== undefined) {
    where.push('entity_id = ?');
    params.push(entityId);
  }

  const rows = db
    .prepare(
      `SELECT seq, ts, actor, event, entity_id, payload, prev_hash, hash
       FROM audit_log WHERE ${where.join(' AND ')} ORDER BY seq ASC LIMIT ?`,
    )
    .all(...params, limit + 1);
  const page = rows.slice(0, limit);

  return {
    entries: page.map(toEntryView),
    hasMore: rows.length > limit,
    nextAfterSeq: page.length > 0 ? page[page.length - 1].seq : afterSeq,
    head: getAuditHeadView(db),
  };
}

// Verifies the whole chain. options: { expectedHead?: { seq, hash } } where the
// head was stored outside the database (detects truncation and rebuilds).
// Returns { valid, entries, headSeq, headHash, problems, truncated }.
export function verifyAuditLog(db, options = {}) {
  assertPlainObject(options, 'options');
  rejectUnknownFields(options, ['expectedHead']);
  try {
    return verifyChain(db, options);
  } catch (error) {
    if (error instanceof TypeError) {
      throw new ValidationError('expectedHead must be { seq, hash } with a 64-character hex hash', 'expectedHead');
    }
    throw error;
  }
}
