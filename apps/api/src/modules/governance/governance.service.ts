import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { HttpError } from '../../shared/errors.js';
import { rulebookService } from '../rulebook/rulebook.service.js';

export interface EvaluateRiskLineInput {
  productId: string;
  categoryId?: string | null;
  quantity: number;
  unitPrice: number;
  lineDiscountPercent: number;
  subtotal: number;
  total: number;
}

export interface LineRiskEvaluation {
  productId: string;
  categoryId: string | null;
  categoryName: string;
  categoryCode: string;
  quantity: number;
  unitPrice: number;
  lineDiscountPercent: number;
  effectiveDiscountPercent: number;
  categoryCeilingPercent: number;
  riskDeltaPercent: number;
  isOverCeiling: boolean;
  subtotal: number;
  total: number;
  reason: string;
}

export interface RiskEvaluationResult {
  riskScore: number; // 0 - 100
  riskLevel: 'low' | 'medium' | 'high';
  approvalRouting: 'none' | 'manager' | 'manager_finance';
  routingReason: string;
  hasLineOverCeiling: boolean;
  overCeilingLineCount: number;
  totalLines: number;
  lines: LineRiskEvaluation[];
  managerThresholdPercent: number;
  financeThresholdPercent: number;
  autoApproveWithinCeilings: boolean;
}

export class GovernanceService {
  private round2(num: number): number {
    return Math.round((num + Number.EPSILON) * 100) / 100;
  }

