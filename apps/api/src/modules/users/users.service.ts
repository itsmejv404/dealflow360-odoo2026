import crypto from 'node:crypto';
import { prisma } from '../../lib/prisma.js';
import { HttpError } from '../../shared/errors.js';
import { sendUserInviteEmail } from '../../lib/mailer.js';

const VALID_ROLES = ['org_admin', 'rep', 'manager', 'finance', 'ops'];

export class UsersService {
  async listUsers(orgId: string) {
    const users = await prisma.user.findMany({
      where: { organizationId: orgId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    const pendingInvites = await prisma.organizationInvite.findMany({
      where: {
        organizationId: orgId,
        acceptedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: {
        id: true,
        email: true,
        role: true,
        createdAt: true,
        expiresAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return { users, pendingInvites };
  }

  async inviteUser(orgId: string, email: string, role: string, name?: string) {
    const cleanEmail = email.toLowerCase().trim();
    if (!VALID_ROLES.includes(role)) {
      throw new HttpError(400, `Invalid role. Must be one of: ${VALID_ROLES.join(', ')}`);
    }

    const org = await prisma.organization.findUnique({
      where: { id: orgId },
    });
    if (!org) {
      throw new HttpError(404, 'Organization not found');
    }

    const existingUser = await prisma.user.findUnique({
      where: { email: cleanEmail },
    });

    if (existingUser) {
      if (existingUser.organizationId === orgId) {
        throw new HttpError(409, 'User with this email already belongs to this organization');
      } else {
        throw new HttpError(409, 'User with this email already belongs to another organization');
      }
    }

    // Invalidate existing pending invites for this email in this org
    await prisma.organizationInvite.deleteMany({
      where: { organizationId: orgId, email: cleanEmail },
    });

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    const invite = await prisma.organizationInvite.create({
      data: {
        organizationId: orgId,
        email: cleanEmail,
        role,
        token,
        expiresAt,
      },
    });

    await sendUserInviteEmail({
      to: cleanEmail,
      orgName: org.name,
      role,
      inviteToken: token,
    });

    return {
      id: invite.id,
      email: invite.email,
      role: invite.role,
      token: invite.token,
      expiresAt: invite.expiresAt,
    };
  }

  async updateUserStatus(
    orgId: string,
    targetUserId: string,
    callerUserId: string,
    status: 'active' | 'suspended'
  ) {
    if (targetUserId === callerUserId) {
      throw new HttpError(400, 'You cannot alter your own account status');
    }

    const user = await prisma.user.findFirst({
      where: {
        id: targetUserId,
        organizationId: orgId,
      },
    });

    if (!user) {
      throw new HttpError(404, 'User not found in this organization');
    }

    const updated = await prisma.user.update({
      where: { id: targetUserId },
      data: { status },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        status: true,
        updatedAt: true,
      },
    });

    return updated;
  }
}

export const usersService = new UsersService();
