import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { HttpError } from '../../shared/errors.js';
import { platformService } from './platform.service.js';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const createOrgSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1).optional(),
});

const updateOrgSchema = z.object({
  name: z.string().min(1).optional(),
  status: z.enum(['active', 'suspended']).optional(),
});

const inviteOrgAdminSchema = z.object({
  email: z.string().email(),
});

export class PlatformController {
  async login(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const parsed = loginSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new HttpError(400, `Validation error: ${JSON.stringify(parsed.error.flatten().fieldErrors)}`);
      }
      const result = await platformService.loginSuperAdmin(parsed.data.email, parsed.data.password);
      res.json({ data: result });
    } catch (err) {
      next(err);
    }
  }

  async listOrganizations(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const orgs = await platformService.listOrganizations();
      res.json({ data: orgs });
    } catch (err) {
      next(err);
    }
  }

  async getOrganization(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = req.params.id;
      if (!id) {
        throw new HttpError(400, 'Organization ID parameter required');
      }
      const org = await platformService.getOrganizationById(id);
      res.json({ data: org });
    } catch (err) {
      next(err);
    }
  }

  async createOrganization(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const parsed = createOrgSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new HttpError(400, `Validation error: ${JSON.stringify(parsed.error.flatten().fieldErrors)}`);
      }
      const org = await platformService.createOrganization(parsed.data);
      res.status(201).json({ data: org });
    } catch (err) {
      next(err);
    }
  }

  async updateOrganization(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = req.params.id;
      if (!id) {
        throw new HttpError(400, 'Organization ID parameter required');
      }
      const parsed = updateOrgSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new HttpError(400, `Validation error: ${JSON.stringify(parsed.error.flatten().fieldErrors)}`);
      }
      const updated = await platformService.updateOrganization(id, parsed.data);
      res.json({ data: updated });
    } catch (err) {
      next(err);
    }
  }

  async inviteOrgAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = req.params.id;
      if (!id) {
        throw new HttpError(400, 'Organization ID parameter required');
      }
      const parsed = inviteOrgAdminSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new HttpError(400, `Validation error: ${JSON.stringify(parsed.error.flatten().fieldErrors)}`);
      }
      const invite = await platformService.inviteOrgAdmin(id, parsed.data.email);
      res.status(201).json({ data: invite });
    } catch (err) {
      next(err);
    }
  }

  async listInvites(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = req.params.id;
      if (!id) {
        throw new HttpError(400, 'Organization ID parameter required');
      }
      const invites = await platformService.listInvites(id);
      res.json({ data: invites });
    } catch (err) {
      next(err);
    }
  }
}

export const platformController = new PlatformController();
