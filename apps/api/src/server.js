import './core/jobs/maintenance.js';
import { jobs } from './core/jobs/index.js';
import { SHUTDOWN_TIMEOUT_MS } from './config/constants.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { createApp } from './app.js';
import { disconnectDatabase } from './db/client.js';

async function start() {
  if (env.JOBS_ENABLED) await jobs.start();
  const app = createApp();
  const server = app.listen(env.PORT, (err) => {
    if (err) {
      logger.fatal({ err }, 'Failed to start the API');
      process.exit(1);
    }
    logger.info({ port: env.PORT, env: env.NODE_ENV }, 'API listening');
  });

  let shuttingDown = false;
  /** @param {NodeJS.Signals} signal */
  function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down: no longer accepting connections');

    const forceExit = setTimeout(() => {
      logger.error('Graceful shutdown timed out, forcing exit');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forceExit.unref();

    server.close(async (err) => {
      if (err) logger.error({ err }, 'Error while closing the HTTP server');
      else logger.info('HTTP server closed');
      try {
        await jobs.stop();
        await disconnectDatabase();
        logger.info('Database disconnected');
      } catch (dbErr) {
        logger.error({ err: dbErr }, 'Error while disconnecting the database');
        process.exit(1);
      }
      process.exit(err ? 1 : 0);
    });
    server.closeIdleConnections();
  }

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'Unhandled promise rejection');
});

process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception, exiting');
  process.exit(1);
});

try {
  await start();
} catch (err) {
  // Bootstrap fallback: the logger itself may be what failed.
  console.error('FieldFlow API failed to start:', err);
  process.exit(1);
}
