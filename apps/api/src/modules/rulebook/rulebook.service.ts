import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { HttpError } from '../../shared/errors.js';
import { catalogService } from '../catalog/catalog.service.js';

export interface DiscountCeilingInput {
  tierId: string;
  categoryId: string;
  maxDiscountPercent: number;
}

export interface ApprovalChainConfigInput {
  managerThresholdPercent?: number;
  financeThresholdPercent?: number;
  requireFinanceAboveThreshold?: boolean;
  autoApproveWithinCeilings?: boolean;
}

export interface EvaluateRuleInput {
  tierId: string;
  categoryId: string;
  proposedDiscountPercent: number;
}

export interface EvaluateRuleResult {
  tierId: string;
  tierName: string;
  categoryId: string;
  categoryName: string;
  maxDiscountPercent: number;
  proposedDiscountPercent: number;
  discountDelta: number;
  outcome: 'AUTO_APPROVED' | 'MANAGER_ONLY' | 'MANAGER_THEN_FINANCE';
  requiresManager: boolean;
  requiresFinance: boolean;
  reason: string;
}

export class RulebookService {
  /**
   * Ensures default discount ceilings (Tier x Category) and approval chain config exist for an organization.
   */
  async ensureDefaultRulebook(orgId: string): Promise<void> {
    await catalogService.ensureDefaultCatalog(orgId);

    const [categories, tiers] = await Promise.all([
      prisma.productCategory.findMany({ where: { organizationId: orgId } }),
      prisma.customerTier.findMany({ where: { organizationId: orgId }, orderBy: { rank: 'asc' } }),
    ]);

    const existingCeilings = await prisma.discountCeiling.findMany({
      where: { organizationId: orgId },
    });

    const existingMap = new Set(existingCeilings.map((c) => `${c.tierId}:${c.categoryId}`));
    const newCeilingsToCreate: Array<{
      organizationId: string;
      tierId: string;
      categoryId: string;
      maxDiscountPercent: Prisma.Decimal;
    }> = [];

    for (const tier of tiers) {
      for (const cat of categories) {
        const key = `${tier.id}:${cat.id}`;
        if (!existingMap.has(key)) {
          let defaultCeiling = 10.0;
          const tCode = tier.code.toLowerCase();
          const cCode = cat.code.toLowerCase();

          if (tCode === 'bronze') {
            if (cCode === 'hardware') defaultCeiling = 5.0;
            else if (cCode === 'services') defaultCeiling = 10.0;
            else if (cCode === 'subscriptions') defaultCeiling = 10.0;
          } else if (tCode === 'silver') {
            if (cCode === 'hardware') defaultCeiling = 12.0;
            else if (cCode === 'services') defaultCeiling = 15.0;
            else if (cCode === 'subscriptions') defaultCeiling = 15.0;
          } else if (tCode === 'gold') {
            if (cCode === 'hardware') defaultCeiling = 20.0;
            else if (cCode === 'services') defaultCeiling = 25.0;
            else if (cCode === 'subscriptions') defaultCeiling = 25.0;
          }

          newCeilingsToCreate.push({
            organizationId: orgId,
            tierId: tier.id,
            categoryId: cat.id,
            maxDiscountPercent: new Prisma.Decimal(defaultCeiling),
          });
        }
      }
    }

    if (newCeilingsToCreate.length > 0) {
      await prisma.discountCeiling.createMany({
        data: newCeilingsToCreate,
      });
    }

    const existingConfig = await prisma.approvalChainConfig.findUnique({
      where: { organizationId: orgId },
    });

    if (!existingConfig) {
      await prisma.approvalChainConfig.create({
        data: {
          organizationId: orgId,
          managerThresholdPercent: new Prisma.Decimal(0.0),
          financeThresholdPercent: new Prisma.Decimal(15.0),
          requireFinanceAboveThreshold: true,
          autoApproveWithinCeilings: true,
        },
      });
    }
  }

