// Database layer on Node's built-in node:sqlite (no native dependencies).
//
// - openDatabase: pragmas (foreign keys, busy timeout, WAL for files) and
//   migrations.
// - migrate: versioned via PRAGMA user_version, all-or-nothing, safe to rerun.
// - withWriteTransaction: BEGIN IMMEDIATE (write lock held for the whole
//   transaction). Any throw rolls back. failTransaction() marks a transaction
//   as unable to commit even if the caller swallows the error that caused it;
//   the audit log uses this so a failed audit append can never let the
//   business operation commit.

import { DatabaseSync } from 'node:sqlite';
import { MIGRATIONS } from './schema.js';

export class DatabaseError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'DatabaseError';
  }
}

const DEFAULT_BUSY_TIMEOUT_MS = 5000;
const MAX_BUSY_TIMEOUT_MS = 60000;

// db -> { failure: Error | null } while a write transaction is open
const writeTransactions = new WeakMap();

function firstValue(row) {
  return row === undefined ? undefined : Object.values(row)[0];
}

export function getUserVersion(db) {
  return firstValue(db.prepare('PRAGMA user_version').get());
}

function rollbackQuietly(db) {
  if (db.isTransaction) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // The transaction is already gone (SQLite can roll back by itself).
    }
  }
}

export function isInWriteTransaction(db) {
  return writeTransactions.has(db) && db.isTransaction;
}

// Marks the open write transaction as failed. It can no longer commit.
export function failTransaction(db, reason) {
  const state = writeTransactions.get(db);
  if (state && state.failure === null) {
    state.failure = reason instanceof Error ? reason : new Error(String(reason));
  }
}

// Runs fn(db) inside BEGIN IMMEDIATE ... COMMIT. fn must be synchronous.
// Returns fn's result. Rolls back and rethrows on any error.
export function withWriteTransaction(db, fn) {
  if (typeof fn !== 'function') {
    throw new TypeError('fn must be a function');
  }
  if (writeTransactions.has(db) || db.isTransaction) {
    throw new DatabaseError('nested transactions are not supported');
  }

  db.exec('BEGIN IMMEDIATE');
  const state = { failure: null };
  writeTransactions.set(db, state);

  let result;
  try {
    result = fn(db);
    if (result !== null && result !== undefined && typeof result.then === 'function') {
      result.then(undefined, () => {}); // avoid an unhandled rejection
      throw new TypeError('transaction callback must be synchronous');
    }
    if (state.failure !== null) {
      throw new DatabaseError('transaction was marked as failed and cannot be committed', {
        cause: state.failure,
      });
    }
    db.exec('COMMIT');
  } catch (error) {
    rollbackQuietly(db);
    throw error;
  } finally {
    writeTransactions.delete(db);
  }
  return result;
}

function validateMigrations(migrations) {
  if (!Array.isArray(migrations)) {
    throw new DatabaseError('migrations must be an array');
  }
  migrations.forEach((m, index) => {
    const expected = index + 1;
    if (m === null || typeof m !== 'object' || m.version !== expected) {
      throw new DatabaseError(`migration at index ${index} must have version ${expected}`);
    }
    if (typeof m.sql !== 'string' || m.sql.trim() === '') {
      throw new DatabaseError(`migration ${expected} has no SQL`);
    }
  });
}

// Applies pending migrations. Returns the resulting schema version.
// Safe to call repeatedly and from several processes: the version is re-read
// after the write lock is taken, and everything is one transaction.
export function migrate(db, migrations = MIGRATIONS) {
  validateMigrations(migrations);
  const latest = migrations.length;

  if (getUserVersion(db) === latest) {
    return latest;
  }

  withWriteTransaction(db, () => {
    const current = getUserVersion(db);
    if (current > latest) {
      throw new DatabaseError(
        `database schema version ${current} is newer than this code supports (${latest})`,
      );
    }
    for (const migration of migrations.slice(current)) {
      db.exec(migration.sql);
      db.exec(`PRAGMA user_version = ${migration.version}`);
    }
  });

  return latest;
}

// location: ':memory:' (default) or a file path.
// options: { busyTimeoutMs, migrate (default true), migrations }
export function openDatabase(location = ':memory:', options = {}) {
  if (typeof location !== 'string' || location === '') {
    throw new TypeError('location must be a non-empty string');
  }
  const busyTimeoutMs = options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS;
  if (
    !Number.isInteger(busyTimeoutMs) ||
    busyTimeoutMs < 0 ||
    busyTimeoutMs > MAX_BUSY_TIMEOUT_MS
  ) {
    throw new TypeError('busyTimeoutMs must be an integer from 0 to 60000');
  }

  const db = new DatabaseSync(location);
  try {
    db.exec(`PRAGMA busy_timeout = ${busyTimeoutMs}`);
    db.exec('PRAGMA foreign_keys = ON');
    if (location !== ':memory:') {
      db.exec('PRAGMA journal_mode = WAL');
    }
    if (options.migrate !== false) {
      migrate(db, options.migrations ?? MIGRATIONS);
    }
  } catch (error) {
    db.close();
    throw error;
  }
  return db;
}
