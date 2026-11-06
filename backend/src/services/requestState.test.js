import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { verifyChain } from '../audit/auditChain.js';
import { withWriteTransaction } from '../db/database.js';
import { nearToYocto as N } from '../money/yocto.js';
import {
  RESERVATION_EFFECT as E,
  STATUS,
  canTransition,
  holdsBudget,
  transition,
} from '../policy/lifecycle.js';
import { count, describeBackends, insertRow, requestRow, reservationRow } from '../testing/dbKit.js';
import { budgetAgent, pay, setupAgent } from '../testing/paymentKit.js';
import { NOW, auditEvents, seedAgent, svc } from '../testing/serviceKit.js';
import { ConflictError, NotFoundError } from './errors.js';
import { getReservation, reservedForDay } from './reservations.js';
import {
  DEFAULT_SETTINGS,
  openRequest,
  requireRequestRow,
  resolveSettings,
  transitionRequest,
} from './requestState.js';

const ALL = Object.values(STATUS);
const DAY = '2026-11-04';
let seq = 0;

const status = (db, id) => requireRequestRow(db, id).status;
const run = (db, fn) => withWriteTransaction(db, fn);

function seedRequest(db, agentId, requestStatus, over = {}) {
  seq += 1;
  const id = `rs-${seq}`;
  insertRow(db, 'payment_requests', requestRow({
    id,
    agent_id: agentId,
    idempotency_key: `idem-rs-${seq}`,
    status: requestStatus,
    decision: requestStatus === 'BLOCKED' ? 'BLOCKED' : 'APPROVED',
    ...over,
  }));
  return id;
}

function seedReservation(db, agentId, requestId, reservationStatus = 'ACTIVE') {
  insertRow(db, 'budget_reservations', reservationRow({
    id: `res-${requestId}`,
    request_id: requestId,
    agent_id: agentId,
    status: reservationStatus,
    release_reason: reservationStatus === 'RELEASED' ? 'TEST' : null,
  }));
}

describe('settings', () => {
  it('defaults to 24 hours for approval and 60 minutes for authorization', () => {
    assert.equal(DEFAULT_SETTINGS.approvalWindowMs, 24 * 3600 * 1000);
    assert.equal(DEFAULT_SETTINGS.authorizationWindowMs, 60 * 60 * 1000);
    assert.ok(Object.isFrozen(DEFAULT_SETTINGS));
    assert.equal(resolveSettings(undefined), DEFAULT_SETTINGS);
  });

  it('accepts partial overrides', () => {
    const r = resolveSettings({ authorizationWindowMs: 600000 });
    assert.equal(r.authorizationWindowMs, 600000);
    assert.equal(r.approvalWindowMs, DEFAULT_SETTINGS.approvalWindowMs);
    assert.ok(Object.isFrozen(r));
    assert.deepEqual({ ...resolveSettings({}) }, { ...DEFAULT_SETTINGS });
  });

  it('rejects invalid settings', () => {
    const bad = [
      null, 'x', 5, [], { unknown: 1 }, { approvalWindowMs: 0 }, { approvalWindowMs: 999 },
      { authorizationWindowMs: 1.5 }, { authorizationWindowMs: '60' },
      { authorizationWindowMs: 2592000001 }, { authorizationWindowMs: -1 },
    ];
    bad.forEach((settings, i) => {
      assert.throws(() => resolveSettings(settings), TypeError, `settings #${i}`);
    });
  });
});

