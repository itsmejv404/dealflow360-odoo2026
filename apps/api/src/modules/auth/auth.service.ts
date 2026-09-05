import bcrypt from 'bcryptjs';
import { prisma } from '../../lib/prisma.js';
import { HttpError } from '../../shared/errors.js';
import { signInternalToken, type UserRole } from '../../shared/jwt.js';

export class AuthService {
  async login(email: string, passwordPlain: string) {
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
      include: {
        organization: true,
      },
    });

    if (!user) {
      throw new HttpError(401, 'Invalid email or password');
    }

    if (user.role === 'super_admin' || !user.organizationId || !user.organization) {
      throw new HttpError(401, 'Please use platform portal for super admin authentication');
    }

    if (user.status !== 'active') {
      throw new HttpError(403, 'Account is inactive or suspended');
    }

    if (user.organization.status !== 'active') {
      throw new HttpError(403, 'Organization account is suspended');
    }

    const isValid = await bcrypt.compare(passwordPlain, user.passwordHash);
    if (!isValid) {
      throw new HttpError(401, 'Invalid email or password');
    }

    const token = signInternalToken({
      sub: user.id,
      email: user.email,
      org_id: user.organization.id,
      role: user.role as Exclude<UserRole, 'super_admin'>,
    });

    return {
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        status: user.status,
      },
      organization: {
        id: user.organization.id,
        name: user.organization.name,
        slug: user.organization.slug,
        status: user.organization.status,
        logoUrl: user.organization.logoUrl,
        currency: user.organization.currency,
        timezone: user.organization.timezone,
        onboardingCompleted: user.organization.onboardingCompleted,
      },
    };
  }

  async getCurrentUser(userId: string, orgId: string) {
    const user = await prisma.user.findFirst({
      where: {
        id: userId,
        organizationId: orgId,
      },
      include: {
        organization: true,
      },
    });

    if (!user || !user.organization) {
      throw new HttpError(404, 'User or organization not found');
    }

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        status: user.status,
      },
      organization: {
        id: user.organization.id,
        name: user.organization.name,
        slug: user.organization.slug,
        status: user.organization.status,
        logoUrl: user.organization.logoUrl,
        currency: user.organization.currency,
        timezone: user.organization.timezone,
        onboardingCompleted: user.organization.onboardingCompleted,
      },
    };
  }
}

export const authService = new AuthService();
