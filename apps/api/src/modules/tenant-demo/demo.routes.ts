import { Router } from 'express';
import { tenantContextMiddleware } from '../../shared/tenant.middleware.js';
import { tenantDemoController } from './demo.controller.js';

export const tenantDemoRouter = Router();

// Apply tenant context middleware to all routes in this module
tenantDemoRouter.use(tenantContextMiddleware);

tenantDemoRouter.get('/products', (req, res, next) => tenantDemoController.listProducts(req, res, next));
tenantDemoRouter.get('/products/:id', (req, res, next) => tenantDemoController.getProduct(req, res, next));
tenantDemoRouter.post('/products', (req, res, next) => tenantDemoController.createProduct(req, res, next));

tenantDemoRouter.get('/order-lines', (req, res, next) => tenantDemoController.listOrderLines(req, res, next));
tenantDemoRouter.post('/order-lines', (req, res, next) => tenantDemoController.createOrderLine(req, res, next));
