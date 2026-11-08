import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { nearToYocto as N } from '../money/yocto.js';
import { pauseAgent } from '../services/agents.js';
import { reservedForDay } from '../services/reservations.js';
import { OWNER_TOKEN } from '../testing/httpKit.js';
import { DAY, HOUR, withServer } from '../testing/ownerKit.js';
import { auditEvents, svc } from '../testing/serviceKit.js';
import { UUID } from '../testing/testRoutes.js';

const VIEW_KEYS = [
  'agentId', 'aiExplanation', 'aiProvider', 'amount', 'createdAt', 'decidedAt', 'decision',
  'expiresAt', 'id', 'idempotencyKey', 'policySnapshot', 'purpose', 'reasonCodes',
  'recipient', 'status', 'updatedAt',
];
const APPROVAL_KEYS = ['comment', 'decidedAt', 'decidedBy', 'decision', 'id', 'recheckResult', 'requestId'];
const PENDING = { recipient: 'other.testnet' }; // not allowlisted, so it waits for a human

describe('listing and reading payments', () => {
  it('lists payments newest first with filters and the full owner view', () =>
    withServer(async ({ clock, owner, evaluate, agent }) => {
      const p1 = await evaluate();
      clock.advance(1000);
      const p2 = await evaluate({ amount: N('21') }); // blocked
      clock.advance(1000);
      const p3 = await evaluate(PENDING);

      const all = await owner('GET', '/api/payments');
      assert.equal(all.status, 200);
      assert.deepEqual(all.json.data.payments.map((p) => p.id), [p3.id, p2.id, p1.id]);
      for (const payment of all.json.data.payments) {
        assert.deepEqual(Object.keys(payment).sort(), [...VIEW_KEYS].sort());
      }
      assert.ok(all.json.data.payments[0].policySnapshot.agent);

      const byStatus = await owner('GET', '/api/payments?status=BLOCKED');
      assert.deepEqual(byStatus.json.data.payments.map((p) => p.id), [p2.id]);
      const queue = await owner('GET', '/api/payments?status=APPROVAL_REQUIRED');
      assert.deepEqual(queue.json.data.payments.map((p) => p.id), [p3.id]);
      const byAgent = await owner('GET', `/api/payments?agentId=${agent.id}`);
      assert.equal(byAgent.json.data.payments.length, 3);
      const other = await owner('GET', `/api/payments?agentId=${UUID}`);
      assert.deepEqual(other.json.data.payments, []);
      const limited = await owner('GET', '/api/payments?limit=2');
      assert.deepEqual(limited.json.data.payments.map((p) => p.id), [p3.id, p2.id]);
    }));

  it('rejects bad list filters', () =>
    withServer(async ({ owner }) => {
      for (const bad of [
        '?status=DONE', '?status=approved', '?limit=0', '?limit=201', '?limit=abc', '?limit=',
        '?agentId=', '?other=1', '?limit=1&limit=2',
      ]) {
        const res = await owner('GET', `/api/payments${bad}`);
        assert.equal(res.status, 400, bad);
        assert.equal(res.json.error.code, 'VALIDATION', bad);
      }
    }));

  it('returns one payment with its approval (none until decided)', () =>
    withServer(async ({ owner, evaluate }) => {
      const pending = await evaluate(PENDING);
      const before = await owner('GET', `/api/payments/${pending.id}`);
      assert.equal(before.status, 200);
      assert.equal(before.json.data.payment.id, pending.id);
      assert.equal(before.json.data.payment.status, 'APPROVAL_REQUIRED');
      assert.equal(before.json.data.approval, null);

      await owner('POST', `/api/payments/${pending.id}/approve`, { comment: 'ok' });
      const after = await owner('GET', `/api/payments/${pending.id}`);
      assert.equal(after.json.data.payment.status, 'APPROVED');
      assert.deepEqual(Object.keys(after.json.data.approval).sort(), APPROVAL_KEYS);
    }));

  it('answers 404 for unknown ids and 400 for malformed ones', () =>
    withServer(async ({ owner }) => {
      assert.equal((await owner('GET', `/api/payments/${UUID}`)).status, 404);
      assert.equal((await owner('GET', '/api/payments/abc')).status, 400);
      for (const action of ['approve', 'reject', 'cancel']) {
        assert.equal((await owner('POST', `/api/payments/${UUID}/${action}`)).status, 404, action);
        assert.equal((await owner('POST', `/api/payments/abc/${action}`)).status, 400, action);
      }
    }));
});

