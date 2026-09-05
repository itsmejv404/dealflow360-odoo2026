import { Request, Response } from 'express';
import { recommendationsService } from './recommendations.service.js';
import { HttpError } from '../../shared/errors.js';

export class RecommendationsController {
  async getUpsellSuggestions(req: Request, res: Response): Promise<void> {
    const orgId = req.tenant?.orgId;
    if (!orgId) {
      throw new HttpError(403, 'Tenant organization context is required');
    }

    const {
      productIds = [],
      tierId,
      subtotal,
      totalAmount,
      totalCost,
      totalMargin,
    } = req.body;

    const suggestions = await recommendationsService.getUpsellSuggestions(orgId, {
      currentProductIds: Array.isArray(productIds) ? productIds : [],
      tierId: typeof tierId === 'string' ? tierId : undefined,
      currentSubtotal: Number(subtotal) || 0,
      currentTotalAmount: Number(totalAmount) || 0,
      currentTotalCost: Number(totalCost) || 0,
      currentTotalMargin: Number(totalMargin) || 0,
    });

    res.json({
      suggestions,
      count: suggestions.length,
      organizationId: orgId,
    });
  }
}

export const recommendationsController = new RecommendationsController();
