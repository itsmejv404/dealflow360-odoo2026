import { Router } from 'express';
import { superAdminGuard } from '../../shared/tenant.middleware.js';
import { platformController } from './platform.controller.js';

export const platformRouter = Router();

// Public auth endpoint for Super Admin
platformRouter.post('/auth/login', (req, res, next) => platformController.login(req, res, next));

// Super Admin protected routes
platformRouter.use(superAdminGuard);

platformRouter.get('/organizations', (req, res, next) => platformController.listOrganizations(req, res, next));
platformRouter.post('/organizations', (req, res, next) => platformController.createOrganization(req, res, next));
platformRouter.get('/organizations/:id', (req, res, next) => platformController.getOrganization(req, res, next));
platformRouter.patch('/organizations/:id', (req, res, next) => platformController.updateOrganization(req, res, next));

platformRouter.post('/organizations/:id/invites', (req, res, next) => platformController.inviteOrgAdmin(req, res, next));
platformRouter.get('/organizations/:id/invites', (req, res, next) => platformController.listInvites(req, res, next));
platformRouter.get('/organizations/:id/audit-logs', (req, res, next) => platformController.listAuditLogs(req, res, next));

// Platform DLQ Management (Super Admin)
platformRouter.get('/dlq', (req, res, next) => platformController.listPlatformDlq(req, res, next));
platformRouter.post('/dlq/:id/retry', (req, res, next) => platformController.retryPlatformDlq(req, res, next));
platformRouter.post('/dlq/:id/dismiss', (req, res, next) => platformController.dismissPlatformDlq(req, res, next));

