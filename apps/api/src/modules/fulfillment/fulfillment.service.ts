import { prisma } from '../../lib/prisma.js';
import { HttpError } from '../../shared/errors.js';
import { warehousesService } from '../warehouses/warehouses.service.js';
import { approvalsService, type UserContext } from '../approvals/approvals.service.js';
import { emitToOrg } from '../../lib/socket.js';
import { logger } from '../../lib/logger.js';

/** Quotation statuses eligible for fulfillment. */
const FULFILLABLE_STATUSES = new Set(['approved', 'confirmed']);

export interface AllocationInput {
  warehouseId: string;
  quantity: number;
}

export interface PlanViewAllocation {
  fulfillmentLineId: string;
  warehouseId: string;
  warehouseName: string;
  warehouseCode: string;
  quantity: number;
}

export type PlanLineStatus = 'fulfilled' | 'ready' | 'split' | 'partial' | 'shortfall';

export interface PlanViewLine {
  quotationLineId: string;
  productId: string;
  productName: string;
  sku: string;
  orderedQuantity: number;
  allocations: PlanViewAllocation[];
  allocatedTotal: number;
  shortfall: number;
  lineStatus: PlanLineStatus;
}

export interface PlanView {
  plan: {
    id: string;
    status: 'proposed' | 'accepted';
    shipmentCount: number;
    deliveryExtendedDays: number;
    extraChargeNote: string | null;
    isOverridden: boolean;
    proposedAt: string;
    acceptedAt: string | null;
  };
  quotation: {
    id: string;
    quotationNumber: string;
    status: string;
    customerName: string;
    totalAmount: number;
    currency: string;
  };
  lines: PlanViewLine[];
}

interface AllocationDraft {
  warehouseId: string;
  quantity: number;
}

export class FulfillmentService {
  // ==================== HELPERS ====================

  private assertEligible(status: string) {
    if (!FULFILLABLE_STATUSES.has(status)) {
      throw new HttpError(
        400,
        `Only approved or confirmed quotations can be fulfilled (current status: '${status}').`
      );
    }
  }

