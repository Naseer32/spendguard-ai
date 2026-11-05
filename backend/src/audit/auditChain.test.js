import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseError, withWriteTransaction } from '../db/database.js';
import {
  T,
  agentRow,
  count,
  describeBackends,
  insertRow,
  requestRow,
  reservationRow,
} from '../testing/dbKit.js';
import {
  AuditError,
  GENESIS_HASH,
  MAX_PAYLOAD_BYTES,
  appendAudit,
  canonicalJson,
  computeEntryHash,
  getAuditHead,
  verifyChain,
} from './auditChain.js';

const FAKE = 'f'.repeat(64);

const entry = (i) => ({
  ts: T,
  actor: 'system',
  event: 'TEST_EVENT',
  entityId: `e${i}`,
  payload: { n: i },
});

function build(db, n) {
  withWriteTransaction(db, () => {
    for (let i = 1; i <= n; i += 1) {
      appendAudit(db, entry(i));
    }
  });
  return getAuditHead(db);
}

function untrigger(db) {
  db.exec('DROP TRIGGER audit_log_no_update');
  db.exec('DROP TRIGGER audit_log_no_delete');
}

// A database with a valid chain whose append-only triggers are removed, so a
// test can simulate someone editing the file directly.
function tamperable(ctx, n = 5) {
  const db = ctx.open();
  const head = build(db, n);
  untrigger(db);
  return { db, head };
}

const rowsOf = (db) =>
  db
    .prepare(
      'SELECT seq, ts, actor, event, entity_id, payload, prev_hash, hash FROM audit_log ORDER BY seq',
    )
    .all();
const codes = (result) => result.problems.map((p) => p.code);
const seqsOf = (result, code) =>
  result.problems.filter((p) => p.code === code).map((p) => p.seq);

describe('canonicalJson', () => {
  it('sorts keys and is independent of insertion order', () => {
    assert.equal(canonicalJson({ b: 1, a: 2 }), '{"a":2,"b":1}');
    assert.equal(canonicalJson({ a: 2, b: 1 }), canonicalJson({ b: 1, a: 2 }));
    assert.equal(
      canonicalJson({ z: [{ b: 1, a: 2 }], a: null }),
      '{"a":null,"z":[{"a":2,"b":1}]}',
    );
  });

  it('encodes strings, booleans, null, integers and empty containers', () => {
    assert.equal(canonicalJson('é"\n'), JSON.stringify('é"\n'));
    assert.equal(canonicalJson({ t: true, f: false, n: null }), '{"f":false,"n":null,"t":true}');
    assert.equal(canonicalJson([1, -5, 0]), '[1,-5,0]');
    assert.equal(canonicalJson({}), '{}');
    assert.equal(canonicalJson([]), '[]');
  });

  it('keeps large amounts exact because they are strings', () => {
    assert.equal(
      canonicalJson({ amount: '9007199254740993' }),
      '{"amount":"9007199254740993"}',
    );
  });

  it('rejects values that cannot be represented exactly', () => {
    const cyclic = {};
    cyclic.self = cyclic;
    let deep = {};
    for (let i = 0; i < 20; i += 1) deep = { n: deep };
    const bad = [
      undefined, { a: undefined }, [undefined], [, 1], () => {}, { f() {} },
      Symbol('x'), { s: Symbol('x') }, 10n, { b: 10n }, 1.5, { x: 1.5 },
      NaN, Infinity, 2 ** 53, { d: new Date() }, new Map(), new Set(),
      new (class Foo {})(), cyclic, deep,
    ];
    for (const value of bad) {
      assert.throws(() => canonicalJson(value), AuditError, String(typeof value));
    }
  });

  it('allows moderately nested payloads', () => {
    let nested = {};
    for (let i = 0; i < 10; i += 1) nested = { n: nested };
    assert.doesNotThrow(() => canonicalJson(nested));
  });
});