describeBackends('request state: transitions', (ctx) => {
  it('applies every legal transition and rejects every illegal one', () => {
    const db = ctx.open();
    const { agent } = seedAgent(db);
    for (const from of ALL) {
      for (const to of ALL) {
        const label = `${from} -> ${to}`;
        const id = seedRequest(db, agent.id, from);
        if (holdsBudget(from)) {
          seedReservation(db, agent.id, id, from === STATUS.EXECUTED ? 'CONSUMED' : 'ACTIVE');
        }
        const eventsBefore = auditEvents(db).length;
        const reservationBefore = JSON.stringify(getReservation(db, id) ?? null);

        if (!canTransition(from, to)) {
          assert.throws(
            () => run(db, () => transitionRequest(db, id, to, svc())),
            (e) => e instanceof ConflictError && e.code === 'ILLEGAL_TRANSITION',
            label,
          );
          assert.equal(status(db, id), from, label);
          assert.equal(JSON.stringify(getReservation(db, id) ?? null), reservationBefore, label);
          assert.equal(auditEvents(db).length, eventsBefore, label);
          continue;
        }

        const step = transition(from, to);
        const view = run(db, () => transitionRequest(db, id, to, svc({ now: NOW + 1000 })));
        assert.equal(view.status, to, label);
        assert.equal(view.updatedAt, '2026-11-04T12:00:01.000Z', label);

        const res = getReservation(db, id);
        switch (step.reservation) {
          case E.CREATE:
            assert.equal(res.status, 'ACTIVE', label);
            assert.equal(res.budget_day, DAY, label);
            assert.equal(res.amount, '1', label);
            assert.equal(res.agent_id, agent.id, label);
            break;
          case E.HOLD:
            assert.equal(res.status, 'ACTIVE', label);
            break;
          case E.CONSUME:
            assert.equal(res.status, 'CONSUMED', label);
            break;
          case E.RELEASE:
            assert.equal(res.status, 'RELEASED', label);
            assert.equal(res.release_reason, to, label);
            break;
          case E.NONE:
            assert.equal(res, undefined, label);
            break;
          default:
            assert.fail(`unexpected effect for ${label}`);
        }

        const events = auditEvents(db);
        assert.equal(events.length, eventsBefore + 1, label);
        const last = events.at(-1);
        assert.equal(last.event, `PAYMENT_${to}`, label);
        assert.equal(last.entityId, id, label);
        assert.equal(last.payload.from, from, label);
        assert.equal(last.payload.to, to, label);
        assert.equal(last.payload.reservation, step.reservation, label);
      }
    }
    assert.equal(verifyChain(db).valid, true);
  });

  it('fails for unknown requests and outside a write transaction', () => {
    const db = ctx.open();
    assert.throws(
      () => run(db, () => transitionRequest(db, 'nope', STATUS.APPROVED, svc())),
      NotFoundError,
    );
    assert.throws(
      () => run(db, () => transitionRequest(db, undefined, STATUS.APPROVED, svc())),
      NotFoundError,
    );
    assert.throws(
      () => transitionRequest(db, 'nope', STATUS.APPROVED, svc()),
      /write transaction/i,
    );
    assert.throws(
      () => openRequest(db, {}, svc()),
      /write transaction/i,
    );
  });

  it('rejects unknown target statuses', () => {
    const db = ctx.open();
    const { agent } = seedAgent(db);
    const id = seedRequest(db, agent.id, STATUS.APPROVAL_REQUIRED);
    for (const to of ['DONE', '', undefined, null, 5]) {
      assert.throws(
        () => run(db, () => transitionRequest(db, id, to, svc())),
        (e) => e instanceof ConflictError && e.code === 'ILLEGAL_TRANSITION',
        String(to),
      );
    }
  });

  it('rejects an invalid context', () => {
    const db = ctx.open();
    const { agent } = seedAgent(db);
    const id = seedRequest(db, agent.id, STATUS.APPROVAL_REQUIRED);
    for (const context of [undefined, {}, { now: 1.5, actor: 'o' }, { now: NOW, actor: '' }]) {
      assert.throws(
        () => run(db, () => transitionRequest(db, id, STATUS.APPROVED, context)),
        TypeError,
      );
    }
    assert.equal(status(db, id), STATUS.APPROVAL_REQUIRED);
  });

  it('uses the UTC day of the context time for new reservations', () => {
    const db = ctx.open();
    const { agent } = seedAgent(db);
    const a = seedRequest(db, agent.id, STATUS.APPROVAL_REQUIRED);
    const b = seedRequest(db, agent.id, STATUS.APPROVAL_REQUIRED);
    run(db, () => transitionRequest(db, a, STATUS.APPROVED, svc({ now: Date.UTC(2026, 10, 4, 23, 59, 59, 999) })));
    run(db, () => transitionRequest(db, b, STATUS.APPROVED, svc({ now: Date.UTC(2026, 10, 5, 0, 0, 0, 0) })));
    assert.equal(getReservation(db, a).budget_day, '2026-11-04');
    assert.equal(getReservation(db, b).budget_day, '2026-11-05');
  });

  it('writes the documented audit payloads', () => {
    const db = ctx.open();
    const { agent } = seedAgent(db);
    const id = seedRequest(db, agent.id, STATUS.APPROVAL_REQUIRED, { amount: N('7') });
    run(db, () => transitionRequest(db, id, STATUS.APPROVED, svc({ actor: 'owner' })));
    let last = auditEvents(db).at(-1);
    assert.equal(last.actor, 'owner');
    assert.deepEqual(last.payload, {
      agentId: agent.id,
      amount: N('7'),
      from: 'APPROVAL_REQUIRED',
      to: 'APPROVED',
      reservation: 'CREATE',
      budgetDay: DAY,
    });
    run(db, () => transitionRequest(db, id, STATUS.CANCELLED, svc({ actor: 'owner' })));
    last = auditEvents(db).at(-1);
    assert.deepEqual(last.payload, {
      agentId: agent.id,
      amount: N('7'),
      from: 'APPROVED',
      to: 'CANCELLED',
      reservation: 'RELEASE',
      releaseReason: 'CANCELLED',
    });
  });

  it('applies optional changes', () => {
    const db = ctx.open();
    const { agent } = seedAgent(db);
    const a = seedRequest(db, agent.id, STATUS.APPROVAL_REQUIRED, { decided_at: null, expires_at: null });
    const view = run(db, () =>
      transitionRequest(db, a, STATUS.APPROVED, svc({ now: NOW + 5000 }), {
        markDecided: true,
        expiresAt: '2026-11-04T13:00:00.000Z',
        event: 'PAYMENT_APPROVED_BY_OWNER',
        payload: { approvalId: 'ap-1', amount: '999', from: 'FAKE' },
      }));
    assert.equal(view.decidedAt, '2026-11-04T12:00:05.000Z');
    assert.equal(view.expiresAt, '2026-11-04T13:00:00.000Z');
    const last = auditEvents(db).at(-1);
    assert.equal(last.event, 'PAYMENT_APPROVED_BY_OWNER');
    assert.equal(last.payload.approvalId, 'ap-1');
    assert.equal(last.payload.amount, '1'); // core fields cannot be overridden
    assert.equal(last.payload.from, 'APPROVAL_REQUIRED');

    const b = seedRequest(db, agent.id, STATUS.APPROVAL_REQUIRED);
    const blocked = run(db, () =>
      transitionRequest(db, b, STATUS.BLOCKED, svc(), {
        reasonCodes: ['EXCEEDS_DAILY_BUDGET'],
        expiresAt: null,
      }));
    assert.deepEqual(blocked.reasonCodes, ['EXCEEDS_DAILY_BUDGET']);
    assert.equal(blocked.expiresAt, null);

    const c = seedRequest(db, agent.id, STATUS.APPROVED);
    seedReservation(db, agent.id, c);
    run(db, () => transitionRequest(db, c, STATUS.EXPIRED, svc(), { releaseReason: 'APPROVAL_WINDOW_ELAPSED' }));
    assert.equal(getReservation(db, c).release_reason, 'APPROVAL_WINDOW_ELAPSED');
  });

  it('leaves decided_at, expires_at and reasons alone by default', () => {
    const db = ctx.open();
    const { agent } = seedAgent(db);
    const id = seedRequest(db, agent.id, STATUS.APPROVAL_REQUIRED, { decided_at: null });
    const before = requireRequestRow(db, id);
    const view = run(db, () => transitionRequest(db, id, STATUS.REJECTED, svc({ now: NOW + 1000 })));
    assert.equal(view.decidedAt, null);
    assert.equal(view.expiresAt, before.expires_at);
    assert.deepEqual(view.reasonCodes, JSON.parse(before.reason_codes));
  });

  it('rejects invalid options before changing anything', () => {
    const db = ctx.open();
    const { agent } = seedAgent(db);
    const id = seedRequest(db, agent.id, STATUS.APPROVAL_REQUIRED);
    const bad = [
      null, 'x', 5, [], { unknown: 1 }, { expiresAt: 'tomorrow' }, { expiresAt: 5 },
      { reasonCodes: [] }, { reasonCodes: 'X' }, { reasonCodes: ['bad code'] }, { reasonCodes: [5] },
      { markDecided: 'yes' }, { event: '' }, { event: 5 }, { event: 'e'.repeat(65) },
      { payload: [] }, { payload: 'x' }, { payload: null }, { releaseReason: '' }, { releaseReason: 5 },
    ];
    bad.forEach((options, i) => {
      assert.throws(
        () => run(db, () => transitionRequest(db, id, STATUS.APPROVED, svc(), options)),
        TypeError,
        `options #${i}`,
      );
    });
    assert.equal(status(db, id), STATUS.APPROVAL_REQUIRED);
    assert.equal(getReservation(db, id), undefined);
  });

  it('keeps the audit chain valid after many transitions', () => {
    const db = ctx.open();
    const { agent } = seedAgent(db);
    const id = seedRequest(db, agent.id, STATUS.APPROVAL_REQUIRED);
    run(db, () => transitionRequest(db, id, STATUS.APPROVED, svc()));
    run(db, () => transitionRequest(db, id, STATUS.SUBMITTED, svc()));
    run(db, () => transitionRequest(db, id, STATUS.EXECUTED, svc()));
    const result = verifyChain(db);
    assert.equal(result.valid, true);
    assert.equal(result.entries, 4);
  });
});

