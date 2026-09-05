import { Router } from 'express';
import { z } from 'zod';
import { negotiationService } from './negotiation.service.js';
import { tenantContextMiddleware, requireRoles } from '../../shared/tenant.middleware.js';
import { HttpError } from '../../shared/errors.js';
import type { Request, Response, NextFunction } from 'express';

const internalCommentSchema = z.object({
  lineId: z.string().uuid().nullable().optional(),
  body: z.string().min(1, 'Comment body is required').max(2000),
});

const resolveSchema = z.object({
  action: z.enum(['accept', 'decline']),
  note: z.string().max(2000).optional(),
});

export class NegotiationController {
  private tenantOrFail(req: Request) {
    const tenant = req.tenant;
    if (!tenant || !tenant.orgId) {
      throw new HttpError(401, 'Tenant context required');
    }
    return tenant;
  }

  private userContext(req: Request) {
    const tenant = this.tenantOrFail(req);
    if (!tenant.userId || !tenant.email || !tenant.role) {
      throw new HttpError(401, 'Internal user context required');
    }
    return { userId: tenant.userId, email: tenant.email, role: tenant.role };
  }

  async listNegotiation(req: Request, res: Response, next: NextFunction) {
    try {
      const tenant = this.tenantOrFail(req);
      const { quotationId } = req.params;
      if (!quotationId) throw new HttpError(400, 'Quotation ID is required');

      const data = await negotiationService.listNegotiation(tenant.orgId, quotationId);
      res.json(data);
    } catch (err) {
      next(err);
    }
  }

  async postComment(req: Request, res: Response, next: NextFunction) {
    try {
      const tenant = this.tenantOrFail(req);
      const user = this.userContext(req);
      const { quotationId } = req.params;
      if (!quotationId) throw new HttpError(400, 'Quotation ID is required');

      const parsed = internalCommentSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw new HttpError(400, parsed.error.issues[0]?.message || 'Invalid comment payload');
      }

      const comment = await negotiationService.addComment(
        tenant.orgId,
        quotationId,
        parsed.data,
        { type: 'internal', id: user.userId, name: user.email, email: user.email }
      );
      res.status(201).json({ comment });
    } catch (err) {
      next(err);
    }
  }

  async resolveChangeRequest(req: Request, res: Response, next: NextFunction) {
    try {
      const tenant = this.tenantOrFail(req);
      const user = this.userContext(req);
      const { quotationId, requestId } = req.params;
      if (!quotationId || !requestId) throw new HttpError(400, 'Quotation ID and request ID are required');

      const parsed = resolveSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw new HttpError(400, parsed.error.issues[0]?.message || 'Invalid resolution payload');
      }

      const result = await negotiationService.resolveChangeRequest(
        tenant.orgId,
        quotationId,
        requestId,
        user,
        parsed.data
      );
      res.json(result);
    } catch (err) {
      next(err);
    }
  }

  async resolveCounterProposal(req: Request, res: Response, next: NextFunction) {
    try {
      const tenant = this.tenantOrFail(req);
      const user = this.userContext(req);
      const { quotationId, counterId } = req.params;
      if (!quotationId || !counterId) throw new HttpError(400, 'Quotation ID and counter ID are required');

      const parsed = resolveSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw new HttpError(400, parsed.error.issues[0]?.message || 'Invalid resolution payload');
      }

      const result = await negotiationService.resolveCounterProposal(
        tenant.orgId,
        quotationId,
        counterId,
        user,
        parsed.data
      );
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
}

export const negotiationController = new NegotiationController();

export const negotiationRouter = Router();

// All negotiation routes require tenant context (internal JWT with org_id + role).
// Customer tokens carry no role and are rejected here — customers may only use
// the portal-scoped negotiation endpoints under /api/portal.
negotiationRouter.use(tenantContextMiddleware);
negotiationRouter.use(requireRoles(['org_admin', 'rep', 'manager', 'finance', 'ops']));

// Thread view — visible to every internal role of the org.
negotiationRouter.get('/:quotationId', (req, res, next) =>
  negotiationController.listNegotiation(req, res, next)
);

// Internal reply on the thread.
negotiationRouter.post('/:quotationId/comments', (req, res, next) =>
  negotiationController.postComment(req, res, next)
);

// Governance decisions: applying/declining negotiated terms changes binding
// terms, so only approver roles may resolve them.
negotiationRouter.post(
  '/:quotationId/change-requests/:requestId/resolve',
  requireRoles(['manager', 'org_admin']),
  (req, res, next) => negotiationController.resolveChangeRequest(req, res, next)
);

negotiationRouter.post(
  '/:quotationId/counters/:counterId/resolve',
  requireRoles(['manager', 'org_admin']),
  (req, res, next) => negotiationController.resolveCounterProposal(req, res, next)
);