describe('computeEntryHash', () => {
  const base = {
    seq: 1, ts: T, actor: 'a', event: 'E', entityId: 'x', payloadText: '{}', prevHash: GENESIS_HASH,
  };

  it('is a 64-character lowercase hex SHA-256', () => {
    assert.match(computeEntryHash(base), /^[0-9a-f]{64}$/);
  });

  it('is deterministic', () => {
    assert.equal(computeEntryHash(base), computeEntryHash({ ...base }));
  });

  it('changes when any field changes', () => {
    const original = computeEntryHash(base);
    const variants = [
      { seq: 2 }, { ts: '2026-11-05T00:00:00.000Z' }, { actor: 'b' }, { event: 'F' },
      { entityId: 'y' }, { entityId: null }, { payloadText: '{"a":1}' }, { prevHash: FAKE },
    ];
    for (const over of variants) {
      assert.notEqual(computeEntryHash({ ...base, ...over }), original, JSON.stringify(over));
    }
  });

  it('treats a missing entity id the same as null', () => {
    assert.equal(
      computeEntryHash({ ...base, entityId: undefined }),
      computeEntryHash({ ...base, entityId: null }),
    );
  });
});

describeBackends('audit chain', (ctx) => {
  it('starts empty with the genesis head', () => {
    const db = ctx.open();
    assert.deepEqual({ ...getAuditHead(db) }, { seq: 0, hash: GENESIS_HASH });
    const result = verifyChain(db);
    assert.equal(result.valid, true);
    assert.equal(result.entries, 0);
    assert.equal(result.headSeq, 0);
    assert.equal(result.headHash, GENESIS_HASH);
  });

  it('writes the documented hash with canonical payload text', () => {
    const db = ctx.open();
    const result = withWriteTransaction(db, () => appendAudit(db, entry(1)));
    const row = rowsOf(db)[0];
    const expected = createHash('sha256')
      .update(
        'spendguard-audit-v1\n' +
          JSON.stringify([1, T, 'system', 'TEST_EVENT', 'e1', '{"n":1}', GENESIS_HASH]),
      )
      .digest('hex');
    assert.equal(row.seq, 1);
    assert.equal(row.payload, '{"n":1}');
    assert.equal(row.prev_hash, GENESIS_HASH);
    assert.equal(row.hash, expected);
    assert.equal(result.seq, 1);
    assert.equal(result.hash, expected);
  });

  it('links each entry to the previous one and verifies', () => {
    const db = ctx.open();
    const head = build(db, 5);
    const rows = rowsOf(db);
    assert.equal(rows.length, 5);
    rows.forEach((row, i) => assert.equal(row.seq, i + 1));
    for (let i = 1; i < rows.length; i += 1) {
      assert.equal(rows[i].prev_hash, rows[i - 1].hash);
    }
    assert.equal(head.seq, 5);
    assert.equal(head.hash, rows[4].hash);
    const result = verifyChain(db);
    assert.equal(result.valid, true);
    assert.equal(result.entries, 5);
    assert.equal(result.headHash, head.hash);
    assert.deepEqual(result.problems, []);
    assert.equal(verifyChain(db, { expectedHead: head }).valid, true);
  });

  it('accepts entries without an entity id or payload', () => {
    const db = ctx.open();
    withWriteTransaction(db, () => {
      appendAudit(db, { ts: T, actor: 'system', event: 'BARE' });
    });
    const row = rowsOf(db)[0];
    assert.equal(row.entity_id, null);
    assert.equal(row.payload, '{}');
    assert.equal(verifyChain(db).valid, true);
  });

  it('validates input and fails the transaction on bad entries', () => {
    const db = ctx.open();
    const ok = entry(1);
    const circular = {};
    circular.self = circular;
    const bad = [
      null, undefined, {}, { ...ok, ts: 'x' }, { ...ok, ts: 5 },
      { ...ok, actor: '' }, { ...ok, actor: 'a'.repeat(129) }, { ...ok, actor: 5 },
      { ...ok, event: '' }, { ...ok, event: 'e'.repeat(65) },
      { ...ok, entityId: '' }, { ...ok, entityId: 5 }, { ...ok, entityId: 'x'.repeat(129) },
      { ...ok, payload: [] }, { ...ok, payload: 'text' }, { ...ok, payload: null },
      { ...ok, payload: { a: undefined } }, { ...ok, payload: { amount: 1.5 } },
      { ...ok, payload: { big: 10n } }, { ...ok, payload: circular },
      { ...ok, payload: { d: new Date() } },
    ];
    for (const input of bad) {
      assert.throws(
        () => withWriteTransaction(db, () => appendAudit(db, input)),
        (e) => e instanceof AuditError,
        JSON.stringify(input),
      );
    }
    assert.equal(count(db, 'audit_log'), 0);
  });

  it('enforces the payload size limit exactly', () => {
    const db = ctx.open();
    // {"d":"..."} is the filler length plus 8 characters
    const atLimit = { d: 'x'.repeat(MAX_PAYLOAD_BYTES - 8) };
    const overLimit = { d: 'x'.repeat(MAX_PAYLOAD_BYTES - 7) };
    withWriteTransaction(db, () => appendAudit(db, { ...entry(1), payload: atLimit }));
    assert.throws(
      () => withWriteTransaction(db, () => appendAudit(db, { ...entry(2), payload: overLimit })),
      AuditError,
    );
    assert.equal(count(db, 'audit_log'), 1);
  });

  it('refuses to append outside a write transaction', () => {
    const db = ctx.open();
    assert.throws(() => appendAudit(db, entry(1)), AuditError);
    db.exec('BEGIN');
    assert.throws(() => appendAudit(db, entry(1)), AuditError);
    db.exec('ROLLBACK');
    assert.equal(count(db, 'audit_log'), 0);
  });

  it('appends several entries in one transaction', () => {
    const db = ctx.open();
    withWriteTransaction(db, () => {
      appendAudit(db, entry(1));
      appendAudit(db, entry(2));
      appendAudit(db, entry(3));
    });
    assert.equal(count(db, 'audit_log'), 3);
    assert.equal(verifyChain(db).valid, true);
  });

  it('leaves no gap after a rolled-back append', () => {
    const db = ctx.open();
    assert.throws(
      () => withWriteTransaction(db, () => {
        appendAudit(db, entry(1));
        throw new Error('operation failed');
      }),
      /operation failed/,
    );
    assert.equal(count(db, 'audit_log'), 0);
    withWriteTransaction(db, () => appendAudit(db, entry(1)));
    const result = verifyChain(db);
    assert.equal(rowsOf(db)[0].seq, 1);
    assert.equal(result.valid, true);
  });

  it('stays contiguous when two connections append in turn', { skip: ctx.kind !== 'file' }, () => {
    const a = ctx.open();
    const b = ctx.openAt(ctx.locationOf(a));
    for (let i = 1; i <= 6; i += 1) {
      const db = i % 2 === 1 ? a : b;
      withWriteTransaction(db, () => appendAudit(db, entry(i)));
    }
    assert.equal(count(a, 'audit_log'), 6);
    const result = verifyChain(b);
    assert.equal(result.valid, true);
    assert.equal(result.headSeq, 6);
  });
});

