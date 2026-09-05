import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { warehousesService } from './warehouses.service.js';
import { friendlyZodMessage, HttpError } from '../../shared/errors.js';

const warehouseSchema = z.object({
  name: z.string().min(1, 'Warehouse name is required').max(120),
  code: z
    .string()
    .min(1, 'Warehouse code is required')
    .max(30)
    .regex(/^[A-Za-z0-9_-]+$/, 'Warehouse code may only contain letters, numbers, dashes and underscores'),
  address: z.string().max(300).optional(),
  city: z.string().max(100).optional(),
  isDefault: z.boolean().optional(),
  status: z.enum(['active', 'inactive']).optional(),
});

const warehouseUpdateSchema = warehouseSchema.partial().extend({
  address: z.string().max(300).nullable().optional(),
  city: z.string().max(100).nullable().optional(),
});

const shippingRulesSchema = z.object({
  allowSplitShipments: z.boolean().optional(),
  chargeForSplitShipments: z.boolean().optional(),
  deliveryExtensionDays: z.number().int().min(0).max(60).optional(),
  notes: z.string().max(1000).nullable().optional(),
});

const shippingOverrideSchema = shippingRulesSchema.extend({
  customerId: z.string().uuid().nullable().optional(),
  warehouseId: z.string().uuid().nullable().optional(),
});

const setStockSchema = z.object({
  quantity: z.number().int('Stock quantity must be a whole number').min(0, 'Stock cannot be negative'),
});

const stockArrivalSchema = z.object({
  warehouseId: z.string().min(1, 'Warehouse ID required'),
  productId: z.string().min(1, 'Product ID required'),
  quantityAdded: z.number().int('Arrival quantity must be a whole number').positive('Arrival quantity must be greater than 0'),
});

export class WarehousesController {
  private parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
    const result = schema.safeParse(body);
    if (!result.success) {
      throw new HttpError(400, friendlyZodMessage(result.error.issues));
    }
    return result.data;
  }

  async listWarehouses(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const orgId = req.tenant!.orgId;
      const warehouses = await warehousesService.listWarehouses(orgId);
      res.json({ warehouses });
    } catch (err) {
      next(err);
    }
  }

  async createWarehouse(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const orgId = req.tenant!.orgId;
      const data = this.parseBody(warehouseSchema, req.body);
      const warehouse = await warehousesService.createWarehouse(orgId, data);
      res.status(201).json({ warehouse });
    } catch (err) {
      next(err);
    }
  }

  async updateWarehouse(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const orgId = req.tenant!.orgId;
      const id = req.params.id as string;
      if (!id) throw new HttpError(400, 'Warehouse ID is required');
      const data = this.parseBody(warehouseUpdateSchema, req.body);
      const warehouse = await warehousesService.updateWarehouse(orgId, id, data);
      res.json({ warehouse });
    } catch (err) {
      next(err);
    }
  }

  async deleteWarehouse(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const orgId = req.tenant!.orgId;
      const id = req.params.id as string;
      if (!id) throw new HttpError(400, 'Warehouse ID is required');
      const result = await warehousesService.deleteWarehouse(orgId, id);
      res.json(result);
    } catch (err) {
      next(err);
    }
  }

  async getShippingRules(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const orgId = req.tenant!.orgId;
      const rules = await warehousesService.getShippingRules(orgId);
      res.json({ rules });
    } catch (err) {
      next(err);
    }
  }

  async updateShippingRules(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const orgId = req.tenant!.orgId;
      const data = this.parseBody(shippingRulesSchema, req.body);
      const rules = await warehousesService.updateShippingRules(orgId, data);
      res.json({ rules });
    } catch (err) {
      next(err);
    }
  }

  async listShippingRuleOverrides(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const orgId = req.tenant!.orgId;
      const data = await warehousesService.getShippingRuleOverrides(orgId);
      res.json(data);
    } catch (err) {
      next(err);
    }
  }

  async upsertShippingRuleOverride(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const orgId = req.tenant!.orgId;
      const data = this.parseBody(shippingOverrideSchema, req.body);
      const override = await warehousesService.upsertShippingRuleOverride(orgId, data);
      res.status(201).json({ override });
    } catch (err) {
      next(err);
    }
  }

  async deleteShippingRuleOverride(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const orgId = req.tenant!.orgId;
      const id = req.params.id as string;
      if (!id) throw new HttpError(400, 'Override ID is required');
      const result = await warehousesService.deleteShippingRuleOverride(orgId, id);
      res.json(result);
    } catch (err) {
      next(err);
    }
  }

  async resolveShippingRules(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const orgId = req.tenant!.orgId;
      const rules = await warehousesService.resolveShippingRules(orgId, {
        customerId: (req.query.customerId as string) || null,
        warehouseId: (req.query.warehouseId as string) || null,
      });
      res.json({ rules });
    } catch (err) {
      next(err);
    }
  }

  async getStockMatrix(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const orgId = req.tenant!.orgId;
      const matrix = await warehousesService.getStockMatrix(orgId);
      res.json(matrix);
    } catch (err) {
      next(err);
    }
  }

  async setStock(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const orgId = req.tenant!.orgId;
      const warehouseId = req.params.warehouseId as string;
      const productId = req.params.productId as string;
      if (!warehouseId || !productId) {
        throw new HttpError(400, 'Warehouse ID and Product ID are required');
      }
      const { quantity } = this.parseBody(setStockSchema, req.body);
      const level = await warehousesService.setStock(orgId, warehouseId, productId, quantity);
      res.json({ stockLevel: level });
    } catch (err) {
      next(err);
    }
  }

  async recordStockArrival(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const orgId = req.tenant!.orgId;
      const data = this.parseBody(stockArrivalSchema, req.body);
      const result = await warehousesService.recordStockArrival(
        orgId,
        data.warehouseId,
        data.productId,
        data.quantityAdded
      );
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  }
}

export const warehousesController = new WarehousesController();