  private async loadQuotation(orgId: string, quotationId: string) {
    const quotation = await prisma.quotation.findFirst({
      where: { id: quotationId, organizationId: orgId },
      include: {
        customer: { select: { name: true } },
        organization: { select: { currency: true } },
        lines: {
          orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }],
          include: { product: { select: { id: true, name: true, sku: true } } },
        },
      },
    });
    if (!quotation) {
      throw new HttpError(404, 'Quotation not found in this organization');
    }
    return quotation;
  }

  private async loadPlanView(orgId: string, quotationId: string): Promise<PlanView> {
    const quotation = await this.loadQuotation(orgId, quotationId);
    const plan = await prisma.fulfillmentPlan.findUnique({
      where: { organizationId_quotationId: { organizationId: orgId, quotationId } },
      include: {
        lines: {
          include: { warehouse: { select: { id: true, name: true, code: true } } },
          orderBy: [{ quantity: 'desc' as const }],
        },
      },
    });

    const lines: PlanViewLine[] = quotation.lines.map((ql) => {
      const allocations: PlanViewAllocation[] = (plan?.lines ?? [])
        .filter((l) => l.quotationLineId === ql.id)
        .map((l) => ({
          fulfillmentLineId: l.id,
          warehouseId: l.warehouseId,
          warehouseName: l.warehouse.name,
          warehouseCode: l.warehouse.code,
          quantity: l.quantity,
        }));
      const allocatedTotal = allocations.reduce((sum, a) => sum + a.quantity, 0);
      const shortfall = Math.max(0, ql.quantity - allocatedTotal);
      const lineStatus: PlanLineStatus =
        plan?.status === 'accepted'
          ? shortfall === 0
            ? 'fulfilled'
            : 'shortfall'
          : shortfall > 0 && allocatedTotal === 0
            ? 'shortfall'
            : shortfall > 0
              ? 'partial'
              : allocations.length > 1
                ? 'split'
                : 'ready';

      return {
        quotationLineId: ql.id,
        productId: ql.productId,
        productName: ql.product?.name || 'Product',
        sku: ql.product?.sku || '',
        orderedQuantity: ql.quantity,
        allocations,
        allocatedTotal,
        shortfall,
        lineStatus,
      };
    });

    return {
      plan: {
        id: plan?.id ?? '',
        status: (plan?.status as 'proposed' | 'accepted') ?? 'proposed',
        shipmentCount: plan?.shipmentCount ?? 0,
        deliveryExtendedDays: plan?.deliveryExtendedDays ?? 0,
        extraChargeNote: plan?.extraChargeNote ?? null,
        isOverridden: plan?.isOverridden ?? false,
        proposedAt: (plan?.proposedAt ?? new Date()).toISOString(),
        acceptedAt: plan?.acceptedAt ? plan.acceptedAt.toISOString() : null,
      },
      quotation: {
        id: quotation.id,
        quotationNumber: quotation.quotationNumber,
        status: quotation.status,
        customerName: quotation.customer.name,
        totalAmount: Number(quotation.totalAmount ?? 0),
        currency: quotation.organization.currency,
      },
      lines,
    };
  }

  /** Product name/sku map for building views. */
  private async productInfo(orgId: string, productIds: string[]) {
    const products = await prisma.product.findMany({
      where: { id: { in: productIds }, organizationId: orgId },
      select: { id: true, name: true, sku: true },
    });
    return new Map(products.map((p) => [p.id, { name: p.name, sku: p.sku }]));
  }

  // ==================== PROPOSAL (THE ALLOCATION ALGORITHM) ====================

  async proposePlan(orgId: string, quotationId: string, actor?: UserContext | null): Promise<PlanView> {
    const quotation = await this.loadQuotation(orgId, quotationId);
    this.assertEligible(quotation.status);

    if (quotation.lines.length === 0) {
      throw new HttpError(400, 'This quotation has no lines to fulfill');
    }

    const existing = await prisma.fulfillmentPlan.findUnique({
      where: { organizationId_quotationId: { organizationId: orgId, quotationId } },
    });
    if (existing?.status === 'accepted') {
      throw new HttpError(400, 'This fulfillment plan is already accepted and locked.');
    }

    // Live stock (org-scoped, cache-backed) + the org's own shipping rules.
    const matrix = await warehousesService.getStockMatrix(orgId);
    const rules = await warehousesService.getShippingRules(orgId);

    const activeWarehouses = matrix.warehouses
      .filter((w) => w.status === 'active')
      .sort((a, b) => {
        if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
        return b.columnTotal - a.columnTotal;
      });

    if (activeWarehouses.length === 0) {
      throw new HttpError(400, 'No active warehouses available — add a warehouse first.');
    }

    const stockFor = (productId: string, warehouseId: string): number =>
      matrix.rows.find((r) => r.productId === productId)?.quantities[warehouseId] ?? 0;

    // Greedy allocation: primary warehouse first, overflow to the next-best
    // warehouse (fewest shipments). Respects the org's split policy.
    const drafts = new Map<string, AllocationDraft[]>();
    let anySplit = false;

    for (const line of quotation.lines) {
      const remaining = line.quantity;
      const allocations: AllocationDraft[] = [];

      if (rules.allowSplitShipments) {
        let left = remaining;
        for (const wh of activeWarehouses) {
          if (left <= 0) break;
          const available = stockFor(line.productId, wh.id);
          if (available <= 0) continue;
          const take = Math.min(left, available);
          allocations.push({ warehouseId: wh.id, quantity: take });
          left -= take;
        }
        anySplit = anySplit || allocations.length > 1;
      } else {
        // No splits allowed: everything from the single best-stocked warehouse.
        const best = [...activeWarehouses]
          .map((wh) => ({ wh, available: stockFor(line.productId, wh.id) }))
          .sort((x, y) => y.available - x.available)[0];
        if (best && best.available > 0) {
          allocations.push({
            warehouseId: best.wh.id,
            quantity: Math.min(remaining, best.available),
          });
        }
      }

      drafts.set(line.id, allocations);
    }

    // Distinct warehouses used across the whole order = shipment count.
    const usedWarehouses = new Set<string>();
    for (const allocs of drafts.values()) {
      for (const a of allocs) usedWarehouses.add(a.warehouseId);
    }
    const shipmentCount = usedWarehouses.size;
    const splitNeeded = rules.allowSplitShipments
      ? [...drafts.values()].some((allocs) => allocs.length > 1)
      : shipmentCount > 1;
    const deliveryExtendedDays = splitNeeded ? rules.deliveryExtensionDays : 0;
    const extraChargeNote =
      splitNeeded && rules.chargeForSplitShipments
        ? 'Additional shipping charge may apply per your shipping rules.'
        : 'No extra charge for split shipments.';

    // Persist: replace the proposed allocation rows, keep the plan identity.
    const plan = await prisma.fulfillmentPlan.upsert({
      where: { organizationId_quotationId: { organizationId: orgId, quotationId } },
      create: {
        organizationId: orgId,
        quotationId,
        status: 'proposed',
        shipmentCount,
        deliveryExtendedDays,
        extraChargeNote,
      },
      update: {
        status: 'proposed',
        shipmentCount,
        deliveryExtendedDays,
        extraChargeNote,
        isOverridden: false,
        overriddenById: null,
        overriddenAt: null,
        proposedAt: new Date(),
      },
    });

    await prisma.fulfillmentLine.deleteMany({
      where: { organizationId: orgId, planId: plan.id },
    });

    const lineRows = quotation.lines.flatMap((line) =>
      (drafts.get(line.id) ?? []).map((a) => ({
        organizationId: orgId,
        planId: plan.id,
        quotationLineId: line.id,
        productId: line.productId,
        warehouseId: a.warehouseId,
        quantity: a.quantity,
      }))
    );
    if (lineRows.length > 0) {
      await prisma.fulfillmentLine.createMany({ data: lineRows });
    }

    emitToOrg(orgId, 'fulfillment:updated', { quotationId, action: 'proposed' });
    logger.info(
      { orgId, quotationId, shipmentCount, deliveryExtendedDays, actor: actor?.email },
      'Fulfillment split proposed'
    );

    return this.loadPlanView(orgId, quotationId);
  }

  async getOrCreatePlan(orgId: string, quotationId: string): Promise<PlanView> {
    const quotation = await this.loadQuotation(orgId, quotationId);
    this.assertEligible(quotation.status);

    const existing = await prisma.fulfillmentPlan.findUnique({
      where: { organizationId_quotationId: { organizationId: orgId, quotationId } },
    });

    if (existing) {
      return this.loadPlanView(orgId, quotationId);
    }
    // Lazy proposal: opening the page always shows a ready split.
    return this.proposePlan(orgId, quotationId);
  }

  // ==================== OPS OVERRIDE ====================

  async overrideLineAllocations(
    orgId: string,
    fulfillmentLineId: string,
    allocations: AllocationInput[],
    actor: UserContext
  ): Promise<PlanView> {
    const line = await prisma.fulfillmentLine.findFirst({
      where: { id: fulfillmentLineId, organizationId: orgId },
      include: { plan: true, quotationLine: true },
    });
    if (!line) {
      throw new HttpError(404, 'Fulfillment line not found');
    }
    if (line.plan.status !== 'proposed') {
      throw new HttpError(400, 'Accepted fulfillment plans are locked and cannot be overridden.');
    }

    const cleanAllocations = (allocations ?? []).filter((a) => a.quantity > 0);
    if (cleanAllocations.length === 0) {
      throw new HttpError(400, 'Provide at least one warehouse allocation with a quantity');
    }

    const orderedQty = line.quotationLine.quantity;
    const totalRequested = cleanAllocations.reduce((sum, a) => sum + a.quantity, 0);
    if (totalRequested > orderedQty) {
      throw new HttpError(400, `Allocated quantity (${totalRequested}) exceeds the ordered quantity (${orderedQty})`);
    }

    // Validate warehouses belong to the org.
    for (const a of cleanAllocations) {
      const wh = await prisma.warehouse.findFirst({
        where: { id: a.warehouseId, organizationId: orgId },
      });
      if (!wh) {
        throw new HttpError(404, 'One of the target warehouses was not found in this organization');
      }
    }

    // Validate live availability per warehouse, accounting for the OTHER lines
    // of the same product already allocated in this plan.
    const matrix = await warehousesService.getStockMatrix(orgId);
    const planLines = await prisma.fulfillmentLine.findMany({
      where: { organizationId: orgId, planId: line.planId },
    });

    for (const target of cleanAllocations) {
      const liveStock =
        matrix.rows.find((r) => r.productId === line.productId)?.quantities[target.warehouseId] ?? 0;
      const othersPlanned = planLines
        .filter((pl) => pl.productId === line.productId && pl.warehouseId === target.warehouseId)
        .filter((pl) => pl.quotationLineId !== line.quotationLineId)
        .reduce((sum, pl) => sum + pl.quantity, 0);
      if (totalRequested > 0 && liveStock - othersPlanned < target.quantity) {
        throw new HttpError(
          400,
          `Not enough live stock in the selected warehouse (available: ${Math.max(0, liveStock - othersPlanned)}). Regenerate the plan or pick another warehouse.`
        );
      }
    }

    // Replace this line's allocation rows with the override.
    await prisma.$transaction([
      prisma.fulfillmentLine.deleteMany({
        where: { organizationId: orgId, planId: line.planId, quotationLineId: line.quotationLineId },
      }),
      prisma.fulfillmentLine.createMany({
        data: cleanAllocations.map((a) => ({
          organizationId: orgId,
          planId: line.planId,
          quotationLineId: line.quotationLineId,
          productId: line.productId,
          warehouseId: a.warehouseId,
          quantity: a.quantity,
        })),
      }),
      prisma.fulfillmentPlan.update({
        where: { id: line.planId },
        data: {
          isOverridden: true,
          overriddenById: actor.userId,
          overriddenAt: new Date(),
        },
      }),
    ]);

    // Shipment count / delivery extension may change with the override.
    await this.recomputePlanMetrics(orgId, line.planId);

    emitToOrg(orgId, 'fulfillment:updated', { quotationId: line.plan.quotationId, action: 'overridden' });
    logger.info({ orgId, fulfillmentLineId, actor: actor.email }, 'Fulfillment line overridden');

    return this.loadPlanView(orgId, line.plan.quotationId);
  }

  /** Recomputes shipment count + delivery extension from the current rows. */
  private async recomputePlanMetrics(orgId: string, planId: string): Promise<void> {
    const rules = await warehousesService.getShippingRules(orgId);
    const plan = await prisma.fulfillmentPlan.findUnique({
      where: { id: planId },
      include: { lines: { select: { quotationLineId: true, warehouseId: true } } },
    });
    if (!plan) return;

    const byLine = new Map<string, Set<string>>();
    const usedWarehouses = new Set<string>();
    for (const l of plan.lines) {
      usedWarehouses.add(l.warehouseId);
      if (!byLine.has(l.quotationLineId)) byLine.set(l.quotationLineId, new Set());
      byLine.get(l.quotationLineId)!.add(l.warehouseId);
    }
    const shipmentCount = usedWarehouses.size;
    const splitNeeded = rules.allowSplitShipments
      ? [...byLine.values()].some((whs) => whs.size > 1)
      : shipmentCount > 1;
    const deliveryExtendedDays = splitNeeded ? rules.deliveryExtensionDays : 0;
    const extraChargeNote =
      splitNeeded && rules.chargeForSplitShipments
        ? 'Additional shipping charge may apply per your shipping rules.'
        : 'No extra charge for split shipments.';

    await prisma.fulfillmentPlan.update({
      where: { id: planId },
      data: { shipmentCount, deliveryExtendedDays, extraChargeNote },
    });
  }

  // ==================== ACCEPT (locks the plan, deducts stock) ====================

  async acceptPlan(orgId: string, quotationId: string, actor: UserContext): Promise<PlanView> {
    const quotation = await this.loadQuotation(orgId, quotationId);
    this.assertEligible(quotation.status);

    const plan = await prisma.fulfillmentPlan.findUnique({
      where: { organizationId_quotationId: { organizationId: orgId, quotationId } },
      include: { lines: true },
    });
    if (!plan) {
      throw new HttpError(404, 'No fulfillment plan exists for this quotation yet');
    }
    if (plan.status === 'accepted') {
      throw new HttpError(400, 'This fulfillment plan is already accepted and locked.');
    }

    // Re-validate against CURRENT live stock — read fresh from the database
    // (not the cache) so any change since the proposal is caught.
    const liveLevels = await prisma.stockLevel.findMany({
      where: { organizationId: orgId },
      select: { warehouseId: true, productId: true, quantity: true },
    });
    const liveMap = new Map<string, number>(
      liveLevels.map((l) => [`${l.warehouseId}:${l.productId}`, l.quantity] as const)
    );
    const needed = new Map<string, number>();
    for (const l of plan.lines) {
      const key = `${l.warehouseId}:${l.productId}`;
      needed.set(key, (needed.get(key) ?? 0) + l.quantity);
    }
    for (const [key, qty] of needed.entries()) {
      const live = liveMap.get(key) ?? 0;
      if (live < qty) {
        throw new HttpError(
          409,
          `Stock changed since the proposal was generated (need ${qty}, have ${live}). Regenerate the plan and try again.`
        );
      }
    }

    // Deduct the allocated quantities and lock the plan atomically.
    await prisma.$transaction(async (tx) => {
      for (const [key, qty] of needed.entries()) {
        const parts = key.split(':');
        const warehouseId = parts[0]!;
        const productId = parts[1]!;
        const level = await tx.stockLevel.findFirst({
          where: { organizationId: orgId, warehouseId, productId },
        });
        if (level) {
          await tx.stockLevel.update({
            where: { id: level.id },
            data: { quantity: Math.max(0, level.quantity - qty) },
          });
        } else {
          await tx.stockLevel.create({
            data: {
              organizationId: orgId,
              warehouseId,
              productId,
              quantity: 0,
            },
          });
        }
      }

      await tx.fulfillmentPlan.update({
        where: { id: plan.id },
        data: {
          status: 'accepted',
          acceptedById: actor.userId,
          acceptedAt: new Date(),
        },
      });
    });

    await warehousesService.invalidateStockCache(orgId);
    emitToOrg(orgId, 'inventory:updated', { quotationId, type: 'fulfillment_deduction' });
    emitToOrg(orgId, 'fulfillment:updated', { quotationId, action: 'accepted' });

    await approvalsService.logAudit(orgId, {
      entityType: 'quotation',
      entityId: quotationId,
      user: { userId: actor.userId, email: actor.email, role: actor.role },
      action: 'fulfillment_accepted',
      reason: `Fulfillment accepted: ${plan.shipmentCount} shipment(s)${plan.deliveryExtendedDays > 0 ? `, delivery +${plan.deliveryExtendedDays} days` : ''}, no extra charge to the customer.`,
      metadata: {
        shipmentCount: plan.shipmentCount,
        deliveryExtendedDays: plan.deliveryExtendedDays,
        allocationCount: plan.lines.length,
      },
    });

    logger.info({ orgId, quotationId, actor: actor.email }, 'Fulfillment plan accepted; stock deducted');
    return this.loadPlanView(orgId, quotationId);
  }
}

export const fulfillmentService = new FulfillmentService();
