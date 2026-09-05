import { Worker, type Job } from 'bullmq';
import { bullRedisConnection, APPROVAL_NOTIFICATION_QUEUE, type ApprovalNotificationJobPayload } from '../../lib/queue.js';
import {
  sendApprovalRequestedEmail,
  sendApprovalDecisionEmail,
  sendNegotiationActivityEmail,
  sendQuoteConfirmedEmail,
} from '../../lib/mailer.js';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';

export function startApprovalNotificationWorker(): Worker<ApprovalNotificationJobPayload> {
  const worker = new Worker<ApprovalNotificationJobPayload>(
    APPROVAL_NOTIFICATION_QUEUE,
    async (job: Job<ApprovalNotificationJobPayload>) => {
      const {
        orgId,
        type,
        quotationId,
        quotationNumber,
        customerName,
        requestedByEmail,
        requestedByName,
        decision,
        reason,
        riskScore = 0,
        riskLevel = 'low',
        recipients,
      } = job.data;

      logger.info(
        { jobId: job.id, orgId, type, quotationNumber, recipientCount: recipients.length },
        'Processing approval notification email job'
      );

      // Verify organization context
      const org = await prisma.organization.findUnique({
        where: { id: orgId },
        select: { id: true, name: true },
      });

      if (!org) {
        logger.warn({ orgId, jobId: job.id }, 'Organization not found for approval notification job');
        return;
      }

      if (!recipients || recipients.length === 0) {
        logger.warn({ orgId, jobId: job.id }, 'No recipients for approval notification job');
        return;
      }

      if (type === 'manager_review_requested') {
        await sendApprovalRequestedEmail({
          to: recipients,
          orgName: org.name,
          quotationNumber,
          quotationId,
          customerName,
          requesterName: requestedByName,
          requesterEmail: requestedByEmail,
          stage: 'manager',
          riskScore,
          riskLevel,
        });
      } else if (type === 'finance_escalation_requested') {
        await sendApprovalRequestedEmail({
          to: recipients,
          orgName: org.name,
          quotationNumber,
          quotationId,
          customerName,
          requesterName: requestedByName,
          requesterEmail: requestedByEmail,
          stage: 'finance',
          riskScore,
          riskLevel,
        });
      } else if (type === 'decision_rendered') {
        await sendApprovalDecisionEmail({
          to: recipients,
          orgName: org.name,
          quotationNumber,
          quotationId,
          decision: decision || 'approved',
          reason,
          requesterName: requestedByName,
          stage: 'manager',
          riskScore,
          riskLevel,
        });
      } else if (type === 'counter_received' || type === 'change_request_received') {
        // Phase 14: customer negotiation activity → notify the rep.
        await sendNegotiationActivityEmail({
          to: recipients,
          orgName: org.name,
          quotationNumber,
          quotationId,
          customerName,
          activity: type === 'counter_received' ? 'counter' : 'change_request',
          actorName: requestedByName || 'Customer',
          actorEmail: requestedByEmail,
          note: reason || job.data.negotiationNote,
          proposedDiscountPercent: job.data.proposedDiscountPercent,
        });
      } else if (type === 'quote_confirmed') {
        // Phase 14: customer confirmed — either auto-confirmed or re-entered approval.
        await sendQuoteConfirmedEmail({
          to: recipients,
          orgName: org.name,
          quotationNumber,
          quotationId,
          customerName,
          reenteredApproval: reason === 'reentered_approval',
        });
      }
    },
    {
      connection: bullRedisConnection,
      concurrency: 5,
    }
  );

  worker.on('completed', (job: Job) => {
    logger.info({ jobId: job.id, queue: APPROVAL_NOTIFICATION_QUEUE }, 'Approval notification job completed');
  });

  worker.on('failed', (job: Job | undefined, err: Error) => {
    logger.error({ jobId: job?.id, queue: APPROVAL_NOTIFICATION_QUEUE, err: err.message }, 'Approval notification job failed');
  });

  return worker;
}