describe('approving', () => {
  it('approves a pending payment, reserves budget and tells the agent', () =>
    withServer(async ({ t, clock, agent, owner, evaluate, agentView }) => {
      const pending = await evaluate(PENDING);
      clock.advance(60_000);
      const res = await owner('POST', `/api/payments/${pending.id}/approve`, { comment: 'ok to pay' });
      assert.equal(res.status, 200);
      assert.equal(res.json.data.outcome, 'APPROVED');
      const { payment, approval } = res.json.data;
      assert.equal(payment.status, 'APPROVED');
      assert.equal(payment.decision, 'APPROVAL_REQUIRED'); // the original decision is kept
      assert.equal(payment.decidedAt, '2026-11-04T12:01:00.000Z');
      assert.equal(payment.expiresAt, '2026-11-04T13:01:00.000Z');
      assert.deepEqual(Object.keys(approval).sort(), APPROVAL_KEYS);
      assert.equal(approval.decision, 'APPROVE');
      assert.equal(approval.decidedBy, 'owner');
      assert.equal(approval.comment, 'ok to pay');
      assert.equal(reservedForDay(t.db, agent.id, DAY), N('1'));

      const seen = await agentView(pending.id);
      assert.equal(seen.json.data.payment.status, 'APPROVED');
      assert.equal(seen.json.data.payment.expiresAt, '2026-11-04T13:01:00.000Z');

      const event = auditEvents(t.db).at(-1);
      assert.equal(event.event, 'PAYMENT_APPROVED');
      assert.equal(event.actor, 'owner');
      assert.ok(!JSON.stringify(auditEvents(t.db)).includes('ok to pay'));
    }));

  it('works without a body', () =>
    withServer(async ({ owner, evaluate }) => {
      const pending = await evaluate(PENDING);
      const res = await owner('POST', `/api/payments/${pending.id}/approve`);
      assert.equal(res.status, 200);
      assert.equal(res.json.data.approval.comment, null);
    }));

  it('cannot approve twice', () =>
    withServer(async ({ t, agent, owner, evaluate }) => {
      const pending = await evaluate(PENDING);
      await owner('POST', `/api/payments/${pending.id}/approve`, {});
      const again = await owner('POST', `/api/payments/${pending.id}/approve`, {});
      assert.equal(again.status, 409);
      assert.equal(again.json.error.code, 'NOT_PENDING');
      assert.equal(reservedForDay(t.db, agent.id, DAY), N('1'));
    }));

  it('cannot approve payments that were never pending', () =>
    withServer(async ({ owner, evaluate }) => {
      const auto = await evaluate(); // allowlisted: approved on its own
      const blocked = await evaluate({ amount: N('21') });
      for (const payment of [auto, blocked]) {
        const res = await owner('POST', `/api/payments/${payment.id}/approve`, {});
        assert.equal(res.status, 409, payment.status);
        assert.equal(res.json.error.code, 'NOT_PENDING');
      }
    }));

  it('refuses, and records a block, when the agent was paused meanwhile', () =>
    withServer(async ({ t, agent, owner, evaluate, agentView }) => {
      const pending = await evaluate(PENDING);
      pauseAgent(t.db, agent.id, svc());
      const res = await owner('POST', `/api/payments/${pending.id}/approve`, { comment: 'please' });
      assert.equal(res.status, 409);
      assert.equal(res.json.error.code, 'APPROVAL_REFUSED');
      assert.equal(res.json.data.outcome, 'BLOCKED');
      assert.deepEqual(res.json.data.refusalReasons, ['AGENT_PAUSED']);
      assert.equal(res.json.data.payment.status, 'BLOCKED');

      const detail = await owner('GET', `/api/payments/${pending.id}`);
      assert.equal(detail.json.data.approval, null);
      const seen = await agentView(pending.id);
      assert.equal(seen.json.data.payment.status, 'BLOCKED');
      assert.deepEqual(seen.json.data.payment.reasonCodes, ['AGENT_PAUSED']);
      assert.equal(reservedForDay(t.db, agent.id, DAY), '0');
      assert.equal(auditEvents(t.db).at(-1).event, 'APPROVAL_REFUSED');
      const again = await owner('POST', `/api/payments/${pending.id}/approve`, {});
      assert.equal(again.json.error.code, 'NOT_PENDING');
    }));

  it('refuses when the daily budget was spent in the meantime', () =>
    withServer(
      async ({ t, agent, owner, evaluate }) => {
        const first = await evaluate({ ...PENDING, amount: N('60') });
        const second = await evaluate({ ...PENDING, amount: N('60') });
        const ok = await owner('POST', `/api/payments/${first.id}/approve`, {});
        assert.equal(ok.status, 200);
        const refused = await owner('POST', `/api/payments/${second.id}/approve`, {});
        assert.equal(refused.status, 409);
        assert.equal(refused.json.error.code, 'APPROVAL_REFUSED');
        assert.deepEqual(refused.json.data.refusalReasons, ['EXCEEDS_DAILY_BUDGET']);
        assert.equal(reservedForDay(t.db, agent.id, DAY), N('60'));
      },
      { dailyBudget: N('100'), perTxLimit: N('100'), approvalThreshold: N('5') },
    ));

  it('allows approval up to the last millisecond of the window and refuses at it', () =>
    withServer(async ({ clock, owner, evaluate, agentView }) => {
      const inTime = await evaluate(PENDING);
      const late = await evaluate(PENDING);
      clock.advance(24 * HOUR - 1);
      assert.equal((await owner('POST', `/api/payments/${inTime.id}/approve`, {})).status, 200);
      clock.advance(1);
      const res = await owner('POST', `/api/payments/${late.id}/approve`, {});
      assert.equal(res.status, 409);
      assert.equal(res.json.error.code, 'REQUEST_EXPIRED');
      assert.equal(res.json.data.outcome, 'EXPIRED');
      assert.equal(res.json.data.payment.status, 'EXPIRED');
      assert.equal((await agentView(late.id)).json.data.payment.status, 'EXPIRED');
    }));

  it('validates the request body and changes nothing on failure', () =>
    withServer(async ({ t, owner, evaluate }) => {
      const pending = await evaluate(PENDING);
      const path = `/api/payments/${pending.id}/approve`;
      for (const json of [{ comment: 5 }, { comment: 'x'.repeat(501) }, { comment: 'a\nb' }, { unknown: 1 }]) {
        const res = await owner('POST', path, json);
        assert.equal(res.status, 400, JSON.stringify(json));
      }
      const arrayBody = await t.request('POST', path, {
        token: OWNER_TOKEN, body: '[]', headers: { 'content-type': 'application/json' },
      });
      assert.equal(arrayBody.status, 400);
      const plain = await t.request('POST', path, {
        token: OWNER_TOKEN, body: '{}', headers: { 'content-type': 'text/plain' },
      });
      assert.equal(plain.status, 415);
      const detail = await owner('GET', `/api/payments/${pending.id}`);
      assert.equal(detail.json.data.payment.status, 'APPROVAL_REQUIRED');
    }));

  it("never lets an agent key decide a payment, not even its own", () =>
    withServer(async ({ t, apiKey, owner, evaluate }) => {
      const pending = await evaluate(PENDING);
      for (const action of ['approve', 'reject', 'cancel']) {
        const res = await t.request('POST', `/api/payments/${pending.id}/${action}`, {
          token: apiKey, json: {},
        });
        assert.equal(res.status, 401, action);
      }
      const detail = await owner('GET', `/api/payments/${pending.id}`);
      assert.equal(detail.json.data.payment.status, 'APPROVAL_REQUIRED');
    }));
});

