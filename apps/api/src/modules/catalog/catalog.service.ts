import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { HttpError } from '../../shared/errors.js';

export interface CreateCategoryInput {
  name: string;
  code: string;
  description?: string;
}

export interface UpdateCategoryInput {
  name?: string;
  code?: string;
  description?: string;
}

export interface CreateTierInput {
  name: string;
  code: string;
  description?: string;
  defaultDiscountPercent?: number;
}

export interface UpdateTierInput {
  name?: string;
  code?: string;
  description?: string;
  defaultDiscountPercent?: number;
}

export interface CreateProductInput {
  name: string;
  sku: string;
  categoryId?: string;
  description?: string;
  price: number;
  costPrice?: number | null;
  billingFrequency?: 'one_time' | 'monthly' | 'quarterly' | 'annual';
  status?: 'active' | 'archived';
  maxDiscountPercent?: number | null;
  tierPrices?: Array<{ tierId: string; customPrice: number }>;
}

export interface UpdateProductInput {
  name?: string;
  sku?: string;
  categoryId?: string | null;
  description?: string;
  price?: number;
  costPrice?: number | null;
  billingFrequency?: 'one_time' | 'monthly' | 'quarterly' | 'annual';
  status?: 'active' | 'archived';
  maxDiscountPercent?: number | null;
  tierPrices?: Array<{ tierId: string; customPrice: number }>;
}

export interface PriceMatrixItemInput {
  tierId: string;
  productId: string;
  customPrice: number;
}

export class CatalogService {
  /**
   * Automatically initializes default categories and tiers for an organization if none exist.
   */
  async ensureDefaultCatalog(orgId: string): Promise<void> {
    const existingCatsCount = await prisma.productCategory.count({
      where: { organizationId: orgId },
    });

    if (existingCatsCount === 0) {
      await prisma.productCategory.createMany({
        skipDuplicates: true,
        data: [
          {
            organizationId: orgId,
            name: 'Hardware',
            code: 'hardware',
            description: 'Physical equipment, devices, and appliances',
          },
          {
            organizationId: orgId,
            name: 'Services',
            code: 'services',
            description: 'Professional onboarding, consulting, and SLA support',
          },
          {
            organizationId: orgId,
            name: 'Subscriptions',
            code: 'subscriptions',
            description: 'Recurring cloud licenses and seat tiers',
          },
        ],
      });
    }

    const existingTiersCount = await prisma.customerTier.count({
      where: { organizationId: orgId },
    });

    if (existingTiersCount === 0) {
      await prisma.customerTier.createMany({
        skipDuplicates: true,
        data: [
          {
            organizationId: orgId,
            name: 'Bronze',
            code: 'bronze',
            description: 'Standard retail customer tier',
            defaultDiscountPercent: new Prisma.Decimal(0.0),
          },
          {
            organizationId: orgId,
            name: 'Silver',
            code: 'silver',
            description: 'Preferred customer tier with standard discount',
            defaultDiscountPercent: new Prisma.Decimal(5.0),
          },
          {
            organizationId: orgId,
            name: 'Gold',
            code: 'gold',
            description: 'VIP Enterprise partner tier',
            defaultDiscountPercent: new Prisma.Decimal(15.0),
          },
        ],
      });
    }
  }

  // ================= CATEGORIES =================

