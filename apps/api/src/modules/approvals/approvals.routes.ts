import { Router } from 'express';
import { approvalsController } from './approvals.controller.js';
import { tenantContextMiddleware, requireRoles } from '../../shared/tenant.middleware.js';

export const approvalsRouter = Router();

approvalsRouter.use(tenantContextMiddleware);

// Submit quote for approval (Rep, Manager, Admin)
approvalsRouter.post('/submit/:quotationId', (req, res, next) => approvalsController.submit(req, res, next));

// Action approval (Manager, Finance, Org Admin)
approvalsRouter.post(
  '/approve/:quotationId',
  requireRoles(['manager', 'finance', 'org_admin']),
  (req, res, next) => approvalsController.approve(req, res, next)
);

approvalsRouter.post(
  '/reject/:quotationId',
  requireRoles(['manager', 'finance', 'org_admin']),
  (req, res, next) => approvalsController.reject(req, res, next)
);

// View pending approvals (Manager, Finance, Org Admin)
approvalsRouter.get(
  '/pending',
  requireRoles(['manager', 'finance', 'org_admin']),
  (req, res, next) => approvalsController.getPending(req, res, next)
);

// View quotation audit trail (Internal users)
approvalsRouter.get('/quotation/:quotationId/audit', (req, res, next) =>
  approvalsController.getQuotationAudit(req, res, next)
);

// View org-wide audit logs (Org Admin, Manager)
approvalsRouter.get(
  '/audit-logs',
  requireRoles(['org_admin', 'manager']),
  (req, res, next) => approvalsController.getOrgAudit(req, res, next)
);
