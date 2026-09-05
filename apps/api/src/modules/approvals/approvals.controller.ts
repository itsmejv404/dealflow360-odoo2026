import { Request, Response, NextFunction } from 'express';
import { approvalsService } from './approvals.service.js';
import { HttpError } from '../../shared/errors.js';

export class ApprovalsController {
  async submit(req: Request, res: Response, next: NextFunction) {
    try {
      const tenant = req.tenant;
      if (!tenant) throw new HttpError(401, 'Tenant context missing');

      const quotationId = req.params.quotationId;
      if (!quotationId) throw new HttpError(400, 'Quotation ID is required');

      const { notes } = req.body;

      const user = {
        userId: tenant.userId || 'anonymous',
        email: tenant.email || '',
        role: tenant.role || 'rep',
        name: null,
      };

      const result = await approvalsService.submitForApproval(tenant.orgId, quotationId, user, notes);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  async approve(req: Request, res: Response, next: NextFunction) {
    try {
      const tenant = req.tenant;
      if (!tenant) throw new HttpError(401, 'Tenant context missing');

      const quotationId = req.params.quotationId;
      if (!quotationId) throw new HttpError(400, 'Quotation ID is required');

      const { reason } = req.body;

      if (!reason || typeof reason !== 'string' || !reason.trim()) {
        throw new HttpError(400, 'A mandatory reason is required to approve quotation terms.');
      }

      const user = {
        userId: tenant.userId || 'anonymous',
        email: tenant.email || '',
        role: tenant.role || 'manager',
        name: null,
      };

      const result = await approvalsService.approveQuotation(tenant.orgId, quotationId, user, { reason });
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  async reject(req: Request, res: Response, next: NextFunction) {
    try {
      const tenant = req.tenant;
      if (!tenant) throw new HttpError(401, 'Tenant context missing');

      const quotationId = req.params.quotationId;
      if (!quotationId) throw new HttpError(400, 'Quotation ID is required');

      const { reason } = req.body;

      if (!reason || typeof reason !== 'string' || !reason.trim()) {
        throw new HttpError(400, 'A mandatory reason is required to reject a quotation.');
      }

      const user = {
        userId: tenant.userId || 'anonymous',
        email: tenant.email || '',
        role: tenant.role || 'manager',
        name: null,
      };

      const result = await approvalsService.rejectQuotation(tenant.orgId, quotationId, user, { reason });
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  async getPending(req: Request, res: Response, next: NextFunction) {
    try {
      const tenant = req.tenant;
      if (!tenant) throw new HttpError(401, 'Tenant context missing');

      const role = tenant.role;
      const requests = await approvalsService.getPendingApprovals(tenant.orgId, role);
      res.status(200).json({ requests });
    } catch (err) {
      next(err);
    }
  }

  async getQuotationAudit(req: Request, res: Response, next: NextFunction) {
    try {
      const tenant = req.tenant;
      if (!tenant) throw new HttpError(401, 'Tenant context missing');

      const quotationId = req.params.quotationId;
      if (!quotationId) throw new HttpError(400, 'Quotation ID is required');

      const auditTrail = await approvalsService.getQuotationAuditTrail(tenant.orgId, quotationId);
      res.status(200).json({ auditTrail });
    } catch (err) {
      next(err);
    }
  }

  async getOrgAudit(req: Request, res: Response, next: NextFunction) {
    try {
      const tenant = req.tenant;
      if (!tenant) throw new HttpError(401, 'Tenant context missing');

      const limit = req.query.limit ? Number(req.query.limit) : 50;
      const entityType = req.query.entityType ? String(req.query.entityType) : undefined;

      const auditLogs = await approvalsService.getOrgAuditLogs(tenant.orgId, limit, entityType);
      res.status(200).json({ auditLogs });
    } catch (err) {
      next(err);
    }
  }
}

export const approvalsController = new ApprovalsController();
