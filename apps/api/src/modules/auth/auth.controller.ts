import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { authService } from './auth.service.js';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1, 'Password is required'),
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
}

export const authController = new AuthController();
