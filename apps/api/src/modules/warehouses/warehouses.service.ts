import { prisma } from '../../lib/prisma.js';
import { redis } from '../../lib/redis.js';
import { HttpError } from '../../shared/errors.js';
import { emitToOrg } from '../../lib/socket.js';
import { logger } from '../../lib/logger.js';
import { backorderConsolidationQueue } from '../../lib/queue.js';

export interface CreateWarehouseInput {
  name: string;
  code: string;
  address?: string;
  city?: string;
  isDefault?: boolean;
  status?: 'active' | 'inactive';
}

export interface UpdateWarehouseInput {
  name?: string;
  code?: string;
  address?: string | null;
  city?: string | null;
  isDefault?: boolean;
  status?: 'active' | 'inactive';
}

export interface UpdateShippingRulesInput {
  allowSplitShipments?: boolean;
  chargeForSplitShipments?: boolean;
  deliveryExtensionDays?: number;
  notes?: string | null;
}

export interface StockMatrixRow {
  productId: string;
  productName: string;
  sku: string;
  quantities: Record<string, number>;
  /** Worth (qty × unit value) per warehouse id. */
  worth: Record<string, number>;
  total: number;
  totalWorth: number;
}

export interface StockMatrix {
  cachedAt: string;
  warehouses: Array<{
    id: string;
    name: string;
    code: string;
    city: string | null;
    isDefault: boolean;
    status: string;
    columnTotal: number;
    columnWorth: number;
  }>;
  rows: StockMatrixRow[];
  grandTotal: number;
  grandTotalWorth: number;
}

export class WarehousesService {
  private round2(num: number): number {
    return Math.round((num + Number.EPSILON) * 100) / 100;
  }

  /** Org-namespaced cache key for the full stock matrix. */
  private stockCacheKey(orgId: string): string {
    return `org:${orgId}:stock:all`;
  }

  /**
   * Invalidates the org's stock matrix cache. Public so sibling modules
   * (e.g. fulfillment stock deductions) can keep reads fresh.
   */
  async invalidateStockCache(orgId: string): Promise<void> {
    try {
      await redis.del(this.stockCacheKey(orgId));
    } catch {
      // Non-fatal: cache misses fall back to the database
    }
  }

  // ==================== WAREHOUSE CRUD ====================

  async listWarehouses(orgId: string) {
    return prisma.warehouse.findMany({
      where: { organizationId: orgId },
      orderBy: [{ createdAt: 'asc' }, { name: 'asc' }],
      include: {
        _count: { select: { stockLevels: true } },
      },
    });
  }

  async createWarehouse(orgId: string, data: CreateWarehouseInput) {
    const code = data.code.trim().toUpperCase();
    const cleanName = data.name.trim();

    const existing = await prisma.warehouse.findFirst({
      where: {
        organizationId: orgId,
        OR: [{ code }, { name: cleanName }],
      },
    });
    if (existing) {
      throw new HttpError(409, 'A warehouse with this name or code already exists in your organization');
    }

    return prisma.$transaction(async (tx) => {
      if (data.isDefault) {
        await tx.warehouse.updateMany({
          where: { organizationId: orgId, isDefault: true },
          data: { isDefault: false },
        });
      }
      const warehouse = await tx.warehouse.create({
        data: {
          organizationId: orgId,
          name: cleanName,
          code,
          address: data.address?.trim() || null,
          city: data.city?.trim() || null,
          isDefault: data.isDefault ?? false,
          status: data.status || 'active',
        },
      });

      await this.invalidateStockCache(orgId);
      emitToOrg(orgId, 'inventory:updated', { warehouseId: warehouse.id, type: 'warehouse_created' });
      return warehouse;
    });
  }

  async updateWarehouse(orgId: string, warehouseId: string, data: UpdateWarehouseInput) {
    const warehouse = await prisma.warehouse.findFirst({
      where: { id: warehouseId, organizationId: orgId },
    });
    if (!warehouse) {
      throw new HttpError(404, 'Warehouse not found in this organization');
    }

    const cleanName = data.name?.trim();
    const code = data.code?.trim().toUpperCase();

    if (cleanName || code) {
      const conflict = await prisma.warehouse.findFirst({
        where: {
          organizationId: orgId,
          id: { not: warehouseId },
          OR: [...(code ? [{ code }] : []), ...(cleanName ? [{ name: cleanName }] : [])],
        },
      });
      if (conflict) {
        throw new HttpError(409, 'Another warehouse already uses this name or code');
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      if (data.isDefault === true) {
        await tx.warehouse.updateMany({
          where: { organizationId: orgId, isDefault: true, id: { not: warehouseId } },
          data: { isDefault: false },
        });
      }
      return tx.warehouse.update({
        where: { id: warehouseId },
        data: {
          ...(cleanName && { name: cleanName }),
          ...(code && { code }),
          ...(data.address !== undefined && { address: data.address?.trim() || null }),
          ...(data.city !== undefined && { city: data.city?.trim() || null }),
          ...(data.isDefault !== undefined && { isDefault: data.isDefault }),
          ...(data.status !== undefined && { status: data.status }),
        },
      });
    });

    await this.invalidateStockCache(orgId);
    emitToOrg(orgId, 'inventory:updated', { warehouseId, type: 'warehouse_updated' });
    return updated;
  }

