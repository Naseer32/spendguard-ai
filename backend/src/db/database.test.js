import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { agentRow, count, describeBackends, insertRow } from '../testing/dbKit.js';
import {
  DatabaseError,
  failTransaction,
  getUserVersion,
  isInWriteTransaction,
  migrate,
  openDatabase,
  withWriteTransaction,
} from './database.js';
import { LATEST_VERSION, MIGRATIONS } from './schema.js';

const pragma = (db, name) => Object.values(db.prepare(`PRAGMA ${name}`).get())[0];
const tableCount = (db, name) =>
  db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = ?").get(name).n;

const V1 = { version: 1, sql: 'CREATE TABLE a (x INTEGER)' };
const V2 = { version: 2, sql: 'CREATE TABLE b (y INTEGER)' };
const BAD_V2 = {
  version: 2,
  sql: 'CREATE TABLE b (y INTEGER); INSERT INTO missing_table VALUES (1)',
};

describe('migration list', () => {
  it('is contiguous, frozen and starts at version 1', () => {
    assert.ok(MIGRATIONS.length >= 1);
    assert.equal(LATEST_VERSION, MIGRATIONS.length);
    assert.ok(Object.isFrozen(MIGRATIONS));
    MIGRATIONS.forEach((m, i) => assert.equal(m.version, i + 1));
  });
});

describe('openDatabase arguments', () => {
  it('rejects invalid locations', () => {
    for (const bad of ['', 123, null, {}]) {
      assert.throws(() => openDatabase(bad), TypeError, String(bad));
    }
  });

  it('rejects invalid busy timeouts', () => {
    for (const bad of [-1, 1.5, '5', 60001, NaN]) {
      assert.throws(() => openDatabase(':memory:', { busyTimeoutMs: bad }), TypeError, String(bad));
    }
  });
});