describeBackends('audit and reservation atomicity', (ctx) => {
  function setup() {
    const db = ctx.open();
    insertRow(db, 'agents', agentRow());
    insertRow(db, 'payment_requests', requestRow());
    return db;
  }
  const reserve = (db) => insertRow(db, 'budget_reservations', reservationRow());
  const auditReservation = (db) =>
    appendAudit(db, {
      ts: T,
      actor: 'system',
      event: 'BUDGET_RESERVED',
      entityId: 'res-1',
      payload: { requestId: 'req-1', amount: '1' },
    });

  it('commits the reservation and its audit entry together', () => {
    const db = setup();
    withWriteTransaction(db, () => {
      reserve(db);
      auditReservation(db);
    });
    assert.equal(count(db, 'budget_reservations'), 1);
    assert.equal(count(db, 'audit_log'), 1);
    assert.equal(verifyChain(db).valid, true);
  });

  it('rolls both back when the operation fails after the audit append', () => {
    const db = setup();
    assert.throws(
      () => withWriteTransaction(db, () => {
        reserve(db);
        auditReservation(db);
        throw new Error('later step failed');
      }),
      /later step failed/,
    );
    assert.equal(count(db, 'budget_reservations'), 0);
    assert.equal(count(db, 'audit_log'), 0);
    assert.equal(db.isTransaction, false);
  });

  it('rolls the audit entry back when the business insert fails', () => {
    const db = setup();
    withWriteTransaction(db, () => {
      reserve(db);
      auditReservation(db);
    });
    assert.throws(
      () => withWriteTransaction(db, () => {
        auditReservation(db); // audit first
        reserve(db); // duplicate reservation for the same request
      }),
      /UNIQUE constraint failed/i,
    );
    assert.equal(count(db, 'budget_reservations'), 1);
    assert.equal(count(db, 'audit_log'), 1); // only the first, committed entry
    assert.equal(verifyChain(db).valid, true);
  });

  it('rolls the reservation back when the audit append fails', () => {
    const db = setup();
    assert.throws(
      () => withWriteTransaction(db, () => {
        reserve(db);
        appendAudit(db, { ...entry(1), payload: { amount: 1.5 } });
      }),
      AuditError,
    );
    assert.equal(count(db, 'budget_reservations'), 0);
    assert.equal(count(db, 'audit_log'), 0);
  });

  it('blocks the commit even if the caller swallows the audit error', () => {
    const db = setup();
    assert.throws(
      () => withWriteTransaction(db, () => {
        reserve(db);
        try {
          appendAudit(db, { ...entry(1), payload: { oops: undefined } });
        } catch {
          // a careless caller ignores the failure and carries on
        }
        return 'carried on';
      }),
      (e) => e instanceof DatabaseError && e.cause instanceof AuditError,
    );
    assert.equal(count(db, 'budget_reservations'), 0);
    assert.equal(count(db, 'audit_log'), 0);
    assert.equal(db.isTransaction, false);
  });

  it('blocks the commit when the audit table itself fails', () => {
    const db = setup();
    db.exec('DROP TABLE audit_log');
    assert.throws(
      () => withWriteTransaction(db, () => {
        reserve(db);
        try {
          auditReservation(db);
        } catch {
          // swallowed
        }
      }),
      (e) => e instanceof DatabaseError && /no such table/i.test(e.cause.message),
    );
    assert.equal(count(db, 'budget_reservations'), 0);
  });
});