  async deleteWarehouse(orgId: string, warehouseId: string) {
    const warehouse = await prisma.warehouse.findFirst({
      where: { id: warehouseId, organizationId: orgId },
      include: { _count: { select: { stockLevels: true } } },
    });
    if (!warehouse) {
      throw new HttpError(404, 'Warehouse not found in this organization');
    }

    if (warehouse._count.stockLevels > 0) {
      throw new HttpError(
        400,
        `Cannot delete "${warehouse.name}" while it still holds ${warehouse._count.stockLevels} stock record(s). Clear its stock first.`
      );
    }

    await prisma.warehouse.delete({ where: { id: warehouseId } });

    await this.invalidateStockCache(orgId);
    emitToOrg(orgId, 'inventory:updated', { warehouseId, type: 'warehouse_deleted' });
    return { success: true };
  }

  // ==================== SHIPPING RULES (org policy) ====================

  async getShippingRules(orgId: string) {
    const config = await prisma.shippingRuleConfig.findUnique({
      where: { organizationId: orgId },
    });
    // Defaults reflect the standing policy: split shipments allowed, the
    // customer never pays extra, delivery date extends instead.
    return (
      config ?? {
        allowSplitShipments: true,
        chargeForSplitShipments: false,
        deliveryExtensionDays: 3,
        notes: null,
      }
    );
  }

  async updateShippingRules(orgId: string, data: UpdateShippingRulesInput) {
    if (
      data.deliveryExtensionDays !== undefined &&
      (data.deliveryExtensionDays < 0 || data.deliveryExtensionDays > 60)
    ) {
      throw new HttpError(400, 'Delivery extension must be between 0 and 60 days');
    }

    const config = await prisma.shippingRuleConfig.upsert({
      where: { organizationId: orgId },
      create: {
        organizationId: orgId,
        allowSplitShipments: data.allowSplitShipments ?? true,
        chargeForSplitShipments: data.chargeForSplitShipments ?? false,
        deliveryExtensionDays: data.deliveryExtensionDays ?? 3,
        notes: data.notes?.trim() || null,
      },
      update: {
        ...(data.allowSplitShipments !== undefined && { allowSplitShipments: data.allowSplitShipments }),
        ...(data.chargeForSplitShipments !== undefined && { chargeForSplitShipments: data.chargeForSplitShipments }),
        ...(data.deliveryExtensionDays !== undefined && { deliveryExtensionDays: data.deliveryExtensionDays }),
        ...(data.notes !== undefined && { notes: data.notes?.trim() || null }),
      },
    });

    logger.info({ orgId }, 'Shipping rules updated');
    return config;
  }

  // ==================== SHIPPING RULE OVERRIDES (customer / warehouse) ====================

  /**
   * Resolve the effective shipping rules. Priority:
   *   1. Customer-specific override (if customerId provided and a row exists)
   *   2. Warehouse-specific override (if warehouseId provided and a row exists)
   *   3. Org-level default config
   *
   * For split-warehouse shipping, callers resolve rules per warehouse so each
   * shipment leg follows the right policy.
   */
  async resolveShippingRules(
    orgId: string,
    scope?: { customerId?: string | null; warehouseId?: string | null }
  ) {
    if (scope?.customerId) {
      const customerOverride = await prisma.shippingRuleOverride.findFirst({
        where: { organizationId: orgId, customerId: scope.customerId },
      });
      if (customerOverride) return customerOverride;
    }
    if (scope?.warehouseId) {
      const warehouseOverride = await prisma.shippingRuleOverride.findFirst({
        where: { organizationId: orgId, warehouseId: scope.warehouseId },
      });
      if (warehouseOverride) return warehouseOverride;
    }
    return this.getShippingRules(orgId);
  }