describe('rejecting', () => {
  it('rejects a pending payment and tells the agent', () =>
    withServer(async ({ t, agent, owner, evaluate, agentView }) => {
      const pending = await evaluate(PENDING);
      const res = await owner('POST', `/api/payments/${pending.id}/reject`, { comment: 'not expected' });
      assert.equal(res.status, 200);
      assert.equal(res.json.data.payment.status, 'REJECTED');
      assert.equal(res.json.data.approval.decision, 'REJECT');
      assert.equal(res.json.data.approval.decidedBy, 'owner');
      assert.equal(res.json.data.approval.comment, 'not expected');
      assert.equal((await agentView(pending.id)).json.data.payment.status, 'REJECTED');
      assert.equal(reservedForDay(t.db, agent.id, DAY), '0');
      assert.equal(auditEvents(t.db).at(-1).event, 'PAYMENT_REJECTED');
    }));

  it('cannot reject twice, approve afterwards, or reject non-pending payments', () =>
    withServer(async ({ owner, evaluate }) => {
      const pending = await evaluate(PENDING);
      const auto = await evaluate();
      await owner('POST', `/api/payments/${pending.id}/reject`, {});
      const again = await owner('POST', `/api/payments/${pending.id}/reject`, {});
      assert.equal(again.status, 409);
      assert.equal(again.json.error.code, 'NOT_PENDING');
      const approve = await owner('POST', `/api/payments/${pending.id}/approve`, {});
      assert.equal(approve.json.error.code, 'NOT_PENDING');
      const nonPending = await owner('POST', `/api/payments/${auto.id}/reject`, {});
      assert.equal(nonPending.status, 409);
    }));

  it('still rejects after the window passed but before the sweep', () =>
    withServer(async ({ clock, owner, evaluate }) => {
      const pending = await evaluate(PENDING);
      clock.advance(3 * 24 * HOUR);
      const res = await owner('POST', `/api/payments/${pending.id}/reject`, {});
      assert.equal(res.status, 200);
      assert.equal(res.json.data.payment.status, 'REJECTED');
    }));

  it('validates the body', () =>
    withServer(async ({ owner, evaluate }) => {
      const pending = await evaluate(PENDING);
      for (const json of [{ comment: 5 }, { unknown: 1 }]) {
        assert.equal((await owner('POST', `/api/payments/${pending.id}/reject`, json)).status, 400);
      }
    }));
});

