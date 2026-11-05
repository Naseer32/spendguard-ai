import { it } from 'node:test';
import assert from 'node:assert/strict';
import { STATUS } from '../policy/lifecycle.js';
import { DECISION } from '../policy/reasonCodes.js';
import {
  T,
  agentRow,
  count,
  describeBackends,
  insertRow,
  requestRow,
  reservationRow,
} from '../testing/dbKit.js';
import { getUserVersion } from './database.js';
import { LATEST_VERSION } from './schema.js';

const FAILS = /constraint failed/i;
const TX_HASH = 'FHk3J8cVqwZ2bX9mYtP7nRaLdE4sUoQxWgCvB6iKj1Hy';
const ZERO_HASH = '0'.repeat(64);

const auditRow = (over = {}) => ({
  seq: 1,
  ts: T,
  actor: 'system',
  event: 'TEST_EVENT',
  entity_id: 'e1',
  payload: '{}',
  prev_hash: ZERO_HASH,
  hash: 'a'.repeat(64),
  ...over,
});

const txRow = (over = {}) => ({
  id: 'tx-1',
  request_id: 'req-1',
  near_tx_hash: TX_HASH,
  signer_account_id: 'owner.testnet',
  verification_status: 'PENDING',
  verification_detail: null,
  block_height: null,
  block_timestamp_ns: null,
  submitted_at: T,
  verified_at: null,
  ...over,
});

const VALID_AMOUNTS = ['0', '1', '100', '9007199254740993', '9'.repeat(40)];
const INVALID_AMOUNTS = [
  '', '-1', '1.5', '01', '00', 'abc', '1e5', ' 1', '1 ', '+1', '0x1',
  '1'.repeat(41), '\u0661\u0662',
];