  /**
   * Retrieves the full rulebook for an organization: customer tiers, product categories,
   * 2D ceiling matrix, and approval chain configuration.
   */
  async getRulebook(orgId: string) {
    await this.ensureDefaultRulebook(orgId);

    const [tiers, categories, ceilings, approvalConfig] = await Promise.all([
      prisma.customerTier.findMany({
        where: { organizationId: orgId },
        orderBy: { rank: 'asc' },
      }),
      prisma.productCategory.findMany({
        where: { organizationId: orgId },
        orderBy: { name: 'asc' },
      }),
      prisma.discountCeiling.findMany({
        where: { organizationId: orgId },
      }),
      prisma.approvalChainConfig.findUnique({
        where: { organizationId: orgId },
      }),
    ]);

    const ceilingMap = new Map<string, { id: string; maxDiscountPercent: number }>();
    for (const c of ceilings) {
      ceilingMap.set(`${c.categoryId}:${c.tierId}`, {
        id: c.id,
        maxDiscountPercent: Number(c.maxDiscountPercent),
      });
    }

    const matrix = categories.map((cat) => {
      const tierCeilings: Record<
        string,
        {
          id: string | null;
          maxDiscountPercent: number;
        }
      > = {};

      for (const tier of tiers) {
        const item = ceilingMap.get(`${cat.id}:${tier.id}`);
        tierCeilings[tier.id] = {
          id: item?.id ?? null,
          maxDiscountPercent: item?.maxDiscountPercent ?? 0,
        };
      }

      return {
        category: {
          id: cat.id,
          name: cat.name,
          code: cat.code,
          description: cat.description,
        },
        tierCeilings,
      };
    });

    return {
      tiers,
      categories,
      matrix,
      approvalConfig: approvalConfig
        ? {
            id: approvalConfig.id,
            managerThresholdPercent: Number(approvalConfig.managerThresholdPercent),
            financeThresholdPercent: Number(approvalConfig.financeThresholdPercent),
            requireFinanceAboveThreshold: approvalConfig.requireFinanceAboveThreshold,
            autoApproveWithinCeilings: approvalConfig.autoApproveWithinCeilings,
          }
        : null,
    };
  }

  /**
   * Updates or upserts discount ceilings in batch.
   */
  async updateCeilings(orgId: string, items: DiscountCeilingInput[]) {
    if (!items || items.length === 0) {
      return { count: 0 };
    }

    const tierIds = Array.from(new Set(items.map((i) => i.tierId)));
    const categoryIds = Array.from(new Set(items.map((i) => i.categoryId)));

    const [validTiers, validCategories] = await Promise.all([
      prisma.customerTier.findMany({
        where: { id: { in: tierIds }, organizationId: orgId },
        select: { id: true },
      }),
      prisma.productCategory.findMany({
        where: { id: { in: categoryIds }, organizationId: orgId },
        select: { id: true },
      }),
    ]);

    const validTierSet = new Set(validTiers.map((t) => t.id));
    const validCatSet = new Set(validCategories.map((c) => c.id));

    const sanitizedItems = items.filter(
      (item) =>
        validTierSet.has(item.tierId) &&
        validCatSet.has(item.categoryId) &&
        !isNaN(item.maxDiscountPercent) &&
        item.maxDiscountPercent >= 0 &&
        item.maxDiscountPercent <= 100
    );

    if (sanitizedItems.length === 0 && items.length > 0) {
      throw new HttpError(400, 'Invalid tier or category IDs provided for this organization');
    }

    return prisma.$transaction(async (tx) => {
      let count = 0;
      for (const item of sanitizedItems) {
        await tx.discountCeiling.upsert({
          where: {
            organizationId_tierId_categoryId: {
              organizationId: orgId,
              tierId: item.tierId,
              categoryId: item.categoryId,
            },
          },
          create: {
            organizationId: orgId,
            tierId: item.tierId,
            categoryId: item.categoryId,
            maxDiscountPercent: new Prisma.Decimal(item.maxDiscountPercent),
          },
          update: {
            maxDiscountPercent: new Prisma.Decimal(item.maxDiscountPercent),
          },
        });
        count++;
      }
      return { count };
    });
  }

