import { Router } from 'express';
import { authController } from './auth.controller.js';
import { tenantContextMiddleware } from '../../shared/tenant.middleware.js';

export const authRouter = Router();

authRouter.post('/login', (req, res, next) => authController.login(req, res, next));
authRouter.get('/me', tenantContextMiddleware, (req, res, next) => authController.me(req, res, next));
