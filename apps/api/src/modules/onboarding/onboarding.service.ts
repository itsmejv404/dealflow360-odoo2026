import bcrypt from 'bcryptjs';
import { prisma } from '../../lib/prisma.js';
import { HttpError } from '../../shared/errors.js';
import { signInternalToken } from '../../shared/jwt.js';

export class OnboardingService {
  async getInviteByToken(token: string) {
    const invite = await prisma.organizationInvite.findUnique({
      where: { token },
      include: {
        organization: {
          select: {
            id: true,
            name: true,
            slug: true,
            status: true,
            logoUrl: true,
            onboardingCompleted: true,
          },
        },
      },
    });

    if (!invite) {
      throw new HttpError(404, 'Invitation not found');
    }

    if (invite.acceptedAt) {
      throw new HttpError(400, 'This invitation has already been accepted');
    }

    if (invite.expiresAt < new Date()) {
      throw new HttpError(400, 'This invitation has expired');
    }

    if (invite.organization.status !== 'active') {
      throw new HttpError(403, 'The organization is currently suspended');
    }

    return {
      email: invite.email,
      role: invite.role,
      organization: invite.organization,
    };
  }

  async activateAccount(data: { token: string; passwordPlain: string; name?: string }) {
    const invite = await prisma.organizationInvite.findUnique({
      where: { token: data.token },
      include: {
        organization: true,
      },
    });

    if (!invite) {
      throw new HttpError(404, 'Invitation not found');
    }

    if (invite.acceptedAt) {
      throw new HttpError(400, 'This invitation has already been accepted');
    }

    if (invite.expiresAt < new Date()) {
      throw new HttpError(400, 'This invitation has expired');
    }

    if (invite.organization.status !== 'active') {
      throw new HttpError(403, 'The organization is currently suspended');
    }

    const passwordHash = await bcrypt.hash(data.passwordPlain, 10);

    // Create or activate the user account
    const user = await prisma.user.upsert({
      where: { email: invite.email },
      create: {
        email: invite.email,
        name: data.name || invite.email.split('@')[0],
        passwordHash,
        organizationId: invite.organizationId,
        role: invite.role,
        status: 'active',
      },
      update: {
        passwordHash,
        name: data.name || undefined,
        organizationId: invite.organizationId,
        role: invite.role,
        status: 'active',
      },
    });

    // Mark invite as accepted
    await prisma.organizationInvite.update({
      where: { id: invite.id },
      data: { acceptedAt: new Date() },
    });

    const token = signInternalToken({
      sub: user.id,
      email: user.email,
      org_id: invite.organizationId,
      role: 'org_admin',
    });

    return {
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
      organization: {
        id: invite.organization.id,
        name: invite.organization.name,
        slug: invite.organization.slug,
        onboardingCompleted: invite.organization.onboardingCompleted,
      },
    };
  }
}

export const onboardingService = new OnboardingService();
