import { Router } from 'express';
import { governanceController } from './governance.controller.js';
import { tenantContextMiddleware } from '../../shared/tenant.middleware.js';

export const governanceRouter = Router();

governanceRouter.use(tenantContextMiddleware);

governanceRouter.post('/evaluate', (req, res, next) => {
  governanceController.evaluateRisk(req, res, next);
});
