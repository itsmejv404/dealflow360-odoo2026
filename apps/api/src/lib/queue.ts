import { Queue, Worker, type Job, type QueueOptions, type WorkerOptions } from 'bullmq';
import { env } from '../config/env.js';
import { logger } from './logger.js';

const redisUrl = new URL(env.REDIS_URL);
export const bullRedisConnection = {
  host: redisUrl.hostname,
  port: Number(redisUrl.port) || 6379,
  password: redisUrl.password || undefined,
  maxRetriesPerRequest: null,
};

export const APPROVAL_NOTIFICATION_QUEUE = 'org_approval_notifications';
export const BACKORDER_CONSOLIDATION_QUEUE = 'org_backorder_consolidation';
export const BILLING_SCHEDULE_QUEUE = 'org_billing_schedules';
export const PRORATION_QUEUE = 'org_proration_runs';
export const DEAL_HEALTH_SCAN_QUEUE = 'org_deal_health_scans';

export interface ApprovalNotificationJobPayload {
  orgId: string;
  type:
    | 'manager_review_requested'
    | 'finance_escalation_requested'
    | 'decision_rendered'
    | 'counter_received'
    | 'change_request_received'
    | 'quote_confirmed';
  quotationId: string;
  quotationNumber: string;
  customerName?: string;
  requestedByEmail?: string;
  requestedByName?: string;
  decision?: 'approved' | 'rejected';
  reason?: string;
  riskScore?: number;
  riskLevel?: string;
  /** Phase 14 negotiation payloads */
  activity?: 'counter' | 'change_request' | 'comment';
  negotiationNote?: string;
  proposedDiscountPercent?: number;
  recipients: string[];
}

export interface BackorderConsolidationJobPayload {
  orgId: string;
  warehouseId: string;
  productId: string;
  quantityAdded: number;
  timestamp: string;
}

export interface BillingScheduleJobPayload {
  orgId: string;
  quotationId: string;
  subscriptionId?: string;
}

export interface ProrationJobPayload {
  orgId: string;
  subscriptionId: string;
  newQuantity: number;
  effectiveDate?: string;
  reason?: string;
  requestedBy?: { userId?: string; email?: string; role?: string };
}

export interface DealHealthScanJobPayload {
  orgId: string;
  trigger?: 'scheduled' | 'manual';
}

export const approvalNotificationQueue = new Queue<ApprovalNotificationJobPayload>(
  APPROVAL_NOTIFICATION_QUEUE,
  {
    connection: bullRedisConnection,
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000,
      },
      removeOnComplete: 100,
      removeOnFail: 500,
    },
  }
);

export const backorderConsolidationQueue = new Queue<BackorderConsolidationJobPayload>(
  BACKORDER_CONSOLIDATION_QUEUE,
  {
    connection: bullRedisConnection,
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000,
      },
      removeOnComplete: 100,
      removeOnFail: 500,
    },
  }
);

export const billingScheduleQueue = new Queue<BillingScheduleJobPayload>(
  BILLING_SCHEDULE_QUEUE,
  {
    connection: bullRedisConnection,
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000,
      },
      removeOnComplete: 100,
      removeOnFail: 500,
    },
  }
);

export const prorationQueue = new Queue<ProrationJobPayload>(
  PRORATION_QUEUE,
  {
    connection: bullRedisConnection,
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000,
      },
      removeOnComplete: 100,
      removeOnFail: 500,
    },
  }
);

export const dealHealthScanQueue = new Queue<DealHealthScanJobPayload>(
  DEAL_HEALTH_SCAN_QUEUE,
  {
    connection: bullRedisConnection,
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000,
      },
      removeOnComplete: 100,
      removeOnFail: 500,
    },
  }
);

// Worker liveness tracking registry
interface RegisteredWorkerMeta {
  worker: Worker<any>;
  name: string;
  displayName: string;
  queue: Queue<any>;
  concurrency: number;
  lastActiveAt: string | null;
}

const workerRegistry = new Map<string, RegisteredWorkerMeta>();

export function registerWorker(
  name: string,
  displayName: string,
  queue: Queue<any>,
  worker: Worker<any>,
  concurrency: number = 5
) {
  const meta: RegisteredWorkerMeta = {
    worker,
    name,
    displayName,
    queue,
    concurrency,
    lastActiveAt: new Date().toISOString(),
  };

  worker.on('active', () => {
    meta.lastActiveAt = new Date().toISOString();
  });
  worker.on('completed', () => {
    meta.lastActiveAt = new Date().toISOString();
  });

  workerRegistry.set(name, meta);
}

export interface WorkerHealthState {
  name: string;
  isAlive: boolean;
  concurrency: number;
  activeWorkersCount: number;
  lastActiveAt: string | null;
}

export interface QueueMetric {
  name: string;
  displayName: string;
  counts: {
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
  };
  worker: WorkerHealthState;
}

export interface QueueHealthReport {
  status: 'healthy' | 'degraded';
  timestamp: string;
  queues: QueueMetric[];
}

export async function getQueueHealthStatus(): Promise<QueueHealthReport> {
  const queuesToCheck = [
    {
      name: BACKORDER_CONSOLIDATION_QUEUE,
      displayName: 'Backorder Auto-Consolidation',
      queue: backorderConsolidationQueue,
    },
    {
      name: APPROVAL_NOTIFICATION_QUEUE,
      displayName: 'Approval Notifications & Negotiation',
      queue: approvalNotificationQueue,
    },
    {
      name: BILLING_SCHEDULE_QUEUE,
      displayName: 'Billing Schedule Engine',
      queue: billingScheduleQueue,
    },
    {
      name: PRORATION_QUEUE,
      displayName: 'Mid-Cycle Subscription Proration',
      queue: prorationQueue,
    },
    {
      name: DEAL_HEALTH_SCAN_QUEUE,
      displayName: 'Deal Health Scanner',
      queue: dealHealthScanQueue,
    },
  ];

  let hasFailedWorkers = false;

  const queueMetrics: QueueMetric[] = await Promise.all(
    queuesToCheck.map(async (q) => {
      try {
        const counts = await q.queue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed');
        const workers = await q.queue.getWorkers();
        const reg = workerRegistry.get(q.name);

        const isAlive = Boolean(reg && !reg.worker.closing) || workers.length > 0;
        if (!isAlive) {
          hasFailedWorkers = true;
        }

        return {
          name: q.name,
          displayName: q.displayName,
          counts: {
            waiting: counts.waiting ?? 0,
            active: counts.active ?? 0,
            completed: counts.completed ?? 0,
            failed: counts.failed ?? 0,
            delayed: counts.delayed ?? 0,
          },
          worker: {
            name: q.name,
            isAlive,
            concurrency: reg?.concurrency ?? 5,
            activeWorkersCount: Math.max(workers.length, isAlive ? 1 : 0),
            lastActiveAt: reg?.lastActiveAt ?? null,
          },
        };
      } catch (err: any) {
        logger.error({ queue: q.name, err: err.message }, 'Failed to fetch queue counts');
        hasFailedWorkers = true;
        return {
          name: q.name,
          displayName: q.displayName,
          counts: { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 },
          worker: {
            name: q.name,
            isAlive: false,
            concurrency: 5,
            activeWorkersCount: 0,
            lastActiveAt: null,
          },
        };
      }
    })
  );

  return {
    status: hasFailedWorkers ? 'degraded' : 'healthy',
    timestamp: new Date().toISOString(),
    queues: queueMetrics,
  };
}
