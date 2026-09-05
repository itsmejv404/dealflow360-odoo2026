import { Request, Response, NextFunction } from 'express';
import { dealHealthService } from './dealhealth.service.js';

export class DealHealthController {
  async listAlerts(req: Request, res: Response, next: NextFunction) {
    try {
      const orgId = req.tenant!.orgId;
      const { status, alertType, refresh } = req.query;
      const data = await dealHealthService.listAlerts(orgId, {
        status: status as string | undefined,
        alertType: alertType as string | undefined,
        refresh: refresh === '1' || refresh === 'true',
      });
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }

  async getAlert(req: Request, res: Response, next: NextFunction) {
    try {
      const orgId = req.tenant!.orgId;
      const data = await dealHealthService.getAlert(orgId, req.params.id!);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }

  async nudgeAlert(req: Request, res: Response, next: NextFunction) {
    try {
      const orgId = req.tenant!.orgId;
      const { escalate } = req.body || {};
      const data = await dealHealthService.nudgeAlert(orgId, req.params.id!, {
        escalate: Boolean(escalate),
        userCtx: req.tenant
          ? { userId: req.tenant.userId, email: req.tenant.email, role: req.tenant.role }
          : undefined,
      });
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }

  async resolveAlert(req: Request, res: Response, next: NextFunction) {
    try {
      const orgId = req.tenant!.orgId;
      const data = await dealHealthService.resolveAlert(orgId, req.params.id!, req.tenant
        ? { userId: req.tenant.userId, email: req.tenant.email, role: req.tenant.role }
        : undefined);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }

  async getSummary(req: Request, res: Response, next: NextFunction) {
    try {
      const orgId = req.tenant!.orgId;
      const data = await dealHealthService.getSummary(orgId);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }
}

export const dealHealthController = new DealHealthController();
