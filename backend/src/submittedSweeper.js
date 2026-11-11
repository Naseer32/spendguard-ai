// Periodically re-verifies payments stuck in SUBMITTED (the owner reported a
// hash, but verification was inconclusive or held). Async because it calls the
// NEAR RPC. runNow() never throws, skips a run while one is still in flight,
// and the timer is unref'd so it never keeps the process alive.

import { reverifySubmitted } from './services/transactions.js';

function requireInteger(value, name, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new TypeError(`${name} must be an integer from ${min} to ${max}`);
  }
}

export function createSubmittedSweeper(options) {
  if (options === null || typeof options !== 'object') {
    throw new TypeError('options must be an object');
  }
  const { db, rpc, logger, now = Date.now, intervalMs, batchLimit = 20 } = options;
  if (db === null || typeof db !== 'object' || typeof db.prepare !== 'function') {
    throw new TypeError('db must be a database connection');
  }
  if (rpc === null || typeof rpc !== 'object' || typeof rpc.call !== 'function') {
    throw new TypeError('rpc must be an RPC client');
  }
  for (const level of ['debug', 'info', 'warn', 'error']) {
    if (logger === null || typeof logger !== 'object' || typeof logger[level] !== 'function') {
      throw new TypeError('logger must come from createLogger');
    }
  }
  if (typeof now !== 'function') throw new TypeError('now must be a function');
  requireInteger(intervalMs, 'intervalMs', 1, 3_600_000);
  requireInteger(batchLimit, 'batchLimit', 1, 100);

  let timer = null;
  let inFlight = false;
  let runs = 0;
  let failures = 0;
  let settled = 0;

  async function runNow() {
    if (inFlight) return { ok: true, skipped: true };
    inFlight = true;
    runs += 1;
    try {
      const counts = await reverifySubmitted(db, rpc, { now: now(), actor: 'system' }, { limit: batchLimit });
      settled += counts.settled;
      if (counts.settled > 0) logger.info('submitted.settled', counts);
      if (counts.errors > 0) logger.warn('submitted.errors', { errors: counts.errors });
      return { ok: true, skipped: false, ...counts };
    } catch (error) {
      failures += 1;
      logger.error('submitted.failed', { error });
      return { ok: false, skipped: false };
    } finally {
      inFlight = false;
    }
  }

  return Object.freeze({
    runNow,
    start() {
      if (timer !== null) return;
      timer = setInterval(runNow, intervalMs);
      timer.unref();
    },
    stop() {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    },
    stats() {
      return Object.freeze({ runs, failures, settled, running: timer !== null });
    },
  });
}
