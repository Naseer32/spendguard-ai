// Entry point: node src/server.js (or npm start).
// Configuration comes from environment variables (see .env.example).

import { ConfigError, loadConfig } from './config.js';
import { createLogger } from './http/logger.js';
import { startServer } from './runtime.js';

const HINTS = Object.freeze({
  EADDRINUSE: 'the port is already in use',
  EACCES: 'permission denied for the port or the database file',
  EADDRNOTAVAIL: 'the HOST address is not available on this machine',
  ENOENT: 'a path does not exist; check DB_PATH',
  ERR_SQLITE_ERROR: 'the database could not be opened or migrated',
});

function hintFor(error) {
  const code = error !== null && typeof error === 'object' ? error.code : undefined;
  return typeof code === 'string' && Object.hasOwn(HINTS, code) ? HINTS[code] : null;
}

const bootLogger = createLogger({ level: 'info' });

process.on('unhandledRejection', (reason) => {
  bootLogger.error('process.unhandled_rejection', { error: reason });
  setImmediate(() => process.exit(1));
});
process.on('uncaughtException', (error) => {
  bootLogger.error('process.uncaught_exception', { error });
  setImmediate(() => process.exit(1));
});

async function main() {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      bootLogger.error('startup.config_invalid', { problems: [...error.problems] });
    } else {
      bootLogger.error('startup.failed', { error });
    }
    process.exitCode = 1;
    return;
  }

  const logger = createLogger({ level: config.logLevel });
  let running;
  try {
    running = await startServer({ config, logger });
  } catch (error) {
    const code = error !== null && typeof error === 'object' && typeof error.code === 'string' ? error.code : null;
    logger.error('startup.failed', { error, code, hint: hintFor(error) });
    process.exitCode = 1;
    return;
  }

  let stopping = false;
  function stop(signal) {
    if (stopping) {
      return;
    }
    stopping = true;
    logger.info('shutdown.started', { signal });
    running.close().then(
      () => {
        process.exitCode = 0;
      },
      (error) => {
        logger.error('shutdown.failed', { error });
        process.exitCode = 1;
      },
    );
  }
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));
}

main();