describeBackends('request state: atomicity', (ctx) => {
  it('rolls the status, reservation and audit back when the audit append fails', () => {
    const db = ctx.open();
    const { agent } = seedAgent(db);
    const id = seedRequest(db, agent.id, STATUS.APPROVAL_REQUIRED);
    db.exec('DROP TABLE audit_log');
    assert.throws(
      () => run(db, () => transitionRequest(db, id, STATUS.APPROVED, svc())),
      /no such table/i,
    );
    assert.equal(status(db, id), STATUS.APPROVAL_REQUIRED);
    assert.equal(getReservation(db, id), undefined);
    assert.equal(count(db, 'budget_reservations'), 0);
    assert.equal(db.isTransaction, false);
  });

  it('rolls everything back when the caller fails after the transition', () => {
    const db = ctx.open();
    const { agent } = seedAgent(db);
    const id = seedRequest(db, agent.id, STATUS.APPROVAL_REQUIRED);
    const eventsBefore = auditEvents(db).length;
    assert.throws(
      () => run(db, () => {
        transitionRequest(db, id, STATUS.APPROVED, svc());
        throw new Error('later step failed');
      }),
      /later step failed/,
    );
    assert.equal(status(db, id), STATUS.APPROVAL_REQUIRED);
    assert.equal(getReservation(db, id), undefined);
    assert.equal(auditEvents(db).length, eventsBefore);
  });
});

