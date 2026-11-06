import { it } from 'node:test';
import assert from 'node:assert/strict';
import { withWriteTransaction } from '../db/database.js';
import { T, describeBackends, insertRow, requestRow } from '../testing/dbKit.js';
import { seedAgent } from '../testing/serviceKit.js';
import { ConflictError, NotFoundError, ValidationError } from './errors.js';
import {
  consumeReservation,
  createReservation,
  getReservation,
  releaseReservation,
  reservedForDay,
} from './reservations.js';

const DAY = '2026-11-04';
const LATER = '2026-11-04T12:00:05.000Z';
let seq = 0;

describeBackends('reservations', (ctx) => {
  function setup() {
    const db = ctx.open();
    const { agent } = seedAgent(db);
    return { db, agentId: agent.id };
  }

  function addRequest(db, agentId) {
    seq += 1;
    const id = `rq-${seq}`;
    insertRow(db, 'payment_requests', requestRow({
      id, agent_id: agentId, idempotency_key: `idem-rq-${seq}`,
    }));
    return id;
  }

  function reserve(db, agentId, amount, day = DAY) {
    const requestId = addRequest(db, agentId);
    withWriteTransaction(db, () =>
      createReservation(db, { requestId, agentId, amount, budgetDay: day }, T),
    );
    return requestId;
  }

  const consume = (db, requestId) =>
    withWriteTransaction(db, () => consumeReservation(db, requestId, LATER));
  const release = (db, requestId, reason = 'TEST') =>
    withWriteTransaction(db, () => releaseReservation(db, requestId, reason, LATER));

  it('is zero when nothing is reserved', () => {
    const { db, agentId } = setup();
    assert.equal(reservedForDay(db, agentId, DAY), '0');
  });

  it('counts ACTIVE and CONSUMED reservations only, per agent and day', () => {
    const { db, agentId } = setup();
    const otherId = seedAgent(db, { name: 'Other' }).agent.id;
    reserve(db, agentId, '10');
    const b = reserve(db, agentId, '20');
    const c = reserve(db, agentId, '40');
    consume(db, b);
    release(db, c);
    reserve(db, agentId, '1000', '2026-11-05'); // another day
    reserve(db, otherId, '500'); // another agent
    assert.equal(reservedForDay(db, agentId, DAY), '30');
    assert.equal(reservedForDay(db, agentId, '2026-11-05'), '1000');
    assert.equal(reservedForDay(db, otherId, DAY), '500');
  });

  it('sums exactly beyond float and 64-bit precision', () => {
    const { db, agentId } = setup();
    reserve(db, agentId, '9007199254740993');
    reserve(db, agentId, '1');
    assert.equal(reservedForDay(db, agentId, DAY), '9007199254740994');
    reserve(db, agentId, '9223372036854775808');
    assert.equal(reservedForDay(db, agentId, DAY), '9232379236109516802');
  });

  it('validates the arguments of reservedForDay', () => {
    const { db, agentId } = setup();
    for (const day of ['2026-11-4', 'today', '2026-02-30', '', undefined, null, 20261104]) {
      assert.throws(() => reservedForDay(db, agentId, day), ValidationError, String(day));
    }
    for (const id of [undefined, null, 5]) {
      assert.throws(() => reservedForDay(db, id, DAY), ValidationError);
    }
  });

  it('creates an ACTIVE reservation', () => {
    const { db, agentId } = setup();
    const requestId = reserve(db, agentId, '7');
    const row = getReservation(db, requestId);
    assert.equal(row.request_id, requestId);
    assert.equal(row.agent_id, agentId);
    assert.equal(row.amount, '7');
    assert.equal(row.budget_day, DAY);
    assert.equal(row.status, 'ACTIVE');
    assert.equal(row.release_reason, null);
    assert.equal(row.created_at, T);
    assert.equal(row.updated_at, T);
    assert.equal(getReservation(db, 'nope'), undefined);
    assert.equal(getReservation(db, undefined), undefined);
  });

  it('allows one reservation per request and rejects malformed values', () => {
    const { db, agentId } = setup();
    const requestId = reserve(db, agentId, '7');
    assert.throws(
      () => withWriteTransaction(db, () =>
        createReservation(db, { requestId, agentId, amount: '1', budgetDay: DAY }, T)),
      /UNIQUE constraint failed/i,
    );
    for (const amount of ['abc', '-1', '1.5', '01', '']) {
      assert.throws(
        () => withWriteTransaction(db, () =>
          createReservation(db, { requestId: addRequest(db, agentId), agentId, amount, budgetDay: DAY }, T)),
        /constraint failed/i,
        amount,
      );
    }
    for (const budgetDay of ['2026-11-4', 'today']) {
      assert.throws(
        () => withWriteTransaction(db, () =>
          createReservation(db, { requestId: addRequest(db, agentId), agentId, amount: '1', budgetDay }, T)),
        /constraint failed/i,
        budgetDay,
      );
    }
    assert.equal(reservedForDay(db, agentId, DAY), '7');
  });

  it('refuses every change outside a write transaction', () => {
    const { db, agentId } = setup();
    const requestId = reserve(db, agentId, '7');
    assert.throws(
      () => createReservation(db, { requestId: 'x', agentId, amount: '1', budgetDay: DAY }, T),
      /write transaction/i,
    );
    assert.throws(() => consumeReservation(db, requestId, T), /write transaction/i);
    assert.throws(() => releaseReservation(db, requestId, 'TEST', T), /write transaction/i);
    assert.equal(getReservation(db, requestId).status, 'ACTIVE');
  });

  it('consumes an active reservation and keeps it counted', () => {
    const { db, agentId } = setup();
    const requestId = reserve(db, agentId, '7');
    const row = consume(db, requestId);
    assert.equal(row.status, 'CONSUMED');
    assert.equal(row.release_reason, null);
    assert.equal(row.created_at, T);
    assert.equal(row.updated_at, LATER);
    assert.equal(reservedForDay(db, agentId, DAY), '7');
  });

  it('releases a reservation with a reason and frees the budget', () => {
    const { db, agentId } = setup();
    const requestId = reserve(db, agentId, '7');
    const row = release(db, requestId, 'EXPIRED');
    assert.equal(row.status, 'RELEASED');
    assert.equal(row.release_reason, 'EXPIRED');
    assert.equal(row.updated_at, LATER);
    assert.equal(reservedForDay(db, agentId, DAY), '0');
  });

  it('allows only one change per reservation', () => {
    const { db, agentId } = setup();
    const a = reserve(db, agentId, '1');
    const b = reserve(db, agentId, '2');
    consume(db, a);
    release(db, b);
    for (const id of [a, b]) {
      assert.throws(
        () => consume(db, id),
        (e) => e instanceof ConflictError && e.code === 'RESERVATION_STATE',
      );
      assert.throws(
        () => release(db, id),
        (e) => e instanceof ConflictError && e.code === 'RESERVATION_STATE',
      );
    }
    assert.equal(getReservation(db, a).status, 'CONSUMED');
    assert.equal(getReservation(db, b).status, 'RELEASED');
    assert.equal(getReservation(db, b).release_reason, 'TEST');
  });

  it('fails for unknown reservations', () => {
    const { db } = setup();
    assert.throws(() => consume(db, 'nope'), NotFoundError);
    assert.throws(() => release(db, 'nope'), NotFoundError);
    assert.throws(() => consume(db, undefined), NotFoundError);
  });

  it('validates release reasons', () => {
    const { db, agentId } = setup();
    const requestId = reserve(db, agentId, '7');
    for (const reason of ['', 5, null, undefined, 'x'.repeat(101)]) {
      assert.throws(() => release(db, requestId, reason), ValidationError, String(reason));
    }
    assert.equal(getReservation(db, requestId).status, 'ACTIVE');
  });

  it('rolls reservation changes back with the surrounding transaction', () => {
    const { db, agentId } = setup();
    const requestId = reserve(db, agentId, '7');
    assert.throws(
      () => withWriteTransaction(db, () => {
        consumeReservation(db, requestId, LATER);
        throw new Error('later step failed');
      }),
      /later step failed/,
    );
    assert.equal(getReservation(db, requestId).status, 'ACTIVE');
  });
});
