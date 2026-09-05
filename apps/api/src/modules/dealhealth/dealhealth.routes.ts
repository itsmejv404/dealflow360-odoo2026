import { Router } from 'express';
import { dealHealthController } from './dealhealth.controller.js';
import { tenantContextMiddleware, requireRoles } from '../../shared/tenant.middleware.js';


export const dealHealthRouter = Router();

dealHealthRouter.use(tenantContextMiddleware);

// All internal roles can view alerts (rep sees nudges about their own deals)
dealHealthRouter.get('/alerts', (req, res, next) => dealHealthController.listAlerts(req, res, next));
dealHealthRouter.get('/alerts/:id', (req, res, next) => dealHealthController.getAlert(req, res, next));
dealHealthRouter.get('/summary', (req, res, next) => dealHealthController.getSummary(req, res, next));

// Actions
dealHealthRouter.post(
  '/alerts/:id/nudge',
  requireRoles(['org_admin', 'manager', 'finance']),
  (req, res, next) => dealHealthController.nudgeAlert(req, res, next)
);

dealHealthRouter.post(
  '/alerts/:id/resolve',
  requireRoles(['org_admin', 'manager', 'finance']),
  (req, res, next) => dealHealthController.resolveAlert(req, res, next)
);
