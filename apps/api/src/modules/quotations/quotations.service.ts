import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { HttpError } from '../../shared/errors.js';
import { pricingService } from './pricing.service.js';
import { approvalsService } from '../approvals/approvals.service.js';
import { emitToOrg } from '../../lib/socket.js';
import { billingService } from '../billing/billing.service.js';

export interface CreateCustomerInput {
  tierId: string;
  name: string;
  email: string;
  company?: string;
  phone?: string;
  address?: string;
}

export interface QuotationLineInput {
  productId: string;
  quantity: number;
  unitPrice?: number;
  lineDiscountPercent?: number;
}

export interface CreateQuotationInput {
  customerId: string;
  orderDiscountPercent?: number;
  notes?: string;
  validUntil?: string;
  lines: QuotationLineInput[];
}

export interface UpdateQuotationInput {
  customerId?: string;
  orderDiscountPercent?: number;
  notes?: string;
  validUntil?: string | null;
  lines?: QuotationLineInput[];
}

export interface AuditActor {
  userId?: string;
  email?: string;
  role?: string;
}

export class QuotationsService {
  // ================= CUSTOMERS =================

  async listCustomers(orgId: string, search?: string) {
    const where: Prisma.CustomerWhereInput = {
      organizationId: orgId,
    };

    if (search) {
      const q = search.trim();
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
        { company: { contains: q, mode: 'insensitive' } },
      ];
    }