describeBackends('schema', (ctx) => {
  function withAgent() {
    const db = ctx.open();
    insertRow(db, 'agents', agentRow());
    return db;
  }

  function withRequest() {
    const db = withAgent();
    insertRow(db, 'payment_requests', requestRow());
    return db;
  }

  it('creates all tables and the audit triggers', () => {
    const db = ctx.open();
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all()
      .map((r) => r.name);
    assert.deepEqual(tables, [
      'agents', 'approvals', 'audit_log', 'budget_reservations',
      'payment_requests', 'recipients', 'transactions',
    ]);
    const triggers = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name")
      .all()
      .map((r) => r.name);
    assert.deepEqual(triggers, ['audit_log_no_delete', 'audit_log_no_update']);
  });

  it('is at the latest schema version with foreign keys on', () => {
    const db = ctx.open();
    assert.equal(getUserVersion(db), LATEST_VERSION);
    const fk = Object.values(db.prepare('PRAGMA foreign_keys').get())[0];
    assert.equal(fk, 1);
  });

  it('accepts canonical yoctoNEAR amounts', () => {
    const db = ctx.open();
    VALID_AMOUNTS.forEach((v, i) => {
      insertRow(db, 'agents', agentRow({
        id: `a-${i}`, daily_budget: v, per_tx_limit: v, approval_threshold: v,
      }));
    });
    assert.equal(count(db, 'agents'), VALID_AMOUNTS.length);
  });

  it('rejects malformed amounts in every agent amount column', () => {
    const db = ctx.open();
    for (const column of ['daily_budget', 'per_tx_limit', 'approval_threshold']) {
      for (const bad of INVALID_AMOUNTS) {
        assert.throws(
          () => insertRow(db, 'agents', agentRow({ [column]: bad })),
          FAILS,
          `${column}=${JSON.stringify(bad)}`,
        );
      }
    }
    assert.equal(count(db, 'agents'), 0);
  });

  it('compares threshold and limit numerically, not as text', () => {
    const db = ctx.open();
    insertRow(db, 'agents', agentRow({ id: 'a1', per_tx_limit: '20', approval_threshold: '20' }));
    insertRow(db, 'agents', agentRow({ id: 'a2', per_tx_limit: '10', approval_threshold: '9' }));
    assert.throws(
      () => insertRow(db, 'agents', agentRow({ id: 'a3', per_tx_limit: '20', approval_threshold: '21' })),
      FAILS,
    );
    assert.throws(
      () => insertRow(db, 'agents', agentRow({ id: 'a4', per_tx_limit: '9', approval_threshold: '10' })),
      FAILS,
    );
  });

  it('validates other agent fields', () => {
    const db = ctx.open();
    const bad = [
      { status: 'ROGUE' }, { name: '' }, { source_account: 'a' },
      { api_key_hash: 'short' }, { api_key_hash: 'B'.repeat(64) },
      { created_at: '2026-11-04' }, { updated_at: 'yesterday' },
    ];
    for (const over of bad) {
      assert.throws(() => insertRow(db, 'agents', agentRow(over)), FAILS, JSON.stringify(over));
    }
  });

  it('rejects an agent with a missing required column', () => {
    const db = ctx.open();
    const row = agentRow();
    delete row.name;
    assert.throws(() => insertRow(db, 'agents', row), /NOT NULL constraint failed/i);
  });

  it('enforces recipient rules', () => {
    const db = withAgent();
    insertRow(db, 'recipients', {
      id: 'r1', agent_id: 'agent-1', account_id: 'shop.testnet',
      list_type: 'ALLOW', note: null, created_at: T,
    });
    const dup = {
      id: 'r2', agent_id: 'agent-1', account_id: 'shop.testnet',
      list_type: 'BLOCK', note: null, created_at: T,
    };
    assert.throws(() => insertRow(db, 'recipients', dup), FAILS); // one list per recipient
    assert.throws(
      () => insertRow(db, 'recipients', { ...dup, id: 'r3', account_id: 'x.testnet', list_type: 'MAYBE' }),
      FAILS,
    );
    assert.throws(
      () => insertRow(db, 'recipients', { ...dup, id: 'r4', account_id: 'y.testnet', agent_id: 'ghost' }),
      /FOREIGN KEY constraint failed/i,
    );
  });

  it('accepts every lifecycle status and decision', () => {
    const db = withAgent();
    Object.values(STATUS).forEach((status, i) => {
      insertRow(db, 'payment_requests', requestRow({
        id: `r-${i}`, idempotency_key: `idem-key-s${i}`,
        decision: DECISION.APPROVAL_REQUIRED, status,
      }));
    });
    Object.values(DECISION).forEach((decision, i) => {
      insertRow(db, 'payment_requests', requestRow({
        id: `d-${i}`, idempotency_key: `idem-key-d${i}`, decision, status: decision,
      }));
    });
    assert.equal(count(db, 'payment_requests'), Object.values(STATUS).length + 3);
  });

  it('rejects invalid request values', () => {
    const db = withAgent();
    const bad = [
      { status: 'PENDING' }, { decision: 'MAYBE' },
      { decision: 'BLOCKED', status: 'APPROVED' }, // a blocked decision stays blocked
      { amount: 'abc' }, { amount: '-5' }, { amount: '1.5' },
      { idempotency_key: 'short' }, { request_hash: 'abc' },
      { reason_codes: '{' }, { policy_snapshot: 'nope' },
      { created_at: 'x' }, { expires_at: 'x' },
      { recipient: '' }, { purpose: 'x'.repeat(501) },
    ];
    bad.forEach((over, i) => {
      assert.throws(
        () => insertRow(db, 'payment_requests', requestRow({ id: `b-${i}`, idempotency_key: `idem-bad-${i}`, ...over })),
        FAILS,
        JSON.stringify(over),
      );
    });
    assert.equal(count(db, 'payment_requests'), 0);
  });

  it('allows a zero amount (the policy engine blocks it)', () => {
    const db = withAgent();
    insertRow(db, 'payment_requests', requestRow({ amount: '0', decision: 'BLOCKED', status: 'BLOCKED' }));
    assert.equal(count(db, 'payment_requests'), 1);
  });

  it('scopes idempotency keys per agent', () => {
    const db = withAgent();
    insertRow(db, 'agents', agentRow({ id: 'agent-2' }));
    insertRow(db, 'payment_requests', requestRow());
    assert.throws(
      () => insertRow(db, 'payment_requests', requestRow({ id: 'req-2' })),
      /UNIQUE constraint failed/i,
    );
    insertRow(db, 'payment_requests', requestRow({ id: 'req-3', agent_id: 'agent-2' }));
    assert.equal(count(db, 'payment_requests'), 2);
  });

  it('protects parent rows with foreign keys', () => {
    const db = withRequest();
    assert.throws(
      () => insertRow(db, 'payment_requests', requestRow({ id: 'r2', idempotency_key: 'idem-key-2', agent_id: 'ghost' })),
      /FOREIGN KEY constraint failed/i,
    );
    assert.throws(
      () => db.prepare('DELETE FROM agents WHERE id = ?').run('agent-1'),
      /FOREIGN KEY constraint failed/i,
    );
  });

  it('enforces reservation rules', () => {
    const db = withRequest();
    insertRow(db, 'budget_reservations', reservationRow());
    assert.throws(
      () => insertRow(db, 'budget_reservations', reservationRow({ id: 'res-2' })),
      /UNIQUE constraint failed/i, // one reservation per request
    );
    insertRow(db, 'payment_requests', requestRow({ id: 'req-2', idempotency_key: 'idem-key-2' }));
    const bad = [
      { status: 'RELEASED', release_reason: null }, // released needs a reason
      { status: 'ACTIVE', release_reason: 'EXPIRED' }, // reason only when released
      { status: 'PENDING' }, { amount: 'x' }, { amount: '-1' },
      { budget_day: '2026-11-4' }, { budget_day: 'today' },
    ];
    for (const over of bad) {
      assert.throws(
        () => insertRow(db, 'budget_reservations', reservationRow({ id: 'res-x', request_id: 'req-2', ...over })),
        FAILS,
        JSON.stringify(over),
      );
    }
    insertRow(db, 'budget_reservations', reservationRow({
      id: 'res-3', request_id: 'req-2', status: 'RELEASED', release_reason: 'EXPIRED',
    }));
    assert.equal(count(db, 'budget_reservations'), 2);
  });

  it('allows one approval per request', () => {
    const db = withRequest();
    const row = {
      id: 'ap-1', request_id: 'req-1', decision: 'APPROVE', decided_by: 'owner',
      comment: null, recheck_result: '{}', decided_at: T,
    };
    insertRow(db, 'approvals', row);
    assert.throws(() => insertRow(db, 'approvals', { ...row, id: 'ap-2' }), /UNIQUE constraint failed/i);
    assert.throws(
      () => insertRow(db, 'approvals', { ...row, id: 'ap-3', request_id: 'x' }),
      /FOREIGN KEY constraint failed/i,
    );
  });

  it('rejects invalid approvals', () => {
    const db = withRequest();
    const row = {
      id: 'ap-1', request_id: 'req-1', decision: 'APPROVE', decided_by: 'owner',
      comment: null, recheck_result: '{}', decided_at: T,
    };
    for (const over of [{ decision: 'MAYBE' }, { decided_by: '' }, { recheck_result: 'nope' }, { decided_at: 'x' }]) {
      assert.throws(() => insertRow(db, 'approvals', { ...row, ...over }), FAILS, JSON.stringify(over));
    }
  });

  it('enforces transaction rules', () => {
    const db = withRequest();
    insertRow(db, 'payment_requests', requestRow({ id: 'req-2', idempotency_key: 'idem-key-2' }));
    insertRow(db, 'transactions', txRow());
    assert.throws(
      () => insertRow(db, 'transactions', txRow({ id: 'tx-2', request_id: 'req-2' })),
      /UNIQUE constraint failed/i, // one tx hash can back only one request
    );
    assert.throws(
      () => insertRow(db, 'transactions', txRow({ id: 'tx-3', near_tx_hash: 'B'.repeat(44) })),
      /UNIQUE constraint failed/i, // one tx per request
    );
    const bad = [
      { near_tx_hash: 'short' },
      { near_tx_hash: '0' + TX_HASH.slice(1) },
      { near_tx_hash: 'O' + TX_HASH.slice(1) },
      { near_tx_hash: 'I' + TX_HASH.slice(1) },
      { near_tx_hash: 'l' + TX_HASH.slice(1) },
      { verification_status: 'DONE' },
      { verification_status: 'PENDING', verified_at: T }, // pending has no verification time
      { verification_status: 'VERIFIED', verified_at: null }, // verified needs one
      { verification_detail: '{' }, { block_height: -1 },
      { block_timestamp_ns: '12x' }, { signer_account_id: 'a' },
    ];
    bad.forEach((over, i) => {
      assert.throws(
        () => insertRow(db, 'transactions', txRow({ id: `tx-b${i}`, request_id: 'req-2', near_tx_hash: `${i + 2}`.repeat(44), ...over })),
        FAILS,
        JSON.stringify(over),
      );
    });
    insertRow(db, 'transactions', txRow({
      id: 'tx-ok', request_id: 'req-2', near_tx_hash: 'C'.repeat(44),
      verification_status: 'VERIFIED', verified_at: T,
      block_height: 123456789, block_timestamp_ns: '1762257600000000000',
      verification_detail: '{"ok":true}',
    }));
    assert.equal(count(db, 'transactions'), 2);
  });

  it('validates audit_log rows', () => {
    const db = ctx.open();
    insertRow(db, 'audit_log', auditRow());
    const bad = [
      { seq: 0, hash: 'c'.repeat(64) }, { seq: 2, hash: 'XYZ' },
      { seq: 2, hash: 'D'.repeat(64) }, { seq: 2, hash: 'c'.repeat(64), prev_hash: 'short' },
      { seq: 2, hash: 'c'.repeat(64), ts: 'now' },
      { seq: 2, hash: 'c'.repeat(64), payload: '{' },
      { seq: 2, hash: 'c'.repeat(64), actor: '' },
      { seq: 1, hash: 'c'.repeat(64) }, // duplicate seq
      { seq: 2, hash: 'a'.repeat(64) }, // duplicate hash
    ];
    for (const over of bad) {
      assert.throws(() => insertRow(db, 'audit_log', auditRow(over)), FAILS, JSON.stringify(over));
    }
    assert.equal(count(db, 'audit_log'), 1);
  });

  it('makes audit_log append-only through triggers', () => {
    const db = ctx.open();
    insertRow(db, 'audit_log', auditRow());
    assert.throws(
      () => db.prepare("UPDATE audit_log SET actor = 'evil' WHERE seq = 1").run(),
      /append-only/,
    );
    assert.throws(() => db.prepare('DELETE FROM audit_log WHERE seq = 1').run(), /append-only/);
    assert.equal(count(db, 'audit_log'), 1);
  });
});
