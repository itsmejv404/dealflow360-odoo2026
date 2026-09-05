import { Router } from 'express';
import { recommendationsController } from './recommendations.controller.js';
import { tenantContextMiddleware } from '../../shared/tenant.middleware.js';

export const recommendationsRouter = Router();

// Apply tenant-isolation context middleware to all recommendation routes
recommendationsRouter.use(tenantContextMiddleware);

// POST /api/recommendations/upsell — Ranked suggestions with margin deltas
recommendationsRouter.post('/upsell', (req, res, next) => {
  recommendationsController.getUpsellSuggestions(req, res).catch(next);
});
