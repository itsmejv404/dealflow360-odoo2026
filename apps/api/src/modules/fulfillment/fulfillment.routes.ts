import { Router } from 'express';
import { fulfillmentController } from './fulfillment.controller.js';
import { tenantContextMiddleware, requireRoles } from '../../shared/tenant.middleware.js';

export const fulfillmentRouter = Router();

// All fulfillment routes require tenant context (internal JWT).
fulfillmentRouter.use(tenantContextMiddleware);

// Reading the plan is open to every internal role (lazy-proposes on first view).
fulfillmentRouter.get('/quotation/:quotationId', (req, res, next) =>
  fulfillmentController.getPlan(req, res, next)
);

// Proposal regeneration and overrides belong to Ops + Org Admin.
fulfillmentRouter.post(
  '/quotation/:quotationId/propose',
  requireRoles(['org_admin', 'ops']),
  (req, res, next) => fulfillmentController.propose(req, res, next)
);

fulfillmentRouter.put(
  '/lines/:lineId/allocations',
  requireRoles(['org_admin', 'ops']),
  (req, res, next) => fulfillmentController.overrideLine(req, res, next)
);

fulfillmentRouter.post(
  '/quotation/:quotationId/accept',
  requireRoles(['org_admin', 'ops']),
  (req, res, next) => fulfillmentController.accept(req, res, next)
);

// ==================== PHASE 17 - BACKORDERS & CONSOLIDATION ====================

// Open backorders list for Ops / Admin
fulfillmentRouter.get(
  '/backorders',
  requireRoles(['org_admin', 'ops']),
  (req, res, next) => fulfillmentController.listBackorders(req, res, next)
);

// Active consolidation prompts
fulfillmentRouter.get(
  '/prompts',
  (req, res, next) => fulfillmentController.listPrompts(req, res, next)
);

// Execute backorder consolidation (Ops / Org Admin)
fulfillmentRouter.post(
  '/prompts/:id/consolidate',
  requireRoles(['org_admin', 'ops']),
  (req, res, next) => fulfillmentController.consolidatePrompt(req, res, next)
);

// Dismiss consolidation prompt (Ops / Org Admin)
fulfillmentRouter.post(
  '/prompts/:id/dismiss',
  requireRoles(['org_admin', 'ops']),
  (req, res, next) => fulfillmentController.dismissPrompt(req, res, next)
);

// BullMQ Queue Status & Worker Liveness View
fulfillmentRouter.get(
  '/queue-status',
  (req, res, next) => fulfillmentController.getQueueStatus(req, res, next)
);