  async getShippingRuleOverrides(orgId: string) {
    const [overrides, customers, warehouses] = await Promise.all([
      prisma.shippingRuleOverride.findMany({
        where: { organizationId: orgId },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.customer.findMany({
        where: { organizationId: orgId },
        select: { id: true, name: true, email: true },
        orderBy: { name: 'asc' },
      }),
      prisma.warehouse.findMany({
        where: { organizationId: orgId },
        select: { id: true, name: true, code: true },
        orderBy: { name: 'asc' },
      }),
    ]);
    return { overrides, customers, warehouses };
  }

  async upsertShippingRuleOverride(
    orgId: string,
    input: UpdateShippingRulesInput & { customerId?: string | null; warehouseId?: string | null }
  ) {
    if (
      input.deliveryExtensionDays !== undefined &&
      (input.deliveryExtensionDays < 0 || input.deliveryExtensionDays > 60)
    ) {
      throw new HttpError(400, 'Delivery extension must be between 0 and 60 days');
    }

    const customerId = input.customerId?.trim() || null;
    const warehouseId = input.warehouseId?.trim() || null;

    if (!customerId && !warehouseId) {
      throw new HttpError(400, 'An override must target a customer or a warehouse');
    }
    if (customerId) {
      const customer = await prisma.customer.findFirst({
        where: { id: customerId, organizationId: orgId },
      });
      if (!customer) throw new HttpError(404, 'Customer not found in this organization');
    }
    if (warehouseId) {
      const warehouse = await prisma.warehouse.findFirst({
        where: { id: warehouseId, organizationId: orgId },
      });
      if (!warehouse) throw new HttpError(404, 'Warehouse not found in this organization');
    }

    const existing = await prisma.shippingRuleOverride.findFirst({
      where: { organizationId: orgId, customerId, warehouseId },
    });

    const data = {
      allowSplitShipments: input.allowSplitShipments ?? true,
      chargeForSplitShipments: input.chargeForSplitShipments ?? false,
      deliveryExtensionDays: input.deliveryExtensionDays ?? 3,
      notes: input.notes?.trim() || null,
    };

    const override = existing
      ? await prisma.shippingRuleOverride.update({ where: { id: existing.id }, data })
      : await prisma.shippingRuleOverride.create({
          data: { organizationId: orgId, customerId, warehouseId, ...data },
        });

    logger.info({ orgId, customerId, warehouseId }, 'Shipping rule override saved');
    return override;
  }

  async deleteShippingRuleOverride(orgId: string, overrideId: string) {
    const existing = await prisma.shippingRuleOverride.findFirst({
      where: { id: overrideId, organizationId: orgId },
    });
    if (!existing) {
      throw new HttpError(404, 'Shipping rule override not found');
    }
    await prisma.shippingRuleOverride.delete({ where: { id: overrideId } });
    logger.info({ orgId, overrideId }, 'Shipping rule override deleted');
    return { success: true };
  }

  // ==================== STOCK (Redis-cached matrix) ====================

  async getStockMatrix(orgId: string): Promise<StockMatrix> {
    const cacheKey = this.stockCacheKey(orgId);

    // Live stock reads are served from the org-namespaced Redis cache.
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached) as StockMatrix;
      }
    } catch {
      // Fallback to database on cache miss or error
    }

    const [warehouses, products, stockLevels] = await Promise.all([
      prisma.warehouse.findMany({
        where: { organizationId: orgId },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      }),
      prisma.product.findMany({
        where: { organizationId: orgId, status: 'active' },
        orderBy: [{ createdAt: 'asc' }, { name: 'asc' }],
      }),
      prisma.stockLevel.findMany({
        where: { organizationId: orgId },
      }),
    ]);

    const quantityMap = new Map<string, number>();
    for (const level of stockLevels) {
      quantityMap.set(`${level.warehouseId}:${level.productId}`, level.quantity);
    }

    const matrix: StockMatrix = {
      cachedAt: new Date().toISOString(),
      warehouses: warehouses.map((w) => ({
        id: w.id,
        name: w.name,
        code: w.code,
        city: w.city,
        isDefault: w.isDefault,
        status: w.status,
        columnTotal: 0,
        columnWorth: 0,
      })),
      rows: products.map((p) => ({
        productId: p.id,
        productName: p.name,
        sku: p.sku,
        quantities: Object.fromEntries(
          warehouses.map((w) => [w.id, quantityMap.get(`${w.id}:${p.id}`) ?? 0])
        ),
        worth: {},
        total: 0,
        totalWorth: 0,
      })),
      grandTotal: 0,
      grandTotalWorth: 0,
    };

    for (const row of matrix.rows) {
      const product = products.find((p) => p.id === row.productId);
      // Use cost price when known (inventory worth); fall back to list price.
      const unitValue = product ? Number(product.costPrice ?? product.price) : 0;
      for (const w of matrix.warehouses) {
        const qty = row.quantities[w.id] ?? 0;
        const worth = this.round2(qty * unitValue);
        row.worth[w.id] = worth;
        row.total += qty;
        row.totalWorth += worth;
        w.columnTotal += qty;
        w.columnWorth += worth;
      }
      matrix.grandTotal += row.total;
      matrix.grandTotalWorth += row.totalWorth;
    }
    for (const w of matrix.warehouses) {
      w.columnWorth = this.round2(w.columnWorth);
    }
    matrix.grandTotalWorth = this.round2(matrix.grandTotalWorth);

