import { Router } from 'express';
import { usersController } from './users.controller.js';
import { tenantContextMiddleware, requireRoles } from '../../shared/tenant.middleware.js';

export const usersRouter = Router();

// All user management routes require tenant context and org_admin role
usersRouter.use(tenantContextMiddleware);
usersRouter.use(requireRoles(['org_admin']));

usersRouter.get('/', (req, res, next) => usersController.list(req, res, next));
usersRouter.post('/invite', (req, res, next) => usersController.invite(req, res, next));
usersRouter.patch('/:id/status', (req, res, next) => usersController.updateStatus(req, res, next));
