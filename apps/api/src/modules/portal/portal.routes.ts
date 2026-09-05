import { Router } from 'express';
import { portalController } from './portal.controller.js';
import { tenantContextMiddleware, requireRoles } from '../../shared/tenant.middleware.js';
import { tenantRateLimit } from '../../shared/rate-limit.js';
import { filesController } from '../files/files.controller.js';

export const portalRouter = Router();

// 1. Internal Rep/Manager action to dispatch magic link email to customer
portalRouter.post(
  '/send/:quotationId',
  tenantContextMiddleware,
  requireRoles(['rep', 'manager', 'org_admin']),
  (req, res, next) => portalController.sendToCustomer(req, res, next)
);

// 2. Customer Portal Endpoints (Authenticated via customer-scoped or internal token)
portalRouter.use(tenantContextMiddleware);

// Phase 14 — Redis-backed rate limits on all customer write endpoints,
// keyed by org_id + customer (see shared/rate-limit.ts).
const negotiationWriteLimiter = tenantRateLimit({
  windowMs: 60_000,
  max: 10,
  keyPrefix: 'rl:portal-negotiation:',
  message: 'Too many negotiation requests. Please wait a moment before trying again.',
});

const confirmLimiter = tenantRateLimit({
  windowMs: 60_000,
  max: 5,
  keyPrefix: 'rl:portal-confirm:',
  message: 'Too many confirmation attempts. Please wait a minute before confirming again.',
});

portalRouter.get('/verify', (req, res, next) =>
  portalController.verify(req, res, next)
);

portalRouter.get('/organization', (req, res, next) =>
  portalController.getBranding(req, res, next)
);

portalRouter.get('/organization/logo', (req, res, next) =>
  portalController.getOrganizationLogo(req, res, next)
);

portalRouter.get('/quotation', (req, res, next) =>
  portalController.getQuotation(req, res, next)
);

portalRouter.get('/quotation/:id', (req, res, next) =>
  portalController.getQuotation(req, res, next)
);

// Phase 22: customer downloads the org-branded quotation PDF (scoped to own quotes)
portalRouter.get('/quotation/:id/pdf', (req, res, next) =>
  filesController.quotationPdf(req, res, next)
);

// ---- Phase 14: negotiation & re-approval loop (customer-scoped writes) ----

portalRouter.get('/quotation/:id/negotiation', (req, res, next) =>
  portalController.listNegotiation(req, res, next)
);

portalRouter.post('/quotation/:id/comments', negotiationWriteLimiter, (req, res, next) =>
  portalController.postComment(req, res, next)
);

portalRouter.post('/quotation/:id/change-requests', negotiationWriteLimiter, (req, res, next) =>
  portalController.postChangeRequest(req, res, next)
);

portalRouter.post('/quotation/:id/counters', negotiationWriteLimiter, (req, res, next) =>
  portalController.postCounterProposal(req, res, next)
);

portalRouter.post('/quotation/:id/confirm', confirmLimiter, (req, res, next) =>
  portalController.confirmQuotation(req, res, next)
);