    return prisma.customer.findMany({
      where,
      include: {
        tier: {
          select: { id: true, name: true, code: true, defaultDiscountPercent: true },
        },
      },
      orderBy: { name: 'asc' },
    });
  }

  async createCustomer(orgId: string, data: CreateCustomerInput) {
    const cleanEmail = data.email.trim().toLowerCase();
    const cleanName = data.name.trim();

    const tier = await prisma.customerTier.findFirst({
      where: { id: data.tierId, organizationId: orgId },
    });
    if (!tier) {
      throw new HttpError(400, 'Invalid customer tier specified for your organization');
    }

    const existing = await prisma.customer.findFirst({
      where: { organizationId: orgId, email: cleanEmail },
    });
    if (existing) {
      throw new HttpError(409, `Customer with email "${cleanEmail}" already exists in your organization`);
    }

    return prisma.customer.create({
      data: {
        organizationId: orgId,
        tierId: data.tierId,
        name: cleanName,
        email: cleanEmail,
        company: data.company?.trim(),
        phone: data.phone?.trim(),
        address: data.address?.trim(),
      },
      include: {
        tier: true,
      },
    });
  }

  // ================= QUOTATIONS CRUD =================

  /**
   * Collision-safe quotation numbering: `QT-YYYYMMDD-<per-org daily sequence>`.
   * The sequence is derived from the highest existing number for today's prefix
   * within this organization, and creation retries on P2002 races.
   */
  private quotationNumberPrefix(now: Date): string {
    const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
    return `QT-${dateStr}-`;
  }

  private async nextQuotationNumber(orgId: string, now: Date = new Date()): Promise<string> {
    const prefix = this.quotationNumberPrefix(now);
    const last = await prisma.quotation.findFirst({
      where: {
        organizationId: orgId,
        quotationNumber: { startsWith: prefix },
      },
      orderBy: { quotationNumber: 'desc' },
      select: { quotationNumber: true },
    });

    let seq = 1;
    if (last) {
      const parsed = parseInt(last.quotationNumber.slice(prefix.length), 10);
      if (!Number.isNaN(parsed) && parsed >= 1) {
        seq = parsed + 1;
      }
    }

    return `${prefix}${String(seq).padStart(4, '0')}`;
  }

  async calculateQuotationData(
    orgId: string,
    tierId: string,
    rawLines: QuotationLineInput[],
    orderDiscountPercent: number = 0,
    quotationId?: string
  ) {
    return pricingService.calculateQuotationPricing(
      orgId,
      tierId,
      rawLines,
      orderDiscountPercent,
      quotationId
    );
  }

  async listQuotations(
    orgId: string,
    filters?: { status?: string; customerId?: string; search?: string }
  ) {
    const where: Prisma.QuotationWhereInput = {
      organizationId: orgId,
    };

    if (filters?.status) {
      where.status = filters.status;
    }

    if (filters?.customerId) {
      where.customerId = filters.customerId;
    }

    if (filters?.search) {
      const q = filters.search.trim();
      where.OR = [
        { quotationNumber: { contains: q, mode: 'insensitive' } },
        { customer: { name: { contains: q, mode: 'insensitive' } } },
        { customer: { company: { contains: q, mode: 'insensitive' } } },
      ];
    }

    return prisma.quotation.findMany({
      where,
      include: {
        customer: {
          select: { id: true, name: true, email: true, company: true },
        },
        tier: {
          select: { id: true, name: true, code: true },
        },
        rep: {
          select: { id: true, name: true, email: true },
        },
        _count: {
          select: { lines: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getQuotation(orgId: string, quotationId: string) {
    const quotation = await prisma.quotation.findFirst({
      where: { id: quotationId, organizationId: orgId },
      include: {
        customer: {
          include: { tier: true },
        },
        tier: true,
        rep: {
          select: { id: true, name: true, email: true },
        },
        lines: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                sku: true,
                price: true,
                costPrice: true,
                billingFrequency: true,
              },
            },
            category: {
              select: { id: true, name: true, code: true },
            },
          },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        },
      },
    });

    if (!quotation) {
      throw new HttpError(404, 'Quotation not found');
    }

    return quotation;
  }

  async createQuotation(orgId: string, userId: string | undefined, data: CreateQuotationInput) {
    const customer = await prisma.customer.findFirst({
      where: { id: data.customerId, organizationId: orgId },
    });

    if (!customer) {
      throw new HttpError(400, 'Invalid customer selected for this organization');
    }

    const { computedLines, totals, risk } = await this.calculateQuotationData(
      orgId,
      customer.tierId,
      data.lines,
      data.orderDiscountPercent || 0
    );

    const MAX_ATTEMPTS = 5;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      try {
        const quotationNumber = await this.nextQuotationNumber(orgId);

        return await prisma.$transaction(async (tx) => {
          const quotation = await tx.quotation.create({
            data: {
              organizationId: orgId,
              quotationNumber,
              customerId: customer.id,
              tierId: customer.tierId,
              repId: userId,
              status: 'draft',
              orderDiscountPercent: new Prisma.Decimal(totals.orderDiscountPercent),
              orderDiscountAmount: new Prisma.Decimal(totals.orderDiscountAmount),
              subtotal: new Prisma.Decimal(totals.subtotal),
              totalDiscount: new Prisma.Decimal(totals.totalDiscount),
              totalAmount: new Prisma.Decimal(totals.totalAmount),
              totalCost: new Prisma.Decimal(totals.totalCost),
              totalMargin: new Prisma.Decimal(totals.totalMargin),
              totalMarginPercent: new Prisma.Decimal(totals.totalMarginPercent),
              oneTimeTotal: new Prisma.Decimal(totals.oneTimeTotal),
              recurringMonthlyTotal: new Prisma.Decimal(totals.recurringMonthlyTotal),
              recurringAnnualTotal: new Prisma.Decimal(totals.recurringAnnualTotal),
              riskScore: new Prisma.Decimal(risk.riskScore),
              riskLevel: risk.riskLevel,
              approvalRouting: risk.approvalRouting,
              riskDetails: risk as unknown as Prisma.InputJsonValue,
              notes: data.notes?.trim(),
              validUntil: data.validUntil ? new Date(data.validUntil) : null,
            },
          });

          if (computedLines.length > 0) {
            await tx.quotationLine.createMany({
              data: computedLines.map((line) => ({
                organizationId: orgId,
                quotationId: quotation.id,
                productId: line.productId,
                categoryId: line.categoryId,
                quantity: line.quantity,
                unitPrice: new Prisma.Decimal(line.unitPrice),
                costPrice: new Prisma.Decimal(line.costPrice),
                lineDiscountPercent: new Prisma.Decimal(line.lineDiscountPercent),
                lineDiscountAmount: new Prisma.Decimal(line.lineDiscountAmount),
                subtotal: new Prisma.Decimal(line.subtotal),
                total: new Prisma.Decimal(line.total),
                marginAmount: new Prisma.Decimal(line.marginAmount),
                marginPercent: new Prisma.Decimal(line.marginPercent),
                appliedCeilingPercent: new Prisma.Decimal(line.appliedCeilingPercent ?? 0),
                riskDeltaPercent: new Prisma.Decimal(line.riskDeltaPercent ?? 0),
                isOverCeiling: line.isOverCeiling ?? false,
                billingFrequency: line.billingFrequency,
              })),
            });
          }

          return tx.quotation.findUnique({
            where: { id: quotation.id },
            include: {
              customer: { include: { tier: true } },
              tier: true,
              rep: { select: { id: true, name: true, email: true } },
              lines: {
                include: {
                  product: true,
                  category: true,
                },
              },
            },
          });
        });
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002'
        ) {
          // Unique violation on (organizationId, quotationNumber) — another
          // concurrent creation claimed the sequence; retry with the next number.
          continue;
        }
        throw err;
      }
    }

    throw new HttpError(
      409,
      'Could not allocate a unique quotation number due to concurrent creation. Please retry.'
    );
  }

  async updateQuotation(
    orgId: string,
    quotationId: string,
    data: UpdateQuotationInput,
    actor?: AuditActor
  ) {
    const existing = await prisma.quotation.findFirst({
      where: { id: quotationId, organizationId: orgId },
      include: { lines: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } },
    });

    if (!existing) {
      throw new HttpError(404, 'Quotation not found');
    }

    const customerId = data.customerId || existing.customerId;
    const customer = await prisma.customer.findFirst({
      where: { id: customerId, organizationId: orgId },
    });

    if (!customer) {
      throw new HttpError(400, 'Invalid customer selected');
    }

    const orderDiscountPercent =
      data.orderDiscountPercent !== undefined
        ? data.orderDiscountPercent
        : Number(existing.orderDiscountPercent);

    const linesToCompute: QuotationLineInput[] =
      data.lines !== undefined
        ? data.lines
        : existing.lines.map((l) => ({
            productId: l.productId,
            quantity: l.quantity,
            unitPrice: Number(l.unitPrice),
            lineDiscountPercent: Number(l.lineDiscountPercent),
          }));

    const { computedLines, totals, risk } = await this.calculateQuotationData(
      orgId,
      customer.tierId,
      linesToCompute,
      orderDiscountPercent,
      quotationId
    );

    const updated = await prisma.$transaction(async (tx) => {
      if (data.lines !== undefined) {
        // Position-based sync: existing rows are updated in place so their IDs
        // stay stable — negotiation comments/counters/change-requests reference
        // line IDs and must not be cascade-deleted on every edit. Only rows
        // beyond the new length are removed (lines dropped from the quote).
        const lineData = (line: (typeof computedLines)[number]) => ({
          productId: line.productId,
          categoryId: line.categoryId,
          quantity: line.quantity,
          unitPrice: new Prisma.Decimal(line.unitPrice),
          costPrice: new Prisma.Decimal(line.costPrice),
          lineDiscountPercent: new Prisma.Decimal(line.lineDiscountPercent),
          lineDiscountAmount: new Prisma.Decimal(line.lineDiscountAmount),
          subtotal: new Prisma.Decimal(line.subtotal),
          total: new Prisma.Decimal(line.total),
          marginAmount: new Prisma.Decimal(line.marginAmount),
          marginPercent: new Prisma.Decimal(line.marginPercent),
          appliedCeilingPercent: new Prisma.Decimal(line.appliedCeilingPercent ?? 0),
          riskDeltaPercent: new Prisma.Decimal(line.riskDeltaPercent ?? 0),
          isOverCeiling: line.isOverCeiling ?? false,
          billingFrequency: line.billingFrequency,
        });

        const existingLines = existing.lines;
        const keepCount = Math.min(existingLines.length, computedLines.length);

        for (let i = 0; i < keepCount; i++) {
          await tx.quotationLine.update({
            where: { id: existingLines[i]!.id },
            data: lineData(computedLines[i]!),
          });
        }

        for (let i = keepCount; i < computedLines.length; i++) {
          await tx.quotationLine.create({
            data: {
              organizationId: orgId,
              quotationId,
              ...lineData(computedLines[i]!),
            },
          });
        }

        if (existingLines.length > computedLines.length) {
          const removedIds = existingLines.slice(computedLines.length).map((l) => l.id);
          await tx.quotationLine.deleteMany({
            where: { id: { in: removedIds }, organizationId: orgId },
          });
        }
      }

      const updated = await tx.quotation.update({
        where: { id: quotationId },
        data: {
          customerId: customer.id,
          tierId: customer.tierId,
          ...(data.notes !== undefined && { notes: data.notes?.trim() }),
          ...(data.validUntil !== undefined && {
            validUntil: data.validUntil ? new Date(data.validUntil) : null,
          }),
          orderDiscountPercent: new Prisma.Decimal(totals.orderDiscountPercent),
          orderDiscountAmount: new Prisma.Decimal(totals.orderDiscountAmount),
          subtotal: new Prisma.Decimal(totals.subtotal),
          totalDiscount: new Prisma.Decimal(totals.totalDiscount),
          totalAmount: new Prisma.Decimal(totals.totalAmount),
          totalCost: new Prisma.Decimal(totals.totalCost),
          totalMargin: new Prisma.Decimal(totals.totalMargin),
          totalMarginPercent: new Prisma.Decimal(totals.totalMarginPercent),
          oneTimeTotal: new Prisma.Decimal(totals.oneTimeTotal),
          recurringMonthlyTotal: new Prisma.Decimal(totals.recurringMonthlyTotal),
          recurringAnnualTotal: new Prisma.Decimal(totals.recurringAnnualTotal),
          riskScore: new Prisma.Decimal(risk.riskScore),
          riskLevel: risk.riskLevel,
          approvalRouting: risk.approvalRouting,
          riskDetails: risk as unknown as Prisma.InputJsonValue,
        },
        include: {
          customer: { include: { tier: true } },
          tier: true,
          rep: { select: { id: true, name: true, email: true } },
          lines: {
            include: {
              product: true,
              category: true,
            },
          },
        },
      });

      return updated;
    });

    await approvalsService.logAudit(orgId, {
      entityType: 'quotation',
      entityId: quotationId,
      user:
        actor && actor.userId && actor.email && actor.role
          ? { userId: actor.userId, email: actor.email, role: actor.role }
          : null,
      action: 'updated',
      reason: 'Quotation updated via quotation builder',
      metadata: { fieldsChanged: Object.keys(data) },
    });

    return updated;
  }

  async deleteQuotation(orgId: string, quotationId: string, actor?: AuditActor) {
    const existing = await prisma.quotation.findFirst({
      where: { id: quotationId, organizationId: orgId },
    });

    if (!existing) {
      throw new HttpError(404, 'Quotation not found');
    }

    const deletableStatuses = new Set(['draft', 'rejected']);
    if (!deletableStatuses.has(existing.status)) {
      throw new HttpError(
        409,
        `Quotation in '${existing.status}' status cannot be deleted. Only draft or rejected quotations may be removed.`
      );
    }

    await prisma.$transaction([
      prisma.quotationLine.deleteMany({
        where: { quotationId, organizationId: orgId },
      }),
      prisma.quotation.delete({
        where: { id: quotationId },
      }),
    ]);

    await approvalsService.logAudit(orgId, {
      entityType: 'quotation',
      entityId: quotationId,
      user:
        actor && actor.userId && actor.email && actor.role
          ? { userId: actor.userId, email: actor.email, role: actor.role }
          : null,
      action: 'deleted',
      reason: `Deleted quotation ${existing.quotationNumber} (${existing.status})`,
      metadata: {
        quotationNumber: existing.quotationNumber,
        previousStatus: existing.status,
        totalAmount: Number(existing.totalAmount),
      },
    });

    return { success: true };
  }

  async confirmQuotation(orgId: string, quotationId: string, actor?: AuditActor) {
    const existing = await prisma.quotation.findFirst({
      where: { id: quotationId, organizationId: orgId },
      include: { customer: true },
    });

    if (!existing) {
      throw new HttpError(404, 'Quotation not found');
    }

    const confirmableStatuses = new Set(['approved', 'sent', 'negotiating']);
    if (!confirmableStatuses.has(existing.status)) {
      throw new HttpError(
        400,
        `Quotation in '${existing.status}' status cannot be confirmed. Only approved/sent quotations can be confirmed.`
      );
    }

    const updated = await prisma.quotation.update({
      where: { id: quotationId },
      data: { status: 'confirmed' },
    });

    await approvalsService.logAudit(orgId, {
      entityType: 'quotation',
      entityId: quotationId,
      user:
        actor && actor.userId && actor.email && actor.role
          ? { userId: actor.userId, email: actor.email, role: actor.role }
          : null,
      action: 'order_confirmed',
      reason: `Quotation ${existing.quotationNumber} confirmed by internal user`,
      metadata: {
        quotationNumber: existing.quotationNumber,
        previousStatus: existing.status,
      },
    });

    emitToOrg(orgId, 'quote:status_changed', {
      quotationId,
      status: 'confirmed',
      quotationNumber: existing.quotationNumber,
    });

    // Trigger order split into one-time invoice and recurring subscriptions
    await billingService.confirmAndSplitOrder(orgId, quotationId);

    return updated;
  }
}

export const quotationsService = new QuotationsService();