    try {
      await redis.set(cacheKey, JSON.stringify(matrix), 'EX', 300);
    } catch {
      // Non-fatal cache write error
    }

    return matrix;
  }

  async setStock(orgId: string, warehouseId: string, productId: string, quantity: number) {
    if (!Number.isInteger(quantity) || quantity < 0) {
      throw new HttpError(400, 'Stock quantity must be a whole number of 0 or more');
    }

    const warehouse = await prisma.warehouse.findFirst({
      where: { id: warehouseId, organizationId: orgId },
    });
    if (!warehouse) {
      throw new HttpError(404, 'Warehouse not found in this organization');
    }

    const product = await prisma.product.findFirst({
      where: { id: productId, organizationId: orgId },
    });
    if (!product) {
      throw new HttpError(404, 'Product not found in this organization');
    }

    const existingLevel = await prisma.stockLevel.findFirst({
      where: { organizationId: orgId, warehouseId, productId },
    });
    const previousQuantity = existingLevel?.quantity ?? 0;

    const level = await prisma.stockLevel.upsert({
      where: {
        organizationId_warehouseId_productId: {
          organizationId: orgId,
          warehouseId,
          productId,
        },
      },
      create: {
        organizationId: orgId,
        warehouseId,
        productId,
        quantity,
      },
      update: { quantity },
    });

    // Cache is invalidated so the very next read reflects the new quantity,
    // and every screen of this org hears about it in real time.
    await this.invalidateStockCache(orgId);
    emitToOrg(orgId, 'inventory:updated', {
      warehouseId,
      productId,
      quantity,
      warehouseName: warehouse.name,
      productName: product.name,
    });

    // If stock increased, enqueue the auto-consolidation background job (Phase 17)
    if (quantity > previousQuantity) {
      const quantityAdded = quantity - previousQuantity;
      await backorderConsolidationQueue.add(
        `stock-arrival:${orgId}:${productId}:${Date.now()}`,
        {
          orgId,
          warehouseId,
          productId,
          quantityAdded,
          timestamp: new Date().toISOString(),
        }
      );
      logger.info(
        { orgId, warehouseId, productId, quantityAdded, newTotal: quantity },
        'Stock increased via setStock -> auto-consolidation job enqueued'
      );
    }

    logger.info({ orgId, warehouseId, productId, quantity }, 'Stock adjusted');
    return level;
  }

  async recordStockArrival(
    orgId: string,
    warehouseId: string,
    productId: string,
    quantityAdded: number
  ) {
    if (!Number.isInteger(quantityAdded) || quantityAdded <= 0) {
      throw new HttpError(400, 'Arrival quantity must be a positive whole number');
    }

    const warehouse = await prisma.warehouse.findFirst({
      where: { id: warehouseId, organizationId: orgId },
    });
    if (!warehouse) {
      throw new HttpError(404, 'Warehouse not found in this organization');
    }

    const product = await prisma.product.findFirst({
      where: { id: productId, organizationId: orgId },
    });
    if (!product) {
      throw new HttpError(404, 'Product not found in this organization');
    }

    const existingLevel = await prisma.stockLevel.findFirst({
      where: { organizationId: orgId, warehouseId, productId },
    });
    const currentQty = existingLevel?.quantity ?? 0;
    const newQuantity = currentQty + quantityAdded;

    const level = await prisma.stockLevel.upsert({
      where: {
        organizationId_warehouseId_productId: {
          organizationId: orgId,
          warehouseId,
          productId,
        },
      },
      create: {
        organizationId: orgId,
        warehouseId,
        productId,
        quantity: newQuantity,
      },
      update: { quantity: newQuantity },
    });

    await this.invalidateStockCache(orgId);
    emitToOrg(orgId, 'inventory:updated', {
      warehouseId,
      productId,
      quantity: newQuantity,
      warehouseName: warehouse.name,
      productName: product.name,
      quantityAdded,
      type: 'stock_arrival',
    });

    // Enqueue BullMQ job for auto-consolidation analysis
    await backorderConsolidationQueue.add(
      `stock-arrival:${orgId}:${productId}:${Date.now()}`,
      {
        orgId,
        warehouseId,
        productId,
        quantityAdded,
        timestamp: new Date().toISOString(),
      }
    );

    logger.info(
      { orgId, warehouseId, productId, quantityAdded, newTotal: newQuantity },
      'Stock arrival recorded & auto-consolidation job enqueued'
    );

    return { level, newQuantity, quantityAdded };
  }
}

export const warehousesService = new WarehousesService();
