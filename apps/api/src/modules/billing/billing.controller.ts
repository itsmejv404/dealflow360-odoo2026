import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { billingService } from './billing.service.js';
import { paymentsService } from './payments.service.js';
import { prorationQueue } from '../../lib/queue.js';
import { HttpError, friendlyZodMessage } from '../../shared/errors.js';
import { prisma } from '../../lib/prisma.js';

const surchargeSchema = z.object({
  label: z.string().min(1, 'Label is required').max(120),
  kind: z.enum(['amount', 'percent']),
  value: z.number().min(0, 'Value cannot be negative'),
});

type SurchargeInput = z.infer<typeof surchargeSchema>;

export class BillingController {
  async getQuotationBilling(req: Request, res: Response, next: NextFunction) {
    try {
      const orgId = req.tenant!.orgId;
      const quotationId = req.params.quotationId!;
      const data = await billingService.getQuotationBillingSummary(orgId, quotationId);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }

  async splitQuotationOrder(req: Request, res: Response, next: NextFunction) {
    try {
      const orgId = req.tenant!.orgId;
      const quotationId = req.params.quotationId!;
      const data = await billingService.confirmAndSplitOrder(orgId, quotationId);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }

  async listInvoices(req: Request, res: Response, next: NextFunction) {
    try {
      const orgId = req.tenant!.orgId;
      const { quotationId, status, type } = req.query;
      const data = await billingService.listInvoices(orgId, {
        quotationId: quotationId as string | undefined,
        status: status as string | undefined,
        type: type as string | undefined,
      });
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }

  async getInvoice(req: Request, res: Response, next: NextFunction) {
    try {
      const orgId = req.tenant!.orgId;
      const invoiceId = req.params.id!;
      const data = await billingService.getInvoice(orgId, invoiceId);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }

  async addSurcharge(req: Request, res: Response, next: NextFunction) {
    try {
      const orgId = req.tenant!.orgId;
      const invoiceId = req.params.id!;
      const parsed = surchargeSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new HttpError(400, friendlyZodMessage(parsed.error.issues));
      }
      const surcharge = await billingService.addSurcharge(
        orgId,
        invoiceId,
        parsed.data as SurchargeInput
      );
      res.status(201).json({ success: true, data: surcharge });
    } catch (err) {
      next(err);
    }
  }

  async removeSurcharge(req: Request, res: Response, next: NextFunction) {
    try {
      const orgId = req.tenant!.orgId;
      const { id, surchargeId } = req.params;
      if (!id || !surchargeId) throw new HttpError(400, 'Invoice ID and Surcharge ID are required');
      const result = await billingService.removeSurcharge(orgId, id, surchargeId);
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }

  async listSubscriptions(req: Request, res: Response, next: NextFunction) {
    try {
      const orgId = req.tenant!.orgId;
      const { status } = req.query;
      const data = await billingService.listSubscriptions(orgId, {
        status: status as string | undefined,
      });
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }

  async getSubscription(req: Request, res: Response, next: NextFunction) {
    try {
      const orgId = req.tenant!.orgId;
      const subscriptionId = req.params.id!;
      const data = await billingService.getSubscription(orgId, subscriptionId);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }

  /** Phase 19: Preview proration math before modifying quantity */
  async previewProration(req: Request, res: Response, next: NextFunction) {
    try {
      const orgId = req.tenant!.orgId;
      const subscriptionId = req.params.id!;
      const newQuantity = Number(req.query.newQuantity);

      if (!newQuantity || newQuantity < 1) {
        throw new HttpError(400, 'newQuantity must be a positive integer');
      }

      const data = await billingService.previewProration(orgId, subscriptionId, newQuantity);
      res.json({
        success: true,
        data,
      });
    } catch (err) {
      next(err);
    }
  }

  /** Phase 19: Modify subscription quantity mid-cycle */
  async modifySubscriptionQuantity(req: Request, res: Response, next: NextFunction) {
    try {
      const orgId = req.tenant!.orgId;
      const subscriptionId = req.params.id!;
      const { newQuantity, reason } = req.body;

      if (!newQuantity || typeof newQuantity !== 'number' || newQuantity < 1) {
        throw new HttpError(400, 'newQuantity must be a positive number of at least 1');
      }

      const data = await billingService.modifySubscriptionQuantity(
        orgId,
        subscriptionId,
        newQuantity,
        reason,
        req.tenant ? { userId: req.tenant.userId, email: req.tenant.email, role: req.tenant.role } : undefined
      );

      res.json({
        success: true,
        data,
      });
    } catch (err) {
      next(err);
    }
  }

  /** List credit notes for organization */
  async listCreditNotes(req: Request, res: Response, next: NextFunction) {
    try {
      const orgId = req.tenant!.orgId;
      const { quotationId, subscriptionId, status } = req.query;
      const data = await billingService.listCreditNotes(orgId, {
        quotationId: quotationId as string | undefined,
        subscriptionId: subscriptionId as string | undefined,
        status: status as string | undefined,
      });
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }

  /** Get single credit note */
  async getCreditNote(req: Request, res: Response, next: NextFunction) {
    try {
      const orgId = req.tenant!.orgId;
      const creditNoteId = req.params.id!;
      const data = await billingService.getCreditNote(orgId, creditNoteId);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }

  /** Phase 20: Pay an invoice */
  async payInvoice(req: Request, res: Response, next: NextFunction) {
    try {
      const orgId = req.tenant!.orgId;
      const invoiceId = req.params.id!;
      const { paymentMethod, idempotencyKey } = req.body;
      const data = await paymentsService.chargeInvoice(orgId, invoiceId, {
        paymentMethod,
        idempotencyKey,
        userCtx: req.tenant ? { userId: req.tenant.userId } : undefined,
      });
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }

  /** Phase 20: Refund a credit note */
  async refundCreditNote(req: Request, res: Response, next: NextFunction) {
    try {
      const orgId = req.tenant!.orgId;
      const creditNoteId = req.params.id!;
      const { paymentMethod } = req.body;
      const data = await paymentsService.refundCreditNote(orgId, creditNoteId, {
        paymentMethod,
        userCtx: req.tenant ? { userId: req.tenant.userId } : undefined,
      });
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }

  /** Phase 20: Ingest Webhook (public) */
  async handleWebhook(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await paymentsService.handleWebhook(req.body, req.headers);
      res.json(result);
    } catch (err) {
      next(err);
    }
  }

  /** Phase 20: List DLQ jobs for organization */
  async listDlq(req: Request, res: Response, next: NextFunction) {
    try {
      const orgId = req.tenant!.orgId;
      const { status, queueName } = req.query;
      const data = await paymentsService.listDlqJobs({
        orgId,
        status: status as string | undefined,
        queueName: queueName as string | undefined,
      });
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }

  /** Phase 20: Get single DLQ job */
  async getDlq(req: Request, res: Response, next: NextFunction) {
    try {
      const orgId = req.tenant!.orgId;
      const jobId = req.params.id!;
      const data = await paymentsService.getDlqJob(jobId, orgId);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }

  /** Phase 20: Retry DLQ job */
  async retryDlq(req: Request, res: Response, next: NextFunction) {
    try {
      const orgId = req.tenant!.orgId;
      const jobId = req.params.id!;
      const data = await paymentsService.retryDlqJob(jobId, orgId);
      res.json(data);
    } catch (err) {
      next(err);
    }
  }

  /** Phase 20: Dismiss DLQ job */
  async dismissDlq(req: Request, res: Response, next: NextFunction) {
    try {
      const orgId = req.tenant!.orgId;
      const jobId = req.params.id!;
      const data = await paymentsService.dismissDlqJob(jobId, orgId);
      res.json(data);
    } catch (err) {
      next(err);
    }
  }

  /** Export sales activities in CSV */
  async exportSalesActivitiesCsv(req: Request, res: Response, next: NextFunction) {
    try {
      const orgId = req.tenant!.orgId;
      const { startDate, endDate, type } = req.query;
      const data = await billingService.exportSalesActivitiesCsv(orgId, {
        startDate: startDate as string | undefined,
        endDate: endDate as string | undefined,
        type: type as string | undefined,
      });

      if (req.query.download === 'true') {
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${data.fileName}"`);
        res.send(data.content);
        return;
      }
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }
}

export const billingController = new BillingController();
