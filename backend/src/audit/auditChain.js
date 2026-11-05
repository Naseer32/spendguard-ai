// Hash-chained audit log: tamper-evident, not immutable.
//
// Entry hash = SHA-256( "spendguard-audit-v1\n" +
//   JSON.stringify([seq, ts, actor, event, entity_id, payload_text, prev_hash]) )
// The first entry's prev_hash is GENESIS_HASH. payload_text is canonical JSON
// (sorted keys). The row is append-only in SQL (triggers from the schema), and
// verifyChain detects deleted, modified, inserted and reordered entries.
//
// LIMITS (by design, not bugs)
// - Removing entries from the END of the log, or someone with full write
//   access rebuilding every hash, cannot be detected from the log alone.
//   Store the head ({ seq, hash }) somewhere else and pass it to verifyChain
//   as expectedHead to detect both.
//
// ATOMICITY
// appendAudit must run inside withWriteTransaction, in the same transaction
// as the business change it records. If an append fails for any reason, the
// transaction is marked failed, so the business change cannot commit even if
// the caller swallows the error.

import { createHash } from 'node:crypto';
import { failTransaction, isInWriteTransaction } from '../db/database.js';

export const GENESIS_HASH = '0'.repeat(64);
export const MAX_PAYLOAD_BYTES = 16384;

const MAX_DEPTH = 16;
const MAX_PROBLEMS = 50;
const HASH_DOMAIN = 'spendguard-audit-v1\n';
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const HEX64_RE = /^[0-9a-f]{64}$/;

export class AuditError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AuditError';
  }
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function canon(value, depth) {
  if (depth > MAX_DEPTH) {
    throw new AuditError('payload is nested too deeply');
  }
  if (value === null) {
    return 'null';
  }
  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isSafeInteger(value)) {
        throw new AuditError(
          'payload numbers must be safe integers; store amounts as strings',
        );
      }
      return String(value);
    case 'object': {
      if (Array.isArray(value)) {
        // Array.from visits holes as undefined, which is rejected below.
        return `[${Array.from(value, (item) => canon(item, depth + 1)).join(',')}]`;
      }
      if (!isPlainObject(value)) {
        throw new AuditError('payload may contain only plain objects and arrays');
      }
      const keys = Object.keys(value).sort();
      const parts = keys.map(
        (key) => `${JSON.stringify(key)}:${canon(value[key], depth + 1)}`,
      );
      return `{${parts.join(',')}}`;
    }
    default:
      throw new AuditError(`payload contains an unsupported ${typeof value} value`);
  }
}

// Deterministic JSON text: sorted keys, no whitespace, strict value types.
export function canonicalJson(value) {
  return canon(value, 0);
}

export function computeEntryHash({ seq, ts, actor, event, entityId, payloadText, prevHash }) {
  return createHash('sha256')
    .update(
      HASH_DOMAIN +
        JSON.stringify([seq, ts, actor, event, entityId ?? null, payloadText, prevHash]),
    )
    .digest('hex');
}

function requireString(value, name, min, max) {
  if (typeof value !== 'string' || value.length < min || value.length > max) {
    throw new AuditError(`${name} must be a string of ${min} to ${max} characters`);
  }
}

// Current end of the chain: { seq, hash }. An empty log is { 0, GENESIS_HASH }.
export function getAuditHead(db) {
  const tail = db
    .prepare('SELECT seq, hash FROM audit_log ORDER BY seq DESC LIMIT 1')
    .get();
  if (tail === undefined) {
    return Object.freeze({ seq: 0, hash: GENESIS_HASH });
  }
  return Object.freeze({ seq: tail.seq, hash: tail.hash });
}

