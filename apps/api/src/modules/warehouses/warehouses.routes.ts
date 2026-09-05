import { Router } from 'express';
import { warehousesController } from './warehouses.controller.js';
import { tenantContextMiddleware, requireRoles } from '../../shared/tenant.middleware.js';

export const warehousesRouter = Router();

// All warehouse routes require tenant context (internal JWT).
warehousesRouter.use(tenantContextMiddleware);

// Reads are open to every internal role — Ops works from these screens.
warehousesRouter.get('/', (req, res, next) => warehousesController.listWarehouses(req, res, next));
warehousesRouter.get('/shipping-rules', (req, res, next) =>
  warehousesController.getShippingRules(req, res, next)
);
warehousesRouter.get('/stock', (req, res, next) =>
  warehousesController.getStockMatrix(req, res, next)
);

// Warehouse configuration is owned by the Org Admin.
warehousesRouter.post(
  '/',
  requireRoles(['org_admin']),
  (req, res, next) => warehousesController.createWarehouse(req, res, next)
);

// NOTE: registered before PUT /:id so "shipping-rules" is never treated as an id.
warehousesRouter.put(
  '/shipping-rules',
  requireRoles(['org_admin']),
  (req, res, next) => warehousesController.updateShippingRules(req, res, next)
);

warehousesRouter.put(
  '/:id',
  requireRoles(['org_admin']),
  (req, res, next) => warehousesController.updateWarehouse(req, res, next)
);
warehousesRouter.delete(
  '/:id',
  requireRoles(['org_admin']),
  (req, res, next) => warehousesController.deleteWarehouse(req, res, next)
);

// Stock adjustments: Org Admin + Ops (fulfillment) — the day-to-day owners of inventory.
warehousesRouter.put(
  '/:warehouseId/stock/:productId',
  requireRoles(['org_admin', 'ops']),
  (req, res, next) => warehousesController.setStock(req, res, next)
);