describeBackends('database', (ctx) => {
  it('opens migrated, with foreign keys and a busy timeout', () => {
    const db = ctx.open();
    assert.equal(getUserVersion(db), LATEST_VERSION);
    assert.equal(pragma(db, 'foreign_keys'), 1);
    assert.equal(pragma(db, 'busy_timeout'), 5000);
    assert.equal(pragma(db, 'journal_mode'), ctx.kind === 'file' ? 'wal' : 'memory');
  });

  it('honors a custom busy timeout', () => {
    const db = ctx.open({ busyTimeoutMs: 123 });
    assert.equal(pragma(db, 'busy_timeout'), 123);
  });

  it('can open without migrating', () => {
    const db = ctx.open({ migrate: false });
    assert.equal(getUserVersion(db), 0);
    assert.equal(tableCount(db, 'agents'), 0);
  });

  it('migrate is idempotent and keeps data', () => {
    const db = ctx.open();
    insertRow(db, 'agents', agentRow());
    assert.equal(migrate(db), LATEST_VERSION);
    assert.equal(migrate(db), LATEST_VERSION);
    assert.equal(getUserVersion(db), LATEST_VERSION);
    assert.equal(count(db, 'agents'), 1);
  });

  it('applies new migrations incrementally and keeps existing data', () => {
    const db = ctx.open({ migrations: [V1] });
    db.exec('INSERT INTO a VALUES (7)');
    assert.equal(getUserVersion(db), 1);
    assert.equal(migrate(db, [V1, V2]), 2);
    assert.equal(getUserVersion(db), 2);
    assert.equal(tableCount(db, 'b'), 1);
    assert.equal(db.prepare('SELECT x FROM a').get().x, 7);
    assert.equal(migrate(db, [V1, V2]), 2); // rerun is a no-op
  });

  it('rolls a failed migration back completely', () => {
    const db = ctx.open({ migrations: [V1] });
    db.exec('INSERT INTO a VALUES (7)');
    assert.throws(() => migrate(db, [V1, BAD_V2]), /missing_table|no such table/i);
    assert.equal(getUserVersion(db), 1);
    assert.equal(tableCount(db, 'b'), 0);
    assert.equal(db.isTransaction, false);
    assert.equal(db.prepare('SELECT x FROM a').get().x, 7);
    assert.equal(migrate(db, [V1, V2]), 2); // a corrected migration still applies
  });

  it('rolls back every pending migration when a later one fails', () => {
    const db = ctx.open({ migrate: false });
    assert.throws(() => migrate(db, [V1, BAD_V2]), /missing_table|no such table/i);
    assert.equal(getUserVersion(db), 0);
    assert.equal(tableCount(db, 'a'), 0);
  });

  it('refuses a database that is newer than the code', () => {
    const db = ctx.open({ migrate: false });
    db.exec('PRAGMA user_version = 99');
    assert.throws(() => migrate(db), (e) => e instanceof DatabaseError && /newer/.test(e.message));
    assert.equal(getUserVersion(db), 99);
  });

  it('rejects malformed migration lists before touching the database', () => {
    const db = ctx.open({ migrate: false });
    const bad = [
      'nope', [null], [V2], [V1, { version: 1, sql: 'SELECT 1' }],
      [V1, { version: 3, sql: 'SELECT 1' }], [{ version: 1.5, sql: 'SELECT 1' }],
      [{ version: 1, sql: '' }], [{ version: 1 }],
    ];
    for (const list of bad) {
      assert.throws(() => migrate(db, list), DatabaseError, JSON.stringify(list));
    }
    assert.equal(getUserVersion(db), 0);
  });

  it('commits a write transaction and returns the callback result', () => {
    const db = ctx.open();
    const result = withWriteTransaction(db, () => {
      insertRow(db, 'agents', agentRow());
      return 'done';
    });
    assert.equal(result, 'done');
    assert.equal(count(db, 'agents'), 1);
    assert.equal(db.isTransaction, false);
  });

  it('rolls back and rethrows the original error', () => {
    const db = ctx.open();
    const boom = new Error('boom');
    assert.throws(
      () => withWriteTransaction(db, () => {
        insertRow(db, 'agents', agentRow());
        throw boom;
      }),
      (e) => e === boom,
    );
    assert.equal(count(db, 'agents'), 0);
    assert.equal(db.isTransaction, false);
  });

  it('rolls back earlier statements when a later statement fails', () => {
    const db = ctx.open();
    assert.throws(
      () => withWriteTransaction(db, () => {
        insertRow(db, 'agents', agentRow());
        insertRow(db, 'agents', agentRow({ id: 'agent-2', status: 'ROGUE' }));
      }),
      /constraint failed/i,
    );
    assert.equal(count(db, 'agents'), 0);
  });

  it('rejects async callbacks and rolls back', () => {
    const db = ctx.open();
    assert.throws(
      () => withWriteTransaction(db, async () => {
        insertRow(db, 'agents', agentRow());
      }),
      TypeError,
    );
    assert.equal(count(db, 'agents'), 0);
    assert.equal(db.isTransaction, false);
  });

  it('rejects nested transactions', () => {
    const db = ctx.open();
    assert.throws(
      () => withWriteTransaction(db, () => {
        insertRow(db, 'agents', agentRow());
        withWriteTransaction(db, () => {});
      }),
      DatabaseError,
    );
    assert.equal(count(db, 'agents'), 0);
  });

  it('rejects a write transaction inside a manual transaction', () => {
    const db = ctx.open();
    db.exec('BEGIN');
    assert.throws(() => withWriteTransaction(db, () => {}), DatabaseError);
    db.exec('ROLLBACK');
  });

  it('rejects a non-function callback', () => {
    const db = ctx.open();
    assert.throws(() => withWriteTransaction(db, null), TypeError);
    assert.equal(db.isTransaction, false);
  });

  it('prevents commit once a transaction is marked failed, even if the error is swallowed', () => {
    const db = ctx.open();
    assert.throws(
      () => withWriteTransaction(db, () => {
        insertRow(db, 'agents', agentRow());
        failTransaction(db, new Error('audit failed'));
        return 'ignored';
      }),
      (e) => e instanceof DatabaseError && e.cause instanceof Error && e.cause.message === 'audit failed',
    );
    assert.equal(count(db, 'agents'), 0);
    assert.equal(db.isTransaction, false);
  });

  it('keeps the first failure reason', () => {
    const db = ctx.open();
    assert.throws(
      () => withWriteTransaction(db, () => {
        failTransaction(db, 'first');
        failTransaction(db, 'second');
      }),
      (e) => e.cause.message === 'first',
    );
  });

  it('tracks whether a write transaction is open', () => {
    const db = ctx.open();
    assert.equal(isInWriteTransaction(db), false);
    withWriteTransaction(db, () => {
      assert.equal(isInWriteTransaction(db), true);
    });
    assert.equal(isInWriteTransaction(db), false);
    db.exec('BEGIN');
    assert.equal(isInWriteTransaction(db), false); // a manual transaction does not count
    db.exec('ROLLBACK');
  });

  it('ignores failTransaction outside a write transaction', () => {
    const db = ctx.open();
    failTransaction(db, 'nothing open');
    withWriteTransaction(db, () => insertRow(db, 'agents', agentRow()));
    assert.equal(count(db, 'agents'), 1);
  });

  it('stays usable after failed transactions', () => {
    const db = ctx.open();
    for (let i = 0; i < 3; i += 1) {
      assert.throws(() => withWriteTransaction(db, () => { throw new Error('x'); }));
    }
    withWriteTransaction(db, () => insertRow(db, 'agents', agentRow()));
    assert.equal(count(db, 'agents'), 1);
  });

  it('persists data across reopen without re-running migrations', { skip: ctx.kind !== 'file' }, () => {
    const db = ctx.open();
    insertRow(db, 'agents', agentRow());
    const location = ctx.locationOf(db);
    ctx.close(db);
    const reopened = ctx.openAt(location);
    assert.equal(getUserVersion(reopened), LATEST_VERSION);
    assert.equal(count(reopened, 'agents'), 1);
  });

  it(
    'blocks a second writer while a write transaction is open, but still allows reads',
    { skip: ctx.kind !== 'file' },
    () => {
      const a = ctx.open();
      const b = ctx.openAt(ctx.locationOf(a), { busyTimeoutMs: 50 });
      withWriteTransaction(a, () => {
        insertRow(a, 'agents', agentRow());
        assert.equal(count(b, 'agents'), 0); // uncommitted data is invisible
        assert.throws(() => withWriteTransaction(b, () => {}), /locked|busy/i);
      });
      assert.equal(count(b, 'agents'), 1); // visible after commit
      withWriteTransaction(b, () => insertRow(b, 'agents', agentRow({ id: 'agent-2' })));
      assert.equal(count(a, 'agents'), 2);
    },
  );
});
