import { redis } from '../../lib/redis.js';
import { prisma } from '../../lib/prisma.js';
import { QuotationLineInput } from './quotations.service.js';
import { governanceService, RiskEvaluationResult } from '../governance/governance.service.js';
import { HttpError } from '../../shared/errors.js';

export interface CalculatedPricingResult {
  computedLines: Array<{
    productId: string;
    categoryId: string | null;
    quantity: number;
    unitPrice: number;
    costPrice: number;
    lineDiscountPercent: number;
    lineDiscountAmount: number;
    subtotal: number;
    total: number;
    marginAmount: number;
    marginPercent: number;
    billingFrequency: string;
    appliedCeilingPercent?: number;
    riskDeltaPercent?: number;
    isOverCeiling?: boolean;
  }>;
  totals: {
    orderDiscountPercent: number;
    orderDiscountAmount: number;
    subtotal: number;
    totalDiscount: number;
    totalAmount: number;
    totalCost: number;
    totalMargin: number;
    totalMarginPercent: number;
    oneTimeTotal: number;
    recurringMonthlyTotal: number;
    recurringAnnualTotal: number;
  };
  risk: RiskEvaluationResult;
}

export class PricingService {
  private round2(num: number): number {
    return Math.round((num + Number.EPSILON) * 100) / 100;
  }

  /**
   * Margin percentages are stored in Decimal(5,2) columns (max ±999.99).
   * Deep discounts can drive margins far negative; clamp to the column range
   * so a valid business scenario never becomes a numeric-field-overflow 500.
   */
  private clampPercent(num: number): number {
    return Math.max(-999.99, Math.min(999.99, this.round2(num)));
  }

  /**
   * Fetch tier price list with Redis cache (TTL: 5 minutes)
   * Cache key: org:{orgId}:pricelist:{tierId}
   */
  async getTierPriceListMap(orgId: string, tierId: string): Promise<{
    tierDefaultDiscount: number;
    customPrices: Record<string, number>;
  }> {
    const cacheKey = `org:${orgId}:pricelist:${tierId}`;
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch {
      // Fallback to database on cache miss or error
    }

    const [tier, priceListItems] = await Promise.all([
      prisma.customerTier.findFirst({
        where: { id: tierId, organizationId: orgId },
      }),
      prisma.priceListItem.findMany({
        where: { tierId, organizationId: orgId },
      }),
    ]);

    const customPrices: Record<string, number> = {};
    for (const item of priceListItems) {
      customPrices[item.productId] = Number(item.customPrice);
    }

    const result = {
      tierDefaultDiscount: Number(tier?.defaultDiscountPercent || 0),
      customPrices,
    };

    try {
      await redis.set(cacheKey, JSON.stringify(result), 'EX', 300);
    } catch {
      // Non-fatal cache write error
    }

    return result;
  }

  /**
   * Invalidate tier price list cache
   */
  async invalidateTierCache(orgId: string, tierId?: string): Promise<void> {
    try {
      if (tierId) {
        await redis.del(`org:${orgId}:pricelist:${tierId}`);
      } else {
        const keys = await redis.keys(`org:${orgId}:pricelist:*`);
        if (keys.length > 0) {
          await redis.del(...keys);
        }
      }
    } catch {
      // Non-fatal
    }
  }

