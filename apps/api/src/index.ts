import http from 'http';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { initSocketIO } from './lib/socket.js';
import { startApprovalNotificationWorker } from './modules/approvals/approvals.worker.js';
import { startBackorderConsolidationWorker } from './modules/fulfillment/fulfillment.worker.js';
import { startBillingScheduleWorker, startProrationWorker } from './modules/billing/billing.worker.js';
import { startDealHealthWorker, enqueueScansForAllOrgs } from './modules/dealhealth/dealhealth.worker.js';

const app = createApp();
const server = http.createServer(app);

// Initialize Socket.IO with multi-tenant auth and room isolation
initSocketIO(server);

// Start BullMQ background workers
const approvalWorker = startApprovalNotificationWorker();
const backorderWorker = startBackorderConsolidationWorker();
const billingWorker = startBillingScheduleWorker();
const prorationWorker = startProrationWorker();
const dealHealthWorker = startDealHealthWorker();

// Phase 21: scheduled deal-health scans — every 6 hours, plus one pass shortly after boot
const DEAL_HEALTH_SCAN_INTERVAL_MS = 6 * 60 * 60 * 1000;
async function scheduleDealHealthScans(): Promise<void> {
  const count = await enqueueScansForAllOrgs();
  logger.info({ orgs: count }, 'Deal health scans enqueued for all active orgs');
}
const initialScanTimer = setTimeout(() => {
  scheduleDealHealthScans().catch((err) => logger.error({ err }, 'Initial deal health scan failed'));
}, 15_000);
initialScanTimer.unref();
const scanInterval = setInterval(() => {
  scheduleDealHealthScans().catch((err) => logger.error({ err }, 'Scheduled deal health scan failed'));
}, DEAL_HEALTH_SCAN_INTERVAL_MS);
scanInterval.unref();

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
