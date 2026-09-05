import { Router } from 'express';
import { quotationsController } from './quotations.controller.js';
import { tenantContextMiddleware, requireRoles } from '../../shared/tenant.middleware.js';

export const quotationsRouter = Router();

// Apply tenant context to all quotation endpoints
quotationsRouter.use(tenantContextMiddleware);

// Customer endpoints
quotationsRouter.get('/customers', (req, res, next) => {
  quotationsController.listCustomers(req, res).catch(next);
});
quotationsRouter.post('/customers', (req, res, next) => {
  quotationsController.createCustomer(req, res).catch(next);
});

// Live calculation preview
quotationsRouter.post('/calculate', (req, res, next) => {
  quotationsController.calculateLive(req, res).catch(next);
});

// Quotations CRUD
quotationsRouter.get('/', (req, res, next) => {
  quotationsController.listQuotations(req, res).catch(next);
});

quotationsRouter.get('/:id', (req, res, next) => {
  quotationsController.getQuotation(req, res).catch(next);
});

quotationsRouter.post('/', (req, res, next) => {
  quotationsController.createQuotation(req, res).catch(next);
});

quotationsRouter.put('/:id', (req, res, next) => {
  quotationsController.updateQuotation(req, res).catch(next);
});

quotationsRouter.delete('/:id', (req, res, next) => {
  quotationsController.deleteQuotation(req, res).catch(next);
});

quotationsRouter.post('/:id/confirm', (req, res, next) => {
  quotationsController.confirmQuotation(req, res).catch(next);
});

