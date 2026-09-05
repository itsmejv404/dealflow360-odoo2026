import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { fulfillmentService } from './fulfillment.service.js';
import { friendlyZodMessage, HttpError } from '../../shared/errors.js';
import type { UserContext } from '../approvals/approvals.service.js';
import { getQueueHealthStatus } from '../../lib/queue.js';

const allocationsSchema = z.object({
  allocations: z
    .array(
      z.object({
        warehouseId: z.string().min(1, 'A valid warehouse is required'),
        quantity: z.number().int('Quantity must be a whole number').min(1, 'Quantity must be at least 1'),
      })
    )
    .min(1, 'Provide at least one warehouse allocation'),
});

export class FulfillmentController {
  private tenant(req: Request) {
    const tenant = req.tenant;
    if (!tenant || !tenant.orgId) {
      throw new HttpError(401, 'Tenant context required');
    }
    return tenant;
  }

  private actor(req: Request): UserContext {
    const tenant = this.tenant(req);
    if (!tenant.userId || !tenant.email || !tenant.role) {
      throw new HttpError(401, 'Internal user context required');
    }
    return { userId: tenant.userId, email: tenant.email, role: tenant.role };
  }

  async getPlan(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const orgId = this.tenant(req).orgId;
      const quotationId = req.params.quotationId as string;
      if (!quotationId) throw new HttpError(400, 'Quotation ID is required');
      const view = await fulfillmentService.getOrCreatePlan(orgId, quotationId);
      res.json(view);
    } catch (err) {
      next(err);
    }
  }

  async propose(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const tenant = this.tenant(req);
      const quotationId = req.params.quotationId as string;
      if (!quotationId) throw new HttpError(400, 'Quotation ID is required');
      const view = await fulfillmentService.proposePlan(tenant.orgId, quotationId, this.actor(req));
      res.json(view);
    } catch (err) {
      next(err);
    }
  }

  async overrideLine(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const tenant = this.tenant(req);
      const lineId = req.params.lineId as string;
      if (!lineId) throw new HttpError(400, 'Fulfillment line ID is required');

      const parsed = allocationsSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw new HttpError(400, friendlyZodMessage(parsed.error.issues));
      }

      const view = await fulfillmentService.overrideLineAllocations(
        tenant.orgId,
        lineId,
        parsed.data.allocations,
        this.actor(req)
      );
      res.json(view);
    } catch (err) {
      next(err);
    }
  }

  async accept(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const tenant = this.tenant(req);
      const quotationId = req.params.quotationId as string;
      if (!quotationId) throw new HttpError(400, 'Quotation ID is required');
      const view = await fulfillmentService.acceptPlan(tenant.orgId, quotationId, this.actor(req));
      res.json(view);
    } catch (err) {
      next(err);
    }
  }

  // ==================== PHASE 17 ENDPOINTS ====================

  async listBackorders(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const orgId = this.tenant(req).orgId;
      const backorders = await fulfillmentService.listBackorders(orgId);
      res.json({ backorders });
    } catch (err) {
      next(err);
    }
  }

  async listPrompts(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const orgId = this.tenant(req).orgId;
      const quotationId = req.query.quotationId as string | undefined;
      const prompts = await fulfillmentService.listPrompts(orgId, quotationId);
      res.json({ prompts });
    } catch (err) {
      next(err);
    }
  }

  async consolidatePrompt(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const tenant = this.tenant(req);
      const promptId = req.params.id as string;
      if (!promptId) throw new HttpError(400, 'Prompt ID is required');
      const view = await fulfillmentService.consolidatePrompt(tenant.orgId, promptId, this.actor(req));
      res.json(view);
    } catch (err) {
      next(err);
    }
  }

  async dismissPrompt(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const tenant = this.tenant(req);
      const promptId = req.params.id as string;
      if (!promptId) throw new HttpError(400, 'Prompt ID is required');
      const result = await fulfillmentService.dismissPrompt(tenant.orgId, promptId, this.actor(req));
      res.json(result);
    } catch (err) {
      next(err);
    }
  }

  async getQueueStatus(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const report = await getQueueHealthStatus();
      res.json(report);
    } catch (err) {
      next(err);
    }
  }
}

export const fulfillmentController = new FulfillmentController();