describeBackends('request state: budget effects', (ctx) => {
  const step = (db, id, to, now = NOW) =>
    run(db, () => transitionRequest(db, id, to, svc({ now, actor: 'system' })));

  function setup() {
    const db = ctx.open();
    const agentId = setupAgent(db, budgetAgent());
    return { db, agentId };
  }

  it('a cancelled authorization frees its budget', () => {
    const { db, agentId } = setup();
    const ids = [];
    for (let i = 0; i < 5; i += 1) {
      const { request } = pay(db, agentId, { amount: N('20') });
      assert.equal(request.status, 'APPROVED');
      ids.push(request.id);
    }
    assert.equal(reservedForDay(db, agentId, DAY), N('100'));
    assert.equal(pay(db, agentId, { amount: N('1') }).request.status, 'BLOCKED');
    step(db, ids[0], STATUS.CANCELLED);
    assert.equal(reservedForDay(db, agentId, DAY), N('80'));
    assert.equal(getReservation(db, ids[0]).release_reason, 'CANCELLED');
    assert.equal(pay(db, agentId, { amount: N('20') }).request.status, 'APPROVED');
    assert.equal(reservedForDay(db, agentId, DAY), N('100'));
  });

  it('an executed payment stays counted', () => {
    const { db, agentId } = setup();
    const { request } = pay(db, agentId, { amount: N('20') });
    step(db, request.id, STATUS.SUBMITTED);
    step(db, request.id, STATUS.EXECUTED);
    assert.equal(getReservation(db, request.id).status, 'CONSUMED');
    assert.equal(reservedForDay(db, agentId, DAY), N('20'));
  });

  it('a failed payment releases its budget', () => {
    const { db, agentId } = setup();
    const { request } = pay(db, agentId, { amount: N('20') });
    step(db, request.id, STATUS.SUBMITTED);
    assert.equal(reservedForDay(db, agentId, DAY), N('20'));
    step(db, request.id, STATUS.FAILED);
    assert.equal(getReservation(db, request.id).status, 'RELEASED');
    assert.equal(getReservation(db, request.id).release_reason, 'FAILED');
    assert.equal(reservedForDay(db, agentId, DAY), '0');
  });

  it('a mismatched payment keeps its budget held', () => {
    const { db, agentId } = setup();
    const { request } = pay(db, agentId, { amount: N('20') });
    step(db, request.id, STATUS.SUBMITTED);
    step(db, request.id, STATUS.MISMATCH);
    assert.equal(getReservation(db, request.id).status, 'ACTIVE');
    assert.equal(reservedForDay(db, agentId, DAY), N('20'));
  });

  it('an expired authorization releases its budget', () => {
    const { db, agentId } = setup();
    const { request } = pay(db, agentId, { amount: N('20') });
    step(db, request.id, STATUS.EXPIRED);
    assert.equal(getReservation(db, request.id).release_reason, 'EXPIRED');
    assert.equal(reservedForDay(db, agentId, DAY), '0');
  });

  it('a reservation keeps the day it was made on, even when executed later', () => {
    const { db, agentId } = setup();
    const lateDay4 = Date.UTC(2026, 10, 4, 23, 59, 59, 999);
    const earlyDay5 = Date.UTC(2026, 10, 5, 0, 0, 0, 0);
    const { request } = pay(db, agentId, { amount: N('20') }, lateDay4);
    step(db, request.id, STATUS.SUBMITTED, earlyDay5);
    step(db, request.id, STATUS.EXECUTED, earlyDay5);
    assert.equal(reservedForDay(db, agentId, '2026-11-04'), N('20'));
    assert.equal(reservedForDay(db, agentId, '2026-11-05'), '0');
  });
});

