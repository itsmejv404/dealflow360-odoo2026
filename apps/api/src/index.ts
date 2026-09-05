import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';

const app = createApp();

const server = app.listen(env.API_PORT, () => {
  logger.info({ port: env.API_PORT, env: env.NODE_ENV }, 'api listening');
});

function shutdown(signal: string): void {
  logger.info({ signal }, 'shutting down');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
