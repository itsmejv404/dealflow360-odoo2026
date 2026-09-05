import { Router } from 'express';
import multer from 'multer';
import { tenantContextMiddleware } from '../../shared/tenant.middleware.js';
import { organizationController } from './organization.controller.js';

export const organizationRouter = Router();

const upload = multer({
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB max
});

// All organization routes require tenant context
organizationRouter.use(tenantContextMiddleware);

organizationRouter.get('/profile', (req, res, next) => organizationController.getProfile(req, res, next));
organizationRouter.patch('/profile', (req, res, next) => organizationController.updateProfile(req, res, next));

organizationRouter.post('/logo', upload.single('logo'), (req, res, next) => organizationController.uploadLogo(req, res, next));
organizationRouter.get('/logo', (req, res, next) => organizationController.getLogo(req, res, next));
