// Test helpers for service tests. Not imported by production code.

import { nearToYocto } from '../money/yocto.js';
import { createAgent } from '../services/agents.js';

// 2026-11-04T12:00:00.000Z, the same instant as T in dbKit.
export const NOW = Date.UTC(2026, 10, 4, 12, 0, 0, 0);

export const svc = (over = {}) => ({ now: NOW, actor: 'owner', ...over });

export const agentInput = (over = {}) => ({
  name: 'Test Agent',
  sourceAccount: 'owner.testnet',
  dailyBudget: nearToYocto('100'),
  perTxLimit: nearToYocto('20'),
  approvalThreshold: nearToYocto('5'),
  ...over,
});

export function seedAgent(db, over = {}, context = svc()) {
  return createAgent(db, agentInput(over), context);
}

export function auditEvents(db) {
  return db
    .prepare('SELECT seq, ts, actor, event, entity_id, payload FROM audit_log ORDER BY seq')
    .all()
    .map((r) => ({
      seq: r.seq,
      ts: r.ts,
      actor: r.actor,
      event: r.event,
      entityId: r.entity_id,
      payload: JSON.parse(r.payload),
    }));
}

export function tableText(db, table) {
  return JSON.stringify(db.prepare(`SELECT * FROM ${table}`).all());
}
