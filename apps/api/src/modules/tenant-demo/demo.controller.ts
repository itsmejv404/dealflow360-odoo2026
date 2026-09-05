import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { HttpError } from '../../shared/errors.js';
import { tenantDemoService } from './demo.service.js';

const createProductSchema = z.object({
  name: z.string().min(1),
  sku: z.string().min(1),
  price: z.coerce.number().positive(),
});

const createOrderLineSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.coerce.number().int().positive().default(1),
  unitPrice: z.coerce.number().positive(),
});

export class TenantDemoController {
  async listProducts(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.tenantDb) {
        throw new HttpError(500, 'Tenant database context missing');
      }
      const products = await tenantDemoService.listProducts(req.tenantDb);
      res.json({ data: products });
    } catch (err) {
      next(err);
    }
  }

  async getProduct(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.tenantDb) {
        throw new HttpError(500, 'Tenant database context missing');
      }
      const id = req.params.id;
      if (!id) {
        throw new HttpError(400, 'Product ID parameter is required');
      }
      const product = await tenantDemoService.getProductById(req.tenantDb, id);
      if (!product) {
        throw new HttpError(404, 'Product not found in this organization');
      }
      res.json({ data: product });
    } catch (err) {
      next(err);
    }
  }

  async createProduct(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.tenantDb) {
        throw new HttpError(500, 'Tenant database context missing');
      }
      const parsed = createProductSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new HttpError(400, `Validation error: ${JSON.stringify(parsed.error.flatten().fieldErrors)}`);
      }
      const product = await tenantDemoService.createProduct(req.tenantDb, parsed.data);
      res.status(201).json({ data: product });
    } catch (err) {
      next(err);
    }
  }

  async listOrderLines(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.tenantDb) {
        throw new HttpError(500, 'Tenant database context missing');
      }
      const orderLines = await tenantDemoService.listOrderLines(req.tenantDb);
      res.json({ data: orderLines });
    } catch (err) {
      next(err);
    }
  }

  async createOrderLine(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.tenantDb) {
        throw new HttpError(500, 'Tenant database context missing');
      }
      const parsed = createOrderLineSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new HttpError(400, `Validation error: ${JSON.stringify(parsed.error.flatten().fieldErrors)}`);
      }
      const orderLine = await tenantDemoService.createOrderLine(req.tenantDb, parsed.data);
      res.status(201).json({ data: orderLine });
    } catch (err) {
      next(err);
    }
  }
}

export const tenantDemoController = new TenantDemoController();