describe('request state: only requestState.js changes payments and reservations', () => {
  const dir = new URL('./', import.meta.url);
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'));
  const allowed = ['requestState.js', 'reservations.js'];

  it('scans the service files', () => {
    for (const expected of ['agents.js', 'payments.js', 'requestState.js', 'reservations.js']) {
      assert.ok(files.includes(expected), expected);
    }
  });

  it('keeps reservation changes inside requestState.js', () => {
    for (const file of files.filter((f) => !allowed.includes(f))) {
      const source = fs.readFileSync(new URL(file, dir), 'utf8');
      for (const call of ['createReservation(', 'consumeReservation(', 'releaseReservation(']) {
        assert.ok(!source.includes(call), `${file} calls ${call}`);
      }
      assert.ok(!source.includes('budget_reservations'), `${file} touches budget_reservations`);
    }
  });

  it('keeps payment request writes inside requestState.js', () => {
    for (const file of files.filter((f) => f !== 'requestState.js')) {
      const source = fs.readFileSync(new URL(file, dir), 'utf8');
      assert.ok(!source.includes('UPDATE payment_requests'), `${file} updates payment_requests`);
      assert.ok(!source.includes('INSERT INTO payment_requests'), `${file} inserts into payment_requests`);
      assert.ok(!source.includes('DELETE FROM payment_requests'), `${file} deletes from payment_requests`);
    }
  });
});
