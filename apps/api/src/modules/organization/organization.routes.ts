import { Router } from 'express';
import multer from 'multer';
import { tenantContextMiddleware, requireRoles } from '../../shared/tenant.middleware.js';
import { organizationController } from './organization.controller.js';

export const organizationRouter = Router();

const ALLOWED_LOGO_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];

const upload = multer({
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB max
  fileFilter: (req, file, cb) => {
    if (ALLOWED_LOGO_MIME_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      // Reject the file but surface a precise 400 from the controller.
      (req as any).logoRejectedMime = file.mimetype;
      cb(null, false);
    }
  },
});

// All organization routes require tenant context
organizationRouter.use(tenantContextMiddleware);

// Reads are open to every internal role; only the Org Admin may modify the
// organization's details — other roles inherit the org profile, they never
// maintain it.
organizationRouter.get('/profile', (req, res, next) => organizationController.getProfile(req, res, next));
organizationRouter.patch(
  '/profile',
  requireRoles(['org_admin']),
  (req, res, next) => organizationController.updateProfile(req, res, next)
);

organizationRouter.post(
  '/logo',
  requireRoles(['org_admin']),
  upload.single('logo'),
  (req, res, next) => organizationController.uploadLogo(req, res, next)
);
organizationRouter.get('/logo', (req, res, next) => organizationController.getLogo(req, res, next));
