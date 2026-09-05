import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { authService } from './auth.service.js';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1, 'Password is required'),
});

const updateProfileSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  currentPassword: z.string().min(1).optional(),
  newPassword: z.string().min(8).optional(),
});

const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

const resetPasswordSchema = z.object({
  email: z.string().email(),
  token: z.string().min(10),
  newPassword: z.string().min(8),
});

export class AuthController {
  async login(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const parsed = loginSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid input', details: parsed.error.issues });
        return;
      }

      const result = await authService.login(parsed.data.email, parsed.data.password);
      res.status(200).json({
        message: 'Login successful',
        data: result,
      });
    } catch (err) {
      next(err);
    }
  }

  async me(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.tenant?.userId || !req.tenant.orgId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const result = await authService.getCurrentUser(req.tenant.userId, req.tenant.orgId);
      res.status(200).json({
        data: result,
      });
    } catch (err) {
      next(err);
    }
  }

  async updateProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.tenant?.userId || !req.tenant.orgId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const parsed = updateProfileSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid input', details: parsed.error.issues });
        return;
      }

      const result = await authService.updateProfile(
        req.tenant.userId,
        req.tenant.orgId,
        parsed.data
      );
      res.status(200).json({ data: result });
    } catch (err) {
      next(err);
    }
  }

  async forgotPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const parsed = forgotPasswordSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'A valid email is required', details: parsed.error.issues });
        return;
      }

      const result = await authService.requestPasswordReset(parsed.data.email);
      res.status(200).json({ data: result });
    } catch (err) {
      next(err);
    }
  }

  async resetPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const parsed = resetPasswordSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid input', details: parsed.error.issues });
        return;
      }

      const result = await authService.resetPassword(
        parsed.data.email,
        parsed.data.token,
        parsed.data.newPassword
      );
      res.status(200).json({ data: result });
    } catch (err) {
      next(err);
    }
  }
}

export const authController = new AuthController();
