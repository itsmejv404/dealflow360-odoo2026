import { Router } from 'express';
import multer from 'multer';
import { filesController } from './files.controller.js';
import { tenantContextMiddleware, requireRoles } from '../../shared/tenant.middleware.js';

export const filesRouter = Router();

const ALLOWED_IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

const upload = multer({
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_IMAGE_MIME_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(null, false);
    }
  },
});

filesRouter.use(tenantContextMiddleware);

// Quotation PDF — internal users and customer tokens (scoped to their own quotes)
filesRouter.get('/quotations/:id/pdf', (req, res, next) => filesController.quotationPdf(req, res, next));

// Invoice PDF
filesRouter.get('/invoices/:id/pdf', (req, res, next) => filesController.invoicePdf(req, res, next));

// Deals report export (PDF or XLS) — internal staff only
filesRouter.get(
  '/reports/deals',
  requireRoles(['org_admin', 'manager', 'finance', 'rep']),
  (req, res, next) => filesController.dealsReport(req, res, next)
);

// Product images — org admin manages, all internal roles may read
filesRouter.post(
  '/products/:id/image',
  requireRoles(['org_admin']),
  upload.single('image'),
  (req, res, next) => filesController.uploadProductImage(req, res, next)
);

filesRouter.get('/products/:id/image', (req, res, next) => filesController.productImage(req, res, next));
