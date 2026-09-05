import { Router } from 'express';
import { catalogController } from './catalog.controller.js';
import { tenantContextMiddleware, requireRoles } from '../../shared/tenant.middleware.js';

export const catalogRouter = Router();

// Apply tenant context to all catalog endpoints
catalogRouter.use(tenantContextMiddleware);

// Categories
catalogRouter.get('/categories', (req, res, next) => {
  catalogController.listCategories(req, res).catch(next);
});
catalogRouter.post('/categories', requireRoles(['org_admin']), (req, res, next) => {
  catalogController.createCategory(req, res).catch(next);
});
catalogRouter.put('/categories/:id', requireRoles(['org_admin']), (req, res, next) => {
  catalogController.updateCategory(req, res).catch(next);
});
catalogRouter.delete('/categories/:id', requireRoles(['org_admin']), (req, res, next) => {
  catalogController.deleteCategory(req, res).catch(next);
});

// Customer Tiers
catalogRouter.get('/tiers', (req, res, next) => {
  catalogController.listTiers(req, res).catch(next);
});
catalogRouter.post('/tiers', requireRoles(['org_admin']), (req, res, next) => {
  catalogController.createTier(req, res).catch(next);
});
catalogRouter.put('/tiers/:id', requireRoles(['org_admin']), (req, res, next) => {
  catalogController.updateTier(req, res).catch(next);
});
catalogRouter.delete('/tiers/:id', requireRoles(['org_admin']), (req, res, next) => {
  catalogController.deleteTier(req, res).catch(next);
});

// Products
catalogRouter.get('/products', (req, res, next) => {
  catalogController.listProducts(req, res).catch(next);
});
catalogRouter.get('/products/:id', (req, res, next) => {
  catalogController.getProduct(req, res).catch(next);
});
catalogRouter.post('/products', requireRoles(['org_admin']), (req, res, next) => {
  catalogController.createProduct(req, res).catch(next);
});
catalogRouter.put('/products/:id', requireRoles(['org_admin']), (req, res, next) => {
  catalogController.updateProduct(req, res).catch(next);
});
catalogRouter.delete('/products/:id', requireRoles(['org_admin']), (req, res, next) => {
  catalogController.deleteProduct(req, res).catch(next);
});

// Price Lists Matrix
catalogRouter.get('/pricelists', (req, res, next) => {
  catalogController.getPriceListMatrix(req, res).catch(next);
});
catalogRouter.put('/pricelists/matrix', requireRoles(['org_admin']), (req, res, next) => {
  catalogController.batchUpdatePriceListMatrix(req, res).catch(next);
});
