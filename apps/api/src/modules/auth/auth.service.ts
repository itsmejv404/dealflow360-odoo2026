import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { prisma } from '../../lib/prisma.js';
import { HttpError } from '../../shared/errors.js';
import { signInternalToken, type UserRole } from '../../shared/jwt.js';
import { sendPasswordResetEmail } from '../../lib/mailer.js';
import { env } from '../../config/env.js';

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

  // ==================== PROFILE MANAGEMENT ====================

  /** Update the current user's own profile (name and/or password). */
  async updateProfile(
    userId: string,
    orgId: string,
    input: { name?: string; currentPassword?: string; newPassword?: string }
  ) {
    const user = await prisma.user.findFirst({ where: { id: userId, organizationId: orgId } });
    if (!user) {
      throw new HttpError(404, 'User not found');
    }

    const data: { name?: string; passwordHash?: string } = {};

    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name) throw new HttpError(400, 'Name cannot be empty');
      if (name.length > 100) throw new HttpError(400, 'Name is too long (max 100 characters)');
      data.name = name;
    }

    if (input.newPassword !== undefined) {
      if (!input.currentPassword) {
        throw new HttpError(400, 'Current password is required to change your password');
      }
      const isValid = await bcrypt.compare(input.currentPassword, user.passwordHash);
      if (!isValid) {
        throw new HttpError(401, 'Current password is incorrect');
      }
      if (input.newPassword.length < 8) {
        throw new HttpError(400, 'New password must be at least 8 characters');
      }
      data.passwordHash = await bcrypt.hash(input.newPassword, 10);
    }

    if (Object.keys(data).length === 0) {
      throw new HttpError(400, 'Nothing to update');
    }

    const updated = await prisma.user.update({ where: { id: user.id }, data });
    return {
      id: updated.id,
      email: updated.email,
      name: updated.name,
      role: updated.role,
    };
  }

  /**
   * Request a password reset. Always succeeds (no account enumeration); a
   * reset email is only sent when the account exists.
   */
  async requestPasswordReset(email: string) {
    const normalized = email.toLowerCase().trim();
    const resetToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');
    const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    const user = await prisma.user.findFirst({
      where: { email: normalized, status: 'active', organization: { status: 'active' } },
      include: { organization: true },
    });
    if (user) {
      await prisma.user.update({
        where: { id: user.id },
        data: { passwordResetToken: tokenHash, passwordResetExpires: expires },
      });
      const resetUrl = `${env.PORTAL_URL}/reset-password?token=${resetToken}`;
      await sendPasswordResetEmail({
        to: user.email,
        name: user.name,
        resetToken,
        resetUrl,
      });
    }
    return { message: 'If an account exists for that email, a reset link has been sent.' };
  }

  /** Complete a password reset with a valid, unexpired token. */
  async resetPassword(email: string, token: string, newPassword: string) {
    if (newPassword.length < 8) {
      throw new HttpError(400, 'Password must be at least 8 characters');
    }
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const now = new Date();

    const user = await prisma.user.findFirst({
      where: {
        email: email.toLowerCase().trim(),
        passwordResetToken: tokenHash,
        passwordResetExpires: { gt: now },
      },
    });
    if (!user) {
      throw new HttpError(400, 'Reset link is invalid or has expired');
    }
    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await bcrypt.hash(newPassword, 10),
        passwordResetToken: null,
        passwordResetExpires: null,
      },
    });
    return { message: 'Password has been reset. You can now sign in.' };
  }
}

export const authService = new AuthService();