  async listCategories(orgId: string) {
    await this.ensureDefaultCatalog(orgId);
    return prisma.productCategory.findMany({
      where: { organizationId: orgId },
      include: {
        _count: {
          select: { products: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async createCategory(orgId: string, data: CreateCategoryInput) {
    const cleanCode = data.code.trim().toLowerCase();
    const cleanName = data.name.trim();

    const existing = await prisma.productCategory.findFirst({
      where: {
        organizationId: orgId,
        OR: [{ code: cleanCode }, { name: cleanName }],
      },
    });

    if (existing) {
      throw new HttpError(409, 'Category with this name or code already exists in your organization');
    }

    return prisma.productCategory.create({
      data: {
        organizationId: orgId,
        name: cleanName,
        code: cleanCode,
        description: data.description?.trim(),
      },
    });
  }

  async updateCategory(orgId: string, categoryId: string, data: UpdateCategoryInput) {
    const category = await prisma.productCategory.findFirst({
      where: { id: categoryId, organizationId: orgId },
    });

    if (!category) {
      throw new HttpError(404, 'Category not found');
    }

    const cleanCode = data.code ? data.code.trim().toLowerCase() : undefined;
    const cleanName = data.name ? data.name.trim() : undefined;

    if (cleanCode || cleanName) {
      const conflict = await prisma.productCategory.findFirst({
        where: {
          organizationId: orgId,
          id: { not: categoryId },
          OR: [
            ...(cleanCode ? [{ code: cleanCode }] : []),
            ...(cleanName ? [{ name: cleanName }] : []),
          ],
        },
      });

      if (conflict) {
        throw new HttpError(409, 'Another category already uses this name or code in your organization');
      }
    }

    return prisma.productCategory.update({
      where: { id: categoryId },
      data: {
        ...(cleanName && { name: cleanName }),
        ...(cleanCode && { code: cleanCode }),
        ...(data.description !== undefined && { description: data.description?.trim() }),
      },
    });
  }

  async deleteCategory(orgId: string, categoryId: string) {
    const category = await prisma.productCategory.findFirst({
      where: { id: categoryId, organizationId: orgId },
      include: { _count: { select: { products: true } } },
    });

    if (!category) {
      throw new HttpError(404, 'Category not found');
    }

    if (category._count.products > 0) {
      throw new HttpError(
        400,
        `Cannot delete category "${category.name}" because it has ${category._count.products} linked products. Unlink or reassign them first.`
      );
    }

    await prisma.productCategory.delete({
      where: { id: categoryId },
    });

    return { success: true };
  }

  // ================= CUSTOMER TIERS =================

  async listTiers(orgId: string) {
    await this.ensureDefaultCatalog(orgId);
    return prisma.customerTier.findMany({
      where: { organizationId: orgId },
      orderBy: [{ createdAt: 'asc' }, { name: 'asc' }],
    });
  }

  async createTier(orgId: string, data: CreateTierInput) {
    const cleanCode = data.code.trim().toLowerCase();
    const cleanName = data.name.trim();

    const existing = await prisma.customerTier.findFirst({
      where: {
        organizationId: orgId,
        OR: [{ code: cleanCode }, { name: cleanName }],
      },
    });

    if (existing) {
      throw new HttpError(409, 'Customer tier with this name or code already exists');
    }

    return prisma.customerTier.create({
      data: {
        organizationId: orgId,
        name: cleanName,
        code: cleanCode,
        description: data.description?.trim(),
        defaultDiscountPercent:
          data.defaultDiscountPercent !== undefined
            ? new Prisma.Decimal(data.defaultDiscountPercent)
            : new Prisma.Decimal(0),
        },
    });
  }

  async updateTier(orgId: string, tierId: string, data: UpdateTierInput) {
    const tier = await prisma.customerTier.findFirst({
      where: { id: tierId, organizationId: orgId },
    });

    if (!tier) {
      throw new HttpError(404, 'Customer tier not found');
    }

    const cleanCode = data.code ? data.code.trim().toLowerCase() : undefined;
    const cleanName = data.name ? data.name.trim() : undefined;

    if (cleanCode || cleanName) {
      const conflict = await prisma.customerTier.findFirst({
        where: {
          organizationId: orgId,
          id: { not: tierId },
          OR: [
            ...(cleanCode ? [{ code: cleanCode }] : []),
            ...(cleanName ? [{ name: cleanName }] : []),
          ],
        },
      });

      if (conflict) {
        throw new HttpError(409, 'Another tier already uses this name or code');
      }
    }

    return prisma.customerTier.update({
      where: { id: tierId },
      data: {
        ...(cleanName && { name: cleanName }),
        ...(cleanCode && { code: cleanCode }),
        ...(data.description !== undefined && { description: data.description?.trim() }),
        ...(data.defaultDiscountPercent !== undefined && {
          defaultDiscountPercent: new Prisma.Decimal(data.defaultDiscountPercent),
        }),
        },
    });
  }

  async deleteTier(orgId: string, tierId: string) {
    const tier = await prisma.customerTier.findFirst({
      where: { id: tierId, organizationId: orgId },
    });

    if (!tier) {
      throw new HttpError(404, 'Customer tier not found');
    }

    // Guard against FK-restricted deletes (customers/quotations/price lists/
    // ceilings all reference the tier). Without this check the delete would
    // surface as an opaque Prisma P2003 error → 500.
    const [customerCount, quotationCount, priceListCount, ceilingCount] = await Promise.all([
      prisma.customer.count({ where: { tierId, organizationId: orgId } }),
      prisma.quotation.count({ where: { tierId, organizationId: orgId } }),
      prisma.priceListItem.count({ where: { tierId, organizationId: orgId } }),
      prisma.discountCeiling.count({ where: { tierId, organizationId: orgId } }),
    ]);

    const references: string[] = [];
    if (customerCount > 0) references.push(`${customerCount} customer(s)`);
    if (quotationCount > 0) references.push(`${quotationCount} quotation(s)`);
    if (priceListCount > 0) references.push(`${priceListCount} price list item(s)`);
    if (ceilingCount > 0) references.push(`${ceilingCount} discount ceiling(s)`);

    if (references.length > 0) {
      throw new HttpError(
        400,
        `Cannot delete tier "${tier.name}" because it is referenced by ${references.join(', ')}. Remove or reassign those references first.`
      );
    }

    await prisma.customerTier.delete({
      where: { id: tierId },
    });

    return { success: true };
  }

  // ================= PRODUCTS =================

  async listProducts(
    orgId: string,
    filters?: { categoryId?: string; status?: string; search?: string }
  ) {
    await this.ensureDefaultCatalog(orgId);

    const where: Prisma.ProductWhereInput = {
      organizationId: orgId,
    };

    if (filters?.categoryId) {
      where.categoryId = filters.categoryId;
    }

    if (filters?.status) {
      where.status = filters.status;
    }

    if (filters?.search) {
      const q = filters.search.trim();
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { sku: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
      ];
    }

    return prisma.product.findMany({
      where,
      include: {
        category: {
          select: { id: true, name: true, code: true },
        },
        priceListItems: {
          select: {
            id: true,
            tierId: true,
            customPrice: true,
            tier: {
              select: { id: true, name: true, code: true },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getProduct(orgId: string, productId: string) {
    const product = await prisma.product.findFirst({
      where: { id: productId, organizationId: orgId },
      include: {
        category: true,
        priceListItems: {
          include: {
            tier: true,
          },
        },
      },
    });

    if (!product) {
      throw new HttpError(404, 'Product not found');
    }

    return product;
  }

  async createProduct(orgId: string, data: CreateProductInput) {
    const cleanSku = data.sku.trim();
    const cleanName = data.name.trim();

    // Verify SKU uniqueness within organization
    const existing = await prisma.product.findFirst({
      where: {
        organizationId: orgId,
        sku: cleanSku,
      },
    });

    if (existing) {
      throw new HttpError(409, `Product SKU "${cleanSku}" is already in use in your organization`);
    }

    // Verify category belongs to this organization if supplied
    if (data.categoryId) {
      const cat = await prisma.productCategory.findFirst({
        where: { id: data.categoryId, organizationId: orgId },
      });
      if (!cat) {
        throw new HttpError(400, 'Invalid category specified for this organization');
      }
    }

    // Verify all tiers belong to this organization if tier prices supplied
    if (data.tierPrices && data.tierPrices.length > 0) {
      const tierIds = data.tierPrices.map((t) => t.tierId);
      const tiers = await prisma.customerTier.findMany({
        where: { id: { in: tierIds }, organizationId: orgId },
      });
      if (tiers.length !== tierIds.length) {
        throw new HttpError(400, 'One or more tier IDs do not belong to this organization');
      }
    }

    return prisma.$transaction(async (tx) => {
      const product = await tx.product.create({
        data: {
          organizationId: orgId,
          name: cleanName,
          sku: cleanSku,
          categoryId: data.categoryId || null,
          description: data.description?.trim(),
          price: new Prisma.Decimal(data.price),
          costPrice:
            data.costPrice !== undefined && data.costPrice !== null
              ? new Prisma.Decimal(data.costPrice)
              : null,
          billingFrequency: data.billingFrequency || 'one_time',
          status: data.status || 'active',
          maxDiscountPercent:
            data.maxDiscountPercent !== undefined && data.maxDiscountPercent !== null
              ? new Prisma.Decimal(data.maxDiscountPercent)
              : null,
        },
      });

      if (data.tierPrices && data.tierPrices.length > 0) {
        await tx.priceListItem.createMany({
          data: data.tierPrices.map((tp) => ({
            organizationId: orgId,
            productId: product.id,
            tierId: tp.tierId,
            customPrice: new Prisma.Decimal(tp.customPrice),
          })),
        });
      }

      return tx.product.findUnique({
        where: { id: product.id },
        include: {
          category: true,
          priceListItems: {
            include: { tier: true },
          },
        },
      });
    });
  }

  async updateProduct(orgId: string, productId: string, data: UpdateProductInput) {
    const product = await prisma.product.findFirst({
      where: { id: productId, organizationId: orgId },
    });

    if (!product) {
      throw new HttpError(404, 'Product not found');
    }

    const cleanSku = data.sku ? data.sku.trim() : undefined;
    const cleanName = data.name ? data.name.trim() : undefined;

    if (cleanSku) {
      const conflict = await prisma.product.findFirst({
        where: {
          organizationId: orgId,
          sku: cleanSku,
          id: { not: productId },
        },
      });
      if (conflict) {
        throw new HttpError(409, `Product SKU "${cleanSku}" is already in use by another product`);
      }
    }

    if (data.categoryId) {
      const cat = await prisma.productCategory.findFirst({
        where: { id: data.categoryId, organizationId: orgId },
      });
      if (!cat) {
        throw new HttpError(400, 'Invalid category specified for this organization');
      }
    }

    return prisma.$transaction(async (tx) => {
      await tx.product.update({
        where: { id: productId },
        data: {
          ...(cleanName && { name: cleanName }),
          ...(cleanSku && { sku: cleanSku }),
          ...(data.categoryId !== undefined && { categoryId: data.categoryId }),
          ...(data.description !== undefined && { description: data.description?.trim() }),
          ...(data.price !== undefined && { price: new Prisma.Decimal(data.price) }),
          ...(data.costPrice !== undefined && {
            costPrice: data.costPrice !== null ? new Prisma.Decimal(data.costPrice) : null,
          }),
          ...(data.billingFrequency && { billingFrequency: data.billingFrequency }),
          ...(data.status && { status: data.status }),
          ...(data.maxDiscountPercent !== undefined && {
            maxDiscountPercent:
              data.maxDiscountPercent !== null ? new Prisma.Decimal(data.maxDiscountPercent) : null,
          }),
        },
      });

      if (data.tierPrices) {
        // Clear existing and re-insert
        await tx.priceListItem.deleteMany({
          where: { organizationId: orgId, productId },
        });

        if (data.tierPrices.length > 0) {
          await tx.priceListItem.createMany({
            data: data.tierPrices.map((tp) => ({
              organizationId: orgId,
              productId,
              tierId: tp.tierId,
              customPrice: new Prisma.Decimal(tp.customPrice),
            })),
          });
        }
      }

      return tx.product.findUnique({
        where: { id: productId },
        include: {
          category: true,
          priceListItems: {
            include: { tier: true },
          },
        },
      });
    });
  }

  async deleteProduct(orgId: string, productId: string) {
    const product = await prisma.product.findFirst({
      where: { id: productId, organizationId: orgId },
      include: {
        _count: {
          select: { orderLines: true, quotationLines: true, priceListItems: true },
        },
      },
    });

    if (!product) {
      throw new HttpError(404, 'Product not found');
    }

    const referenced =
      product._count.orderLines > 0 ||
      product._count.quotationLines > 0 ||
      product._count.priceListItems > 0;

    if (referenced) {
      // Archive instead of hard delete to preserve historical quote references
      // (FKs to quotation_lines / price_list_items / order_lines are Restrict).
      await prisma.product.update({
        where: { id: productId },
        data: { status: 'archived' },
      });
      return { success: true, message: 'Product archived due to existing quotations or price list references' };
    }

    // Affinity rows cascade (schema: onDelete: Cascade on both product FKs).
    await prisma.product.delete({
      where: { id: productId },
    });

    return { success: true, message: 'Product deleted' };
  }

}

export const catalogService = new CatalogService();
