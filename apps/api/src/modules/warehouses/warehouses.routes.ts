import { Router } from 'express';
import { warehousesController } from './warehouses.controller.js';
import { tenantContextMiddleware, requireRoles } from '../../shared/tenant.middleware.js';

export const warehousesRouter = Router();

// All warehouse routes require tenant context (internal JWT).
warehousesRouter.use(tenantContextMiddleware);

// Reads are open to every internal role — Ops works from these screens.
warehousesRouter.get('/', (req, res, next) => warehousesController.listWarehouses(req, res, next));
warehousesRouter.get('/export/csv', (req, res, next) => warehousesController.exportStockCsv(req, res, next));
warehousesRouter.get('/stock/export/csv', (req, res, next) => warehousesController.exportStockCsv(req, res, next));
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

// Scoped shipping-rule overrides (per customer / per warehouse). Managers and
// Finance may also manage these alongside the Org Admin.
warehousesRouter.get('/shipping-rules/resolve', (req, res, next) =>
  warehousesController.resolveShippingRules(req, res, next)
);
warehousesRouter.get('/shipping-rules/overrides', (req, res, next) =>
  warehousesController.listShippingRuleOverrides(req, res, next)
);
warehousesRouter.delete(
  '/shipping-rules/overrides/:id',
  requireRoles(['org_admin', 'manager', 'finance']),
  (req, res, next) => warehousesController.deleteShippingRuleOverride(req, res, next)
);
warehousesRouter.put(
  '/shipping-rules/overrides',
  requireRoles(['org_admin', 'manager', 'finance']),
  (req, res, next) => warehousesController.upsertShippingRuleOverride(req, res, next)
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

// Stock arrival / adjustments: Org Admin + Ops (fulfillment)
warehousesRouter.post(
  '/stock/arrival',
  requireRoles(['org_admin', 'ops']),
  (req, res, next) => warehousesController.recordStockArrival(req, res, next)
);

warehousesRouter.put(
  '/:warehouseId/stock/:productId',
  requireRoles(['org_admin', 'ops']),
  (req, res, next) => warehousesController.setStock(req, res, next)
);
