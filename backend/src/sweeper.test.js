import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from './db/database.js';
import { createLogger } from './http/logger.js';
import { nearToYocto as N } from './money/yocto.js';
import { getPaymentRequest } from './services/payments.js';
import { getReservation, reservedForDay } from './services/reservations.js';
import { createSweeper } from './sweeper.js';
import { describeBackends } from './testing/dbKit.js';
import { budgetAgent, pay, setupAgent } from './testing/paymentKit.js';
import { NOW, auditEvents } from './testing/serviceKit.js';

const H = 3_600_000;
const DAY = '2026-11-04';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function makeLogs() {
  const lines = [];
  const logger = createLogger({ level: 'debug', write: (line) => lines.push(line), now: () => NOW });
  return { logger, entries: () => lines.map((line) => JSON.parse(line)), text: () => lines.join('\n') };
}

function makeClock(start = NOW) {
  let current = start;
  return { now: () => current, set(value) { current = value; } };
}

describe('sweeper options', () => {
  it('validates its options', () => {
    const db = openDatabase(':memory:');
    const { logger } = makeLogs();
    const ok = { db, logger, intervalMs: 1000 };
    const bad = [
      undefined, null, 'x', {}, { ...ok, db: null }, { ...ok, db: {} }, { ...ok, logger: null },
      { ...ok, logger: {} }, { ...ok, now: 'x' }, { ...ok, intervalMs: 0 }, { ...ok, intervalMs: 3_600_001 },
      { ...ok, intervalMs: 1.5 }, { ...ok, intervalMs: '5' }, { ...ok, intervalMs: undefined },
      { ...ok, batchLimit: 0 }, { ...ok, batchLimit: 1001 }, { ...ok, maxBatches: 0 }, { ...ok, maxBatches: 101 },
    ];
    bad.forEach((options, i) => {
      assert.throws(() => createSweeper(options), TypeError, `options #${i}`);
    });
    assert.doesNotThrow(() => createSweeper(ok));
    assert.doesNotThrow(() => createSweeper({ ...ok, intervalMs: 1, batchLimit: 1000, maxBatches: 100 }));
    db.close();
  });
});