  /**
   * Updates approval chain configuration for the tenant.
   */
  async updateApprovalChainConfig(orgId: string, input: ApprovalChainConfigInput) {
    const existing = await prisma.approvalChainConfig.findUnique({
      where: { organizationId: orgId },
    });

    const managerThreshold =
      input.managerThresholdPercent !== undefined
        ? new Prisma.Decimal(Math.max(0, Math.min(100, input.managerThresholdPercent)))
        : existing?.managerThresholdPercent ?? new Prisma.Decimal(0.0);

    const financeThreshold =
      input.financeThresholdPercent !== undefined
        ? new Prisma.Decimal(Math.max(0, Math.min(100, input.financeThresholdPercent)))
        : existing?.financeThresholdPercent ?? new Prisma.Decimal(15.0);

    const requireFinanceAboveThreshold =
      input.requireFinanceAboveThreshold !== undefined
        ? input.requireFinanceAboveThreshold
        : existing?.requireFinanceAboveThreshold ?? true;

    const autoApproveWithinCeilings =
      input.autoApproveWithinCeilings !== undefined
        ? input.autoApproveWithinCeilings
        : existing?.autoApproveWithinCeilings ?? true;

    const updated = await prisma.approvalChainConfig.upsert({
      where: { organizationId: orgId },
      create: {
        organizationId: orgId,
        managerThresholdPercent: managerThreshold,
        financeThresholdPercent: financeThreshold,
        requireFinanceAboveThreshold,
        autoApproveWithinCeilings,
      },
      update: {
        managerThresholdPercent: managerThreshold,
        financeThresholdPercent: financeThreshold,
        requireFinanceAboveThreshold,
        autoApproveWithinCeilings,
      },
    });

    return {
      id: updated.id,
      managerThresholdPercent: Number(updated.managerThresholdPercent),
      financeThresholdPercent: Number(updated.financeThresholdPercent),
      requireFinanceAboveThreshold: updated.requireFinanceAboveThreshold,
      autoApproveWithinCeilings: updated.autoApproveWithinCeilings,
    };
  }

  /**
   * Governance Simulator: Evaluates a proposed discount against the organization's rulebook.
   */
  async evaluateRule(orgId: string, input: EvaluateRuleInput): Promise<EvaluateRuleResult> {
    await this.ensureDefaultRulebook(orgId);

    const [tier, category, ceiling, approvalConfig] = await Promise.all([
      prisma.customerTier.findFirst({
        where: { id: input.tierId, organizationId: orgId },
      }),
      prisma.productCategory.findFirst({
        where: { id: input.categoryId, organizationId: orgId },
      }),
      prisma.discountCeiling.findFirst({
        where: {
          organizationId: orgId,
          tierId: input.tierId,
          categoryId: input.categoryId,
        },
      }),
      prisma.approvalChainConfig.findUnique({
        where: { organizationId: orgId },
      }),
    ]);

    if (!tier) {
      throw new HttpError(404, 'Customer tier not found for this organization');
    }
    if (!category) {
      throw new HttpError(404, 'Product category not found for this organization');
    }

    const maxDiscountPercent = ceiling ? Number(ceiling.maxDiscountPercent) : 0;
    const proposed = Number(input.proposedDiscountPercent) || 0;
    const discountDelta = Math.round((proposed - maxDiscountPercent) * 100) / 100;

    const financeThreshold = approvalConfig ? Number(approvalConfig.financeThresholdPercent) : 15.0;
    const requireFinance = approvalConfig?.requireFinanceAboveThreshold ?? true;
    const autoApproveWithin = approvalConfig?.autoApproveWithinCeilings ?? true;

    let outcome: 'AUTO_APPROVED' | 'MANAGER_ONLY' | 'MANAGER_THEN_FINANCE' = 'AUTO_APPROVED';
    let requiresManager = false;
    let requiresFinance = false;
    let reason = '';

    if (discountDelta <= 0) {
      if (autoApproveWithin) {
        outcome = 'AUTO_APPROVED';
        reason = `Discount of ${proposed}% is within the allowed ceiling of ${maxDiscountPercent}%. No approval required.`;
      } else {
        outcome = 'MANAGER_ONLY';
        requiresManager = true;
        reason = `Discount is within ceiling (${maxDiscountPercent}%), but policy requires Sales Manager sign-off.`;
      }
    } else {
      if (requireFinance && discountDelta > financeThreshold) {
        outcome = 'MANAGER_THEN_FINANCE';
        requiresManager = true;
        requiresFinance = true;
        reason = `Discount exceeds category ceiling by +${discountDelta}% (above the +${financeThreshold}% finance threshold). Requires Sales Manager approval and Finance escalation.`;
      } else {
        outcome = 'MANAGER_ONLY';
        requiresManager = true;
        reason = `Discount exceeds category ceiling by +${discountDelta}%. Requires Sales Manager approval.`;
      }
    }

    return {
      tierId: tier.id,
      tierName: tier.name,
      categoryId: category.id,
      categoryName: category.name,
      maxDiscountPercent,
      proposedDiscountPercent: proposed,
      discountDelta,
      outcome,
      requiresManager,
      requiresFinance,
      reason,
    };
  }
}

export const rulebookService = new RulebookService();
