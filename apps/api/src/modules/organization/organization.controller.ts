import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { friendlyZodMessage, HttpError } from '../../shared/errors.js';
import { organizationService } from './organization.service.js';

const updateProfileSchema = z.object({
  name: z.string().min(1).optional(),
  address: z.string().optional(),
  description: z.string().optional(),
  contactEmail: z.string().email().optional().or(z.literal('')),
  contactPhone: z.string().optional(),
  website: z.string().optional(),
  currency: z.string().min(1).max(10).optional(),
  timezone: z.string().min(1).max(50).optional(),
  onboardingCompleted: z.boolean().optional(),
});

export class OrganizationController {
  async getProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.tenant) {
        throw new HttpError(401, 'Tenant context required');
      }
      const profile = await organizationService.getProfile(req.tenant.orgId);
      res.json({ data: profile });
    } catch (err) {
      next(err);
    }
  }

  async updateProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.tenant) {
        throw new HttpError(401, 'Tenant context required');
      }
      const parsed = updateProfileSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new HttpError(400, friendlyZodMessage(parsed.error.issues));
      }
      const updated = await organizationService.updateProfile(req.tenant.orgId, parsed.data);
      res.json({ data: updated });
    } catch (err) {
      next(err);
    }
  }

  async uploadLogo(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.tenant) {
        throw new HttpError(401, 'Tenant context required');
      }

      const file = req.file;
      let buffer: Buffer;
      let mimeType: string;

      const rejectedMime = (req as any).logoRejectedMime;
      if (rejectedMime) {
        throw new HttpError(400, `Unsupported logo type "${rejectedMime}". Allowed: PNG, JPEG, WebP, SVG.`);
      }

      if (file) {
        buffer = file.buffer;
        mimeType = file.mimetype;
      } else if (req.body?.base64) {
        const matches = req.body.base64.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
        if (!matches || matches.length !== 3) {
          throw new HttpError(400, 'Invalid base64 payload. Expected data:<mime>;base64,<encoded>');
        }
        mimeType = matches[1] || 'image/png';
        buffer = Buffer.from(matches[2] || '', 'base64');
      } else {
        throw new HttpError(400, 'A file upload or base64 payload is required');
      }

      const result = await organizationService.uploadLogo(req.tenant.orgId, buffer, mimeType);
      res.status(201).json({ data: result });
    } catch (err) {
      next(err);
    }
  }

  async getLogo(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.tenant) {
        throw new HttpError(401, 'Tenant context required');
      }
      const ext = req.query.ext ? String(req.query.ext) : undefined;
      const fileStream = await organizationService.getLogoStream(req.tenant.orgId, ext);

      if (fileStream.contentType) {
        res.setHeader('Content-Type', fileStream.contentType);
      }
      if (fileStream.contentLength) {
        res.setHeader('Content-Length', fileStream.contentLength);
      }
      res.setHeader('Cache-Control', 'public, max-age=3600');

      if (fileStream.body && typeof (fileStream.body as any).pipe === 'function') {
        (fileStream.body as any).pipe(res);
      } else {
        res.status(500).json({ error: 'Failed to stream logo' });
      }
    } catch (err) {
      next(err);
    }
  }
}

export const organizationController = new OrganizationController();
