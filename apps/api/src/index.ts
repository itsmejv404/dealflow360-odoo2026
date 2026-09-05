import http from 'http';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { initSocketIO } from './lib/socket.js';
import { startApprovalNotificationWorker } from './modules/approvals/approvals.worker.js';
import { startBackorderConsolidationWorker } from './modules/fulfillment/fulfillment.worker.js';

const app = createApp();
const server = http.createServer(app);

// Initialize Socket.IO with multi-tenant auth and room isolation
initSocketIO(server);

// Start BullMQ background workers
const approvalWorker = startApprovalNotificationWorker();
const backorderWorker = startBackorderConsolidationWorker();

server.listen(env.API_PORT, () => {
  logger.info({ port: env.API_PORT, env: env.NODE_ENV }, 'api & realtime socket server listening');
});

function shutdown(signal: string): void {
  logger.info({ signal }, 'shutting down');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
