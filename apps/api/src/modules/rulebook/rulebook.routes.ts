import { Router } from 'express';
import { rulebookController } from './rulebook.controller.js';
import { tenantContextMiddleware, requireRoles } from '../../shared/tenant.middleware.js';

export const rulebookRouter = Router();

// Apply tenant context to all rulebook endpoints
rulebookRouter.use(tenantContextMiddleware);

// Retrieve full rulebook (categories, tiers, ceilings matrix, approval chain)
rulebookRouter.get('/', (req, res, next) => {
  rulebookController.getRulebook(req, res).catch(next);
});

// Update discount ceilings matrix in batch (Org Admin only)
rulebookRouter.put('/ceilings', requireRoles(['org_admin']), (req, res, next) => {
  rulebookController.updateCeilings(req, res).catch(next);
});

// Update approval chain configuration (Org Admin only)
rulebookRouter.put('/approval-chain', requireRoles(['org_admin']), (req, res, next) => {
  rulebookController.updateApprovalChainConfig(req, res).catch(next);
});

// Live Rule Simulator / Evaluator (Accessible to reps, managers, finance, and admins)
rulebookRouter.post('/evaluate', (req, res, next) => {
  rulebookController.evaluateRule(req, res).catch(next);
});