describeBackends('sweeper runs', (ctx) => {
  it('expires due requests, releases their budget and audits them as the system', () => {
    const db = ctx.open();
    const agentId = setupAgent(db, budgetAgent());
    const a = pay(db, agentId, { amount: N('20') }, NOW).request; // approved, expires at +1h
    const b = pay(db, agentId, { amount: N('20') }, NOW).request;
    const pending = pay(db, agentId, { recipient: 'other.testnet' }, NOW).request; // expires at +24h
    assert.equal(reservedForDay(db, agentId, DAY), N('40'));

    const clock = makeClock(NOW + H);
    const logs = makeLogs();
    const sweeper = createSweeper({ db, logger: logs.logger, now: clock.now, intervalMs: 1000 });

    assert.deepEqual(sweeper.runNow(), { expired: 2, batches: 1, more: false, ok: true });
    for (const id of [a.id, b.id]) {
      assert.equal(getPaymentRequest(db, id).status, 'EXPIRED');
      assert.equal(getReservation(db, id).status, 'RELEASED');
      assert.equal(getReservation(db, id).release_reason, 'EXPIRED');
    }
    assert.equal(getPaymentRequest(db, pending.id).status, 'APPROVAL_REQUIRED');
    assert.equal(reservedForDay(db, agentId, DAY), '0');

    const events = auditEvents(db).slice(-2);
    assert.deepEqual(events.map((e) => e.event), ['PAYMENT_EXPIRED', 'PAYMENT_EXPIRED']);
    assert.ok(events.every((e) => e.actor === 'system'));

    const logged = logs.entries().filter((e) => e.event === 'sweep.expired');
    assert.equal(logged.length, 1);
    assert.equal(logged[0].level, 'info');
    assert.equal(logged[0].expired, 2);
    assert.equal(logged[0].batches, 1);
    assert.equal(logged[0].more, false);

    clock.set(NOW + 24 * H);
    assert.deepEqual(sweeper.runNow(), { expired: 1, batches: 1, more: false, ok: true });
    assert.equal(getPaymentRequest(db, pending.id).status, 'EXPIRED');
  });

  it('does nothing, and logs nothing, when nothing is due', () => {
    const db = ctx.open();
    const agentId = setupAgent(db);
    pay(db, agentId, {}, NOW);
    const logs = makeLogs();
    const sweeper = createSweeper({ db, logger: logs.logger, now: makeClock(NOW + H - 1).now, intervalMs: 1000 });
    assert.deepEqual(sweeper.runNow(), { expired: 0, batches: 1, more: false, ok: true });
    assert.equal(logs.entries().length, 0);
    assert.deepEqual({ ...sweeper.stats() }, { runs: 1, failures: 0, expired: 0, running: false });
  });

  it('works through a backlog in batches, up to the batch cap', () => {
    const db = ctx.open();
    const agentId = setupAgent(db);
    for (let i = 0; i < 5; i += 1) pay(db, agentId, {}, NOW + i * 1000);
    const clock = makeClock(NOW + 2 * H);
    const logs = makeLogs();
    const make = (maxBatches) => createSweeper({
      db, logger: logs.logger, now: clock.now, intervalMs: 1000, batchLimit: 2, maxBatches,
    });

    assert.deepEqual(make(1).runNow(), { expired: 2, batches: 1, more: true, ok: true });
    assert.deepEqual(make(2).runNow(), { expired: 2, batches: 2, more: true, ok: true });
    assert.deepEqual(make(10).runNow(), { expired: 1, batches: 1, more: false, ok: true });
    assert.deepEqual(make(10).runNow(), { expired: 0, batches: 1, more: false, ok: true });
    const logged = logs.entries().filter((e) => e.event === 'sweep.expired');
    assert.deepEqual(logged.map((e) => [e.expired, e.more]), [[2, true], [2, true], [1, false]]);
  });

  it('clears a whole backlog in one run when the cap allows', () => {
    const db = ctx.open();
    const agentId = setupAgent(db);
    for (let i = 0; i < 5; i += 1) pay(db, agentId, {}, NOW + i * 1000);
    const sweeper = createSweeper({
      db, logger: makeLogs().logger, now: makeClock(NOW + 2 * H).now, intervalMs: 1000, batchLimit: 2,
    });
    assert.deepEqual(sweeper.runNow(), { expired: 5, batches: 3, more: false, ok: true });
  });

  it('never throws on failure, logs only the error name and code, and keeps counting', () => {
    const db = ctx.open();
    const logs = makeLogs();
    const sweeper = createSweeper({ db, logger: logs.logger, now: makeClock().now, intervalMs: 1000 });
    db.close();
    let result;
    assert.doesNotThrow(() => { result = sweeper.runNow(); });
    assert.equal(result.ok, false);
    assert.equal(result.expired, 0);
    const failed = logs.entries().find((e) => e.event === 'sweep.failed');
    assert.equal(failed.level, 'error');
    assert.equal(typeof failed.error.name, 'string');
    assert.equal(Object.hasOwn(failed.error, 'message'), false);
    sweeper.runNow();
    assert.deepEqual({ ...sweeper.stats() }, { runs: 2, failures: 2, expired: 0, running: false });
  });

  it('survives a failing clock', () => {
    const db = ctx.open();
    const logs = makeLogs();
    const sweeper = createSweeper({
      db, logger: logs.logger, intervalMs: 1000,
      now: () => { throw new Error('clock broke'); },
    });
    assert.equal(sweeper.runNow().ok, false);
    assert.ok(!logs.text().includes('clock broke'));
  });
});

describe('sweeper timer', () => {
  it('runs on a timer and stops when asked', async () => {
    const db = openDatabase(':memory:');
    const sweeper = createSweeper({ db, logger: makeLogs().logger, intervalMs: 20 });
    assert.equal(sweeper.stats().running, false);
    sweeper.start();
    assert.equal(sweeper.stats().running, true);
    await sleep(200);
    sweeper.stop();
    const stopped = sweeper.stats();
    assert.equal(stopped.running, false);
    assert.ok(stopped.runs >= 3, `only ${stopped.runs} runs`);
    await sleep(100);
    assert.equal(sweeper.stats().runs, stopped.runs);
    sweeper.stop(); // stopping twice is fine
    db.close();
  });

  it('does not start a second timer when started twice', async () => {
    const db = openDatabase(':memory:');
    const sweeper = createSweeper({ db, logger: makeLogs().logger, intervalMs: 40 });
    sweeper.start();
    sweeper.start();
    await sleep(250);
    sweeper.stop();
    assert.ok(sweeper.stats().runs <= 8, `${sweeper.stats().runs} runs suggests two timers`);
    db.close();
  });

  it('expires requests by itself through the timer', async () => {
    const db = openDatabase(':memory:');
    const agentId = setupAgent(db);
    const created = pay(db, agentId, {}, NOW).request;
    const clock = makeClock(NOW + H);
    const sweeper = createSweeper({ db, logger: makeLogs().logger, now: clock.now, intervalMs: 20 });
    sweeper.start();
    for (let i = 0; i < 100 && getPaymentRequest(db, created.id).status !== 'EXPIRED'; i += 1) {
      await sleep(20);
    }
    sweeper.stop();
    assert.equal(getPaymentRequest(db, created.id).status, 'EXPIRED');
    db.close();
  });
});
