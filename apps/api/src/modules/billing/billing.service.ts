import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { emitToOrg } from '../../lib/socket.js';
import { billingScheduleQueue, prorationQueue } from '../../lib/queue.js';
import { HttpError } from '../../shared/errors.js';
import { generateOrgInvoiceNumber, calculateProration } from './billing.worker.js';
import { sendInvoiceEmail } from '../../lib/mailer.js';
import { Prisma, type Invoice } from '@prisma/client';

export class BillingService {
  private round2(num: number): number {
    return Math.round((num + Number.EPSILON) * 100) / 100;
  }

  /**
   * Called when a quotation transitions to 'confirmed' status.
   * Splits one-time vs recurring lines:
   *  - One-time lines immediately generate a one-time Invoice.
   *  - Recurring lines create Subscription records and enqueue BullMQ billing schedule generation.
   */
  async confirmAndSplitOrder(orgId: string, quotationId: string) {
    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { id: true, name: true, slug: true, currency: true, timezone: true },
    });
    if (!org) throw new HttpError(404, 'Organization not found');

    const quotation = await prisma.quotation.findFirst({
      where: { id: quotationId, organizationId: orgId },
      include: {
        customer: true,
        lines: {
          include: { product: true },
          orderBy: { id: 'asc' },
        },
      },
    });
    if (!quotation) throw new HttpError(404, 'Quotation not found');

    const oneTimeLines = quotation.lines.filter(
      (l) => !l.billingFrequency || l.billingFrequency === 'one_time'
    );
    const recurringLines = quotation.lines.filter(
      (l) => l.billingFrequency && l.billingFrequency !== 'one_time'
    );

    // Mutable holder so TypeScript can track assignment inside the transaction callback
    const result: { oneTimeInvoice: Invoice | null; createdSubscriptions: Array<{ id: string; name: string }> } = {
      oneTimeInvoice: null,
      createdSubscriptions: [],
    };

    await prisma.$transaction(async (tx) => {
      // 1. Process One-Time Lines -> Create One-Time Invoice
      if (oneTimeLines.length > 0) {
        const existingOneTime = await tx.invoice.findFirst({
          where: {
            organizationId: orgId,
            quotationId,
            type: 'one_time',
          },
        });

        if (!existingOneTime) {
          const invoiceNumber = await generateOrgInvoiceNumber(tx, orgId, org.slug);
          const subtotal = oneTimeLines.reduce((sum, l) => sum + Number(l.subtotal), 0);
          const totalAmount = oneTimeLines.reduce((sum, l) => sum + Number(l.total), 0);
          const discountAmount = subtotal - totalAmount;

          const dueDate = new Date();
          dueDate.setDate(dueDate.getDate() + 14); // Net 14

          result.oneTimeInvoice = await tx.invoice.create({
            data: {
              organizationId: orgId,
              quotationId,
              invoiceNumber,
              type: 'one_time',
              status: 'issued',
              currency: org.currency,
              subtotal: new Prisma.Decimal(subtotal),
              discountAmount: new Prisma.Decimal(discountAmount),
              totalAmount: new Prisma.Decimal(totalAmount),
              dueDate,
              issuedAt: new Date(),
              notes: `One-time product charges for Quotation ${quotation.quotationNumber}`,
              lines: {
                create: oneTimeLines.map((l) => ({
                  quotationLineId: l.id,
                  productId: l.productId,
                  description: l.product.name,
                  quantity: l.quantity,
                  unitPrice: l.unitPrice,
                  discountPercent: l.lineDiscountPercent,
                  subtotal: l.subtotal,
                  totalAmount: l.total,
                })),
              },
            },
          });

          await tx.auditLog.create({
            data: {
              organizationId: orgId,
              entityType: 'quotation',
              entityId: quotationId,
              action: 'invoice_issued',
              reason: `Generated one-time invoice ${invoiceNumber} for ${oneTimeLines.length} item(s)`,
              metadata: {
                invoiceNumber,
                totalAmount,
                currency: org.currency,
                lineCount: oneTimeLines.length,
              },
            },
          });
        }
      }

      // 2. Process Recurring Lines -> Create Subscription Records
      if (recurringLines.length > 0) {
        const year = new Date().getFullYear();
        const subCount = await tx.subscription.count({ where: { organizationId: orgId } });

        for (let i = 0; i < recurringLines.length; i++) {
          const line = recurringLines[i]!;
          const existingSub = await tx.subscription.findFirst({
            where: { organizationId: orgId, quotationLineId: line.id },
          });

          if (!existingSub) {
            const seq = String(subCount + i + 1).padStart(4, '0');
            const subscriptionNumber = `${org.slug.toUpperCase().replace(/[^A-Z0-9]/g, '')}-SUB-${year}-${seq}`;

            const now = new Date();
            const periodEnd = new Date(now.getTime());
            if (line.billingFrequency === 'annual') {
              periodEnd.setFullYear(periodEnd.getFullYear() + 1);
            } else if (line.billingFrequency === 'quarterly') {
              periodEnd.setMonth(periodEnd.getMonth() + 3);
            } else {
              periodEnd.setMonth(periodEnd.getMonth() + 1);
            }
            periodEnd.setDate(periodEnd.getDate() - 1);
            periodEnd.setHours(23, 59, 59, 999);

            const nextBilling = new Date(periodEnd.getTime() + 1);

            const sub = await tx.subscription.create({
              data: {
                organizationId: orgId,
                quotationId,
                quotationLineId: line.id,
                productId: line.productId,
                customerId: quotation.customerId,
                subscriptionNumber,
                name: line.product.name,
                billingFrequency: line.billingFrequency || 'monthly',
                quantity: line.quantity,
                unitPrice: line.unitPrice,
                discountPercent: line.lineDiscountPercent,
                recurringAmount: line.total,
                currency: org.currency,
                status: 'active',
                startDate: now,
                currentPeriodStart: now,
                currentPeriodEnd: periodEnd,
                nextBillingDate: nextBilling,
              },
            });

            result.createdSubscriptions.push({ id: sub.id, name: sub.name });

            await tx.auditLog.create({
              data: {
                organizationId: orgId,
                entityType: 'quotation',
                entityId: quotationId,
                action: 'subscription_created',
                reason: `Created ${line.billingFrequency} subscription ${subscriptionNumber} for ${line.product.name}`,
                metadata: {
                  subscriptionId: sub.id,
                  subscriptionNumber,
                  billingFrequency: line.billingFrequency,
                  recurringAmount: Number(line.total),
                  currency: org.currency,
                },
              },
            });
          }
        }
      }
    });

    const oneTimeInvoice = result.oneTimeInvoice;
    const createdSubscriptions = result.createdSubscriptions;

    // 3. Enqueue BullMQ jobs to generate multi-period billing schedules for new subscriptions
    for (const sub of createdSubscriptions) {
      await billingScheduleQueue.add('generate_schedule', {
        orgId,
        quotationId,
        subscriptionId: sub.id,
      });
    }

    emitToOrg(orgId, 'billing:updated', {
      quotationId,
      action: 'order_split_confirmed',
      oneTimeLinesCount: oneTimeLines.length,
      recurringLinesCount: recurringLines.length,
    });

    // Send the branded invoice PDF to the customer (fire-and-forget: billing
    // must not fail because the mail server is down).
    if (result.oneTimeInvoice) {
      void this.emailInvoiceToCustomer(orgId, result.oneTimeInvoice.id).catch((err: any) =>
        logger.error({ orgId, invoiceId: result.oneTimeInvoice?.id, err: err.message }, 'Failed to email invoice to customer')
      );
    }

    logger.info(
      {
        orgId,
        quotationId,
        oneTimeLines: oneTimeLines.length,
        recurringLines: recurringLines.length,
      },
      'Order split completed successfully upon confirmation'
    );

    return {
      quotationId,
      oneTimeInvoice,
      subscriptionsCreated: createdSubscriptions.length,
    };
  }

  /** Get quotation billing summary (invoices, subscriptions, schedules) */
  async getQuotationBillingSummary(orgId: string, quotationId: string) {
    const [quotation, invoices, subscriptions, creditNotes] = await Promise.all([
      prisma.quotation.findFirst({
        where: { id: quotationId, organizationId: orgId },
        select: {
          id: true,
          quotationNumber: true,
          status: true,
          oneTimeTotal: true,
          recurringMonthlyTotal: true,
          recurringAnnualTotal: true,
          totalAmount: true,
          organization: { select: { currency: true, timezone: true } },
        },
      }),
      prisma.invoice.findMany({
        where: { organizationId: orgId, quotationId },
        include: {
          lines: true,
          payments: true,
        },
        orderBy: { issuedAt: 'desc' },
      }),
      prisma.subscription.findMany({
        where: { organizationId: orgId, quotationId },
        include: {
          product: { select: { name: true, sku: true } },
          schedules: { orderBy: { periodNumber: 'asc' } },
        },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.creditNote.findMany({
        where: { organizationId: orgId, quotationId },
        include: {
          invoice: { select: { invoiceNumber: true } },
          payments: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    if (!quotation) throw new HttpError(404, 'Quotation not found in this organization');

    return {
      quotation,
      invoices,
      subscriptions,
      creditNotes,
    };
  }

  /** List invoices for organization */
  async listInvoices(
    orgId: string,
    filters?: { quotationId?: string; status?: string; type?: string }
  ) {
    return prisma.invoice.findMany({
      where: {
        organizationId: orgId,
        ...(filters?.quotationId ? { quotationId: filters.quotationId } : {}),
        ...(filters?.status ? { status: filters.status } : {}),
        ...(filters?.type ? { type: filters.type } : {}),
      },
      include: {
        quotation: { select: { quotationNumber: true, customer: { select: { name: true, email: true } } } },
        subscription: { select: { subscriptionNumber: true, name: true } },
        lines: true,
        payments: true,
        surcharges: true,
      },
      orderBy: { issuedAt: 'desc' },
    });
  }

  /** Get single invoice details */
  async getInvoice(orgId: string, invoiceId: string) {
    const invoice = await prisma.invoice.findFirst({
      where: { id: invoiceId, organizationId: orgId },
      include: {
        quotation: {
          select: {
            id: true,
            quotationNumber: true,
            customer: true,
          },
        },
        subscription: true,
        lines: true,
        payments: true,
        creditNotes: true,
        surcharges: true,
      },
    });
    if (!invoice) throw new HttpError(404, 'Invoice not found in this organization');
    return invoice;
  }

  /**
   * Generate the branded invoice PDF (org logo top-left, full itemization,
   * surcharges) and email it to the customer.
   */
  async emailInvoiceToCustomer(orgId: string, invoiceId: string) {
    const { filesService } = await import('../files/files.service.js');
    const invoice = await prisma.invoice.findFirst({
      where: { id: invoiceId, organizationId: orgId },
      include: {
        organization: { select: { name: true } },
        quotation: { select: { customer: { select: { name: true, email: true } } } },
      },
    });
    if (!invoice) throw new HttpError(404, 'Invoice not found');

    const customerEmail = invoice.quotation?.customer?.email;
    if (!customerEmail) {
      logger.warn({ orgId, invoiceId }, 'Invoice has no customer email; skipping delivery');
      return { sent: false };
    }

    const { pdf } = await filesService.buildInvoicePdf(orgId, invoiceId);
    await sendInvoiceEmail({
      to: customerEmail,
      customerName: invoice.quotation?.customer?.name || 'Customer',
      orgName: invoice.organization.name,
      invoiceNumber: invoice.invoiceNumber,
      totalAmount: Number(invoice.totalAmount),
      currency: invoice.currency,
      dueDate: invoice.dueDate.toISOString().split('T')[0] as string,
      invoicePdf: pdf,
    });
    return { sent: true };
  }

  // ==================== INVOICE SURCHARGES (additional bills) ====================

  /**
   * Add an additional charge to an invoice, either as a percentage of the
   * subtotal or a fixed currency amount. Reps, Managers, Finance, and Org
   * Admins can add these. The invoice total is recalculated.
   */
  async addSurcharge(
    orgId: string,
    invoiceId: string,
    input: { label?: string; kind?: 'amount' | 'percent'; value?: number }
  ) {
    const label = (input.label ?? '').trim();
    const kind = input.kind ?? 'amount';
    const value = input.value ?? 0;
    if (!label) throw new HttpError(400, 'Surcharge label is required');

    const invoice = await prisma.invoice.findFirst({
      where: { id: invoiceId, organizationId: orgId },
      include: { surcharges: true },
    });
    if (!invoice) throw new HttpError(404, 'Invoice not found in this organization');
    if (invoice.status === 'void' || invoice.status === 'refunded') {
      throw new HttpError(400, `Cannot add charges to a ${invoice.status} invoice`);
    }
    if (kind === 'percent' && (value < 0 || value > 100)) {
      throw new HttpError(400, 'Percent surcharge must be between 0 and 100');
    }
    if (kind === 'amount' && value < 0) {
      throw new HttpError(400, 'Surcharge amount cannot be negative');
    }

    const subtotal = Number(invoice.subtotal);
    const discount = Number(invoice.discountAmount);
    const net = Math.max(0, subtotal - discount);
    const existingSurchargeTotal = invoice.surcharges.reduce(
      (sum, s) => sum + Number(s.computedAmount),
      0
    );
    const computedAmount =
      kind === 'percent' ? this.round2((net * value) / 100) : this.round2(value);

    const [, surcharge] = await prisma.$transaction([
      prisma.invoiceSurcharge.create({
        data: {
          organizationId: orgId,
          invoiceId,
          label,
          kind,
          value,
          computedAmount,
        },
      }),
      prisma.invoice.update({
        where: { id: invoiceId },
        data: {
          totalAmount: this.round2(net + existingSurchargeTotal + computedAmount),
        },
      }),
    ]);

    logger.info({ orgId, invoiceId, surchargeId: surcharge.id, kind: input.kind, value: input.value }, 'Invoice surcharge added');
    return surcharge;
  }

  /** Remove a surcharge and recalculate the invoice total. */
  async removeSurcharge(orgId: string, invoiceId: string, surchargeId: string) {
    const invoice = await prisma.invoice.findFirst({
      where: { id: invoiceId, organizationId: orgId },
      include: { surcharges: true },
    });
    if (!invoice) throw new HttpError(404, 'Invoice not found in this organization');

    const surcharge = invoice.surcharges.find((s) => s.id === surchargeId);
    if (!surcharge) throw new HttpError(404, 'Surcharge not found on this invoice');

    const subtotal = Number(invoice.subtotal);
    const discount = Number(invoice.discountAmount);
    const net = Math.max(0, subtotal - discount);
    const remainingSurchargeTotal = invoice.surcharges
      .filter((s) => s.id !== surchargeId)
      .reduce((sum, s) => sum + Number(s.computedAmount), 0);

    await prisma.$transaction([
      prisma.invoiceSurcharge.delete({ where: { id: surchargeId } }),
      prisma.invoice.update({
        where: { id: invoiceId },
        data: { totalAmount: this.round2(net + remainingSurchargeTotal) },
      }),
    ]);

    logger.info({ orgId, invoiceId, surchargeId }, 'Invoice surcharge removed');
    return { success: true };
  }

  /** List active subscriptions for organization */
  async listSubscriptions(orgId: string, filters?: { status?: string }) {
    return prisma.subscription.findMany({
      where: {
        organizationId: orgId,
        ...(filters?.status ? { status: filters.status } : {}),
      },
      include: {
        customer: { select: { id: true, name: true, email: true } },
        product: { select: { id: true, name: true, sku: true } },
        quotation: { select: { id: true, quotationNumber: true } },
        schedules: { orderBy: { periodNumber: 'asc' } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Get single subscription details */
  async getSubscription(orgId: string, subscriptionId: string) {
    const sub = await prisma.subscription.findFirst({
      where: { id: subscriptionId, organizationId: orgId },
      include: {
        customer: true,
        product: true,
        quotation: { select: { id: true, quotationNumber: true } },
        schedules: {
          orderBy: { periodNumber: 'asc' },
          include: { invoice: { select: { id: true, invoiceNumber: true, status: true, totalAmount: true } } },
        },
        invoices: { orderBy: { issuedAt: 'desc' } },
        creditNotes: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!sub) throw new HttpError(404, 'Subscription not found in this organization');
    return sub;
  }

  /** Preview mid-cycle subscription quantity change proration calculation */
  async previewProration(
    orgId: string,
    subscriptionId: string,
    newQuantity: number,
    effectiveDate?: Date
  ) {
    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { timezone: true, currency: true },
    });
    if (!org) throw new HttpError(404, 'Organization not found');

    const sub = await prisma.subscription.findFirst({
      where: { id: subscriptionId, organizationId: orgId },
      include: {
        product: { select: { name: true, sku: true } },
      },
    });
    if (!sub) throw new HttpError(404, 'Subscription not found in this organization');

    const now = effectiveDate || new Date();
    const result = calculateProration({
      currentQuantity: sub.quantity,
      newQuantity,
      unitPrice: Number(sub.unitPrice),
      discountPercent: Number(sub.discountPercent),
      cycleStart: sub.currentPeriodStart,
      cycleEnd: sub.currentPeriodEnd,
      effectiveDate: now,
      timezone: org.timezone || 'UTC',
    });

    return {
      subscriptionId: sub.id,
      subscriptionNumber: sub.subscriptionNumber,
      productName: sub.product.name,
      currency: org.currency,
      timezone: org.timezone,
      currentQuantity: sub.quantity,
      newQuantity,
      unitPrice: Number(sub.unitPrice),
      discountPercent: Number(sub.discountPercent),
      netUnitRate: result.netUnitRate,
      currentRecurringAmount: Number(sub.recurringAmount),
      newRecurringAmount: result.newRecurringAmount,
      totalCycleDays: result.totalCycleDays,
      remainingDays: result.remainingDays,
      proratedDelta: result.proratedDelta,
      action: result.action,
      creditAmount: result.creditAmount,
      adjustmentAmount: result.adjustmentAmount,
      cycleStart: sub.currentPeriodStart,
      cycleEnd: sub.currentPeriodEnd,
    };
  }

  /** Trigger mid-cycle quantity change and enqueue BullMQ proration job */
  async modifySubscriptionQuantity(
    orgId: string,
    subscriptionId: string,
    newQuantity: number,
    reason?: string,
    userCtx?: { userId?: string; email?: string; role?: string }
  ) {
    if (newQuantity <= 0) {
      throw new HttpError(400, 'Subscription quantity must be at least 1');
    }

    const sub = await prisma.subscription.findFirst({
      where: { id: subscriptionId, organizationId: orgId },
    });
    if (!sub) throw new HttpError(404, 'Subscription not found in this organization');

    if (sub.status !== 'active') {
      throw new HttpError(400, `Cannot modify subscription in ${sub.status} state`);
    }

    const job = await prorationQueue.add('modify_quantity', {
      orgId,
      subscriptionId,
      newQuantity,
      reason,
      requestedBy: userCtx ? { userId: userCtx.userId, email: userCtx.email, role: userCtx.role } : undefined,
    });

    return {
      jobId: job.id,
      subscriptionId,
      status: 'queued',
      message: `Proration job queued to change quantity to ${newQuantity}`,
    };
  }

  /** List credit notes */
  async listCreditNotes(
    orgId: string,
    filters?: { quotationId?: string; subscriptionId?: string; status?: string }
  ) {
    return prisma.creditNote.findMany({
      where: {
        organizationId: orgId,
        ...(filters?.quotationId ? { quotationId: filters.quotationId } : {}),
        ...(filters?.subscriptionId ? { subscriptionId: filters.subscriptionId } : {}),
        ...(filters?.status ? { status: filters.status } : {}),
      },
      include: {
        invoice: { select: { invoiceNumber: true, status: true, totalAmount: true } },
        subscription: { select: { subscriptionNumber: true, name: true } },
        quotation: { select: { quotationNumber: true } },
        payments: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Get single credit note */
  async getCreditNote(orgId: string, creditNoteId: string) {
    const cn = await prisma.creditNote.findFirst({
      where: { id: creditNoteId, organizationId: orgId },
      include: {
        invoice: true,
        subscription: true,
        quotation: true,
        payments: true,
      },
    });
    if (!cn) throw new HttpError(404, 'Credit note not found in this organization');
    return cn;
  }

  // ==================== SALES ACTIVITIES CSV EXPORT ====================

  async exportSalesActivitiesCsv(
    orgId: string,
    options?: { startDate?: string; endDate?: string; type?: string }
  ) {
    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { name: true, slug: true, currency: true },
    });
    if (!org) throw new HttpError(404, 'Organization not found');

    const start = options?.startDate ? new Date(options.startDate) : new Date(0);
    const end = options?.endDate ? new Date(new Date(options.endDate).setHours(23, 59, 59, 999)) : new Date(8640000000000000);

    const typeFilter = options?.type || 'all';

    const [invoices, subscriptions, creditNotes, payments, auditLogs] = await Promise.all([
      ['all', 'invoices'].includes(typeFilter)
        ? prisma.invoice.findMany({
            where: {
              organizationId: orgId,
              createdAt: { gte: start, lte: end },
            },
            include: {
              quotation: { select: { quotationNumber: true, customer: true } },
              surcharges: true,
            },
            orderBy: { createdAt: 'desc' },
          })
        : [],
      ['all', 'subscriptions'].includes(typeFilter)
        ? prisma.subscription.findMany({
            where: {
              organizationId: orgId,
              createdAt: { gte: start, lte: end },
            },
            include: {
              quotationLine: {
                include: {
                  quotation: { select: { quotationNumber: true, customer: true } },
                  product: { select: { name: true, sku: true } },
                },
              },
            },
            orderBy: { createdAt: 'desc' },
          })
        : [],
      ['all', 'credit_notes'].includes(typeFilter)
        ? prisma.creditNote.findMany({
            where: {
              organizationId: orgId,
              createdAt: { gte: start, lte: end },
            },
            include: {
              quotation: { select: { quotationNumber: true, customer: true } },
              invoice: { select: { invoiceNumber: true } },
            },
            orderBy: { createdAt: 'desc' },
          })
        : [],
      ['all', 'payments'].includes(typeFilter)
        ? prisma.payment.findMany({
            where: {
              organizationId: orgId,
              createdAt: { gte: start, lte: end },
            },
            include: {
              invoice: { select: { invoiceNumber: true, quotation: { select: { customer: true } } } },
            },
            orderBy: { createdAt: 'desc' },
          })
        : [],
      prisma.auditLog.findMany({
        where: {
          organizationId: orgId,
          createdAt: { gte: start, lte: end },
          OR: [
            { entityType: { in: ['invoice', 'subscription', 'credit_note', 'payment', 'billing'] } },
            { action: { in: ['invoice_issued', 'payment_received', 'subscription_created', 'proration_applied', 'credit_note_issued', 'refund_processed'] } },
          ],
        },
        orderBy: { createdAt: 'desc' },
        take: 500,
      }),
    ]);

    interface ActivityRow {
      timestamp: Date;
      category: string;
      activityType: string;
      refNumber: string;
      customerName: string;
      customerEmail: string;
      currency: string;
      subtotal: number;
      discountAmount: number;
      surchargeAmount: number;
      totalAmount: number;
      status: string;
      paymentMethod: string;
      notes: string;
    }

    const activities: ActivityRow[] = [];

    // 1. Invoices
    for (const inv of invoices) {
      const surchargeSum = inv.surcharges.reduce((s, c) => s + Number(c.computedAmount), 0);
      activities.push({
        timestamp: inv.issuedAt || inv.createdAt,
        category: 'Invoice',
        activityType: `Invoice ${inv.status.toUpperCase()}`,
        refNumber: inv.invoiceNumber,
        customerName: inv.quotation?.customer?.name || 'N/A',
        customerEmail: inv.quotation?.customer?.email || 'N/A',
        currency: inv.currency || org.currency,
        subtotal: Number(inv.subtotal),
        discountAmount: Number(inv.discountAmount),
        surchargeAmount: surchargeSum,
        totalAmount: Number(inv.totalAmount),
        status: inv.status,
        paymentMethod: inv.type.replace(/_/g, ' '),
        notes: inv.notes || '',
      });
    }

    // 2. Subscriptions
    for (const sub of subscriptions) {
      activities.push({
        timestamp: sub.createdAt,
        category: 'Subscription',
        activityType: 'Subscription Created / Activated',
        refNumber: sub.subscriptionNumber,
        customerName: sub.quotationLine?.quotation?.customer?.name || 'N/A',
        customerEmail: sub.quotationLine?.quotation?.customer?.email || 'N/A',
        currency: sub.currency || org.currency,
        subtotal: Number(sub.recurringAmount),
        discountAmount: 0,
        surchargeAmount: 0,
        totalAmount: Number(sub.recurringAmount),
        status: sub.status,
        paymentMethod: 'Subscription Recurring',
        notes: `${sub.name} (Qty: ${sub.quantity}, ${sub.billingFrequency})`,
      });
    }

    // 3. Credit Notes
    for (const cn of creditNotes) {
      activities.push({
        timestamp: cn.createdAt,
        category: 'Credit Note',
        activityType: `Credit Note ${cn.status.toUpperCase()}`,
        refNumber: cn.creditNoteNumber,
        customerName: cn.quotation?.customer?.name || 'N/A',
        customerEmail: cn.quotation?.customer?.email || 'N/A',
        currency: cn.currency || org.currency,
        subtotal: Number(cn.amount),
        discountAmount: 0,
        surchargeAmount: 0,
        totalAmount: -Number(cn.amount), // Credit note is a reduction/refund
        status: cn.status,
        paymentMethod: 'Account Credit',
        notes: cn.reason || '',
      });
    }

    // 4. Payments
    for (const pay of payments) {
      activities.push({
        timestamp: pay.createdAt,
        category: 'Payment',
        activityType: `Payment ${pay.status.toUpperCase()}`,
        refNumber: pay.transactionReference || pay.id,
        customerName: pay.invoice?.quotation?.customer?.name || 'N/A',
        customerEmail: pay.invoice?.quotation?.customer?.email || 'N/A',
        currency: pay.currency || org.currency,
        subtotal: Number(pay.amount),
        discountAmount: 0,
        surchargeAmount: 0,
        totalAmount: Number(pay.amount),
        status: pay.status,
        paymentMethod: pay.paymentMethod || 'sandbox',
        notes: pay.errorMessage || `Payment for invoice ${pay.invoice?.invoiceNumber || pay.invoiceId || ''}`,
      });
    }

    // Sort all activities in reverse chronological order
    activities.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    const escapeCsv = (val: unknown): string => {
      if (val === null || val === undefined) return '""';
      const str = String(val);
      if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return `"${str}"`;
    };

    const rows: string[] = [];

    rows.push(escapeCsv(`DEALFLOW360 - SALES & BILLING ACTIVITIES REPORT`));
    rows.push([
      escapeCsv('Organization:'),
      escapeCsv(org.name),
      escapeCsv('Date Range:'),
      escapeCsv(`${options?.startDate || 'Earliest'} to ${options?.endDate || 'Latest'}`),
      escapeCsv('Exported At:'),
      escapeCsv(new Date().toISOString()),
    ].join(','));
    rows.push('');

    const headers = [
      'Timestamp (ISO)',
      'Timestamp (Local)',
      'Category',
      'Activity Type',
      'Reference #',
      'Customer Name',
      'Customer Email',
      'Currency',
      'Subtotal',
      'Discount Amount',
      'Surcharge Amount',
      'Total Amount',
      'Status',
      'Payment Method',
      'Notes / Reason',
    ];
    rows.push(headers.map(escapeCsv).join(','));

    let totalRevenue = 0;

    for (const a of activities) {
      totalRevenue += a.totalAmount;
      rows.push(
        [
          a.timestamp.toISOString(),
          new Date(a.timestamp).toLocaleString(),
          a.category,
          a.activityType,
          a.refNumber,
          a.customerName,
          a.customerEmail,
          a.currency,
          a.subtotal.toFixed(2),
          a.discountAmount.toFixed(2),
          a.surchargeAmount.toFixed(2),
          a.totalAmount.toFixed(2),
          a.status,
          a.paymentMethod,
          a.notes,
        ]
          .map(escapeCsv)
          .join(',')
      );
    }

    rows.push('');
    rows.push([
      'TOTAL SALES & TRANSACTIONS',
      '',
      '',
      '',
      '',
      '',
      '',
      org.currency,
      '',
      '',
      '',
      totalRevenue.toFixed(2),
      '',
      '',
      '',
    ].map(escapeCsv).join(','));

    const startLabel = options?.startDate ? options.startDate.replace(/[^0-9]/g, '-') : 'all';
    const endLabel = options?.endDate ? options.endDate.replace(/[^0-9]/g, '-') : 'now';

    return {
      fileName: `sales-activities-${org.slug}-${startLabel}-to-${endLabel}.csv`,
      content: rows.join('\r\n'),
    };
  }
}

export const billingService = new BillingService();