// Appends one entry. Returns { seq, hash }.
// Input: { ts, actor, event, entityId?, payload? }
export function appendAudit(db, input) {
  if (!isInWriteTransaction(db)) {
    throw new AuditError('audit entries must be appended inside a write transaction');
  }
  try {
    const source = input ?? {};
    const { ts, actor, event } = source;
    const entityId = source.entityId ?? null;
    const payload = source.payload === undefined ? {} : source.payload;

    if (typeof ts !== 'string' || !ISO_RE.test(ts)) {
      throw new AuditError('ts must be an ISO UTC timestamp with milliseconds');
    }
    requireString(actor, 'actor', 1, 128);
    requireString(event, 'event', 1, 64);
    if (entityId !== null) {
      requireString(entityId, 'entityId', 1, 128);
    }
    if (!isPlainObject(payload)) {
      throw new AuditError('payload must be a plain object');
    }
    const payloadText = canonicalJson(payload);
    if (Buffer.byteLength(payloadText, 'utf8') > MAX_PAYLOAD_BYTES) {
      throw new AuditError(`payload exceeds ${MAX_PAYLOAD_BYTES} bytes`);
    }

    const head = getAuditHead(db);
    const seq = head.seq + 1;
    const hash = computeEntryHash({
      seq,
      ts,
      actor,
      event,
      entityId,
      payloadText,
      prevHash: head.hash,
    });

    db.prepare(
      `INSERT INTO audit_log (seq, ts, actor, event, entity_id, payload, prev_hash, hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(seq, ts, actor, event, entityId, payloadText, head.hash, hash);

    return Object.freeze({ seq, hash });
  } catch (error) {
    failTransaction(db, error);
    throw error;
  }
}

// Verifies the whole chain. Never throws on tampering; it reports problems.
// options.expectedHead: { seq, hash } kept outside the database, to detect
// truncation and full rebuilds.
export function verifyChain(db, options = {}) {
  const expectedHead = options.expectedHead;
  if (
    expectedHead !== undefined &&
    (expectedHead === null ||
      typeof expectedHead !== 'object' ||
      !Number.isSafeInteger(expectedHead.seq) ||
      expectedHead.seq < 0 ||
      typeof expectedHead.hash !== 'string' ||
      !HEX64_RE.test(expectedHead.hash))
  ) {
    throw new TypeError('expectedHead must be { seq, hash } with a 64-character hex hash');
  }

  const rows = db
    .prepare(
      `SELECT seq, ts, actor, event, entity_id, payload, prev_hash, hash
       FROM audit_log ORDER BY seq ASC`,
    )
    .all();

  const problems = [];
  let truncated = false;
  const report = (seq, code, message) => {
    if (problems.length < MAX_PROBLEMS) {
      problems.push({ seq, code, message });
    } else {
      truncated = true;
    }
  };

  let expectedSeq = 1;
  let prevHash = GENESIS_HASH;
  for (const row of rows) {
    if (row.seq !== expectedSeq) {
      report(row.seq, 'SEQUENCE_GAP', `expected seq ${expectedSeq}, found ${row.seq}`);
    }
    if (row.prev_hash !== prevHash) {
      report(row.seq, 'PREV_HASH_MISMATCH', 'entry does not link to the previous entry');
    }
    let recomputed = null;
    try {
      recomputed = computeEntryHash({
        seq: row.seq,
        ts: row.ts,
        actor: row.actor,
        event: row.event,
        entityId: row.entity_id,
        payloadText: row.payload,
        prevHash: row.prev_hash,
      });
    } catch {
      recomputed = null;
    }
    if (recomputed !== row.hash) {
      report(row.seq, 'HASH_MISMATCH', 'entry content does not match its hash');
    }
    // Continue from what is stored, so one tampered entry is reported where it is.
    expectedSeq = row.seq + 1;
    prevHash = row.hash;
  }

  const last = rows.length > 0 ? rows[rows.length - 1] : null;
  const headSeq = last === null ? 0 : last.seq;
  const headHash = last === null ? GENESIS_HASH : last.hash;

  if (
    expectedHead !== undefined &&
    (expectedHead.seq !== headSeq || expectedHead.hash !== headHash)
  ) {
    report(
      headSeq,
      'HEAD_MISMATCH',
      `head is seq ${headSeq}, expected seq ${expectedHead.seq}`,
    );
  }

  return {
    valid: problems.length === 0,
    entries: rows.length,
    headSeq,
    headHash,
    problems,
    truncated,
  };
}
