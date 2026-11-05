// Test helpers for database tests. Not imported by production code.
// describeBackends runs the same tests on an in-memory database and on a
// temporary file database (WAL mode, cleaned up afterwards).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe } from 'node:test';
import { openDatabase } from '../db/database.js';

export const T = '2026-11-04T12:00:00.000Z';

class DbContext {
  constructor(kind) {
    this.kind = kind;
    this.dir = null;
    this.counter = 0;
    this.opened = new Set();
    this.locations = new Map();
  }

  // Opens a fresh, migrated database (options are passed to openDatabase).
  open(options) {
    let location = ':memory:';
    if (this.kind === 'file') {
      this.dir ??= fs.mkdtempSync(path.join(os.tmpdir(), 'spendguard-test-'));
      location = path.join(this.dir, `db-${this.counter++}.sqlite`);
    }
    return this.openAt(location, options);
  }

  // Opens a connection to an existing location (a second connection or a reopen).
  openAt(location, options) {
    const db = openDatabase(location, options);
    this.opened.add(db);
    this.locations.set(db, location);
    return db;
  }

  locationOf(db) {
    return this.locations.get(db);
  }

  close(db) {
    if (this.opened.delete(db)) {
      db.close();
    }
  }

  cleanup() {
    for (const db of [...this.opened]) {
      try {
        this.close(db);
      } catch {
        // already closed
      }
    }
    if (this.dir !== null) {
      fs.rmSync(this.dir, { recursive: true, force: true });
    }
  }
}

export function describeBackends(title, defineTests) {
  for (const kind of ['memory', 'file']) {
    describe(`${title} [${kind}]`, () => {
      const ctx = new DbContext(kind);
      after(() => ctx.cleanup());
      defineTests(ctx);
    });
  }
}

export function insertRow(db, table, row) {
  const columns = Object.keys(row);
  const sql = `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns
    .map(() => '?')
    .join(', ')})`;
  return db.prepare(sql).run(...columns.map((c) => row[c]));
}

export function count(db, table) {
  return db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
}

export const agentRow = (over = {}) => ({
  id: 'agent-1',
  name: 'Test Agent',
  status: 'ACTIVE',
  api_key_hash: 'b'.repeat(64),
  source_account: 'owner.testnet',
  daily_budget: '100',
  per_tx_limit: '20',
  approval_threshold: '5',
  created_at: T,
  updated_at: T,
  ...over,
});

export const requestRow = (over = {}) => ({
  id: 'req-1',
  agent_id: 'agent-1',
  recipient: 'merchant.testnet',
  amount: '1',
  purpose: null,
  idempotency_key: 'idem-key-1',
  request_hash: 'a'.repeat(64),
  decision: 'APPROVED',
  status: 'APPROVED',
  reason_codes: '["WITHIN_POLICY"]',
  policy_snapshot: '{}',
  ai_explanation: null,
  ai_provider: null,
  created_at: T,
  decided_at: T,
  expires_at: T,
  updated_at: T,
  ...over,
});

export const reservationRow = (over = {}) => ({
  id: 'res-1',
  request_id: 'req-1',
  agent_id: 'agent-1',
  amount: '1',
  budget_day: '2026-11-04',
  status: 'ACTIVE',
  release_reason: null,
  created_at: T,
  updated_at: T,
  ...over,
});
