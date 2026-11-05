// Per-agent recipient lists. A recipient is on at most one list per agent
// (unique agent + account in the schema); setting a different list moves it.

import { appendAudit } from '../audit/auditChain.js';
import { withWriteTransaction } from '../db/database.js';
import { isValidNearAccountId } from '../policy/engine.js';
import { NotFoundError, ValidationError } from './errors.js';
import {
  assertPlainObject,
  hasControlCharacters,
  newId,
  rejectUnknownFields,
  requireContext,
} from './util.js';

export const LIST_TYPES = Object.freeze({ ALLOW: 'ALLOW', BLOCK: 'BLOCK' });
const LIST_VALUES = Object.values(LIST_TYPES);
const SET_FIELDS = ['accountId', 'listType', 'note'];

function toView(row) {
  return {
    id: row.id,
    agentId: row.agent_id,
    accountId: row.account_id,
    listType: row.list_type,
    note: row.note ?? null,
    createdAt: row.created_at,
  };
}

function requireAgent(db, agentId) {
  const row =
    typeof agentId === 'string'
      ? db.prepare('SELECT id FROM agents WHERE id = ?').get(agentId)
      : undefined;
  if (row === undefined) {
    throw new NotFoundError('agent not found');
  }
}

function validateNote(note) {
  if (note === undefined || note === null) {
    return null;
  }
  if (typeof note !== 'string') {
    throw new ValidationError('note must be a string', 'note');
  }
  const trimmed = note.trim();
  if (trimmed.length > 500 || hasControlCharacters(trimmed)) {
    throw new ValidationError('note must be at most 500 characters without control characters', 'note');
  }
  return trimmed === '' ? null : trimmed;
}

// Adds a recipient, or moves/updates an existing one. Omitting the note clears it.
export function setRecipient(db, agentId, input, context) {
  const { nowIso, actor } = requireContext(context);
  assertPlainObject(input, 'input');
  rejectUnknownFields(input, SET_FIELDS);
  if (!isValidNearAccountId(input.accountId)) {
    throw new ValidationError('accountId must be a valid NEAR account id', 'accountId');
  }
  if (!LIST_VALUES.includes(input.listType)) {
    throw new ValidationError('listType must be ALLOW or BLOCK', 'listType');
  }
  const note = validateNote(input.note);

  return withWriteTransaction(db, () => {
    requireAgent(db, agentId);
    const existing = db
      .prepare('SELECT * FROM recipients WHERE agent_id = ? AND account_id = ?')
      .get(agentId, input.accountId);

    if (existing === undefined) {
      const id = newId();
      db.prepare(
        `INSERT INTO recipients (id, agent_id, account_id, list_type, note, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(id, agentId, input.accountId, input.listType, note, nowIso);
      appendAudit(db, {
        ts: nowIso,
        actor,
        event: 'RECIPIENT_ADDED',
        entityId: id,
        payload: { agentId, accountId: input.accountId, listType: input.listType },
      });
      return toView(db.prepare('SELECT * FROM recipients WHERE id = ?').get(id));
    }

    db.prepare('UPDATE recipients SET list_type = ?, note = ? WHERE id = ?').run(
      input.listType, note, existing.id,
    );
    appendAudit(db, {
      ts: nowIso,
      actor,
      event: 'RECIPIENT_UPDATED',
      entityId: existing.id,
      payload: {
        agentId,
        accountId: input.accountId,
        from: existing.list_type,
        to: input.listType,
      },
    });
    return toView(db.prepare('SELECT * FROM recipients WHERE id = ?').get(existing.id));
  });
}

export function removeRecipient(db, agentId, accountId, context) {
  const { nowIso, actor } = requireContext(context);
  return withWriteTransaction(db, () => {
    const existing =
      typeof agentId === 'string' && typeof accountId === 'string'
        ? db
            .prepare('SELECT * FROM recipients WHERE agent_id = ? AND account_id = ?')
            .get(agentId, accountId)
        : undefined;
    if (existing === undefined) {
      throw new NotFoundError('recipient not found');
    }
    db.prepare('DELETE FROM recipients WHERE id = ?').run(existing.id);
    appendAudit(db, {
      ts: nowIso,
      actor,
      event: 'RECIPIENT_REMOVED',
      entityId: existing.id,
      payload: { agentId, accountId, listType: existing.list_type },
    });
    return toView(existing);
  });
}

// Lists an agent's recipients, ordered by account id. listType is optional.
export function listRecipients(db, agentId, listType) {
  if (listType !== undefined && !LIST_VALUES.includes(listType)) {
    throw new ValidationError('listType must be ALLOW or BLOCK', 'listType');
  }
  requireAgent(db, agentId);
  const rows =
    listType === undefined
      ? db.prepare('SELECT * FROM recipients WHERE agent_id = ? ORDER BY account_id ASC').all(agentId)
      : db
          .prepare('SELECT * FROM recipients WHERE agent_id = ? AND list_type = ? ORDER BY account_id ASC')
          .all(agentId, listType);
  return rows.map(toView);
}

// The shape the policy engine expects. Unknown recipients are on neither list.
export function getRecipientLists(db, agentId, accountId) {
  let listType = null;
  if (typeof agentId === 'string' && typeof accountId === 'string') {
    const row = db
      .prepare('SELECT list_type FROM recipients WHERE agent_id = ? AND account_id = ?')
      .get(agentId, accountId);
    listType = row === undefined ? null : row.list_type;
  }
  return Object.freeze({
    onAllowlist: listType === LIST_TYPES.ALLOW,
    onBlocklist: listType === LIST_TYPES.BLOCK,
  });
}
