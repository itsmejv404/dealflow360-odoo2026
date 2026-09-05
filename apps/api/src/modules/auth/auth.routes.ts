import { Router } from 'express';
import { authController } from './auth.controller.js';
import { tenantContextMiddleware } from '../../shared/tenant.middleware.js';

export const authRouter = Router();

authRouter.post('/login', (req, res, next) => authController.login(req, res, next));
authRouter.get('/me', tenantContextMiddleware, (req, res, next) => authController.me(req, res, next));
authRouter.put('/profile', tenantContextMiddleware, (req, res, next) => authController.updateProfile(req, res, next));
// Password reset — unauthenticated by design (the requester has forgotten their password)
authRouter.post('/forgot-password', (req, res, next) => authController.forgotPassword(req, res, next));
authRouter.post('/reset-password', (req, res, next) => authController.resetPassword(req, res, next));
authRouter.get('/test', (req, res) => {
    res.status(200).json({
        data: "result",
      });
});
