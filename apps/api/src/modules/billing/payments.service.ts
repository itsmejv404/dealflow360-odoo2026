import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { emitToOrg } from '../../lib/socket.js';
import { HttpError } from '../../shared/errors.js';
import { Prisma } from '@prisma/client';

export class PaymentsService {
  /** Get or initialize gateway config for organization */
  async getGatewayConfig(orgId: string) {
    let config = await prisma.paymentGatewayConfig.findUnique({
      where: { organizationId: orgId },
    });
    if (!config) {
      config = await prisma.paymentGatewayConfig.create({
        data: {
          organizationId: orgId,
          provider: 'sandbox',
          apiKey: `sb_key_${orgId.substring(0, 8)}`,
          webhookSecret: `sb_whsec_${orgId.substring(0, 8)}`,
          autoCapture: true,
          isEnabled: true,
        },
      });
    }
    return config;
  }

  /** Direct Payment Charge on an Invoice */
  async chargeInvoice(
    orgId: string,
    invoiceId: string,
    params?: { paymentMethod?: string; idempotencyKey?: string; userCtx?: { userId?: string } }
  ) {
    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { id: true, name: true, slug: true, currency: true },
    });
    if (!org) throw new HttpError(404, 'Organization not found');

    const invoice = await prisma.invoice.findFirst({
      where: { id: invoiceId, organizationId: orgId },
      include: { lines: true, subscription: true },
    });
    if (!invoice) throw new HttpError(404, 'Invoice not found in this organization');

    if (invoice.status === 'paid') {
      throw new HttpError(400, `Invoice ${invoice.invoiceNumber} is already fully paid`);
    }
    if (invoice.status === 'void') {
      throw new HttpError(400, `Cannot pay voided invoice ${invoice.invoiceNumber}`);
    }

    const txRef = params?.idempotencyKey || `mock_ch_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const paymentMethod = params?.paymentMethod || 'credit_card';

    const result = await prisma.$transaction(async (tx) => {
      // 1. Create Payment Record
      const payment = await tx.payment.create({
        data: {
          organizationId: orgId,
          invoiceId: invoice.id,
          transactionReference: txRef,
          paymentType: 'charge',
          paymentMethod,
          amount: invoice.totalAmount,
          currency: invoice.currency,
          status: 'succeeded',
          gatewayResponse: {
            provider: 'sandbox',
            authCode: 'AUTH_TEST_OK',
            timestamp: new Date().toISOString(),
          },
        },
      });

      // 2. Mark Invoice as Paid
      const updatedInvoice = await tx.invoice.update({
        where: { id: invoice.id },
        data: {
          status: 'paid',
          amountPaid: invoice.totalAmount,
          paidAt: new Date(),
        },
      });

      // 3. If tied to a billing schedule, mark schedule as paid
      await tx.billingSchedule.updateMany({
        where: { invoiceId: invoice.id, organizationId: orgId },
        data: { status: 'paid' },
      });

      // 4. Audit Log
      await tx.auditLog.create({
        data: {
          organizationId: orgId,
          entityType: 'invoice',
          entityId: invoice.id,
          action: 'payment_processed',
          reason: `Processed payment of ${invoice.currency} ${invoice.totalAmount} via ${paymentMethod} (${txRef})`,
          userId: params?.userCtx?.userId,
          metadata: {
            paymentId: payment.id,
            transactionReference: txRef,
            invoiceNumber: invoice.invoiceNumber,
            amount: Number(invoice.totalAmount),
            currency: invoice.currency,
          },
        },
      });

      return { payment, invoice: updatedInvoice };
    });

    emitToOrg(orgId, 'billing:updated', {
      invoiceId: invoice.id,
      action: 'invoice_paid',
      amount: Number(invoice.totalAmount),
      paymentId: result.payment.id,
    });

    logger.info(
      { orgId, invoiceId, transactionReference: txRef, amount: Number(invoice.totalAmount) },
      'Invoice payment charged successfully'
    );

    return result;
  }

  /** Process Refund for a Credit Note */
  async refundCreditNote(
    orgId: string,
    creditNoteId: string,
    params?: { paymentMethod?: string; userCtx?: { userId?: string } }
  ) {
    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { id: true, name: true, slug: true, currency: true },
    });
    if (!org) throw new HttpError(404, 'Organization not found');

    const creditNote = await prisma.creditNote.findFirst({
      where: { id: creditNoteId, organizationId: orgId },
      include: { invoice: true },
    });
    if (!creditNote) throw new HttpError(404, 'Credit note not found in this organization');

    if (creditNote.status === 'refunded') {
      throw new HttpError(400, `Credit note ${creditNote.creditNoteNumber} has already been refunded`);
    }

    const txRef = `mock_re_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const paymentMethod = params?.paymentMethod || 'credit_card';

    const result = await prisma.$transaction(async (tx) => {
      // 1. Create Refund Payment Record
      const payment = await tx.payment.create({
        data: {
          organizationId: orgId,
          creditNoteId: creditNote.id,
          invoiceId: creditNote.invoiceId ?? undefined,
          transactionReference: txRef,
          paymentType: 'refund',
          paymentMethod,
          amount: creditNote.amount,
          currency: creditNote.currency,
          status: 'succeeded',
          gatewayResponse: {
            provider: 'sandbox',
            refundId: txRef,
            timestamp: new Date().toISOString(),
          },
        },
      });

      // 2. Mark Credit Note as Refunded
      const updatedCreditNote = await tx.creditNote.update({
        where: { id: creditNote.id },
        data: {
          status: 'refunded',
          refundedAt: new Date(),
        },
      });

      // 3. Update Invoice refunded amount if linked
      if (creditNote.invoiceId) {
        const inv = await tx.invoice.findUnique({ where: { id: creditNote.invoiceId } });
        if (inv) {
          const newRefunded = new Prisma.Decimal(inv.amountRefunded).add(creditNote.amount);
          const isFull = newRefunded.gte(inv.totalAmount);
          await tx.invoice.update({
            where: { id: inv.id },
            data: {
              amountRefunded: newRefunded,
              status: isFull ? 'refunded' : 'partially_refunded',
            },
          });
        }
      }

      // 4. Audit Log
      await tx.auditLog.create({
        data: {
          organizationId: orgId,
          entityType: 'credit_note',
          entityId: creditNote.id,
          action: 'credit_note_refunded',
          reason: `Processed refund of ${creditNote.currency} ${creditNote.amount} (${txRef})`,
          userId: params?.userCtx?.userId,
          metadata: {
            paymentId: payment.id,
            creditNoteNumber: creditNote.creditNoteNumber,
            amount: Number(creditNote.amount),
          },
        },
      });

      return { payment, creditNote: updatedCreditNote };
    });

    emitToOrg(orgId, 'billing:updated', {
      creditNoteId: creditNote.id,
      action: 'credit_note_refunded',
      amount: Number(creditNote.amount),
      paymentId: result.payment.id,
    });

    logger.info(
      { orgId, creditNoteId, transactionReference: txRef, amount: Number(creditNote.amount) },
      'Credit note refund processed successfully'
    );

    return result;
  }

  /** Ingest and route Webhooks with tenant isolation & Dead Letter Queue logging */
  async handleWebhook(payload: any, headers?: Record<string, any>) {
    const eventId = payload?.id || `wh_${Date.now()}`;
    const eventType = payload?.type || payload?.event || 'unknown_event';
    const metadata = payload?.data?.object?.metadata || payload?.metadata || {};

    // 1. Resolve Organization
    let orgId: string | null = payload?.orgId || payload?.organizationId || metadata.orgId || metadata.organizationId || null;

    if (!orgId && metadata.invoiceNumber) {
      const inv = await prisma.invoice.findFirst({
        where: { invoiceNumber: metadata.invoiceNumber },
        select: { organizationId: true },
      });
      if (inv) orgId = inv.organizationId;
    }

    if (!orgId && payload?.data?.object?.invoiceId) {
      const inv = await prisma.invoice.findUnique({
        where: { id: payload.data.object.invoiceId },
        select: { organizationId: true },
      });
      if (inv) orgId = inv.organizationId;
    }

    // 2. If unroutable or malformed -> Persist to Dead Letter Queue (DLQ)
    if (!orgId) {
      logger.warn({ eventId, eventType }, 'Webhook missing organization routing; writing to DLQ');
      const dlq = await prisma.deadLetterJob.create({
        data: {
          organizationId: null,
          queueName: 'billing_webhooks',
          jobId: eventId,
          jobName: eventType,
          payload: payload || {},
          errorMessage: 'Unroutable webhook: could not determine organizationId from payload',
          status: 'failed',
        },
      });
      return { success: false, deadLetterId: dlq.id, reason: 'unroutable_tenant' };
    }

    // Verify Org exists
    const org = await prisma.organization.findUnique({ where: { id: orgId } });
    if (!org) {
      logger.warn({ orgId, eventId }, 'Webhook organization does not exist; writing to DLQ');
      const dlq = await prisma.deadLetterJob.create({
        data: {
          organizationId: null,
          queueName: 'billing_webhooks',
          jobId: eventId,
          jobName: eventType,
          payload: payload || {},
          errorMessage: `Tenant organization ${orgId} not found in system`,
          status: 'failed',
        },
      });
      return { success: false, deadLetterId: dlq.id, reason: 'tenant_not_found' };
    }

    // 3. Process Supported Webhook Events
    try {
      if (eventType === 'invoice.payment_succeeded' || eventType === 'charge.succeeded') {
        const invoiceId = payload.data?.object?.invoiceId || metadata.invoiceId;
        if (!invoiceId) {
          throw new Error('Missing invoiceId in payment succeeded event');
        }
        await this.chargeInvoice(orgId, invoiceId, {
          paymentMethod: payload.data?.object?.payment_method_details?.type || 'webhook_charge',
          idempotencyKey: eventId,
        });
      } else if (eventType === 'charge.refunded' || eventType === 'credit_note.refunded') {
        const creditNoteId = payload.data?.object?.creditNoteId || metadata.creditNoteId;
        if (!creditNoteId) {
          throw new Error('Missing creditNoteId in refund event');
        }
        await this.refundCreditNote(orgId, creditNoteId, {
          paymentMethod: 'webhook_refund',
        });
      }

      logger.info({ orgId, eventId, eventType }, 'Webhook handled successfully');
      return { success: true, orgId, eventType };
    } catch (err: any) {
      logger.error({ orgId, eventId, err }, 'Webhook processing failed; persisting to DLQ');
      const dlq = await prisma.deadLetterJob.create({
        data: {
          organizationId: orgId,
          queueName: 'billing_webhooks',
          jobId: eventId,
          jobName: eventType,
          payload: payload || {},
          errorMessage: err.message || 'Webhook processing exception',
          stackTrace: err.stack,
          status: 'failed',
        },
      });
      return { success: false, deadLetterId: dlq.id, error: err.message };
    }
  }

  /** List Dead Letter Queue Jobs */
  async listDlqJobs(filters?: { orgId?: string; status?: string; queueName?: string }) {
    return prisma.deadLetterJob.findMany({
      where: {
        ...(filters?.orgId !== undefined ? { organizationId: filters.orgId } : {}),
        ...(filters?.status ? { status: filters.status } : {}),
        ...(filters?.queueName ? { queueName: filters.queueName } : {}),
      },
      include: {
        organization: { select: { id: true, name: true, slug: true } },
      },
      orderBy: { failedAt: 'desc' },
    });
  }

  /** Get single DLQ Job with optional tenant constraint */
  async getDlqJob(jobId: string, orgId?: string) {
    const job = await prisma.deadLetterJob.findFirst({
      where: {
        id: jobId,
        ...(orgId ? { organizationId: orgId } : {}),
      },
      include: {
        organization: { select: { id: true, name: true, slug: true } },
      },
    });
    if (!job) throw new HttpError(404, 'Dead letter job not found');
    return job;
  }

  /** Retry a DLQ Job */
  async retryDlqJob(jobId: string, orgId?: string) {
    const job = await this.getDlqJob(jobId, orgId);

    if (job.status === 'retried') {
      throw new HttpError(400, 'This dead letter job has already been resolved');
    }

    try {
      // Re-run through handleWebhook with the saved payload
      const res = await this.handleWebhook(job.payload);
      if (!res.success) {
        // Still failed, increment retryCount and update errorMessage
        await prisma.deadLetterJob.update({
          where: { id: job.id },
          data: {
            retryCount: { increment: 1 },
            errorMessage: res.error || 'Retry attempt failed',
          },
        });
        return { success: false, message: 'Retry attempt failed', error: res.error };
      }

      // Mark DLQ job as retried and resolved
      const resolved = await prisma.deadLetterJob.update({
        where: { id: job.id },
        data: {
          status: 'retried',
          retryCount: { increment: 1 },
          resolvedAt: new Date(),
        },
      });

      return { success: true, message: 'Dead letter job successfully retried and resolved', job: resolved };
    } catch (err: any) {
      await prisma.deadLetterJob.update({
        where: { id: job.id },
        data: {
          retryCount: { increment: 1 },
          errorMessage: err.message,
        },
      });
      return { success: false, message: 'Retry exception', error: err.message };
    }
  }

  /** Dismiss a DLQ Job */
  async dismissDlqJob(jobId: string, orgId?: string) {
    const job = await this.getDlqJob(jobId, orgId);

    const dismissed = await prisma.deadLetterJob.update({
      where: { id: job.id },
      data: {
        status: 'dismissed',
        resolvedAt: new Date(),
      },
    });

    return { success: true, message: 'Dead letter job dismissed', job: dismissed };
  }
}

export const paymentsService = new PaymentsService();
