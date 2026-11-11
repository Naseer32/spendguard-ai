// Starts the HTTP server: opens the database (unless one is provided), builds
// the app, listens, and starts the expiry sweeper. close() stops everything in
// order: sweeper, new connections, idle connections, then (after graceMs)
// connections that are still busy, and finally the database if we opened it.

import http from 'node:http';
import { createApp } from './app.js';
import { openDatabase } from './db/database.js';
import { createSweeper } from './sweeper.js';
import { createRpcClient } from './near/rpcClient.js';
import { createSubmittedSweeper } from './submittedSweeper.js';

export const SERVER_TIMEOUTS = Object.freeze({
  headersTimeout: 15_000,
  requestTimeout: 30_000,
  keepAliveTimeout: 5_000,
});
const DEFAULT_GRACE_MS = 10_000;

export async function startServer({
  config,
  logger,
  now = Date.now,
  db,
  routeModules,
  graceMs = DEFAULT_GRACE_MS,
} = {}) {
  if (
    config === null ||
    typeof config !== 'object' ||
    typeof config.host !== 'string' ||
    !Number.isInteger(config.port) ||
    typeof config.dbPath !== 'string' ||
    !Number.isInteger(config.sweepIntervalMs)
  ) {
    throw new TypeError('config must come from loadConfig');
  }
  if (logger === null || typeof logger !== 'object' || typeof logger.info !== 'function') {
    throw new TypeError('logger must come from createLogger');
  }
  if (!Number.isInteger(graceMs) || graceMs < 0) {
    throw new TypeError('graceMs must be a non-negative integer');
  }

  const ownsDb = db === undefined;
  const database = ownsDb ? openDatabase(config.dbPath) : db;
  let server = null;
  let sweeper = null;
  let submittedSweeper = null;
  let routes = [];

  try {
    const created = createApp({ db: database, config, logger, now, routeModules });
    routes = created.routes;
    server = http.createServer(created.app);
    server.headersTimeout = SERVER_TIMEOUTS.headersTimeout;
    server.requestTimeout = SERVER_TIMEOUTS.requestTimeout;
    server.keepAliveTimeout = SERVER_TIMEOUTS.keepAliveTimeout;
    sweeper = createSweeper({ db: database, logger, now, intervalMs: config.sweepIntervalMs });
    submittedSweeper = createSubmittedSweeper({
      db: database,
      rpc: createRpcClient({
        url: config.near.rpcUrl,
        timeoutMs: config.near.rpcTimeoutMs,
        maxResponseBytes: config.near.rpcMaxResponseBytes,
      }),
      logger,
      now,
      intervalMs: Math.min(Math.max(config.sweepIntervalMs, 15_000), 3_600_000),
    });

    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(config.port, config.host, () => {
        server.off('error', reject);
        resolve();
      });
    });
  } catch (error) {
    if (server !== null && server.listening) {
      server.close();
      server.closeAllConnections();
    }
    if (ownsDb) {
      try {
        database.close();
      } catch {
        // already closed
      }
    }
    throw error;
  }

  server.on('error', (error) => logger.error('server.error', { error }));
  sweeper.start();
  submittedSweeper.start();
  const { port } = server.address();
  logger.info('server.started', {
    host: config.host,
    port,
    dbPath: config.dbPath,
    corsOrigins: [...config.corsOrigins],
    // named authWindowMs on purpose: the logger redacts any key containing 'authorization'
    settings: {
      approvalWindowMs: config.settings.approvalWindowMs,
      authWindowMs: config.settings.authorizationWindowMs,
    },
    rateLimits: { ...config.rateLimits },
    sweepIntervalMs: config.sweepIntervalMs,
    routes: routes.length,
  });

  let closing = null;
  async function shutdown() {
    sweeper.stop();
    submittedSweeper.stop();
    const closed = new Promise((resolve) => {
      server.close(() => resolve());
    });
    server.closeIdleConnections();
    const forced = setTimeout(() => server.closeAllConnections(), graceMs);
    forced.unref();
    await closed;
    clearTimeout(forced);
    if (ownsDb) {
      database.close();
    }
    logger.info('server.stopped', {});
  }

  return Object.freeze({
    server,
    port,
    db: database,
    routes,
    sweeper,
    submittedSweeper,
    close() {
      if (closing === null) {
        closing = shutdown();
      }
      return closing;
    },
  });
}
