import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { usersService } from './users.service.js';

const inviteUserSchema = z.object({
  email: z.string().email(),
  role: z.enum(['org_admin', 'rep', 'manager', 'finance', 'ops']),
  name: z.string().optional(),
});

const updateUserStatusSchema = z.object({
  status: z.enum(['active', 'suspended']),
});

export class UsersController {
  async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const orgId = req.tenant!.orgId;
      const result = await usersService.listUsers(orgId);
      res.status(200).json({
        data: result,
      });
    } catch (err) {
      next(err);
    }
  }

  async invite(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const parsed = inviteUserSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid input', details: parsed.error.issues });
        return;
      }

      const orgId = req.tenant!.orgId;
      const result = await usersService.inviteUser(
        orgId,
        parsed.data.email,
        parsed.data.role,
        parsed.data.name
      );

      res.status(201).json({
        message: 'Invitation sent successfully',
        data: result,
      });
    } catch (err) {
      next(err);
    }
  }

  async updateStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const parsed = updateUserStatusSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid input', details: parsed.error.issues });
        return;
      }

      const orgId = req.tenant!.orgId;
      const callerUserId = req.tenant!.userId!;
      const targetUserId = req.params.id;

      if (!targetUserId) {
        res.status(400).json({ error: 'User ID is required' });
        return;
      }

      const result = await usersService.updateUserStatus(
        orgId,
        targetUserId,
        callerUserId,
        parsed.data.status
      );

      res.status(200).json({
        message: `User status updated to ${parsed.data.status}`,
        data: result,
      });
    } catch (err) {
      next(err);
    }
  }
}

export const usersController = new UsersController();
