import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { HttpError } from '../../shared/errors.js';

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
  status?: string;
  lines?: QuotationLineInput[];
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

  // ================= CALCULATION & PRICING =================

  private round2(num: number): number {
    return Math.round((num + Number.EPSILON) * 100) / 100;
  }

  private generateQuotationNumber(): string {
    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    return `QT-${dateStr}-${randomSuffix}`;
  }

  async calculateQuotationData(
    orgId: string,
    tierId: string,
    rawLines: QuotationLineInput[],
    orderDiscountPercent: number = 0
  ) {
    if (!rawLines || rawLines.length === 0) {
      throw new HttpError(400, 'Quotation must have at least one product line');
    }

    const productIds = rawLines.map((l) => l.productId);
    const [products, priceListItems] = await Promise.all([
      prisma.product.findMany({
        where: { id: { in: productIds }, organizationId: orgId },
        include: { category: true },
      }),
      prisma.priceListItem.findMany({
        where: {
          productId: { in: productIds },
          tierId,
          organizationId: orgId,
        },
      }),
    ]);

    const productMap = new Map(products.map((p) => [p.id, p]));
    const priceMap = new Map(priceListItems.map((pli) => [pli.productId, Number(pli.customPrice)]));

    const tier = await prisma.customerTier.findFirst({
      where: { id: tierId, organizationId: orgId },
    });
    const tierDefaultDiscount = Number(tier?.defaultDiscountPercent || 0);

    let subtotal = 0;
    let totalLineDiscount = 0;
    let totalCost = 0;
    let oneTimeTotal = 0;
    let recurringMonthlyTotal = 0;
    let recurringAnnualTotal = 0;

    const computedLines = rawLines.map((lineInput) => {
      const product = productMap.get(lineInput.productId);
      if (!product) {
        throw new HttpError(400, `Product ${lineInput.productId} not found in this organization`);
      }

      const quantity = Math.max(1, Math.floor(lineInput.quantity || 1));
      const costPrice = product.costPrice ? Number(product.costPrice) : 0;

      let unitPrice: number;
      if (lineInput.unitPrice !== undefined && lineInput.unitPrice >= 0) {
        unitPrice = Number(lineInput.unitPrice);
      } else if (priceMap.has(product.id)) {
        unitPrice = priceMap.get(product.id)!;
      } else {
        const base = Number(product.price);
        unitPrice = tierDefaultDiscount > 0 ? this.round2(base * (1 - tierDefaultDiscount / 100)) : base;
      }

      const lineDiscountPct = Math.min(100, Math.max(0, lineInput.lineDiscountPercent ?? 0));
      const lineGross = this.round2(quantity * unitPrice);
      const lineDiscountAmt = this.round2(lineGross * (lineDiscountPct / 100));
      const lineNet = this.round2(lineGross - lineDiscountAmt);
      const lineCost = this.round2(quantity * costPrice);
      const lineMarginAmt = this.round2(lineNet - lineCost);
      const lineMarginPct = lineNet > 0 ? this.round2((lineMarginAmt / lineNet) * 100) : 0;

      subtotal += lineGross;
      totalLineDiscount += lineDiscountAmt;
      totalCost += lineCost;

      if (product.billingFrequency === 'monthly') {
        recurringMonthlyTotal += lineNet;
      } else if (product.billingFrequency === 'annual') {
        recurringAnnualTotal += lineNet;
      } else {
        oneTimeTotal += lineNet;
      }

      return {
        productId: product.id,
        categoryId: product.categoryId,
        quantity,
        unitPrice,
        costPrice,
        lineDiscountPercent: lineDiscountPct,
        lineDiscountAmount: lineDiscountAmt,
        subtotal: lineGross,
        total: lineNet,
        marginAmount: lineMarginAmt,
        marginPercent: lineMarginPct,
        billingFrequency: product.billingFrequency,
      };
    });

    const netBeforeOrderDiscount = this.round2(subtotal - totalLineDiscount);
    const orderDiscountPct = Math.min(100, Math.max(0, orderDiscountPercent));
    const orderDiscountAmt = this.round2(netBeforeOrderDiscount * (orderDiscountPct / 100));
    const totalAmount = this.round2(netBeforeOrderDiscount - orderDiscountAmt);
    const totalDiscount = this.round2(totalLineDiscount + orderDiscountAmt);
    const totalMargin = this.round2(totalAmount - totalCost);
    const totalMarginPercent = totalAmount > 0 ? this.round2((totalMargin / totalAmount) * 100) : 0;

    return {
      computedLines,
      totals: {
        orderDiscountPercent: orderDiscountPct,
        orderDiscountAmount: orderDiscountAmt,
        subtotal: this.round2(subtotal),
        totalDiscount,
        totalAmount,
        totalCost: this.round2(totalCost),
        totalMargin,
        totalMarginPercent,
        oneTimeTotal: this.round2(oneTimeTotal),
        recurringMonthlyTotal: this.round2(recurringMonthlyTotal),
        recurringAnnualTotal: this.round2(recurringAnnualTotal),
      },
    };
  }

  // ================= QUOTATIONS CRUD =================

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
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!quotation) {
      throw new HttpError(404, 'Quotation not found');
    }

    return quotation;
  }

  async createQuotation(orgId: string, userId: string, data: CreateQuotationInput) {
    const customer = await prisma.customer.findFirst({
      where: { id: data.customerId, organizationId: orgId },
    });

    if (!customer) {
      throw new HttpError(400, 'Invalid customer selected for this organization');
    }

    const { computedLines, totals } = await this.calculateQuotationData(
      orgId,
      customer.tierId,
      data.lines,
      data.orderDiscountPercent || 0
    );

    const quotationNumber = this.generateQuotationNumber();

    return prisma.$transaction(async (tx) => {
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
  }

  async updateQuotation(orgId: string, quotationId: string, data: UpdateQuotationInput) {
    const existing = await prisma.quotation.findFirst({
      where: { id: quotationId, organizationId: orgId },
      include: { lines: true },
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

    const { computedLines, totals } = await this.calculateQuotationData(
      orgId,
      customer.tierId,
      linesToCompute,
      orderDiscountPercent
    );

    return prisma.$transaction(async (tx) => {
      if (data.lines !== undefined) {
        await tx.quotationLine.deleteMany({
          where: { quotationId, organizationId: orgId },
        });

        await tx.quotationLine.createMany({
          data: computedLines.map((line) => ({
            organizationId: orgId,
            quotationId,
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
            billingFrequency: line.billingFrequency,
          })),
        });
      }

      const updated = await tx.quotation.update({
        where: { id: quotationId },
        data: {
          customerId: customer.id,
          tierId: customer.tierId,
          ...(data.status && { status: data.status }),
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
  }

  async deleteQuotation(orgId: string, quotationId: string) {
    const existing = await prisma.quotation.findFirst({
      where: { id: quotationId, organizationId: orgId },
    });

    if (!existing) {
      throw new HttpError(404, 'Quotation not found');
    }

    await prisma.quotation.delete({
      where: { id: quotationId },
    });

    return { success: true };
  }
}

export const quotationsService = new QuotationsService();
