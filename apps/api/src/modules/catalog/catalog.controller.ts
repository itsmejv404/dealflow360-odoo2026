import type { Request, Response } from 'express';
import { z } from 'zod';
import { catalogService } from './catalog.service.js';
import { friendlyZodMessage, HttpError } from '../../shared/errors.js';

const createCategorySchema = z.object({
  name: z.string().min(1, 'Category name is required').max(100),
  code: z.string().min(1, 'Category code is required').max(50),
  description: z.string().max(500).optional(),
});

const updateCategorySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  code: z.string().min(1).max(50).optional(),
  description: z.string().max(500).optional(),
});

const createTierSchema = z.object({
  name: z.string().min(1, 'Tier name is required').max(100),
  code: z.string().min(1, 'Tier code is required').max(50),
  description: z.string().max(500).optional(),
  defaultDiscountPercent: z.number().min(0).max(100).optional(),
});

const updateTierSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  code: z.string().min(1).max(50).optional(),
  description: z.string().max(500).optional(),
  defaultDiscountPercent: z.number().min(0).max(100).optional(),
});

const createProductSchema = z.object({
  name: z.string().min(1, 'Product name is required').max(200),
  sku: z.string().min(1, 'SKU is required').max(100),
  categoryId: z.string().uuid().optional(),
  description: z.string().max(2000).optional(),
  price: z.number().positive('Price must be greater than 0'),
  // Accept an explicit null from clients that clear the field.
  costPrice: z.number().min(0).nullable().optional(),
  billingFrequency: z.enum(['one_time', 'monthly', 'quarterly', 'annual']).optional(),
  status: z.enum(['active', 'archived']).optional(),
  maxDiscountPercent: z.number().min(0).max(100).nullable().optional(),
  tierPrices: z
    .array(
      z.object({
        tierId: z.string().uuid(),
        customPrice: z.number().positive(),
      })
    )
    .optional(),
});

const updateProductSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  sku: z.string().min(1).max(100).optional(),
  categoryId: z.string().uuid().nullable().optional(),
  description: z.string().max(2000).optional(),
  price: z.number().positive().optional(),
  costPrice: z.number().min(0).nullable().optional(),
  billingFrequency: z.enum(['one_time', 'monthly', 'quarterly', 'annual']).optional(),
  status: z.enum(['active', 'archived']).optional(),
  maxDiscountPercent: z.number().min(0).max(100).nullable().optional(),
  tierPrices: z
    .array(
      z.object({
        tierId: z.string().uuid(),
        customPrice: z.number().positive(),
      })
    )
    .optional(),
});

export class CatalogController {
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

  // ================= CATEGORIES =================

  async listCategories(req: Request, res: Response): Promise<void> {
    const orgId = req.tenant!.orgId;
    const categories = await catalogService.listCategories(orgId);
    res.json({ categories });
  }

  async createCategory(req: Request, res: Response): Promise<void> {
    const orgId = req.tenant!.orgId;
    const validated = this.parseBody(createCategorySchema, req.body);
    const category = await catalogService.createCategory(orgId, validated);
    res.status(201).json({ category });
  }

  async updateCategory(req: Request, res: Response): Promise<void> {
    const orgId = req.tenant!.orgId;
    const id = req.params.id as string;
    const validated = this.parseBody(updateCategorySchema, req.body);
    const category = await catalogService.updateCategory(orgId, id, validated);
    res.json({ category });
  }

  async deleteCategory(req: Request, res: Response): Promise<void> {
    const orgId = req.tenant!.orgId;
    const id = req.params.id as string;
    const result = await catalogService.deleteCategory(orgId, id);
    res.json(result);
  }

  // ================= CUSTOMER TIERS =================

  async listTiers(req: Request, res: Response): Promise<void> {
    const orgId = req.tenant!.orgId;
    const tiers = await catalogService.listTiers(orgId);
    res.json({ tiers });
  }

  async createTier(req: Request, res: Response): Promise<void> {
    const orgId = req.tenant!.orgId;
    const validated = this.parseBody(createTierSchema, req.body);
    const tier = await catalogService.createTier(orgId, validated);
    res.status(201).json({ tier });
  }

  async updateTier(req: Request, res: Response): Promise<void> {
    const orgId = req.tenant!.orgId;
    const id = req.params.id as string;
    const validated = this.parseBody(updateTierSchema, req.body);
    const tier = await catalogService.updateTier(orgId, id, validated);
    res.json({ tier });
  }

  async deleteTier(req: Request, res: Response): Promise<void> {
    const orgId = req.tenant!.orgId;
    const id = req.params.id as string;
    const result = await catalogService.deleteTier(orgId, id);
    res.json(result);
  }

  // ================= PRODUCTS =================

  async listProducts(req: Request, res: Response): Promise<void> {
    const orgId = req.tenant!.orgId;
    const { categoryId, status, search } = req.query;

    const products = await catalogService.listProducts(orgId, {
      categoryId: typeof categoryId === 'string' ? categoryId : undefined,
      status: typeof status === 'string' ? status : undefined,
      search: typeof search === 'string' ? search : undefined,
    });

    res.json({ products });
  }

  async getProduct(req: Request, res: Response): Promise<void> {
    const orgId = req.tenant!.orgId;
    const id = req.params.id as string;
    const product = await catalogService.getProduct(orgId, id);
    res.json({ product });
  }

  async createProduct(req: Request, res: Response): Promise<void> {
    const orgId = req.tenant!.orgId;
    const validated = this.parseBody(createProductSchema, req.body);
    const product = await catalogService.createProduct(orgId, validated);
    res.status(201).json({ product });
  }

  async updateProduct(req: Request, res: Response): Promise<void> {
    const orgId = req.tenant!.orgId;
    const id = req.params.id as string;
    const validated = this.parseBody(updateProductSchema, req.body);
    const product = await catalogService.updateProduct(orgId, id, validated);
    res.json({ product });
  }

  async deleteProduct(req: Request, res: Response): Promise<void> {
    const orgId = req.tenant!.orgId;
    const id = req.params.id as string;
    const result = await catalogService.deleteProduct(orgId, id);
    res.json(result);
  }
}

export const catalogController = new CatalogController();
