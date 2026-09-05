import type { Request, Response } from 'express';
import { z } from 'zod';
import { rulebookService } from './rulebook.service.js';
import { friendlyZodMessage, HttpError } from '../../shared/errors.js';

const batchCeilingsSchema = z.object({
  ceilings: z.array(
    z.object({
      tierId: z.string().uuid(),
      categoryId: z.string().uuid(),
      maxDiscountPercent: z.number().min(0).max(100),
    })
  ),
});

const approvalConfigSchema = z.object({
  managerThresholdPercent: z.number().min(0).max(100).optional(),
  financeThresholdPercent: z.number().min(0).max(100).optional(),
  requireFinanceAboveThreshold: z.boolean().optional(),
  autoApproveWithinCeilings: z.boolean().optional(),
});

const evaluateRuleSchema = z.object({
  tierId: z.string().uuid(),
  categoryId: z.string().uuid(),
  proposedDiscountPercent: z.number().min(0).max(100),
});

export class RulebookController {
  /**
   * Validates the request body and throws a 400 HttpError (never a raw
   * ZodError, which would surface as an opaque 500).
   */
  private parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
    const result = schema.safeParse(body);
    if (!result.success) {
      throw new HttpError(400, friendlyZodMessage(result.error.issues));
    }
    return result.data;
  }

  async getRulebook(req: Request, res: Response): Promise<void> {
    const orgId = req.tenant!.orgId;
    const rulebook = await rulebookService.getRulebook(orgId);
    res.json(rulebook);
  }

  async updateCeilings(req: Request, res: Response): Promise<void> {
    const orgId = req.tenant!.orgId;
    const validated = this.parseBody(batchCeilingsSchema, req.body);
    const result = await rulebookService.updateCeilings(orgId, validated.ceilings);
    res.json(result);
  }

  async updateApprovalChainConfig(req: Request, res: Response): Promise<void> {
    const orgId = req.tenant!.orgId;
    const validated = this.parseBody(approvalConfigSchema, req.body);
    const config = await rulebookService.updateApprovalChainConfig(orgId, validated);
    res.json({ config });
  }

  async evaluateRule(req: Request, res: Response): Promise<void> {
    const orgId = req.tenant!.orgId;
    const validated = this.parseBody(evaluateRuleSchema, req.body);
    const evaluation = await rulebookService.evaluateRule(orgId, validated);
    res.json({ evaluation });
  }
}

export const rulebookController = new RulebookController();