describe('cancelling', () => {
  it('cancels an approved payment and releases its budget', () =>
    withServer(async ({ t, agent, owner, evaluate, agentView }) => {
      const approved = await evaluate();
      assert.equal(reservedForDay(t.db, agent.id, DAY), N('1'));
      const res = await owner('POST', `/api/payments/${approved.id}/cancel`);
      assert.equal(res.status, 200);
      assert.equal(res.json.data.payment.status, 'CANCELLED');
      assert.equal(reservedForDay(t.db, agent.id, DAY), '0');
      assert.equal((await agentView(approved.id)).json.data.payment.status, 'CANCELLED');
      const event = auditEvents(t.db).at(-1);
      assert.equal(event.event, 'PAYMENT_CANCELLED');
      assert.equal(event.payload.releaseReason, 'CANCELLED');
    }));

  it('cannot cancel pending or already cancelled payments', () =>
    withServer(async ({ owner, evaluate }) => {
      const pending = await evaluate(PENDING);
      const approved = await evaluate();
      await owner('POST', `/api/payments/${approved.id}/cancel`);
      for (const payment of [pending, approved]) {
        const res = await owner('POST', `/api/payments/${payment.id}/cancel`);
        assert.equal(res.status, 409);
        assert.equal(res.json.error.code, 'ILLEGAL_TRANSITION');
      }
    }));

  it('accepts no body fields', () =>
    withServer(async ({ owner, evaluate }) => {
      const approved = await evaluate();
      const res = await owner('POST', `/api/payments/${approved.id}/cancel`, { comment: 'x' });
      assert.equal(res.status, 400);
      const detail = await owner('GET', `/api/payments/${approved.id}`);
      assert.equal(detail.json.data.payment.status, 'APPROVED');
    }));
});
