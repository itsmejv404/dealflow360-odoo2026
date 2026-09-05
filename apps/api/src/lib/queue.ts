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