  /**
   * Calculates the blended discount risk score and approval routing for a quotation payload.
   */
  async calculateRiskScore(
    orgId: string,
    tierId: string,
    lines: EvaluateRiskLineInput[],
    orderDiscountPercent: number = 0
  ): Promise<RiskEvaluationResult> {
    await rulebookService.ensureDefaultRulebook(orgId);

    const [tier, categories, ceilings, approvalConfig, products] = await Promise.all([
      prisma.customerTier.findFirst({
        where: { id: tierId, organizationId: orgId },
      }),
      prisma.productCategory.findMany({
        where: { organizationId: orgId },
      }),
      prisma.discountCeiling.findMany({
        where: { tierId, organizationId: orgId },
      }),
      prisma.approvalChainConfig.findUnique({
        where: { organizationId: orgId },
      }),
      prisma.product.findMany({
        where: {
          id: { in: lines.map((l) => l.productId) },
          organizationId: orgId,
        },
        include: { category: true },
      }),
    ]);

    if (!tier) {
      throw new HttpError(400, 'Customer tier not found for this organization');
    }

    const categoryMap = new Map(categories.map((c) => [c.id, c]));
    const productMap = new Map(products.map((p) => [p.id, p]));
    const ceilingMap = new Map(ceilings.map((c) => [c.categoryId, Number(c.maxDiscountPercent)]));

    const managerThreshold = approvalConfig ? Number(approvalConfig.managerThresholdPercent) : 0;
    const financeThreshold = approvalConfig ? Number(approvalConfig.financeThresholdPercent) : 15;
    const requireFinanceAboveThreshold = approvalConfig?.requireFinanceAboveThreshold ?? true;
    const autoApproveWithinCeilings = approvalConfig?.autoApproveWithinCeilings ?? true;

    const orderDiscPct = Math.min(100, Math.max(0, orderDiscountPercent));

    let grossSubtotal = 0;
    let weightedRiskSum = 0;
    let overCeilingCount = 0;
    let maxLineRiskDelta = 0;

    const evaluatedLines: LineRiskEvaluation[] = lines.map((line) => {
      const prod = productMap.get(line.productId);
      const catId = line.categoryId || prod?.categoryId || null;
      const cat = catId ? categoryMap.get(catId) : null;
      const categoryName = cat?.name || 'General';
      const categoryCode = cat?.code || 'general';

      const lineDiscPct = Math.min(100, Math.max(0, line.lineDiscountPercent || 0));
      
      // Effective discount rate compounded with order discount
      const effectiveDiscountPercent = this.round2(
        lineDiscPct + orderDiscPct - (lineDiscPct * orderDiscPct) / 100
      );

      const categoryCeilingPercent = catId && ceilingMap.has(catId) ? ceilingMap.get(catId)! : 0;

      const riskDelta = this.round2(effectiveDiscountPercent - categoryCeilingPercent);
      const riskDeltaPercent = Math.max(0, riskDelta);
      const isOverCeiling = riskDeltaPercent > 0.001;

      if (isOverCeiling) {
        overCeilingCount++;
      }
      if (riskDeltaPercent > maxLineRiskDelta) {
        maxLineRiskDelta = riskDeltaPercent;
      }

      const lineGross = this.round2(line.quantity * line.unitPrice);
      grossSubtotal += lineGross;

      const lineWeight = lineGross;
      weightedRiskSum += lineWeight * Math.pow(riskDeltaPercent, 1.15);

      let reason = `Compliant: ${effectiveDiscountPercent}% effective discount is within ${categoryName} ceiling of ${categoryCeilingPercent}%.`;
      if (isOverCeiling) {
        if (effectiveDiscountPercent > categoryCeilingPercent + financeThreshold) {
          reason = `Critical: ${effectiveDiscountPercent}% effective discount exceeds ${categoryName} ceiling (${categoryCeilingPercent}%) by +${riskDeltaPercent}%, crossing Finance escalation threshold (+${financeThreshold}%).`;
        } else {
          reason = `Warning: ${effectiveDiscountPercent}% effective discount exceeds ${categoryName} ceiling (${categoryCeilingPercent}%) by +${riskDeltaPercent}%.`;
        }
      }

      return {
        productId: line.productId,
        categoryId: catId,
        categoryName,
        categoryCode,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        lineDiscountPercent: lineDiscPct,
        effectiveDiscountPercent,
        categoryCeilingPercent,
        riskDeltaPercent,
        isOverCeiling,
        subtotal: lineGross,
        total: line.total,
        reason,
      };
    });

    let blendedScore = 0;
    if (grossSubtotal > 0) {
      const weightedDelta = weightedRiskSum / grossSubtotal;
      blendedScore = this.round2(Math.min(100, weightedDelta * 2.5));
    }

    let riskLevel: 'low' | 'medium' | 'high' = 'low';
    let approvalRouting: 'none' | 'manager' | 'manager_finance' = 'none';
    let routingReason = 'All discounts are within the rulebook ceilings. No review needed.';

    const crossesFinanceThreshold =
      requireFinanceAboveThreshold &&
      (maxLineRiskDelta >= financeThreshold || blendedScore >= 60);

    const crossesManagerThreshold =
      maxLineRiskDelta > managerThreshold || blendedScore > 10 || overCeilingCount > 0;

    if (crossesFinanceThreshold) {
      riskLevel = 'high';
      approvalRouting = 'manager_finance';
      routingReason = `High risk: discount exposure goes well beyond the ceilings (risk score ${blendedScore}/100). Needs Sales Manager approval and then Finance sign-off.`;
    } else if (crossesManagerThreshold || !autoApproveWithinCeilings) {
      riskLevel = 'medium';
      approvalRouting = 'manager';
      routingReason = `One or more lines exceed the category discount ceilings (risk score ${blendedScore}/100). Needs Sales Manager approval.`;
    } else {
      riskLevel = 'low';
      approvalRouting = 'none';
      routingReason = `All lines comply with the ${tier.name} tier ceilings (risk score ${blendedScore}/100). Ready to send.`;
    }

    return {
      riskScore: blendedScore,
      riskLevel,
      approvalRouting,
      routingReason,
      hasLineOverCeiling: overCeilingCount > 0,
      overCeilingLineCount: overCeilingCount,
      totalLines: lines.length,
      lines: evaluatedLines,
      managerThresholdPercent: managerThreshold,
      financeThresholdPercent: financeThreshold,
      autoApproveWithinCeilings,
    };
  }
}

export const governanceService = new GovernanceService();