  /**
   * Calculate quotation lines, totals, live margins, and discount risk scoring
   */
  async calculateQuotationPricing(
    orgId: string,
    tierId: string,
    rawLines: QuotationLineInput[],
    orderDiscountPercent: number = 0,
    quotationId?: string
  ): Promise<CalculatedPricingResult> {
    if (!rawLines || rawLines.length === 0) {
      throw new HttpError(400, 'Quotation must have at least one product line');
    }

    const productIds = rawLines.map((l) => l.productId);
    const [products, tierPricing] = await Promise.all([
      prisma.product.findMany({
        where: { id: { in: productIds }, organizationId: orgId },
        include: { category: true },
      }),
      this.getTierPriceListMap(orgId, tierId),
    ]);

    const productMap = new Map(products.map((p) => [p.id, p]));
    const { tierDefaultDiscount, customPrices } = tierPricing;

    let subtotal = 0;
    let totalLineDiscount = 0;
    let totalCost = 0;
    let oneTimeTotal = 0;
    let recurringMonthlyTotal = 0;
    let recurringAnnualTotal = 0;

    const preliminaryLines = rawLines.map((lineInput) => {
      const product = productMap.get(lineInput.productId);
      if (!product) {
        throw new HttpError(400, `Product ${lineInput.productId} not found in this organization`);
      }

      const quantity = Math.max(1, Math.floor(lineInput.quantity || 1));
      const costPrice = product.costPrice ? Number(product.costPrice) : 0;

      let unitPrice: number;
      if (lineInput.unitPrice !== undefined && lineInput.unitPrice >= 0) {
        unitPrice = Number(lineInput.unitPrice);
      } else if (customPrices[product.id] !== undefined) {
        unitPrice = customPrices[product.id]!;
      } else {
        const base = Number(product.price);
        unitPrice = tierDefaultDiscount > 0 ? this.round2(base * (1 - tierDefaultDiscount / 100)) : base;
      }

      const lineDiscountPct = Math.min(100, Math.max(0, lineInput.lineDiscountPercent ?? 0));
      const lineGross = this.round2(quantity * unitPrice);
      const lineDiscountAmt = this.round2(lineGross * (lineDiscountPct / 100));
      const lineNet = this.round2(lineGross - lineDiscountAmt);
      const lineCost = this.round2(quantity * costPrice);
      const lineMarginAmt = this.round2(lineNet - lineCost);
      const lineMarginPct = lineNet > 0 ? this.clampPercent((lineMarginAmt / lineNet) * 100) : 0;

      subtotal += lineGross;
      totalLineDiscount += lineDiscountAmt;
      totalCost += lineCost;

      if (product.billingFrequency === 'monthly') {
        recurringMonthlyTotal += lineNet;
      } else if (product.billingFrequency === 'quarterly') {
        // Quarterly charges were previously dropped (treated as one-time);
        // they are recurring — bucket them into the annualized total (×4).
        recurringAnnualTotal += lineNet * 4;
      } else if (product.billingFrequency === 'annual') {
        recurringAnnualTotal += lineNet;
      } else {
        oneTimeTotal += lineNet;
      }

      return {
        productId: product.id,
        categoryId: product.categoryId,
        quantity,
        unitPrice,
        costPrice,
        lineDiscountPercent: lineDiscountPct,
        lineDiscountAmount: lineDiscountAmt,
        subtotal: lineGross,
        total: lineNet,
        marginAmount: lineMarginAmt,
        marginPercent: lineMarginPct,
        billingFrequency: product.billingFrequency,
      };
    });

    const netBeforeOrderDiscount = this.round2(subtotal - totalLineDiscount);
    const orderDiscountPct = Math.min(100, Math.max(0, orderDiscountPercent));
    const orderDiscountAmt = this.round2(netBeforeOrderDiscount * (orderDiscountPct / 100));
    const totalAmount = this.round2(netBeforeOrderDiscount - orderDiscountAmt);
    const totalDiscount = this.round2(totalLineDiscount + orderDiscountAmt);
    const totalMargin = this.round2(totalAmount - totalCost);
    const totalMarginPercent = totalAmount > 0 ? this.clampPercent((totalMargin / totalAmount) * 100) : 0;

    // Calculate Risk Score and category ceiling checks via GovernanceService
    const riskResult = await governanceService.calculateRiskScore(
      orgId,
      tierId,
      preliminaryLines.map((l) => ({
        productId: l.productId,
        categoryId: l.categoryId,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        lineDiscountPercent: l.lineDiscountPercent,
        subtotal: l.subtotal,
        total: l.total,
      })),
      orderDiscountPct
    );

    const lineRiskMap = new Map(riskResult.lines.map((rl) => [rl.productId, rl]));

    const computedLines = preliminaryLines.map((l) => {
      const riskInfo = lineRiskMap.get(l.productId);
      return {
        ...l,
        appliedCeilingPercent: riskInfo?.categoryCeilingPercent ?? 0,
        riskDeltaPercent: riskInfo?.riskDeltaPercent ?? 0,
        isOverCeiling: riskInfo?.isOverCeiling ?? false,
      };
    });

    const result: CalculatedPricingResult = {
      computedLines,
      totals: {
        orderDiscountPercent: orderDiscountPct,
        orderDiscountAmount: orderDiscountAmt,
        subtotal: this.round2(subtotal),
        totalDiscount,
        totalAmount,
        totalCost: this.round2(totalCost),
        totalMargin,
        totalMarginPercent,
        oneTimeTotal: this.round2(oneTimeTotal),
        recurringMonthlyTotal: this.round2(recurringMonthlyTotal),
        recurringAnnualTotal: this.round2(recurringAnnualTotal),
      },
      risk: riskResult,
    };

    // Cache running totals & risk summary in Redis if quotation ID is present
    if (quotationId) {
      try {
        const quoteTotalsKey = `org:${orgId}:quote:${quotationId}:running_totals`;
        await redis.set(quoteTotalsKey, JSON.stringify(result), 'EX', 600);
      } catch {
        // Non-fatal
      }
    }

    return result;
  }
}

export const pricingService = new PricingService();
