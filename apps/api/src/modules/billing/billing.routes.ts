import { Router } from 'express';
import { billingController } from './billing.controller.js';
import { tenantContextMiddleware, requireRoles } from '../../shared/tenant.middleware.js';

export const billingRouter = Router();

// Public payment gateway webhook receiver (Phase 20)
billingRouter.post('/webhooks', (req, res, next) =>
  billingController.handleWebhook(req, res, next)
);

// All tenant-scoped billing endpoints require tenant context
billingRouter.use(tenantContextMiddleware);

// Quotation billing summary & order split
billingRouter.get('/quotation/:quotationId', (req, res, next) =>
  billingController.getQuotationBilling(req, res, next)
);

billingRouter.get('/quotations/:quotationId/summary', (req, res, next) =>
  billingController.getQuotationBilling(req, res, next)
);

billingRouter.post('/quotation/:quotationId/split', (req, res, next) =>
  billingController.splitQuotationOrder(req, res, next)
);

billingRouter.post('/quotations/:quotationId/split', (req, res, next) =>
  billingController.splitQuotationOrder(req, res, next)
);

// Invoices
billingRouter.get('/invoices', (req, res, next) =>
  billingController.listInvoices(req, res, next)
);

billingRouter.get('/invoices/:id', (req, res, next) =>
  billingController.getInvoice(req, res, next)
);

// Additional charges (surcharges) — rep, manager, finance, org admin
billingRouter.post(
  '/invoices/:id/surcharges',
  requireRoles(['org_admin', 'manager', 'finance', 'rep']),
  (req, res, next) => billingController.addSurcharge(req, res, next)
);

billingRouter.delete(
  '/invoices/:id/surcharges/:surchargeId',
  requireRoles(['org_admin', 'manager', 'finance', 'rep']),
  (req, res, next) => billingController.removeSurcharge(req, res, next)
);

// Direct Payments (Phase 20)
billingRouter.post(
  '/invoices/:id/pay',
  requireRoles(['org_admin', 'finance', 'rep']),
  (req, res, next) => billingController.payInvoice(req, res, next)
);

// Subscriptions
billingRouter.get('/subscriptions', (req, res, next) =>
  billingController.listSubscriptions(req, res, next)
);

billingRouter.get('/subscriptions/:id', (req, res, next) =>
  billingController.getSubscription(req, res, next)
);

// Proration preview & modify (Phase 19)
billingRouter.get('/subscriptions/:id/proration-preview', (req, res, next) =>
  billingController.previewProration(req, res, next)
);

billingRouter.post(
  '/subscriptions/:id/modify-quantity',
  requireRoles(['org_admin', 'finance', 'rep', 'ops']),
  (req, res, next) => billingController.modifySubscriptionQuantity(req, res, next)
);

// Credit Notes (Phase 19)
billingRouter.get('/credit-notes', (req, res, next) =>
  billingController.listCreditNotes(req, res, next)
);

billingRouter.get('/credit-notes/:id', (req, res, next) =>
  billingController.getCreditNote(req, res, next)
);

// Credit Note Refund (Phase 20)
billingRouter.post(
  '/credit-notes/:id/refund',
  requireRoles(['org_admin', 'finance']),
  (req, res, next) => billingController.refundCreditNote(req, res, next)
);

// Dead Letter Queue (DLQ) Management (Phase 20)
billingRouter.get(
  '/dlq',
  requireRoles(['org_admin', 'finance', 'ops']),
  (req, res, next) => billingController.listDlq(req, res, next)
);

billingRouter.get(
  '/dlq/:id',
  requireRoles(['org_admin', 'finance', 'ops']),
  (req, res, next) => billingController.getDlq(req, res, next)
);

billingRouter.post(
  '/dlq/:id/retry',
  requireRoles(['org_admin', 'finance', 'ops']),
  (req, res, next) => billingController.retryDlq(req, res, next)
);

billingRouter.post(
  '/dlq/:id/dismiss',
  requireRoles(['org_admin', 'finance', 'ops']),
  (req, res, next) => billingController.dismissDlq(req, res, next)
);
