// Periodically expires pending approvals and stale authorizations.
//
// runNow() performs up to maxBatches batches of batchLimit requests and never
// throws: a failure is logged (error name and code only) and the next tick
// tries again. The timer is unref'd so it never keeps the process alive.

import { expireDueRequests } from './services/approvals.js';

function requireInteger(value, name, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new TypeError(`${name} must be an integer from ${min} to ${max}`);
  }
}

export function createSweeper(options) {
  if (options === null || typeof options !== 'object') {
    throw new TypeError('options must be an object');
  }
  const { db, logger, now = Date.now, intervalMs, batchLimit = 100, maxBatches = 10 } = options;
  if (db === null || typeof db !== 'object' || typeof db.prepare !== 'function') {
    throw new TypeError('db must be a database connection');
  }
  for (const level of ['debug', 'info', 'warn', 'error']) {
    if (logger === null || typeof logger !== 'object' || typeof logger[level] !== 'function') {
      throw new TypeError('logger must come from createLogger');
    }
  }
  if (typeof now !== 'function') {
    throw new TypeError('now must be a function');
  }
  requireInteger(intervalMs, 'intervalMs', 1, 3_600_000);
  requireInteger(batchLimit, 'batchLimit', 1, 1000);
  requireInteger(maxBatches, 'maxBatches', 1, 100);

  let timer = null;
  let runs = 0;
  let failures = 0;
  let totalExpired = 0;

  function runNow() {
    runs += 1;
    let expired = 0;
    let batches = 0;
    let more = false;
    try {
      while (batches < maxBatches) {
        const result = expireDueRequests(
          db,
          { now: now(), actor: 'system' },
          { limit: batchLimit },
        );
        batches += 1;
        expired += result.expired;
        more = result.more;
        if (!more) {
          break;
        }
      }
      totalExpired += expired;
      if (expired > 0) {
        logger.info('sweep.expired', { expired, batches, more });
      }
      return { expired, batches, more, ok: true };
    } catch (error) {
      failures += 1;
      logger.error('sweep.failed', { error });
      return { expired, batches, more, ok: false };
    }
  }

  return Object.freeze({
    runNow,
    start() {
      if (timer !== null) {
        return;
      }
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
      return Object.freeze({ runs, failures, expired: totalExpired, running: timer !== null });
    },
  });
}
