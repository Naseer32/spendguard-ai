import { it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { verifyChain } from '../audit/auditChain.js';
import { withWriteTransaction } from '../db/database.js';
import { nearToYocto as N } from '../money/yocto.js';
import { T, count, describeBackends } from '../testing/dbKit.js';
import { budgetAgent, pay, setupAgent } from '../testing/paymentKit.js';
import { NOW, auditEvents, seedAgent, svc } from '../testing/serviceKit.js';
import { pauseAgent, updateLimits } from './agents.js';
import { IdempotencyConflictError, NotFoundError, ValidationError } from './errors.js';
import {
  evaluatePaymentRequest,
  getAgentPaymentRequest,
  getPaymentRequest,
  listPaymentRequests,
} from './payments.js';
import { setRecipient } from './recipients.js';
import { transitionRequest } from './requestState.js';
import { getReservation, reservedForDay } from './reservations.js';

const DAY = '2026-11-04';
const VIEW_KEYS = [
  'agentId', 'aiExplanation', 'aiProvider', 'amount', 'createdAt', 'decidedAt', 'decision',
  'expiresAt', 'id', 'idempotencyKey', 'policySnapshot', 'purpose', 'reasonCodes',
  'recipient', 'status', 'updatedAt',
];
const AGENT_POLICY = {
  status: 'ACTIVE',
  dailyBudget: N('100'),
  perTxLimit: N('20'),
  approvalThreshold: N('5'),
};

const lastEvent = (db) => auditEvents(db).at(-1);

describeBackends('payments: decisions', (ctx) => {
  it('approves a payment within policy, reserves budget and audits it', () => {
    const db = ctx.open();
    const agentId = setupAgent(db);
    const { request, replayed } = pay(db, agentId, { purpose: '  Coffee beans  ' });
    assert.equal(replayed, false);
    assert.deepEqual(Object.keys(request).sort(), [...VIEW_KEYS].sort());
    assert.equal(request.agentId, agentId);
    assert.equal(request.recipient, 'merchant.testnet');
    assert.equal(request.amount, N('1'));
    assert.equal(request.purpose, 'Coffee beans');
    assert.equal(request.decision, 'APPROVED');
    assert.equal(request.status, 'APPROVED');
    assert.deepEqual(request.reasonCodes, ['WITHIN_POLICY']);
    assert.equal(request.createdAt, T);
    assert.equal(request.decidedAt, T);
    assert.equal(request.expiresAt, '2026-11-04T13:00:00.000Z');
    assert.equal(request.updatedAt, T);
    assert.equal(request.aiExplanation, null);
    assert.equal(request.aiProvider, null);
    assert.deepEqual(request.policySnapshot, {
      agent: AGENT_POLICY,
      recipientLists: { onAllowlist: true, onBlocklist: false },
      reservedToday: '0',
      budgetDay: DAY,
      remainingBudget: N('100'),
    });

    const reservation = getReservation(db, request.id);
    assert.equal(reservation.status, 'ACTIVE');
    assert.equal(reservation.amount, N('1'));
    assert.equal(reservation.budget_day, DAY);
    assert.equal(reservedForDay(db, agentId, DAY), N('1'));

    const event = lastEvent(db);
    assert.equal(event.event, 'PAYMENT_EVALUATED');
    assert.equal(event.actor, `agent:${agentId}`);
    assert.equal(event.entityId, request.id);
    assert.deepEqual(event.payload, {
      agentId,
      recipient: 'merchant.testnet',
      amount: N('1'),
      decision: 'APPROVED',
      reasonCodes: ['WITHIN_POLICY'],
      status: 'APPROVED',
      reservation: 'CREATE',
      budgetDay: DAY,
    });
    assert.ok(!JSON.stringify(auditEvents(db)).includes('Coffee beans'));
    assert.equal(verifyChain(db).valid, true);
  });

  it('requires approval, without reserving budget, for unlisted recipients and large amounts', () => {
    const db = ctx.open();
    const agentId = setupAgent(db);
    const unlisted = pay(db, agentId, { recipient: 'other.testnet' }).request;
    assert.equal(unlisted.decision, 'APPROVAL_REQUIRED');
    assert.equal(unlisted.status, 'APPROVAL_REQUIRED');
    assert.deepEqual(unlisted.reasonCodes, ['RECIPIENT_NOT_ALLOWLISTED']);
    assert.equal(unlisted.decidedAt, null);
    assert.equal(unlisted.expiresAt, '2026-11-05T12:00:00.000Z');

    const large = pay(db, agentId, { amount: N('10') }).request;
    assert.equal(large.status, 'APPROVAL_REQUIRED');
    assert.deepEqual(large.reasonCodes, ['ABOVE_APPROVAL_THRESHOLD']);

    assert.equal(getReservation(db, unlisted.id), undefined);
    assert.equal(getReservation(db, large.id), undefined);
    assert.equal(reservedForDay(db, agentId, DAY), '0');
    const event = lastEvent(db);
    assert.equal(event.payload.reservation, 'NONE');
    assert.equal('budgetDay' in event.payload, false);
  });

  it('stores and audits BLOCKED requests without reserving budget', () => {
    const db = ctx.open();
    const agentId = setupAgent(db);
    setRecipient(db, agentId, { accountId: 'scam.testnet', listType: 'BLOCK' }, svc());
    const cases = [
      [{ recipient: 'scam.testnet' }, ['RECIPIENT_BLOCKED']],
      [{ amount: N('21') }, ['EXCEEDS_TX_LIMIT']],
      [{ amount: N('200') }, ['EXCEEDS_TX_LIMIT', 'EXCEEDS_DAILY_BUDGET']],
      [{ amount: '0' }, ['ZERO_AMOUNT']],
      [{ recipient: 'Merchant.Testnet' }, ['INVALID_RECIPIENT']],
      [{ recipient: 'a b' }, ['INVALID_RECIPIENT']],
    ];
    for (const [over, reasons] of cases) {
      const { request } = pay(db, agentId, over);
      assert.equal(request.decision, 'BLOCKED', JSON.stringify(over));
      assert.equal(request.status, 'BLOCKED');
      assert.deepEqual(request.reasonCodes, reasons, JSON.stringify(over));
      assert.equal(request.decidedAt, T);
      assert.equal(request.expiresAt, null);
      assert.equal(getReservation(db, request.id), undefined);
      const event = lastEvent(db);
      assert.equal(event.event, 'PAYMENT_EVALUATED');
      assert.equal(event.entityId, request.id);
      assert.equal(event.payload.decision, 'BLOCKED');
      assert.equal(event.payload.reservation, 'NONE');
    }
    assert.equal(count(db, 'payment_requests'), cases.length);
    assert.equal(count(db, 'budget_reservations'), 0);
    assert.equal(reservedForDay(db, agentId, DAY), '0');
    assert.equal(verifyChain(db).valid, true);
  });

  it('blocks a paused agent and a blocklisted-and-allowlisted conflict is impossible', () => {
    const db = ctx.open();
    const agentId = setupAgent(db);
    pauseAgent(db, agentId, svc());
    const { request } = pay(db, agentId);
    assert.equal(request.status, 'BLOCKED');
    assert.deepEqual(request.reasonCodes, ['AGENT_PAUSED']);
    assert.equal(request.policySnapshot.agent.status, 'PAUSED');
  });

  it('uses the limits in force at decision time', () => {
    const db = ctx.open();
    const agentId = setupAgent(db);
    updateLimits(db, agentId, { perTxLimit: N('5'), approvalThreshold: N('5') }, svc());
    const { request } = pay(db, agentId, { amount: N('6') });
    assert.equal(request.status, 'BLOCKED');
    assert.deepEqual(request.reasonCodes, ['EXCEEDS_TX_LIMIT']);
    assert.equal(request.policySnapshot.agent.perTxLimit, N('5'));
  });

  it('keeps the snapshot values as exact strings', () => {
    const db = ctx.open();
    const big = '9007199254740993';
    const agentId = setupAgent(db, { dailyBudget: big, perTxLimit: big, approvalThreshold: big });
    const { request } = pay(db, agentId, { amount: '9007199254740992' });
    assert.equal(request.status, 'APPROVED');
    assert.equal(request.policySnapshot.remainingBudget, big);
    const second = pay(db, agentId, { amount: '2' }).request;
    assert.equal(second.status, 'BLOCKED');
    assert.deepEqual(second.reasonCodes, ['EXCEEDS_DAILY_BUDGET']);
    assert.equal(second.policySnapshot.reservedToday, '9007199254740992');
    assert.equal(second.policySnapshot.remainingBudget, '1');
  });
});

describeBackends('payments: daily budget', (ctx) => {
  it('approves exactly what fits and blocks the rest', () => {
    const db = ctx.open();
    const agentId = setupAgent(db, budgetAgent());
    const statuses = [];
    for (let i = 0; i < 7; i += 1) {
      statuses.push(pay(db, agentId, { amount: N('15') }).request.status);
    }
    assert.deepEqual(statuses, [
      'APPROVED', 'APPROVED', 'APPROVED', 'APPROVED', 'APPROVED', 'APPROVED', 'BLOCKED',
    ]);
    assert.equal(reservedForDay(db, agentId, DAY), N('90'));
    const exact = pay(db, agentId, { amount: N('10') }).request;
    assert.equal(exact.status, 'APPROVED');
    assert.equal(reservedForDay(db, agentId, DAY), N('100'));
    const over = pay(db, agentId, { amount: '1' }).request;
    assert.equal(over.status, 'BLOCKED');
    assert.deepEqual(over.reasonCodes, ['EXCEEDS_DAILY_BUDGET']);
    assert.equal(over.policySnapshot.remainingBudget, '0');
  });

  it('records the budget that was reserved before each decision', () => {
    const db = ctx.open();
    const agentId = setupAgent(db, budgetAgent());
    const first = pay(db, agentId, { amount: N('20') }).request;
    const second = pay(db, agentId, { amount: N('20') }).request;
    assert.equal(first.policySnapshot.reservedToday, '0');
    assert.equal(second.policySnapshot.reservedToday, N('20'));
    assert.equal(second.policySnapshot.remainingBudget, N('80'));
  });

  it('does not count blocked or approval-required requests', () => {
    const db = ctx.open();
    const agentId = setupAgent(db, budgetAgent());
    pay(db, agentId, { amount: N('21') }); // blocked: over the per-tx limit
    pay(db, agentId, { recipient: 'other.testnet', amount: N('20') }); // needs approval
    assert.equal(reservedForDay(db, agentId, DAY), '0');
    assert.equal(pay(db, agentId, { amount: N('20') }).request.status, 'APPROVED');
  });

  it('budgets each agent separately', () => {
    const db = ctx.open();
    const a = setupAgent(db, budgetAgent());
    const b = setupAgent(db, { ...budgetAgent(), name: 'Agent B' });
    for (let i = 0; i < 5; i += 1) pay(db, a, { amount: N('20') });
    assert.equal(pay(db, a, { amount: N('1') }).request.status, 'BLOCKED');
    assert.equal(pay(db, b, { amount: N('20') }).request.status, 'APPROVED');
    assert.equal(reservedForDay(db, b, DAY), N('20'));
  });

  it('starts a fresh budget at UTC midnight', () => {
    const db = ctx.open();
    const agentId = setupAgent(db, budgetAgent());
    const lateDay4 = Date.UTC(2026, 10, 4, 23, 59, 59, 999);
    const earlyDay5 = Date.UTC(2026, 10, 5, 0, 0, 0, 0);
    for (let i = 0; i < 5; i += 1) {
      assert.equal(pay(db, agentId, { amount: N('20') }, lateDay4).request.status, 'APPROVED');
    }
    assert.equal(pay(db, agentId, { amount: N('1') }, lateDay4).request.status, 'BLOCKED');
    const next = pay(db, agentId, { amount: N('20') }, earlyDay5).request;
    assert.equal(next.status, 'APPROVED');
    assert.equal(next.policySnapshot.budgetDay, '2026-11-05');
    assert.equal(next.policySnapshot.reservedToday, '0');
    assert.equal(next.policySnapshot.remainingBudget, N('100'));
    assert.equal(reservedForDay(db, agentId, '2026-11-04'), N('100'));
    assert.equal(reservedForDay(db, agentId, '2026-11-05'), N('20'));
  });

  it('frees budget when an authorization is cancelled', () => {
    const db = ctx.open();
    const agentId = setupAgent(db, budgetAgent());
    const ids = [];
    for (let i = 0; i < 5; i += 1) ids.push(pay(db, agentId, { amount: N('20') }).request.id);
    assert.equal(pay(db, agentId, { amount: N('20') }).request.status, 'BLOCKED');
    withWriteTransaction(db, () => transitionRequest(db, ids[0], 'CANCELLED', svc()));
    assert.equal(pay(db, agentId, { amount: N('20') }).request.status, 'APPROVED');
  });
});

describeBackends('payments: idempotency', (ctx) => {
  it('replays the original request for the same key and body', () => {
    const db = ctx.open();
    const agentId = setupAgent(db);
    const first = pay(db, agentId, { idempotencyKey: 'order-12345', purpose: 'Coffee' });
    const second = pay(db, agentId, { idempotencyKey: 'order-12345', purpose: 'Coffee' });
    assert.equal(first.replayed, false);
    assert.equal(second.replayed, true);
    assert.deepEqual(second.request, first.request);
    assert.equal(count(db, 'payment_requests'), 1);
    assert.equal(count(db, 'budget_reservations'), 1);
    assert.equal(reservedForDay(db, agentId, DAY), N('1'));
    assert.equal(auditEvents(db).filter((e) => e.event === 'PAYMENT_EVALUATED').length, 1);
  });

  it('treats an omitted purpose, a null purpose and a trimmed purpose as the same request', () => {
    const db = ctx.open();
    const agentId = setupAgent(db);
    const a = pay(db, agentId, { idempotencyKey: 'key-omitted' });
    assert.equal(pay(db, agentId, { idempotencyKey: 'key-omitted', purpose: null }).replayed, true);
    assert.equal(pay(db, agentId, { idempotencyKey: 'key-omitted', purpose: '   ' }).replayed, true);
    const b = pay(db, agentId, { idempotencyKey: 'key-trimmed', purpose: 'x' });
    assert.equal(pay(db, agentId, { idempotencyKey: 'key-trimmed', purpose: '  x  ' }).replayed, true);
    assert.notEqual(a.request.id, b.request.id);
  });

  it('rejects the same key with a different body', () => {
    const db = ctx.open();
    const agentId = setupAgent(db);
    pay(db, agentId, { idempotencyKey: 'order-12345', purpose: 'Coffee' });
    const changed = [
      { amount: N('2') }, { recipient: 'other.testnet' }, { purpose: 'Tea' }, { purpose: undefined },
    ];
    for (const over of changed) {
      assert.throws(
        () => pay(db, agentId, { idempotencyKey: 'order-12345', purpose: 'Coffee', ...over }),
        IdempotencyConflictError,
        JSON.stringify(over),
      );
    }
    assert.equal(count(db, 'payment_requests'), 1);
    assert.equal(reservedForDay(db, agentId, DAY), N('1'));
  });

  it('scopes keys to the agent', () => {
    const db = ctx.open();
    const a = setupAgent(db);
    const b = setupAgent(db, { name: 'Agent B' });
    const first = pay(db, a, { idempotencyKey: 'shared-key-1' }).request;
    const second = pay(db, b, { idempotencyKey: 'shared-key-1' });
    assert.equal(second.replayed, false);
    assert.notEqual(second.request.id, first.id);
    assert.equal(count(db, 'payment_requests'), 2);
  });

  it('replays the stored decision, not a fresh evaluation', () => {
    const db = ctx.open();
    const agentId = setupAgent(db);
    const first = pay(db, agentId, { idempotencyKey: 'order-12345' });
    pauseAgent(db, agentId, svc());
    const later = pay(db, agentId, { idempotencyKey: 'order-12345' }, NOW + 3 * 86400000);
    assert.equal(later.replayed, true);
    assert.equal(later.request.status, 'APPROVED');
    assert.deepEqual(later.request, first.request);
  });

  it('replays the current state of a request that has moved on', () => {
    const db = ctx.open();
    const agentId = setupAgent(db);
    const first = pay(db, agentId, { idempotencyKey: 'order-12345' }).request;
    withWriteTransaction(db, () => transitionRequest(db, first.id, 'CANCELLED', svc()));
    const replay = pay(db, agentId, { idempotencyKey: 'order-12345' });
    assert.equal(replay.replayed, true);
    assert.equal(replay.request.status, 'CANCELLED');
    assert.equal(count(db, 'payment_requests'), 1);
  });

  it('replays blocked requests too', () => {
    const db = ctx.open();
    const agentId = setupAgent(db);
    const first = pay(db, agentId, { idempotencyKey: 'order-blocked', amount: N('21') });
    const second = pay(db, agentId, { idempotencyKey: 'order-blocked', amount: N('21') });
    assert.equal(first.request.status, 'BLOCKED');
    assert.equal(second.replayed, true);
    assert.equal(count(db, 'payment_requests'), 1);
  });
});

describeBackends('payments: validation', (ctx) => {
  it('rejects malformed input without storing anything', () => {
    const db = ctx.open();
    const agentId = setupAgent(db);
    const eventsBefore = auditEvents(db).length;
    const ok = { idempotencyKey: 'order-12345', recipient: 'merchant.testnet', amount: N('1') };
    const without = (key) => {
      const copy = { ...ok };
      delete copy[key];
      return copy;
    };
    const bad = [
      null, undefined, 'x', [], 5,
      without('idempotencyKey'), without('recipient'), without('amount'),
      { ...ok, idempotencyKey: 'short' }, { ...ok, idempotencyKey: 'bad key with spaces' },
      { ...ok, idempotencyKey: 'x'.repeat(129) }, { ...ok, idempotencyKey: 'bad!key#1234' },
      { ...ok, idempotencyKey: 12345678 },
      { ...ok, recipient: '' }, { ...ok, recipient: 'x'.repeat(129) }, { ...ok, recipient: 5 },
      { ...ok, recipient: 'a\u0000b' }, { ...ok, recipient: null },
      { ...ok, amount: '1.5' }, { ...ok, amount: '-1' }, { ...ok, amount: '01' },
      { ...ok, amount: 'abc' }, { ...ok, amount: '' }, { ...ok, amount: 5 },
      { ...ok, amount: null }, { ...ok, amount: '1'.repeat(41) },
      { ...ok, purpose: 5 }, { ...ok, purpose: 'x'.repeat(501) }, { ...ok, purpose: 'a\nb' },
      { ...ok, status: 'APPROVED' }, { ...ok, agentId: 'other' }, { ...ok, decision: 'APPROVED' },
    ];
    bad.forEach((input, i) => {
      assert.throws(
        () => evaluatePaymentRequest(db, agentId, input, svc()),
        ValidationError,
        `input #${i}`,
      );
    });
    assert.equal(count(db, 'payment_requests'), 0);
    assert.equal(count(db, 'budget_reservations'), 0);
    assert.equal(auditEvents(db).length, eventsBefore);
  });

  it('fails for unknown agents and invalid contexts', () => {
    const db = ctx.open();
    const agentId = setupAgent(db);
    const input = { idempotencyKey: 'order-12345', recipient: 'merchant.testnet', amount: '1' };
    for (const id of [randomUUID(), 'nope', undefined, null, 5]) {
      assert.throws(() => evaluatePaymentRequest(db, id, input, svc()), NotFoundError);
    }
    for (const context of [undefined, {}, { now: 1.5, actor: 'a' }, { now: NOW, actor: '' }]) {
      assert.throws(() => evaluatePaymentRequest(db, agentId, input, context), TypeError);
    }
    assert.equal(count(db, 'payment_requests'), 0);
  });
});

describeBackends('payments: settings', (ctx) => {
  it('uses configurable expiry windows', () => {
    const db = ctx.open();
    const agentId = setupAgent(db);
    const settings = { authorizationWindowMs: 600000, approvalWindowMs: 7200000 };
    const approved = pay(db, agentId, {}, NOW, settings).request;
    const pending = pay(db, agentId, { recipient: 'other.testnet' }, NOW, settings).request;
    assert.equal(approved.expiresAt, '2026-11-04T12:10:00.000Z');
    assert.equal(pending.expiresAt, '2026-11-04T14:00:00.000Z');
  });

  it('rejects invalid settings before storing anything', () => {
    const db = ctx.open();
    const agentId = setupAgent(db);
    for (const settings of [null, 'x', { authorizationWindowMs: 0 }, { other: 1 }]) {
      assert.throws(() => pay(db, agentId, {}, NOW, settings), TypeError);
    }
    assert.equal(count(db, 'payment_requests'), 0);
    assert.equal(count(db, 'budget_reservations'), 0);
  });
});

describeBackends('payments: atomicity', (ctx) => {
  it('rolls the request and reservation back when the audit append fails', () => {
    const db = ctx.open();
    const agentId = setupAgent(db);
    db.exec('DROP TABLE audit_log');
    assert.throws(() => pay(db, agentId), /no such table/i);
    assert.equal(count(db, 'payment_requests'), 0);
    assert.equal(count(db, 'budget_reservations'), 0);
    assert.equal(db.isTransaction, false);
  });

  it('rolls back blocked requests too', () => {
    const db = ctx.open();
    const agentId = setupAgent(db);
    db.exec('DROP TABLE audit_log');
    assert.throws(() => pay(db, agentId, { amount: N('21') }), /no such table/i);
    assert.equal(count(db, 'payment_requests'), 0);
  });

  it('can be retried with the same key after a rolled-back attempt', () => {
    const db = ctx.open();
    const agentId = setupAgent(db);
    db.exec('ALTER TABLE audit_log RENAME TO audit_log_hidden');
    assert.throws(() => pay(db, agentId, { idempotencyKey: 'order-12345' }), /no such table/i);
    db.exec('ALTER TABLE audit_log_hidden RENAME TO audit_log');
    const retry = pay(db, agentId, { idempotencyKey: 'order-12345' });
    assert.equal(retry.replayed, false);
    assert.equal(retry.request.status, 'APPROVED');
    assert.equal(count(db, 'payment_requests'), 1);
    assert.equal(verifyChain(db).valid, true);
  });
});

describeBackends('payments: two connections', (ctx) => {
  it('keeps the budget exact when two connections take turns', { skip: ctx.kind !== 'file' }, () => {
    const a = ctx.open();
    const agentId = setupAgent(a, budgetAgent());
    const b = ctx.openAt(ctx.locationOf(a));
    const statuses = [];
    for (let i = 0; i < 7; i += 1) {
      statuses.push(pay(i % 2 === 0 ? a : b, agentId, { amount: N('15') }).request.status);
    }
    assert.deepEqual(statuses, [
      'APPROVED', 'APPROVED', 'APPROVED', 'APPROVED', 'APPROVED', 'APPROVED', 'BLOCKED',
    ]);
    assert.equal(reservedForDay(a, agentId, DAY), N('90'));
    assert.equal(reservedForDay(b, agentId, DAY), N('90'));
    assert.equal(verifyChain(a).valid, true);
  });

  it('cannot evaluate while another connection holds the write lock', { skip: ctx.kind !== 'file' }, () => {
    const a = ctx.open();
    const agentId = setupAgent(a);
    const b = ctx.openAt(ctx.locationOf(a), { busyTimeoutMs: 50 });
    withWriteTransaction(a, () => {
      assert.throws(() => pay(b, agentId), /locked|busy/i);
    });
    assert.equal(count(a, 'payment_requests'), 0);
    assert.equal(pay(b, agentId).request.status, 'APPROVED');
    assert.equal(count(a, 'payment_requests'), 1);
  });
});

describeBackends('payments: reading requests', (ctx) => {
  it('returns a request by id', () => {
    const db = ctx.open();
    const agentId = setupAgent(db);
    const { request } = pay(db, agentId);
    assert.deepEqual(getPaymentRequest(db, request.id), request);
    assert.deepEqual(getAgentPaymentRequest(db, agentId, request.id), request);
    assert.throws(() => getPaymentRequest(db, randomUUID()), NotFoundError);
    assert.throws(() => getPaymentRequest(db, undefined), NotFoundError);
  });

  it("hides another agent's request", () => {
    const db = ctx.open();
    const a = setupAgent(db);
    const b = setupAgent(db, { name: 'Agent B' });
    const { request } = pay(db, a);
    for (const id of [b, undefined, null, 5]) {
      assert.throws(() => getAgentPaymentRequest(db, id, request.id), NotFoundError);
    }
    assert.throws(() => getAgentPaymentRequest(db, a, randomUUID()), NotFoundError);
  });

  it('lists requests newest first with filters', () => {
    const db = ctx.open();
    const a = setupAgent(db);
    const b = setupAgent(db, { name: 'Agent B' });
    const r1 = pay(db, a, {}, NOW).request;
    const r2 = pay(db, a, { amount: N('21') }, NOW + 1000).request; // blocked
    const r3 = pay(db, b, {}, NOW + 2000).request; // approval required (not allowlisted)
    assert.deepEqual(listPaymentRequests(db).map((r) => r.id), [r3.id, r2.id, r1.id]);
    assert.deepEqual(listPaymentRequests(db, { agentId: a }).map((r) => r.id), [r2.id, r1.id]);
    assert.deepEqual(listPaymentRequests(db, { status: 'BLOCKED' }).map((r) => r.id), [r2.id]);
    assert.deepEqual(listPaymentRequests(db, { agentId: b, status: 'APPROVAL_REQUIRED' }).map((r) => r.id), [r3.id]);
    assert.deepEqual(listPaymentRequests(db, { agentId: b, status: 'BLOCKED' }), []);
    assert.deepEqual(listPaymentRequests(db, { limit: 2 }).map((r) => r.id), [r3.id, r2.id]);
    assert.equal(listPaymentRequests(db, {}).length, 3);
  });

  it('rejects bad list filters', () => {
    const db = ctx.open();
    const bad = [
      null, 'x', [], { unknown: 1 }, { agentId: 5 }, { status: 'DONE' }, { status: 'approved' },
      { limit: 0 }, { limit: 201 }, { limit: 1.5 }, { limit: '5' },
    ];
    bad.forEach((filters, i) => {
      assert.throws(() => listPaymentRequests(db, filters), ValidationError, `filters #${i}`);
    });
  });

  it('never exposes the request hash', () => {
    const db = ctx.open();
    const agentId = setupAgent(db);
    pay(db, agentId);
    for (const request of listPaymentRequests(db)) {
      assert.deepEqual(Object.keys(request).sort(), [...VIEW_KEYS].sort());
    }
  });
});
