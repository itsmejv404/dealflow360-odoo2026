import { prisma } from '../../lib/prisma.js';
import { pricingService } from '../quotations/pricing.service.js';

export interface UpsellSuggestion {
  productId: string;
  name: string;
  sku: string;
  categoryId: string | null;
  categoryName?: string;
  categoryCode?: string;
  billingFrequency: string;
  unitPrice: number;
  costPrice: number;
  lineDiscountPercent: number;
  lineTotal: number;
  marginAmount: number;
  marginPercent: number;
  reason: string;
  // Incremental impact on the active quotation
  deltaRevenue: number;
  deltaMarginAmount: number;
  projectedQuoteMarginPercent: number;
}

export interface GetUpsellSuggestionsInput {
  currentProductIds: string[];
  tierId?: string;
  currentSubtotal?: number;
  currentTotalAmount?: number;
  currentTotalCost?: number;
  currentTotalMargin?: number;
}

export class RecommendationsService {
  private round2(num: number): number {
    return Math.round((num + Number.EPSILON) * 100) / 100;
  }

  /**
   * Suggests products from the SAME category as the items already in the
   * quotation — honest, explainable "similar products", ranked by the margin
   * each would add. Strictly tenant-isolated via orgId.
   */
  async getUpsellSuggestions(
    orgId: string,
    input: GetUpsellSuggestionsInput
  ): Promise<UpsellSuggestion[]> {
    const { currentProductIds = [], tierId, currentTotalAmount = 0, currentTotalCost = 0 } = input;

    if (currentProductIds.length === 0) {
      return [];
    }

    // 1. Resolve the categories represented in the current cart (org-scoped:
    // foreign product ids simply resolve to nothing).
    const cartProducts = await prisma.product.findMany({
      where: { id: { in: currentProductIds }, organizationId: orgId },
      include: { category: true },
    });

    const categoryIds = [...new Set(cartProducts.map((p) => p.categoryId).filter((id): id is string => !!id))];
    if (categoryIds.length === 0) {
      return [];
    }

    // 2. Same-category active products of this org, excluding cart items.
    const similarProducts = await prisma.product.findMany({
      where: {
        organizationId: orgId,
        categoryId: { in: categoryIds },
        id: { notIn: currentProductIds },
        status: 'active',
      },
      include: { category: true },
      orderBy: [{ price: 'desc' }],
      take: 6,
    });

    if (similarProducts.length === 0) {
      return [];
    }

    // 3. Tier pricing for the customer's tier (custom prices / default discount).
    let tierPricingMap: { tierDefaultDiscount: number; customPrices: Record<string, number> } = {
      tierDefaultDiscount: 0,
      customPrices: {},
    };
    if (tierId) {
      tierPricingMap = await pricingService.getTierPriceListMap(orgId, tierId);
    }

    const suggestions: UpsellSuggestion[] = similarProducts.map((prod) => {
      const basePrice = Number(prod.price);
      const customPrice = tierPricingMap.customPrices[prod.id];
      const unitPrice = customPrice !== undefined ? customPrice : basePrice;
      const costPrice = Number(prod.costPrice || 0);

      const lineDiscountPercent = customPrice !== undefined ? 0 : tierPricingMap.tierDefaultDiscount;
      const lineTotal = this.round2(unitPrice * (1 - lineDiscountPercent / 100));
      const marginAmount = this.round2(lineTotal - costPrice);
      const marginPercent = lineTotal > 0 ? this.round2((marginAmount / lineTotal) * 100) : 0;

      const deltaRevenue = lineTotal;
      const projectedTotalAmount = this.round2(currentTotalAmount + lineTotal);
      const projectedTotalCost = this.round2(currentTotalCost + costPrice);
      const projectedTotalMargin = this.round2(projectedTotalAmount - projectedTotalCost);
      const projectedQuoteMarginPercent = projectedTotalAmount > 0
        ? this.round2((projectedTotalMargin / projectedTotalAmount) * 100)
        : 0;

      const sameCategorySource = cartProducts.find((p) => p.categoryId === prod.categoryId);

      return {
        productId: prod.id,
        name: prod.name,
        sku: prod.sku,
        categoryId: prod.categoryId,
        categoryName: prod.category?.name,
        categoryCode: prod.category?.code,
        billingFrequency: prod.billingFrequency,
        unitPrice,
        costPrice,
        lineDiscountPercent,
        lineTotal,
        marginAmount,
        marginPercent,
        reason: sameCategorySource
          ? `Same category as ${sameCategorySource.name}`
          : `Matches ${prod.category?.name || 'the cart'} category`,
        deltaRevenue,
        deltaMarginAmount: marginAmount,
        projectedQuoteMarginPercent,
      };
    });

    // Rank by the margin the suggestion would add, then by price.
    return suggestions.sort((a, b) => {
      if (b.deltaMarginAmount !== a.deltaMarginAmount) {
        return b.deltaMarginAmount - a.deltaMarginAmount;
      }
      return a.unitPrice - b.unitPrice;
    });
  }
}

export const recommendationsService = new RecommendationsService();
