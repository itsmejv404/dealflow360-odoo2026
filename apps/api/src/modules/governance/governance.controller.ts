import { Request, Response, NextFunction } from 'express';
import { governanceService } from './governance.service.js';
import { HttpError } from '../../shared/errors.js';

export class GovernanceController {
  async evaluateRisk(req: Request, res: Response, next: NextFunction) {
    try {
      const orgId = req.tenant?.orgId;
      if (!orgId) throw new HttpError(401, 'Tenant context required');

      const { tierId, lines, orderDiscountPercent } = req.body;
      if (!tierId) throw new HttpError(400, 'Customer tierId is required');
      if (!lines || !Array.isArray(lines)) throw new HttpError(400, 'Lines array is required');

      const result = await governanceService.calculateRiskScore(
        orgId,
        tierId,
        lines,
        Number(orderDiscountPercent || 0)
      );

      res.json(result);
    } catch (err) {
      next(err);
    }
  }
}

export const governanceController = new GovernanceController();
