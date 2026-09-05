import { prisma } from '../../lib/prisma.js';
import { HttpError } from '../../shared/errors.js';
import { signCustomerToken } from '../../shared/jwt.js';
import { sendQuotationMagicLinkEmail } from '../../lib/mailer.js';
import { emitToOrg, emitToQuote } from '../../lib/socket.js';
import { logger } from '../../lib/logger.js';
import { env } from '../../config/env.js';

export interface ActorInfo {
  userId: string;
  email: string;
  role: string;
  name?: string | null;
}

export class PortalService {
  /**
   * Generates a customer magic-link token, sends email via Mailhog, updates status, and logs audit record.
   */
  async sendQuotationToCustomer(
    orgId: string,
    quotationId: string,
    actor: ActorInfo
  ) {
    const quotation = await prisma.quotation.findFirst({
      where: {
        id: quotationId,
        organizationId: orgId,
      },
      include: {
        customer: true,
        organization: true,
      },
    });

    if (!quotation) {
      throw new HttpError(404, 'Quotation not found in this organization');
    }

    if (!quotation.customer || !quotation.customer.email) {
      throw new HttpError(400, 'Customer email is required to dispatch customer portal access link');
    }

    // Sign scoped customer token — long-lived (30d) so a multi-round
    // negotiation comfortably outlives the link. Re-sending mints a fresh
    // token anytime via "Send to Customer".
    const customerToken = signCustomerToken(
      {
        sub: quotation.customerId,
        email: quotation.customer.email,
        org_id: orgId,
        quotation_ids: [quotation.id],
      },
      '30d'
    );

    // Update status to 'sent' if draft/approved
    let newStatus = quotation.status;
    if (quotation.status === 'draft' || quotation.status === 'approved') {
      newStatus = 'sent';
      await prisma.quotation.update({
        where: { id: quotation.id },
        data: { status: 'sent' },
      });
    }

    // Append-only audit log
    await prisma.auditLog.create({
      data: {
        organizationId: orgId,
        entityType: 'quotation',
        entityId: quotation.id,
        action: 'sent_to_customer',
        userId: actor.userId,
        userEmail: actor.email,
        userRole: actor.role,
        reason: 'Dispatched customer portal link via email',
        metadata: {
          recipientEmail: quotation.customer.email,
          previousStatus: quotation.status,
          newStatus,
        },
      },
    });

    // Send email via Mailhog
    await sendQuotationMagicLinkEmail({
      to: quotation.customer.email,
      customerName: quotation.customer.name,
      orgName: quotation.organization.name,
      orgLogoUrl: (quotation.organization as any).logoUrl || null,
      quotationNumber: quotation.quotationNumber,
      quotationTitle: quotation.quotationNumber,
      grandTotal: Number(quotation.totalAmount),
      currency: (quotation.organization as any).currency || 'USD',
      magicToken: customerToken,
    });

    // Realtime broadcast
    emitToOrg(orgId, 'quote:status_changed', {
      quotationId: quotation.id,
      status: newStatus,
    });
    emitToQuote(orgId, quotation.id, 'quote:updated', {
      quotationId: quotation.id,
      status: newStatus,
    });

    logger.info(
      { orgId, quotationId, customerEmail: quotation.customer.email },
      'Dispatched customer portal magic link'
    );

    return {
      success: true,
      token: customerToken,
      portalUrl: `${env.PORTAL_URL}/portal/access?token=${customerToken}`,
      quotationNumber: quotation.quotationNumber,
      customerEmail: quotation.customer.email,
      status: newStatus,
    };
  }

  /**
   * Retrieves public tenant branding for the customer portal. Customers only
   * need the org's identity (name + logo) and currency for pricing display —
   * internal contact details, address, and timezone are never exposed here.
   */
  async getOrganizationBranding(orgId: string) {
    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: {
        id: true,
        name: true,
        logoUrl: true,
        currency: true,
      },
    });

    if (!org) {
      throw new HttpError(404, 'Organization not found');
    }

    return {
      id: org.id,
      name: org.name,
      // Portal-served logo stream (tenant-checked); null when no logo uploaded.
      logoUrl: org.logoUrl ? '/api/portal/organization/logo' : null,
      currency: org.currency,
    };
  }

  /**
   * Streams the issuing organization's logo from MinIO for portal branding.
   * The tenant check is implicit: orgId always comes from the verified token.
   */
  async getOrganizationLogoStream(orgId: string, requestedExt?: string) {
    const { organizationService } = await import('../organization/organization.service.js');
    return organizationService.getLogoStream(orgId, requestedExt);
  }

  /**
   * Retrieves full quotation details for the customer portal, validating customer scope.
   */
  async getCustomerQuotation(
    orgId: string,
    targetQuotationId?: string,
    allowedQuotationIds: string[] = []
  ) {
    const resolvedQuoteId = targetQuotationId || allowedQuotationIds[0];

    if (!resolvedQuoteId) {
      throw new HttpError(400, 'No quotation ID specified or authorized in token');
    }

    // Cryptographic token scope validation
    if (!allowedQuotationIds.includes(resolvedQuoteId)) {
      throw new HttpError(403, 'Forbidden: Your access token is not authorized for this quotation');
    }

    const quotation = await prisma.quotation.findFirst({
      where: {
        id: resolvedQuoteId,
        organizationId: orgId,
      },
      include: {
        customer: true,
        lines: {
          include: {
            product: {
              include: {
                category: true,
              },
            },
          },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        },
      },
    });

    if (!quotation) {
      throw new HttpError(404, 'Quotation not found');
    }

    return {
      id: quotation.id,
      quotationNumber: quotation.quotationNumber,
      title: quotation.notes || quotation.quotationNumber,
      status: quotation.status,
      orderDiscountPercent: Number(quotation.orderDiscountPercent),
      subtotal: Number(quotation.subtotal),
      totalDiscount: Number(quotation.totalDiscount),
      taxTotal: 0,
      grandTotal: Number(quotation.totalAmount),
      totalAmount: Number(quotation.totalAmount),
      notes: quotation.notes,
      validUntil: quotation.validUntil,
      createdAt: quotation.createdAt,
      customer: {
        name: quotation.customer.name,
        email: quotation.customer.email,
        company: quotation.customer.company,
        phone: quotation.customer.phone,
        address: quotation.customer.address,
      },
      lines: quotation.lines.map((l) => ({
        id: l.id,
        productId: l.productId,
        quantity: l.quantity,
        unitPrice: Number(l.unitPrice),
        lineDiscountPercent: Number(l.lineDiscountPercent),
        lineTotal: Number(l.total),
        total: Number(l.total),
        product: {
          name: l.product.name,
          sku: l.product.sku,
          description: l.product.description,
          category: l.product.category ? { name: l.product.category.name } : null,
        },
      })),
    };
  }
}

export const portalService = new PortalService();
