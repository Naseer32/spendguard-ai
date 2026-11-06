import { it } from 'node:test';
import assert from 'node:assert/strict';
import { GENESIS_HASH, appendAudit } from '../audit/auditChain.js';
import { withWriteTransaction } from '../db/database.js';
import { T, describeBackends } from '../testing/dbKit.js';
import { ValidationError } from './errors.js';
import { getAuditHeadView, listAuditEntries, verifyAuditLog } from './auditLog.js';

const ENTRY_KEYS = ['actor', 'entityId', 'event', 'hash', 'payload', 'prevHash', 'seq', 'ts'];

describeBackends('audit log reading', (ctx) => {
  function seed(count = 5) {
    const db = ctx.open();
    withWriteTransaction(db, () => {
      for (let i = 1; i <= count; i += 1) {
        appendAudit(db, {
          ts: T,
          actor: i % 2 === 1 ? 'owner' : 'system',
          event: i % 2 === 1 ? 'EVENT_A' : 'EVENT_B',
          entityId: `e${i}`,
          payload: { n: i },
        });
      }
    });
    return db;
  }

  const seqs = (page) => page.entries.map((e) => e.seq);

  it('lists entries oldest first with parsed payloads', () => {
    const db = seed();
    const page = listAuditEntries(db);
    assert.deepEqual(seqs(page), [1, 2, 3, 4, 5]);
    assert.equal(page.hasMore, false);
    assert.equal(page.nextAfterSeq, 5);
    assert.deepEqual(Object.keys(page.entries[0]).sort(), ENTRY_KEYS);
    assert.equal(page.entries[0].actor, 'owner');
    assert.equal(page.entries[0].event, 'EVENT_A');
    assert.equal(page.entries[0].entityId, 'e1');
    assert.deepEqual(page.entries[0].payload, { n: 1 });
    assert.equal(page.entries[0].prevHash, GENESIS_HASH);
    assert.equal(page.entries[1].prevHash, page.entries[0].hash);
    assert.deepEqual(page.head, getAuditHeadView(db));
    assert.equal(page.head.seq, 5);
    assert.equal(page.head.hash, page.entries[4].hash);
  });

  it('pages with a cursor', () => {
    const db = seed();
    const first = listAuditEntries(db, { limit: 2 });
    assert.deepEqual(seqs(first), [1, 2]);
    assert.equal(first.hasMore, true);
    assert.equal(first.nextAfterSeq, 2);
    const second = listAuditEntries(db, { limit: 2, afterSeq: first.nextAfterSeq });
    assert.deepEqual(seqs(second), [3, 4]);
    assert.equal(second.hasMore, true);
    const third = listAuditEntries(db, { limit: 2, afterSeq: second.nextAfterSeq });
    assert.deepEqual(seqs(third), [5]);
    assert.equal(third.hasMore, false);
    assert.equal(third.nextAfterSeq, 5);
  });

  it('reports no more entries when the page is exactly full', () => {
    const db = seed();
    const page = listAuditEntries(db, { limit: 5 });
    assert.equal(page.entries.length, 5);
    assert.equal(page.hasMore, false);
  });

  it('returns an empty page past the end and keeps the cursor', () => {
    const db = seed();
    const page = listAuditEntries(db, { afterSeq: 5 });
    assert.deepEqual(page.entries, []);
    assert.equal(page.hasMore, false);
    assert.equal(page.nextAfterSeq, 5);
    assert.equal(listAuditEntries(db, { afterSeq: 100 }).nextAfterSeq, 100);
  });

  it('handles an empty log', () => {
    const db = ctx.open();
    const page = listAuditEntries(db);
    assert.deepEqual(page.entries, []);
    assert.equal(page.hasMore, false);
    assert.equal(page.nextAfterSeq, 0);
    assert.deepEqual(page.head, { seq: 0, hash: GENESIS_HASH });
  });

  it('filters by event and by entity', () => {
    const db = seed();
    assert.deepEqual(seqs(listAuditEntries(db, { event: 'EVENT_A' })), [1, 3, 5]);
    assert.deepEqual(seqs(listAuditEntries(db, { event: 'EVENT_B' })), [2, 4]);
    assert.deepEqual(seqs(listAuditEntries(db, { entityId: 'e3' })), [3]);
    assert.deepEqual(seqs(listAuditEntries(db, { event: 'EVENT_A', entityId: 'e2' })), []);
    assert.deepEqual(seqs(listAuditEntries(db, { event: 'NOPE' })), []);
  });

  it('pages correctly through a filtered list', () => {
    const db = seed();
    const first = listAuditEntries(db, { event: 'EVENT_A', limit: 2 });
    assert.deepEqual(seqs(first), [1, 3]);
    assert.equal(first.hasMore, true);
    assert.equal(first.nextAfterSeq, 3);
    const second = listAuditEntries(db, { event: 'EVENT_A', limit: 2, afterSeq: first.nextAfterSeq });
    assert.deepEqual(seqs(second), [5]);
    assert.equal(second.hasMore, false);
  });

  it('rejects invalid filters', () => {
    const db = seed();
    const bad = [
      null, 'x', 5, [], { unknown: 1 },
      { afterSeq: -1 }, { afterSeq: 1.5 }, { afterSeq: '1' }, { afterSeq: 2 ** 53 },
      { limit: 0 }, { limit: 501 }, { limit: 1.5 }, { limit: '5' },
      { event: '' }, { event: 5 }, { event: 'e'.repeat(65) },
      { entityId: '' }, { entityId: 5 }, { entityId: 'e'.repeat(129) },
    ];
    bad.forEach((filters, i) => {
      assert.throws(() => listAuditEntries(db, filters), ValidationError, `filters #${i}`);
    });
    assert.doesNotThrow(() => listAuditEntries(db, { limit: 500 }));
  });

  it('survives a damaged payload row and reports it through verification', () => {
    const db = seed();
    db.exec('DROP TRIGGER audit_log_no_update');
    db.exec('DROP TABLE IF EXISTS _unused');
    db.exec("PRAGMA ignore_check_constraints = ON");
    db.exec("UPDATE audit_log SET payload = 'not json' WHERE seq = 3");
    const page = listAuditEntries(db);
    assert.equal(page.entries.length, 5);
    assert.equal(page.entries[2].payload, null);
    const result = verifyAuditLog(db);
    assert.equal(result.valid, false);
    assert.ok(result.problems.some((p) => p.seq === 3 && p.code === 'HASH_MISMATCH'));
  });

  it('verifies an intact chain', () => {
    const db = seed();
    const result = verifyAuditLog(db);
    assert.equal(result.valid, true);
    assert.equal(result.entries, 5);
    assert.equal(result.headSeq, 5);
    assert.deepEqual(result.problems, []);
    assert.equal(verifyAuditLog(db, { expectedHead: getAuditHeadView(db) }).valid, true);
    assert.equal(verifyAuditLog(db, { expectedHead: { seq: 0, hash: GENESIS_HASH } }).valid, false);
  });

  it('detects tampering and truncation against an external head', () => {
    const db = seed();
    const head = getAuditHeadView(db);
    db.exec('DROP TRIGGER audit_log_no_update');
    db.exec('DROP TRIGGER audit_log_no_delete');
    db.exec("UPDATE audit_log SET actor = 'evil' WHERE seq = 3");
    const tampered = verifyAuditLog(db);
    assert.equal(tampered.valid, false);
    assert.deepEqual(tampered.problems.map((p) => [p.seq, p.code]), [[3, 'HASH_MISMATCH']]);
    db.exec('DELETE FROM audit_log WHERE seq = 5');
    const truncated = verifyAuditLog(db, { expectedHead: head });
    assert.ok(truncated.problems.some((p) => p.code === 'HEAD_MISMATCH'));
  });

  it('rejects bad verification options', () => {
    const db = seed();
    const bad = [
      null, 'x', [], { unknown: 1 }, { expectedHead: null }, { expectedHead: 'x' },
      { expectedHead: { seq: -1, hash: GENESIS_HASH } }, { expectedHead: { seq: 1, hash: 'short' } },
      { expectedHead: { seq: 1 } }, { expectedHead: { hash: GENESIS_HASH } },
    ];
    bad.forEach((options, i) => {
      assert.throws(() => verifyAuditLog(db, options), ValidationError, `options #${i}`);
    });
  });

  it('is read-only', () => {
    const db = seed();
    const before = JSON.stringify(listAuditEntries(db));
    listAuditEntries(db, { limit: 2 });
    verifyAuditLog(db);
    assert.equal(JSON.stringify(listAuditEntries(db)), before);
  });
});
