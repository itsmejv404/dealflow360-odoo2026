import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '../../lib/prisma.js';
import { HttpError } from '../../shared/errors.js';
import { signSuperAdminToken } from '../../shared/jwt.js';
import { sendOrgAdminInviteEmail } from '../../lib/mailer.js';

export class PlatformService {
  async loginSuperAdmin(email: string, passwordPlain: string) {
    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user || user.role !== 'super_admin') {
      throw new HttpError(401, 'Invalid Super Admin credentials');
    }

    const validPassword = await bcrypt.compare(passwordPlain, user.passwordHash);
    if (!validPassword) {
      throw new HttpError(401, 'Invalid Super Admin credentials');
    }

    const token = signSuperAdminToken({
      sub: user.id,
      email: user.email,
      role: 'super_admin',
    });

    return {
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    };
  }

  async listOrganizations() {
    const orgs = await prisma.organization.findMany({
      include: {
        _count: {
          select: {
            users: true,
            products: true,
            orderLines: true,
            invites: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Total profit chain: realized profit per organization, aggregated across
    // its quotations ( quotation margins are stored per quote in org currency ).
    const profitByOrg = await prisma.quotation.groupBy({
      by: ['organizationId'],
      _sum: { totalMargin: true },
      _count: { id: true },
    });
    const profitMap = new Map(
      profitByOrg.map((row) => [
        row.organizationId,
        {
          totalProfit: Number(row._sum.totalMargin ?? 0),
          quotationCount: row._count.id,
        },
      ])
    );

    return orgs.map((org) => ({
      ...org,
      profit: profitMap.get(org.id) ?? { totalProfit: 0, quotationCount: 0 },
    }));
  }

  async getOrganizationById(id: string) {
    const org = await prisma.organization.findUnique({
      where: { id },
      include: {
        users: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            status: true,
            createdAt: true,
          },
        },
        invites: {
          orderBy: { createdAt: 'desc' },
        },
        _count: {
          select: {
            products: true,
            orderLines: true,
          },
        },
      },
    });

    if (!org) {
      throw new HttpError(404, 'Organization not found');
    }

    return org;
  }

  async createOrganization(data: { name: string; slug?: string }) {
    const slug = (data.slug || data.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')).trim();

    const existing = await prisma.organization.findUnique({
      where: { slug },
    });

    if (existing) {
      throw new HttpError(409, `Organization with slug "${slug}" already exists`);
    }

    return prisma.organization.create({
      data: {
        name: data.name,
        slug,
        status: 'active',
      },
    });
  }

  async updateOrganization(id: string, data: { name?: string; status?: 'active' | 'suspended' }) {
    const org = await prisma.organization.findUnique({
      where: { id },
    });

    if (!org) {
      throw new HttpError(404, 'Organization not found');
    }

    return prisma.organization.update({
      where: { id },
      data: {
        ...(data.name ? { name: data.name } : {}),
        ...(data.status ? { status: data.status } : {}),
      },
    });
  }

  async inviteOrgAdmin(orgId: string, email: string) {
    const org = await prisma.organization.findUnique({
      where: { id: orgId },
    });

    if (!org) {
      throw new HttpError(404, 'Organization not found');
    }

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    const invite = await prisma.organizationInvite.create({
      data: {
        organizationId: org.id,
        email: email.toLowerCase().trim(),
        role: 'org_admin',
        token,
        expiresAt,
      },
    });

    await sendOrgAdminInviteEmail({
      to: invite.email,
      orgName: org.name,
      inviteToken: token,
      inviteUrl: `http://localhost/activate?token=${token}`,
    });

    return invite;
  }

  async listInvites(orgId: string) {
    const org = await prisma.organization.findUnique({
      where: { id: orgId },
    });

    if (!org) {
      throw new HttpError(404, 'Organization not found');
    }

    return prisma.organizationInvite.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getOrganizationAuditLogs(orgId: string, limit = 100) {
    const org = await prisma.organization.findUnique({
      where: { id: orgId },
    });

    if (!org) {
      throw new HttpError(404, 'Organization not found');
    }

    return prisma.auditLog.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }
}

export const platformService = new PlatformService();

