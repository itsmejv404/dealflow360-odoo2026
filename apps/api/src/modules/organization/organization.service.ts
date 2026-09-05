import { prisma } from '../../lib/prisma.js';
import { HttpError } from '../../shared/errors.js';
import { storageService } from '../../lib/storage.js';

export interface UpdateProfileInput {
  name?: string;
  address?: string;
  description?: string;
  contactEmail?: string;
  contactPhone?: string;
  website?: string;
  currency?: string;
  timezone?: string;
  onboardingCompleted?: boolean;
}

export class OrganizationService {
  async getProfile(orgId: string) {
    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: {
        id: true,
        name: true,
        slug: true,
        status: true,
        logoUrl: true,
        address: true,
        description: true,
        contactEmail: true,
        contactPhone: true,
        website: true,
        currency: true,
        timezone: true,
        onboardingCompleted: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!org) {
      throw new HttpError(404, 'Organization not found');
    }

    return org;
  }

  async updateProfile(orgId: string, data: UpdateProfileInput) {
    const org = await prisma.organization.findUnique({
      where: { id: orgId },
    });

    if (!org) {
      throw new HttpError(404, 'Organization not found');
    }

    return prisma.organization.update({
      where: { id: orgId },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.address !== undefined ? { address: data.address } : {}),
        ...(data.description !== undefined ? { description: data.description } : {}),
        ...(data.contactEmail !== undefined ? { contactEmail: data.contactEmail } : {}),
        ...(data.contactPhone !== undefined ? { contactPhone: data.contactPhone } : {}),
        ...(data.website !== undefined ? { website: data.website } : {}),
        ...(data.currency !== undefined ? { currency: data.currency } : {}),
        ...(data.timezone !== undefined ? { timezone: data.timezone } : {}),
        ...(data.onboardingCompleted !== undefined ? { onboardingCompleted: data.onboardingCompleted } : {}),
      },
      select: {
        id: true,
        name: true,
        slug: true,
        status: true,
        logoUrl: true,
        address: true,
        description: true,
        contactEmail: true,
        contactPhone: true,
        website: true,
        currency: true,
        timezone: true,
        onboardingCompleted: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async uploadLogo(orgId: string, buffer: Buffer, mimeType: string) {
    let ext = 'png';
    if (mimeType.includes('svg')) ext = 'svg';
    else if (mimeType.includes('jpeg') || mimeType.includes('jpg')) ext = 'jpg';
    else if (mimeType.includes('webp')) ext = 'webp';

    const filename = `logo.${ext}`;
    await storageService.uploadTenantFile({
      orgId,
      key: filename,
      buffer,
      contentType: mimeType,
    });

    // Remove superseded logos in other formats so the old logo can never be
    // served after a format switch (e.g. png → svg).
    for (const otherExt of ['png', 'svg', 'jpg', 'webp']) {
      if (otherExt !== ext) {
        await storageService.deleteTenantFile(orgId, `logo.${otherExt}`).catch(() => {
          // Non-fatal: object may not exist
        });
      }
    }

    const logoUrl = `/api/organization/logo?ext=${ext}&v=${Date.now()}`;

    await prisma.organization.update({
      where: { id: orgId },
      data: { logoUrl },
    });

    return { logoUrl, filename };
  }

  async getLogoStream(orgId: string, requestedExt?: string) {
    // Prefer the extension recorded on the org's own logoUrl so a format
    // switch is reflected immediately (a bare request must not resurrect an
    // older logo.* object from a previous upload).
    const preferredExts: string[] = [];
    if (requestedExt) {
      preferredExts.push(requestedExt);
    } else {
      const org = await prisma.organization.findUnique({
        where: { id: orgId },
        select: { logoUrl: true },
      });
      const extMatch = org?.logoUrl?.match(/[?&]ext=([a-z0-9]+)/i);
      if (extMatch?.[1]) {
        preferredExts.push(extMatch[1]);
      }
    }

    const possibleExts = [...new Set([...preferredExts, 'png', 'svg', 'jpg', 'webp'])];

    for (const ext of possibleExts) {
      try {
        const stream = await storageService.getTenantFileStream(orgId, `logo.${ext}`);
        return stream;
      } catch {
        // Continue trying fallback extensions
      }
    }

    throw new HttpError(404, 'Logo not found for this organization');
  }
}

export const organizationService = new OrganizationService();
