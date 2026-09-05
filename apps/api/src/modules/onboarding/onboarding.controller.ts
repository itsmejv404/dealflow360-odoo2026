import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { HttpError } from '../../shared/errors.js';
import { onboardingService } from './onboarding.service.js';

const activateSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().min(1).optional(),
});

export class OnboardingController {
  async getInvite(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const token = req.params.token;
      if (!token) {
        throw new HttpError(400, 'Invite token is required');
      }
      const invite = await onboardingService.getInviteByToken(token);
      res.json({ data: invite });
    } catch (err) {
      next(err);
    }
  }

  async activate(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const parsed = activateSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new HttpError(400, `Validation error: ${JSON.stringify(parsed.error.flatten().fieldErrors)}`);
      }
      const result = await onboardingService.activateAccount({
        token: parsed.data.token,
        passwordPlain: parsed.data.password,
        name: parsed.data.name,
      });
      res.status(201).json({ data: result });
    } catch (err) {
      next(err);
    }
  }
}

export const onboardingController = new OnboardingController();
