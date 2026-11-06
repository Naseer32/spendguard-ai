import { it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { verifyChain } from '../audit/auditChain.js';
import { withWriteTransaction } from '../db/database.js';
import { nearToYocto as N } from '../money/yocto.js';
import { count, describeBackends } from '../testing/dbKit.js';
import { budgetAgent, pay, setupAgent } from '../testing/paymentKit.js';
import { NOW, auditEvents, svc } from '../testing/serviceKit.js';
import { pauseAgent, updateLimits } from './agents.js';
import {
  approveRequest,
  cancelRequest,
  expireDueRequests,
  getApprovalForRequest,
  rejectRequest,
} from './approvals.js';
import { ConflictError, NotFoundError, ValidationError } from './errors.js';
import { getPaymentRequest } from './payments.js';
import { evaluateCurrentPolicy } from './policyContext.js';
import { setRecipient } from './recipients.js';
import { transitionRequest } from './requestState.js';
import { getReservation, reservedForDay } from './reservations.js';

const DAY = '2026-11-04';
const H = 3600000;
const APPROVAL_KEYS = ['comment', 'decidedAt', 'decidedBy', 'decision', 'id', 'recheckResult', 'requestId'];
const RESULT_KEYS = ['approval', 'approved', 'outcome', 'refusalReasons', 'request'];

const owner = (over = {}) => svc({ actor: 'owner', ...over });
const system = (over = {}) => svc({ actor: 'system', ...over });
const lastEvent = (db) => auditEvents(db).at(-1);
const stateOf = (db, id) => getPaymentRequest(db, id).status;
const notPending = (e) => e instanceof ConflictError && e.code === 'NOT_PENDING';

// An unlisted recipient, so the request waits for a human.
const pending = (db, agentId, over = {}, now = NOW) =>
  pay(db, agentId, { recipient: 'other.testnet', ...over }, now).request;

describeBackends('approvals: approving', (ctx) => {
  it('approves a pending request, reserves budget and records the decision', () => {
    const db = ctx.open();
    const agentId = setupAgent(db);
    const request = pending(db, agentId);
    assert.equal(request.status, 'APPROVAL_REQUIRED');

    const result = approveRequest(db, request.id, { comment: '  looks fine  ' }, owner({ now: NOW + 60000 }));
    assert.deepEqual(Object.keys(result).sort(), RESULT_KEYS);
    assert.equal(result.approved, true);
    assert.equal(result.outcome, 'APPROVED');
    assert.deepEqual(result.refusalReasons, []);
    assert.equal(result.request.status, 'APPROVED');
    assert.equal(result.request.decision, 'APPROVAL_REQUIRED'); // the original decision is kept
    assert.deepEqual(result.request.reasonCodes, ['RECIPIENT_NOT_ALLOWLISTED']);
    assert.equal(result.request.decidedAt, '2026-11-04T12:01:00.000Z');
    assert.equal(result.request.expiresAt, '2026-11-04T13:01:00.000Z');
    assert.equal(result.request.updatedAt, '2026-11-04T12:01:00.000Z');

    assert.deepEqual(Object.keys(result.approval).sort(), APPROVAL_KEYS);
    assert.equal(result.approval.requestId, request.id);
    assert.equal(result.approval.decision, 'APPROVE');
    assert.equal(result.approval.decidedBy, 'owner');
    assert.equal(result.approval.comment, 'looks fine');
    assert.equal(result.approval.decidedAt, '2026-11-04T12:01:00.000Z');
    assert.deepEqual(result.approval.recheckResult, {
      decision: 'APPROVAL_REQUIRED',
      reasonCodes: ['RECIPIENT_NOT_ALLOWLISTED'],
      reservedToday: '0',
      remainingBudget: N('100'),
      budgetDay: DAY,
    });
    assert.deepEqual(getApprovalForRequest(db, request.id), result.approval);

    const reservation = getReservation(db, request.id);
    assert.equal(reservation.status, 'ACTIVE');
    assert.equal(reservation.amount, N('1'));
    assert.equal(reservation.budget_day, DAY);
    assert.equal(reservedForDay(db, agentId, DAY), N('1'));

    const event = lastEvent(db);
    assert.equal(event.event, 'PAYMENT_APPROVED');
    assert.equal(event.actor, 'owner');
    assert.equal(event.entityId, request.id);
    assert.deepEqual(event.payload, {
      agentId,
      amount: N('1'),
      from: 'APPROVAL_REQUIRED',
      to: 'APPROVED',
      reservation: 'CREATE',
      budgetDay: DAY,
      approvalId: result.approval.id,
      recheckDecision: 'APPROVAL_REQUIRED',
    });
    assert.ok(!JSON.stringify(auditEvents(db)).includes('looks fine'));
    assert.equal(verifyChain(db).valid, true);
  });

  it('uses the configured authorization window', () => {
    const db = ctx.open();
    const agentId = setupAgent(db);
    const request = pending(db, agentId);
    const result = approveRequest(db, request.id, undefined, owner(), { authorizationWindowMs: 600000 });
    assert.equal(result.request.expiresAt, '2026-11-04T12:10:00.000Z');
  });

  it('reserves against the UTC day of the approval, not of the request', () => {
    const db = ctx.open();
    const agentId = setupAgent(db);
    const request = pending(db, agentId);
    const day5 = Date.UTC(2026, 10, 5, 1, 0, 0, 0); // 13 hours later, inside the 24-hour window
    const result = approveRequest(db, request.id, {}, owner({ now: day5 }));
    assert.equal(result.approved, true);
    assert.equal(getReservation(db, request.id).budget_day, '2026-11-05');
    assert.equal(result.approval.recheckResult.budgetDay, '2026-11-05');
    assert.equal(reservedForDay(db, agentId, DAY), '0');
    assert.equal(reservedForDay(db, agentId, '2026-11-05'), N('1'));
  });

  it('allows approval right up to the expiry instant and refuses at it', () => {
    const db = ctx.open();
    const agentId = setupAgent(db);
    const a = pending(db, agentId);
    const b = pending(db, agentId);
    assert.equal(a.expiresAt, '2026-11-05T12:00:00.000Z');
    const justBefore = Date.UTC(2026, 10, 5, 11, 59, 59, 999);
    const atExpiry = Date.UTC(2026, 10, 5, 12, 0, 0, 0);
    assert.equal(approveRequest(db, a.id, {}, owner({ now: justBefore })).approved, true);

    const late = approveRequest(db, b.id, {}, owner({ now: atExpiry }));
    assert.equal(late.approved, false);
    assert.equal(late.outcome, 'EXPIRED');
    assert.equal(late.request.status, 'EXPIRED');
    assert.equal(late.approval, null);
    assert.equal(getApprovalForRequest(db, b.id), null);
    assert.equal(getReservation(db, b.id), undefined);
    assert.equal(lastEvent(db).event, 'PAYMENT_EXPIRED');
    assert.equal(stateOf(db, b.id), 'EXPIRED');
  });

  it('refuses to approve a request that is not awaiting approval', () => {
    const db = ctx.open();
    const agentId = setupAgent(db);
    const approved = pay(db, agentId).request; // allowlisted: auto-approved
    const blocked = pay(db, agentId, { amount: N('21') }).request;
    const rejected = rejectRequest(db, pending(db, agentId).id, {}, owner()).request;
    const cancelled = cancelRequest(db, pay(db, agentId).request.id, owner());
    const approvedLater = pending(db, agentId);
    approveRequest(db, approvedLater.id, {}, owner());

    for (const request of [approved, blocked, rejected, cancelled, approvedLater]) {
      const before = stateOf(db, request.id);
      assert.throws(() => approveRequest(db, request.id, {}, owner()), notPending, before);
      assert.equal(stateOf(db, request.id), before);
    }
    assert.equal(count(db, 'approvals'), 2); // one rejection, one approval
  });

  it('records only one decision when approved twice', () => {
    const db = ctx.open();
    const agentId = setupAgent(db);
    const request = pending(db, agentId);
    approveRequest(db, request.id, {}, owner());
    assert.throws(() => approveRequest(db, request.id, {}, owner()), notPending);
    assert.equal(count(db, 'approvals'), 1);
    assert.equal(count(db, 'budget_reservations'), 1);
    assert.equal(reservedForDay(db, agentId, DAY), N('1'));
  });

  it('fails for unknown requests', () => {
    const db = ctx.open();
    for (const id of [randomUUID(), 'nope', undefined, null, 5]) {
      assert.throws(() => approveRequest(db, id, {}, owner()), NotFoundError);
    }
  });
});

describeBackends('approvals: the recheck never lets approval override a block', (ctx) => {
  const scenarios = [
    ['the agent was paused', (db, agentId) => pauseAgent(db, agentId, svc()), ['AGENT_PAUSED']],
    [
      'the recipient was blocklisted',
      (db, agentId) => setRecipient(db, agentId, { accountId: 'other.testnet', listType: 'BLOCK' }, svc()),
      ['RECIPIENT_BLOCKED'],
    ],
    [
      'the per-transaction limit was lowered',
      (db, agentId) =>
        updateLimits(db, agentId, { perTxLimit: N('0.5'), approvalThreshold: N('0.5') }, svc()),
      ['EXCEEDS_TX_LIMIT'],
    ],
  ];

  for (const [name, mutate, reasons] of scenarios) {
    it(`blocks the request when ${name}`, () => {
      const db = ctx.open();
      const agentId = setupAgent(db);
      const request = pending(db, agentId);
      mutate(db, agentId);
      const eventsBefore = auditEvents(db).length;

      const result = approveRequest(db, request.id, { comment: 'please' }, owner({ now: NOW + 5000 }));
      assert.equal(result.approved, false);
      assert.equal(result.outcome, 'BLOCKED');
      assert.deepEqual(result.refusalReasons, reasons);
      assert.equal(result.approval, null);
      assert.equal(result.request.status, 'BLOCKED');
      assert.equal(result.request.decision, 'APPROVAL_REQUIRED'); // the original decision is kept
      assert.deepEqual(result.request.reasonCodes, reasons);
      assert.equal(result.request.expiresAt, null);
      assert.equal(result.request.decidedAt, '2026-11-04T12:00:05.000Z');
      assert.equal(count(db, 'approvals'), 0);
      assert.equal(getReservation(db, request.id), undefined);
      assert.equal(reservedForDay(db, agentId, DAY), '0');

      const events = auditEvents(db);
      assert.equal(events.length, eventsBefore + 1);
      assert.equal(events.at(-1).event, 'APPROVAL_REFUSED');
      assert.equal(events.at(-1).actor, 'owner');
      assert.deepEqual(events.at(-1).payload, {
        agentId,
        amount: N('1'),
        from: 'APPROVAL_REQUIRED',
        to: 'BLOCKED',
        reservation: 'NONE',
        reasonCodes: reasons,
      });
      assert.equal(verifyChain(db).valid, true);

      // a blocked request can never be approved afterwards
      assert.throws(() => approveRequest(db, request.id, {}, owner()), notPending);
    });
  }

  it('blocks approval when the daily budget was spent in the meantime', () => {
    const db = ctx.open();
    const agentId = setupAgent(db, { dailyBudget: N('100'), perTxLimit: N('100'), approvalThreshold: N('5') });
    const a = pending(db, agentId, { amount: N('60') });
    const b = pending(db, agentId, { amount: N('41') });
    const c = pending(db, agentId, { amount: N('40') });

    assert.equal(approveRequest(db, a.id, {}, owner()).approved, true);
    assert.equal(reservedForDay(db, agentId, DAY), N('60'));

    const refused = approveRequest(db, b.id, {}, owner());
    assert.equal(refused.approved, false);
    assert.deepEqual(refused.refusalReasons, ['EXCEEDS_DAILY_BUDGET']);
    assert.equal(refused.request.status, 'BLOCKED');
    assert.equal(reservedForDay(db, agentId, DAY), N('60'));

    const exact = approveRequest(db, c.id, {}, owner()); // exactly the remaining 40
    assert.equal(exact.approved, true);
    assert.equal(exact.approval.recheckResult.remainingBudget, N('40'));
    assert.equal(reservedForDay(db, agentId, DAY), N('100'));
  });

  it('counts only the approval day when rechecking the budget', () => {
    const db = ctx.open();
    const agentId = setupAgent(db, { dailyBudget: N('100'), perTxLimit: N('100'), approvalThreshold: N('5') });
    const a = pending(db, agentId, { amount: N('60') });
    const b = pending(db, agentId, { amount: N('60') });
    approveRequest(db, a.id, {}, owner()); // reserves 60 on Nov 4
    const day5 = Date.UTC(2026, 10, 5, 1, 0, 0, 0);
    const result = approveRequest(db, b.id, {}, owner({ now: day5 }));
    assert.equal(result.approved, true); // Nov 5 has its own budget
    assert.equal(result.approval.recheckResult.reservedToday, '0');
  });
});

describeBackends('approvals: rejecting', (ctx) => {
  it('rejects a pending request and records the decision', () => {
    const db = ctx.open();
    const agentId = setupAgent(db);
    const request = pending(db, agentId);
    const result = rejectRequest(db, request.id, { comment: 'not expected' }, owner({ now: NOW + 1000 }));
    assert.deepEqual(Object.keys(result).sort(), ['approval', 'request']);
    assert.equal(result.request.status, 'REJECTED');
    assert.equal(result.request.decidedAt, '2026-11-04T12:00:01.000Z');
    assert.equal(result.request.expiresAt, null);
    assert.deepEqual(Object.keys(result.approval).sort(), APPROVAL_KEYS);
    assert.equal(result.approval.decision, 'REJECT');
    assert.equal(result.approval.decidedBy, 'owner');
    assert.equal(result.approval.comment, 'not expected');
    assert.deepEqual(result.approval.recheckResult, {});
    assert.equal(getReservation(db, request.id), undefined);
    assert.equal(reservedForDay(db, agentId, DAY), '0');
    const event = lastEvent(db);
    assert.equal(event.event, 'PAYMENT_REJECTED');
    assert.deepEqual(event.payload, {
      agentId,
      amount: N('1'),
      from: 'APPROVAL_REQUIRED',
      to: 'REJECTED',
      reservation: 'NONE',
      approvalId: result.approval.id,
    });
    assert.ok(!JSON.stringify(auditEvents(db)).includes('not expected'));
    assert.equal(verifyChain(db).valid, true);
  });

  it('still rejects a request whose approval window passed but was not swept yet', () => {
    const db = ctx.open();
    const agentId = setupAgent(db);
    const request = pending(db, agentId);
    const result = rejectRequest(db, request.id, {}, owner({ now: NOW + 3 * 24 * H }));
    assert.equal(result.request.status, 'REJECTED');
  });

  it('refuses to reject anything that is not awaiting approval', () => {
    const db = ctx.open();
    const agentId = setupAgent(db);
    const approved = pay(db, agentId).request;
    const blocked = pay(db, agentId, { amount: N('21') }).request;
    const rejected = pending(db, agentId);
    rejectRequest(db, rejected.id, {}, owner());
    for (const request of [approved, blocked, rejected]) {
      assert.throws(() => rejectRequest(db, request.id, {}, owner()), notPending);
    }
    assert.equal(count(db, 'approvals'), 1);
  });

  it('cannot be approved after being rejected', () => {
    const db = ctx.open();
    const agentId = setupAgent(db);
    const request = pending(db, agentId);
    rejectRequest(db, request.id, {}, owner());
    assert.throws(() => approveRequest(db, request.id, {}, owner()), notPending);
    assert.equal(getReservation(db, request.id), undefined);
  });

  it('fails for unknown requests', () => {
    const db = ctx.open();
    assert.throws(() => rejectRequest(db, randomUUID(), {}, owner()), NotFoundError);
    assert.throws(() => rejectRequest(db, undefined, {}, owner()), NotFoundError);
  });
});

describeBackends('approvals: cancelling', (ctx) => {
  it('cancels an approved request and releases its budget', () => {
    const db = ctx.open();
    const agentId = setupAgent(db);
    const request = pay(db, agentId).request;
    assert.equal(reservedForDay(db, agentId, DAY), N('1'));
    const cancelled = cancelRequest(db, request.id, owner({ now: NOW + 1000 }));
    assert.equal(cancelled.status, 'CANCELLED');
    assert.equal(getReservation(db, request.id).status, 'RELEASED');
    assert.equal(getReservation(db, request.id).release_reason, 'CANCELLED');
    assert.equal(reservedForDay(db, agentId, DAY), '0');
    const event = lastEvent(db);
    assert.equal(event.event, 'PAYMENT_CANCELLED');
    assert.equal(event.actor, 'owner');
    assert.equal(event.payload.releaseReason, 'CANCELLED');
    assert.equal(event.payload.reservation, 'RELEASE');
  });

  it('cannot cancel pending, cancelled or blocked requests', () => {
    const db = ctx.open();
    const agentId = setupAgent(db);
    const waiting = pending(db, agentId);
    const blocked = pay(db, agentId, { amount: N('21') }).request;
    const done = pay(db, agentId).request;
    cancelRequest(db, done.id, owner());
    for (const request of [waiting, blocked, done]) {
      assert.throws(
        () => cancelRequest(db, request.id, owner()),
        (e) => e instanceof ConflictError && e.code === 'ILLEGAL_TRANSITION',
        request.status,
      );
    }
    assert.equal(stateOf(db, waiting.id), 'APPROVAL_REQUIRED');
  });

  it('cannot cancel a request that was already submitted', () => {
    const db = ctx.open();
    const agentId = setupAgent(db);
    const request = pay(db, agentId).request;
    withWriteTransaction(db, () => transitionRequest(db, request.id, 'SUBMITTED', svc()));
    assert.throws(() => cancelRequest(db, request.id, owner()), ConflictError);
    assert.equal(getReservation(db, request.id).status, 'ACTIVE');
  });

  it('fails for unknown requests', () => {
    const db = ctx.open();
    assert.throws(() => cancelRequest(db, randomUUID(), owner()), NotFoundError);
    assert.throws(() => cancelRequest(db, undefined, owner()), NotFoundError);
  });
});

describeBackends('approvals: validation and context', (ctx) => {
  it('rejects malformed decision input without changing anything', () => {
    const db = ctx.open();
    const agentId = setupAgent(db);
    const request = pending(db, agentId);
    const bad = [
      null, 'x', 5, [], { unknown: 1 }, { comment: 5 }, { comment: 'x'.repeat(501) },
      { comment: 'a\nb' }, { comment: {} },
    ];
    bad.forEach((input, i) => {
      assert.throws(() => approveRequest(db, request.id, input, owner()), ValidationError, `approve #${i}`);
      assert.throws(() => rejectRequest(db, request.id, input, owner()), ValidationError, `reject #${i}`);
    });
    assert.equal(stateOf(db, request.id), 'APPROVAL_REQUIRED');
    assert.equal(count(db, 'approvals'), 0);
  });

  it('accepts missing, empty and null comments', () => {
    const db = ctx.open();
    const agentId = setupAgent(db);
    const a = approveRequest(db, pending(db, agentId).id, undefined, owner());
    const b = approveRequest(db, pending(db, agentId).id, {}, owner());
    const c = approveRequest(db, pending(db, agentId).id, { comment: null }, owner());
    const d = approveRequest(db, pending(db, agentId).id, { comment: '   ' }, owner());
    for (const result of [a, b, c, d]) assert.equal(result.approval.comment, null);
  });

  it('rejects invalid contexts and settings', () => {
    const db = ctx.open();
    const agentId = setupAgent(db);
    const request = pending(db, agentId);
    for (const context of [undefined, {}, { now: 1.5, actor: 'o' }, { now: NOW, actor: '' }]) {
      assert.throws(() => approveRequest(db, request.id, {}, context), TypeError);
      assert.throws(() => rejectRequest(db, request.id, {}, context), TypeError);
      assert.throws(() => cancelRequest(db, request.id, context), TypeError);
      assert.throws(() => expireDueRequests(db, context), TypeError);
    }
    for (const settings of [null, 'x', { authorizationWindowMs: 0 }, { other: 1 }]) {
      assert.throws(() => approveRequest(db, request.id, {}, owner(), settings), TypeError);
    }
    assert.equal(stateOf(db, request.id), 'APPROVAL_REQUIRED');
  });

  it('returns null for a missing approval', () => {
    const db = ctx.open();
    const agentId = setupAgent(db);
    assert.equal(getApprovalForRequest(db, pending(db, agentId).id), null);
    assert.equal(getApprovalForRequest(db, 'nope'), null);
    assert.equal(getApprovalForRequest(db, undefined), null);
  });
});

describeBackends('approvals: atomicity', (ctx) => {
  it('changes nothing when the audit append fails during approval', () => {
    const db = ctx.open();
    const agentId = setupAgent(db);
    const request = pending(db, agentId);
    db.exec('DROP TABLE audit_log');
    assert.throws(() => approveRequest(db, request.id, {}, owner()), /no such table/i);
    assert.equal(stateOf(db, request.id), 'APPROVAL_REQUIRED');
    assert.equal(count(db, 'approvals'), 0);
    assert.equal(count(db, 'budget_reservations'), 0);
    assert.equal(db.isTransaction, false);
  });

  it('changes nothing when the audit append fails during rejection', () => {
    const db = ctx.open();
    const agentId = setupAgent(db);
    const request = pending(db, agentId);
    db.exec('DROP TABLE audit_log');
    assert.throws(() => rejectRequest(db, request.id, {}, owner()), /no such table/i);
    assert.equal(stateOf(db, request.id), 'APPROVAL_REQUIRED');
    assert.equal(count(db, 'approvals'), 0);
  });

  it('changes nothing when the audit append fails during cancellation', () => {
    const db = ctx.open();
    const agentId = setupAgent(db);
    const request = pay(db, agentId).request;
    db.exec('DROP TABLE audit_log');
    assert.throws(() => cancelRequest(db, request.id, owner()), /no such table/i);
    assert.equal(stateOf(db, request.id), 'APPROVED');
    assert.equal(getReservation(db, request.id).status, 'ACTIVE');
  });

  it('changes nothing when the audit append fails during the refusal path', () => {
    const db = ctx.open();
    const agentId = setupAgent(db);
    const request = pending(db, agentId);
    pauseAgent(db, agentId, svc());
    db.exec('DROP TABLE audit_log');
    assert.throws(() => approveRequest(db, request.id, {}, owner()), /no such table/i);
    assert.equal(stateOf(db, request.id), 'APPROVAL_REQUIRED');
  });
});

describeBackends('approvals: expiry sweep', (ctx) => {
  it('expires due requests one window at a time and releases their budget', () => {
    const db = ctx.open();
    const agentId = setupAgent(db);
    const p1 = pending(db, agentId, {}, NOW); // expires NOW + 24h
    const a1 = pay(db, agentId, {}, NOW).request; // expires NOW + 1h
    const a2 = pay(db, agentId, {}, NOW + H / 2).request; // expires NOW + 1.5h
    assert.equal(reservedForDay(db, agentId, DAY), N('2'));

    const first = expireDueRequests(db, system({ now: NOW + H }));
    assert.deepEqual(first, { expired: 1, requestIds: [a1.id], more: false });
    assert.equal(stateOf(db, a1.id), 'EXPIRED');
    assert.equal(getReservation(db, a1.id).status, 'RELEASED');
    assert.equal(getReservation(db, a1.id).release_reason, 'EXPIRED');
    assert.equal(reservedForDay(db, agentId, DAY), N('1'));
    assert.equal(stateOf(db, a2.id), 'APPROVED');
    assert.equal(stateOf(db, p1.id), 'APPROVAL_REQUIRED');
    const event = lastEvent(db);
    assert.equal(event.event, 'PAYMENT_EXPIRED');
    assert.equal(event.actor, 'system');
    assert.equal(event.entityId, a1.id);
    assert.equal(event.payload.releaseReason, 'EXPIRED');

    const second = expireDueRequests(db, system({ now: NOW + 2 * H }));
    assert.deepEqual(second, { expired: 1, requestIds: [a2.id], more: false });
    assert.equal(reservedForDay(db, agentId, DAY), '0');

    const third = expireDueRequests(db, system({ now: NOW + 24 * H })); // exactly at expiry
    assert.deepEqual(third, { expired: 1, requestIds: [p1.id], more: false });
    assert.equal(stateOf(db, p1.id), 'EXPIRED');
    assert.equal(getReservation(db, p1.id), undefined); // pending requests held no budget

    assert.deepEqual(expireDueRequests(db, system({ now: NOW + 48 * H })), {
      expired: 0, requestIds: [], more: false,
    });
    assert.equal(verifyChain(db).valid, true);
  });

  it('does not expire requests that are not due', () => {
    const db = ctx.open();
    const agentId = setupAgent(db);
    const request = pay(db, agentId).request;
    const result = expireDueRequests(db, system({ now: NOW + H - 1 }));
    assert.equal(result.expired, 0);
    assert.equal(stateOf(db, request.id), 'APPROVED');
  });

  it('never touches blocked, submitted or finished requests', () => {
    const db = ctx.open();
    const agentId = setupAgent(db);
    const blocked = pay(db, agentId, { amount: N('21') }).request;
    const submitted = pay(db, agentId).request;
    withWriteTransaction(db, () => transitionRequest(db, submitted.id, 'SUBMITTED', svc()));
    const rejected = rejectRequest(db, pending(db, agentId).id, {}, owner()).request;
    const result = expireDueRequests(db, system({ now: NOW + 30 * 24 * H }));
    assert.equal(result.expired, 0);
    assert.equal(stateOf(db, blocked.id), 'BLOCKED');
    assert.equal(stateOf(db, submitted.id), 'SUBMITTED');
    assert.equal(stateOf(db, rejected.id), 'REJECTED');
    assert.equal(getReservation(db, submitted.id).status, 'ACTIVE');
  });

  it('processes at most `limit` requests per call, oldest expiry first', () => {
    const db = ctx.open();
    const agentId = setupAgent(db);
    const r1 = pay(db, agentId, {}, NOW).request;
    const r2 = pay(db, agentId, {}, NOW + 1000).request;
    const r3 = pay(db, agentId, {}, NOW + 2000).request;
    const later = system({ now: NOW + 2 * H });
    const first = expireDueRequests(db, later, { limit: 2 });
    assert.deepEqual(first, { expired: 2, requestIds: [r1.id, r2.id], more: true });
    assert.equal(stateOf(db, r3.id), 'APPROVED');
    const second = expireDueRequests(db, later, { limit: 2 });
    assert.deepEqual(second, { expired: 1, requestIds: [r3.id], more: false });
  });

  it('is all-or-nothing when the audit append fails', () => {
    const db = ctx.open();
    const agentId = setupAgent(db);
    const request = pay(db, agentId).request;
    db.exec('DROP TABLE audit_log');
    assert.throws(() => expireDueRequests(db, system({ now: NOW + 2 * H })), /no such table/i);
    assert.equal(stateOf(db, request.id), 'APPROVED');
    assert.equal(getReservation(db, request.id).status, 'ACTIVE');
  });

  it('rejects bad options', () => {
    const db = ctx.open();
    const bad = [
      null, 'x', [], { unknown: 1 }, { limit: 0 }, { limit: 1001 }, { limit: 1.5 }, { limit: '5' },
    ];
    bad.forEach((options, i) => {
      assert.throws(() => expireDueRequests(db, system(), options), ValidationError, `options #${i}`);
    });
  });
});

describeBackends('policy context', (ctx) => {
  it('matches the snapshot payments.js stores at evaluation time', () => {
    const db = ctx.open();
    const agentId = setupAgent(db, budgetAgent());
    const cases = [
      { recipient: 'merchant.testnet', amount: N('1') },
      { recipient: 'other.testnet', amount: N('1') },
      { recipient: 'merchant.testnet', amount: N('21') },
      { recipient: 'Bad Name', amount: N('1') },
      { recipient: 'merchant.testnet', amount: '0' },
    ];
    for (const request of cases) {
      const expected = evaluateCurrentPolicy(db, agentId, request, NOW);
      const stored = pay(db, agentId, request).request;
      assert.equal(stored.decision, expected.result.decision, JSON.stringify(request));
      assert.deepEqual(stored.reasonCodes, [...expected.result.reasonCodes], JSON.stringify(request));
      assert.deepEqual(stored.policySnapshot, expected.snapshot, JSON.stringify(request));
    }
  });

  it('reflects the current limits, lists and budget', () => {
    const db = ctx.open();
    const agentId = setupAgent(db, budgetAgent());
    pay(db, agentId, { amount: N('20') });
    const { result, snapshot } = evaluateCurrentPolicy(
      db, agentId, { recipient: 'merchant.testnet', amount: N('20') }, NOW,
    );
    assert.equal(result.decision, 'APPROVED');
    assert.equal(snapshot.reservedToday, N('20'));
    assert.equal(snapshot.remainingBudget, N('80'));
    pauseAgent(db, agentId, svc());
    const paused = evaluateCurrentPolicy(db, agentId, { recipient: 'merchant.testnet', amount: '1' }, NOW);
    assert.deepEqual([...paused.result.reasonCodes], ['AGENT_PAUSED']);
  });

  it('is read-only and fails for unknown agents', () => {
    const db = ctx.open();
    const agentId = setupAgent(db);
    const eventsBefore = auditEvents(db).length;
    evaluateCurrentPolicy(db, agentId, { recipient: 'merchant.testnet', amount: '1' }, NOW);
    assert.equal(auditEvents(db).length, eventsBefore);
    assert.equal(count(db, 'payment_requests'), 0);
    assert.throws(
      () => evaluateCurrentPolicy(db, randomUUID(), { recipient: 'merchant.testnet', amount: '1' }, NOW),
      NotFoundError,
    );
  });
});