describeBackends('audit verification', (ctx) => {
  describe('deletion', () => {
    it('detects a deleted middle entry', () => {
      const { db } = tamperable(ctx);
      db.exec('DELETE FROM audit_log WHERE seq = 3');
      const result = verifyChain(db);
      assert.equal(result.valid, false);
      assert.deepEqual(codes(result), ['SEQUENCE_GAP', 'PREV_HASH_MISMATCH']);
      assert.deepEqual(result.problems.map((p) => p.seq), [4, 4]);
    });

    it('detects a deleted first entry', () => {
      const { db } = tamperable(ctx);
      db.exec('DELETE FROM audit_log WHERE seq = 1');
      const result = verifyChain(db);
      assert.equal(result.valid, false);
      assert.deepEqual(codes(result), ['SEQUENCE_GAP', 'PREV_HASH_MISMATCH']);
      assert.deepEqual(result.problems.map((p) => p.seq), [2, 2]);
    });

    it('detects removed tail entries only with an external head', () => {
      const { db, head } = tamperable(ctx);
      db.exec('DELETE FROM audit_log WHERE seq = 5');
      assert.equal(verifyChain(db).valid, true); // the chain alone cannot see it
      const anchored = verifyChain(db, { expectedHead: head });
      assert.equal(anchored.valid, false);
      assert.deepEqual(codes(anchored), ['HEAD_MISMATCH']);
    });

    it('detects a wiped log only with an external head', () => {
      const { db, head } = tamperable(ctx);
      db.exec('DELETE FROM audit_log');
      const alone = verifyChain(db);
      assert.equal(alone.valid, true);
      assert.equal(alone.entries, 0);
      assert.deepEqual(codes(verifyChain(db, { expectedHead: head })), ['HEAD_MISMATCH']);
    });
  });

  describe('modification', () => {
    const fields = [
      ['payload', `payload = '{"tampered":1}'`],
      ['actor', `actor = 'evil'`],
      ['event', `event = 'EVIL_EVENT'`],
      ['entity id', `entity_id = 'e-evil'`],
      ['entity id removed', 'entity_id = NULL'],
      ['timestamp', `ts = '2026-11-05T00:00:00.000Z'`],
    ];
    for (const [name, assignment] of fields) {
      it(`detects a modified ${name}`, () => {
        const { db } = tamperable(ctx);
        db.exec(`UPDATE audit_log SET ${assignment} WHERE seq = 3`);
        const result = verifyChain(db);
        assert.equal(result.valid, false);
        assert.deepEqual(codes(result), ['HASH_MISMATCH']);
        assert.equal(result.problems[0].seq, 3);
      });
    }

    it('detects a replaced hash and the broken link after it', () => {
      const { db } = tamperable(ctx);
      db.exec(`UPDATE audit_log SET hash = '${FAKE}' WHERE seq = 3`);
      const result = verifyChain(db);
      assert.deepEqual(codes(result), ['HASH_MISMATCH', 'PREV_HASH_MISMATCH']);
      assert.deepEqual(result.problems.map((p) => p.seq), [3, 4]);
    });

    it('detects a modified previous-hash link', () => {
      const { db } = tamperable(ctx);
      db.exec(`UPDATE audit_log SET prev_hash = '${FAKE}' WHERE seq = 3`);
      const result = verifyChain(db);
      assert.deepEqual(codes(result), ['PREV_HASH_MISMATCH', 'HASH_MISMATCH']);
      assert.deepEqual(result.problems.map((p) => p.seq), [3, 3]);
    });

    it('detects a renumbered entry', () => {
      const { db } = tamperable(ctx);
      db.exec('UPDATE audit_log SET seq = 9 WHERE seq = 5');
      const result = verifyChain(db);
      assert.deepEqual(codes(result), ['SEQUENCE_GAP', 'HASH_MISMATCH']);
      assert.deepEqual(result.problems.map((p) => p.seq), [9, 9]);
    });
  });

  describe('insertion', () => {
    const forged = (over) => ({
      seq: 6,
      ts: T,
      actor: 'evil',
      event: 'FORGED',
      entity_id: null,
      payload: '{}',
      prev_hash: FAKE,
      hash: 'e'.repeat(64),
      ...over,
    });

    it('detects a forged entry appended at the end', () => {
      const { db, head } = tamperable(ctx);
      insertRow(db, 'audit_log', forged({ prev_hash: head.hash }));
      const result = verifyChain(db);
      assert.equal(result.valid, false);
      assert.deepEqual(codes(result), ['HASH_MISMATCH']);
      assert.equal(result.problems[0].seq, 6);
    });

    it('detects a forged entry with a sequence jump', () => {
      const { db, head } = tamperable(ctx);
      insertRow(db, 'audit_log', forged({ seq: 9, prev_hash: head.hash }));
      const result = verifyChain(db);
      assert.equal(result.valid, false);
      assert.ok(codes(result).includes('SEQUENCE_GAP'));
      assert.ok(codes(result).includes('HASH_MISMATCH'));
    });

    it('detects an entry inserted in the middle by renumbering', () => {
      const { db } = tamperable(ctx);
      const h2 = rowsOf(db)[1].hash;
      for (const seq of [5, 4, 3]) {
        db.prepare('UPDATE audit_log SET seq = seq + 1 WHERE seq = ?').run(seq);
      }
      insertRow(db, 'audit_log', forged({ seq: 3, prev_hash: h2 }));
      const result = verifyChain(db);
      assert.equal(result.valid, false);
      assert.deepEqual(seqsOf(result, 'HASH_MISMATCH'), [3, 4, 5, 6]);
      assert.ok(codes(result).includes('PREV_HASH_MISMATCH'));
    });
  });

  describe('reordering', () => {
    function swapSeq(db, a, b) {
      db.prepare('UPDATE audit_log SET seq = 100 WHERE seq = ?').run(a);
      db.prepare('UPDATE audit_log SET seq = ? WHERE seq = ?').run(a, b);
      db.prepare('UPDATE audit_log SET seq = ? WHERE seq = 100').run(b);
    }

    it('detects two swapped middle entries', () => {
      const { db } = tamperable(ctx);
      swapSeq(db, 2, 3);
      const result = verifyChain(db);
      assert.equal(result.valid, false);
      assert.deepEqual(seqsOf(result, 'PREV_HASH_MISMATCH'), [2, 3, 4]);
      assert.deepEqual(seqsOf(result, 'HASH_MISMATCH'), [2, 3]);
    });

    it('detects two swapped final entries', () => {
      const { db } = tamperable(ctx);
      swapSeq(db, 4, 5);
      const result = verifyChain(db);
      assert.equal(result.valid, false);
      assert.ok(codes(result).includes('PREV_HASH_MISMATCH'));
      assert.ok(codes(result).includes('HASH_MISMATCH'));
    });
  });

  describe('rebuild by someone with write access', () => {
    it('is detected only with an external head', () => {
      const { db, head } = tamperable(ctx);
      const rows = rowsOf(db);
      const update = db.prepare(
        'UPDATE audit_log SET payload = ?, prev_hash = ?, hash = ? WHERE seq = ?',
      );
      let prev = rows[1].hash;
      for (const row of rows.slice(2)) {
        const payload = row.seq === 3 ? '{"tampered":1}' : row.payload;
        const hash = computeEntryHash({
          seq: row.seq,
          ts: row.ts,
          actor: row.actor,
          event: row.event,
          entityId: row.entity_id,
          payloadText: payload,
          prevHash: prev,
        });
        update.run(payload, prev, hash, row.seq);
        prev = hash;
      }
      assert.equal(verifyChain(db).valid, true); // a perfect rebuild looks valid
      const anchored = verifyChain(db, { expectedHead: head });
      assert.equal(anchored.valid, false);
      assert.deepEqual(codes(anchored), ['HEAD_MISMATCH']);
      assert.equal(anchored.headSeq, 5);
    });
  });

  describe('options and reporting', () => {
    it('rejects an invalid expected head', () => {
      const db = ctx.open();
      const bad = [
        null, 'text', 5, {}, { seq: -1, hash: GENESIS_HASH }, { seq: 1.5, hash: GENESIS_HASH },
        { seq: 1, hash: 'short' }, { seq: 1, hash: 'F'.repeat(64) }, { seq: 1 },
      ];
      for (const expectedHead of bad) {
        assert.throws(() => verifyChain(db, { expectedHead }), TypeError, JSON.stringify(expectedHead));
      }
    });

    it('accepts the genesis head for an empty log', () => {
      const db = ctx.open();
      const result = verifyChain(db, { expectedHead: { seq: 0, hash: GENESIS_HASH } });
      assert.equal(result.valid, true);
    });

    it('does not modify the database while verifying', () => {
      const { db } = tamperable(ctx);
      const before = JSON.stringify(rowsOf(db));
      verifyChain(db);
      verifyChain(db);
      assert.equal(JSON.stringify(rowsOf(db)), before);
    });

    it('caps the number of reported problems', () => {
      const { db } = tamperable(ctx, 60);
      db.exec(`UPDATE audit_log SET payload = '{"tampered":1}'`);
      const result = verifyChain(db);
      assert.equal(result.valid, false);
      assert.equal(result.problems.length, 50);
      assert.equal(result.truncated, true);
      assert.equal(result.entries, 60);
    });
  });
});
