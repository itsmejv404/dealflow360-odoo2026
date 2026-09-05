import { Worker, type Job } from 'bullmq';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { emitToOrg } from '../../lib/socket.js';
import {
  bullRedisConnection,
  BILLING_SCHEDULE_QUEUE,
  PRORATION_QUEUE,
  billingScheduleQueue,
  prorationQueue,
  registerWorker,
  type BillingScheduleJobPayload,
  type ProrationJobPayload,
} from '../../lib/queue.js';
import { Prisma } from '@prisma/client';

/** Helper to add months or years to a date */
function addBillingPeriod(startDate: Date, frequency: string, periodIndex: number): { start: Date; end: Date; due: Date } {
  const start = new Date(startDate.getTime());
  const end = new Date(startDate.getTime());

  if (frequency === 'annual') {
    start.setFullYear(start.getFullYear() + periodIndex);
    end.setFullYear(end.getFullYear() + periodIndex + 1);
    end.setDate(end.getDate() - 1);
  } else if (frequency === 'quarterly') {
    start.setMonth(start.getMonth() + periodIndex * 3);
    end.setMonth(end.getMonth() + (periodIndex + 1) * 3);
    end.setDate(end.getDate() - 1);
  } else {
    // monthly default
    start.setMonth(start.getMonth() + periodIndex);
    end.setMonth(end.getMonth() + periodIndex + 1);
    end.setDate(end.getDate() - 1);
  }

  // End of day
  end.setHours(23, 59, 59, 999);

  // Due date = net 14 days from period start
  const due = new Date(start.getTime());
  due.setDate(due.getDate() + 14);

  return { start, end, due };
}

/** Generate sequential org-branded invoice number e.g. ORG-INV-2026-0001 */
export async function generateOrgInvoiceNumber(tx: Prisma.TransactionClient, orgId: string, orgSlug: string): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `${orgSlug.toUpperCase().replace(/[^A-Z0-9]/g, '')}-INV-${year}`;

  const count = await tx.invoice.count({
    where: { organizationId: orgId },
  });
  const seq = String(count + 1).padStart(4, '0');
  return `${prefix}-${seq}`;
}

/** Generate sequential org-branded credit note number e.g. ORG-CN-2026-0001 */
export async function generateOrgCreditNoteNumber(tx: Prisma.TransactionClient, orgId: string, orgSlug: string): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `${orgSlug.toUpperCase().replace(/[^A-Z0-9]/g, '')}-CN-${year}`;

  const count = await tx.creditNote.count({
    where: { organizationId: orgId },
  });
  const seq = String(count + 1).padStart(4, '0');
  return `${prefix}-${seq}`;
}

/** Compute calendar days difference in an organization's specific timezone */
export function getDaysDifferenceInTimezone(start: Date, end: Date, timezone: string): number {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone || 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const startStr = formatter.format(start);
    const endStr = formatter.format(end);
    const startDate = new Date(`${startStr}T00:00:00Z`);
    const endDate = new Date(`${endStr}T00:00:00Z`);
    const diffMs = endDate.getTime() - startDate.getTime();
    return Math.max(0, Math.round(diffMs / (1000 * 60 * 60 * 24)));
  } catch {
    return Math.max(0, Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)));
  }
}

/** Pure proration math calculation using org timezone */
export function calculateProration(params: {
  currentQuantity: number;
  newQuantity: number;
  unitPrice: number;
  discountPercent: number;
  cycleStart: Date;
  cycleEnd: Date;
  effectiveDate: Date;
  timezone: string;
}) {
  const { currentQuantity, newQuantity, unitPrice, discountPercent, cycleStart, cycleEnd, effectiveDate, timezone } = params;
  const totalCycleDays = Math.max(1, getDaysDifferenceInTimezone(cycleStart, cycleEnd, timezone));
  const remainingDays = Math.min(totalCycleDays, getDaysDifferenceInTimezone(effectiveDate, cycleEnd, timezone));

  const netUnitRate = unitPrice * (1 - discountPercent / 100);
  const deltaQty = newQuantity - currentQuantity;
  const proratedDelta = Number(((deltaQty * netUnitRate * remainingDays) / totalCycleDays).toFixed(2));
  const newRecurringAmount = Number((newQuantity * netUnitRate).toFixed(2));

  return {
    totalCycleDays,
    remainingDays,
    netUnitRate,
    deltaQty,
    proratedDelta,
    newRecurringAmount,
    action: proratedDelta < 0 ? ('credit_note' as const) : proratedDelta > 0 ? ('supplemental_invoice' as const) : ('no_change' as const),
    creditAmount: proratedDelta < 0 ? Math.abs(proratedDelta) : 0,
    adjustmentAmount: proratedDelta > 0 ? proratedDelta : 0,
  };
}

/** Worker for generating multi-period billing schedules */
export function startBillingScheduleWorker(): Worker<BillingScheduleJobPayload> {
  const worker = new Worker<BillingScheduleJobPayload>(
    BILLING_SCHEDULE_QUEUE,
    async (job: Job<BillingScheduleJobPayload>) => {
      const { orgId, quotationId, subscriptionId } = job.data;
      logger.info({ orgId, quotationId, subscriptionId, jobId: job.id }, 'Processing billing schedule job');

      const org = await prisma.organization.findUnique({
        where: { id: orgId },
        select: { id: true, name: true, slug: true, currency: true, timezone: true },
      });
      if (!org) {
        throw new Error(`Organization ${orgId} not found`);
      }

      const subscriptions = await prisma.subscription.findMany({
        where: {
          organizationId: orgId,
          quotationId,
          ...(subscriptionId ? { id: subscriptionId } : {}),
        },
        include: {
          product: { select: { id: true, name: true, sku: true } },
          customer: { select: { id: true, name: true, email: true } },
          schedules: { orderBy: { periodNumber: 'asc' } },
        },
      });

      if (subscriptions.length === 0) {
        logger.warn({ orgId, quotationId }, 'No subscriptions found for quotation');
        return { schedulesGenerated: 0 };
      }

      let totalSchedulesGenerated = 0;

      for (const sub of subscriptions) {
        // Skip if schedules already exist
        if (sub.schedules.length > 0) {
          logger.info({ subscriptionId: sub.id }, 'Billing schedules already exist, skipping');
          continue;
        }

        const frequency = sub.billingFrequency || 'monthly';
        const periodsCount = frequency === 'annual' ? 1 : frequency === 'quarterly' ? 4 : 12;

        await prisma.$transaction(async (tx) => {
          const scheduleRows: Prisma.BillingScheduleCreateManyInput[] = [];

          for (let p = 0; p < periodsCount; p++) {
            const { start, end, due } = addBillingPeriod(sub.startDate, frequency, p);
            scheduleRows.push({
              organizationId: orgId,
              quotationId,
              subscriptionId: sub.id,
              periodNumber: p + 1,
              periodStart: start,
              periodEnd: end,
              dueDate: due,
              expectedAmount: sub.recurringAmount,
              currency: org.currency,
              status: p === 0 ? 'invoiced' : 'pending',
            });
          }

          // Create all schedule periods
          await tx.billingSchedule.createMany({ data: scheduleRows });

          // Fetch period 1 schedule row
          const period1 = await tx.billingSchedule.findUnique({
            where: {
              organizationId_subscriptionId_periodNumber: {
                organizationId: orgId,
                subscriptionId: sub.id,
                periodNumber: 1,
              },
            },
          });

          if (!period1) throw new Error('Failed to create Period 1 schedule');

          // Generate Period 1 Subscription Invoice
          const invoiceNumber = await generateOrgInvoiceNumber(tx, orgId, org.slug);
          const invoice = await tx.invoice.create({
            data: {
              organizationId: orgId,
              quotationId,
              subscriptionId: sub.id,
              invoiceNumber,
              type: 'subscription_cycle',
              status: 'issued',
              currency: org.currency,
              subtotal: sub.recurringAmount,
              totalAmount: sub.recurringAmount,
              dueDate: period1.dueDate,
              issuedAt: new Date(),
              notes: `Subscription cycle 1 of ${periodsCount} (${frequency}) for ${sub.name}`,
              lines: {
                create: [
                  {
                    quotationLineId: sub.quotationLineId,
                    productId: sub.productId,
                    description: `${sub.name} — Period 1 (${period1.periodStart.toISOString().split('T')[0]} to ${period1.periodEnd.toISOString().split('T')[0]})`,
                    quantity: sub.quantity,
                    unitPrice: sub.unitPrice,
                    discountPercent: sub.discountPercent,
                    subtotal: new Prisma.Decimal(sub.quantity).mul(sub.unitPrice),
                    totalAmount: sub.recurringAmount,
                    periodStart: period1.periodStart,
                    periodEnd: period1.periodEnd,
                  },
                ],
              },
            },
          });

          // Link invoice to Period 1 schedule
          await tx.billingSchedule.update({
            where: { id: period1.id },
            data: { invoiceId: invoice.id, invoicedAt: new Date() },
          });

          // Update subscription boundaries
          const { start: p2Start } = addBillingPeriod(sub.startDate, frequency, 1);
          await tx.subscription.update({
            where: { id: sub.id },
            data: {
              currentPeriodStart: period1.periodStart,
              currentPeriodEnd: period1.periodEnd,
              nextBillingDate: p2Start,
            },
          });

          // Audit log
          await tx.auditLog.create({
            data: {
              organizationId: orgId,
              entityType: 'quotation',
              entityId: quotationId,
              action: 'billing_schedule_generated',
              reason: `Generated ${periodsCount}-period ${frequency} billing schedule and issued cycle invoice ${invoiceNumber}`,
              metadata: {
                subscriptionId: sub.id,
                invoiceNumber,
                periodsCount,
                recurringAmount: Number(sub.recurringAmount),
                currency: org.currency,
              },
            },
          });
        });

        totalSchedulesGenerated += periodsCount;
      }

      emitToOrg(orgId, 'billing:updated', {
        quotationId,
        subscriptionId,
        action: 'schedule_generated',
        totalSchedules: totalSchedulesGenerated,
      });

      logger.info({ orgId, quotationId, totalSchedulesGenerated }, 'Billing schedules generated successfully');
      return { schedulesGenerated: totalSchedulesGenerated };
    },
    {
      connection: bullRedisConnection,
      concurrency: 5,
    }
  );

  registerWorker(BILLING_SCHEDULE_QUEUE, 'Billing Schedule Engine', billingScheduleQueue, worker, 5);
  return worker;
}

/** Worker for mid-cycle subscription proration and credit note generation */
export function startProrationWorker(): Worker<ProrationJobPayload> {
  const worker = new Worker<ProrationJobPayload>(
    PRORATION_QUEUE,
    async (job: Job<ProrationJobPayload>) => {
      const { orgId, subscriptionId, newQuantity, effectiveDate, reason, requestedBy } = job.data;
      logger.info({ orgId, subscriptionId, newQuantity, jobId: job.id }, 'Processing subscription proration job');

      const org = await prisma.organization.findUnique({
        where: { id: orgId },
        select: { id: true, name: true, slug: true, currency: true, timezone: true },
      });
      if (!org) throw new Error(`Organization ${orgId} not found`);

      const sub = await prisma.subscription.findFirst({
        where: { id: subscriptionId, organizationId: orgId },
        include: {
          product: true,
          invoices: {
            where: { type: 'subscription_cycle' },
            orderBy: { issuedAt: 'desc' },
            take: 1,
          },
          schedules: {
            where: { status: 'pending' },
            orderBy: { periodNumber: 'asc' },
          },
        },
      });

      if (!sub) throw new Error(`Subscription ${subscriptionId} not found in org ${orgId}`);

      const oldQuantity = sub.quantity;
      if (oldQuantity === newQuantity) {
        logger.info({ subscriptionId, newQuantity }, 'Quantity unchanged, skipping proration');
        return { prorated: false };
      }

      const now = effectiveDate ? new Date(effectiveDate) : new Date();
      const cycleStart = sub.currentPeriodStart;
      const cycleEnd = sub.currentPeriodEnd;

      const {
        totalCycleDays,
        remainingDays,
        netUnitRate,
        deltaQty,
        proratedDelta,
        newRecurringAmount,
      } = calculateProration({
        currentQuantity: oldQuantity,
        newQuantity,
        unitPrice: Number(sub.unitPrice),
        discountPercent: Number(sub.discountPercent),
        cycleStart,
        cycleEnd,
        effectiveDate: now,
        timezone: org.timezone || 'UTC',
      });

      const latestCycleInvoice = sub.invoices[0];

      let creditNoteResult: { id: string; number: string; amount: number } | null = null;
      let adjustmentInvoiceResult: { id: string; number: string; amount: number } | null = null;

      await prisma.$transaction(async (tx) => {
        // 1. If reduction (proratedDelta < 0) -> Generate Credit Note
        if (proratedDelta < 0) {
          const creditAmount = Math.abs(proratedDelta);
          const creditNoteNumber = await generateOrgCreditNoteNumber(tx, orgId, org.slug);

          const cn = await tx.creditNote.create({
            data: {
              organizationId: orgId,
              creditNoteNumber,
              quotationId: sub.quotationId,
              subscriptionId: sub.id,
              invoiceId: latestCycleInvoice?.id ?? null,
              amount: new Prisma.Decimal(creditAmount),
              currency: org.currency,
              reason:
                reason ||
                `Mid-cycle quantity reduction from ${oldQuantity} to ${newQuantity} (${remainingDays}/${totalCycleDays} days remaining in cycle)`,
              status: 'issued',
            },
          });

          creditNoteResult = { id: cn.id, number: cn.creditNoteNumber, amount: creditAmount };
        } else if (proratedDelta > 0) {
          // 2. If expansion (proratedDelta > 0) -> Generate Proration Adjustment Invoice
          const adjustmentAmount = proratedDelta;
          const invoiceNumber = await generateOrgInvoiceNumber(tx, orgId, org.slug);

          const inv = await tx.invoice.create({
            data: {
              organizationId: orgId,
              quotationId: sub.quotationId,
              subscriptionId: sub.id,
              invoiceNumber,
              type: 'proration_adjustment',
              status: 'issued',
              currency: org.currency,
              subtotal: new Prisma.Decimal(adjustmentAmount),
              totalAmount: new Prisma.Decimal(adjustmentAmount),
              dueDate: new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000),
              issuedAt: new Date(),
              notes:
                reason ||
                `Mid-cycle quantity increase from ${oldQuantity} to ${newQuantity} (${remainingDays}/${totalCycleDays} days remaining in cycle)`,
              lines: {
                create: [
                  {
                    quotationLineId: sub.quotationLineId,
                    productId: sub.productId,
                    description: `${sub.name} — Proration Adjustment (+${deltaQty} seats for ${remainingDays} days)`,
                    quantity: deltaQty,
                    unitPrice: new Prisma.Decimal(netUnitRate),
                    discountPercent: new Prisma.Decimal(0),
                    subtotal: new Prisma.Decimal(adjustmentAmount),
                    totalAmount: new Prisma.Decimal(adjustmentAmount),
                    periodStart: now,
                    periodEnd: cycleEnd,
                  },
                ],
              },
            },
          });

          adjustmentInvoiceResult = { id: inv.id, number: inv.invoiceNumber, amount: adjustmentAmount };
        }

        // 3. Update subscription with new quantity and recurring amount
        await tx.subscription.update({
          where: { id: sub.id },
          data: {
            quantity: newQuantity,
            recurringAmount: new Prisma.Decimal(newRecurringAmount),
          },
        });

        // 4. Update all future pending billing schedules to the new recurring amount
        await tx.billingSchedule.updateMany({
          where: {
            organizationId: orgId,
            subscriptionId: sub.id,
            status: 'pending',
          },
          data: {
            expectedAmount: new Prisma.Decimal(newRecurringAmount),
          },
        });

        // 5. Audit log
        await tx.auditLog.create({
          data: {
            organizationId: orgId,
            entityType: 'quotation',
            entityId: sub.quotationId,
            userId: requestedBy?.userId,
            userEmail: requestedBy?.email,
            userRole: requestedBy?.role,
            action: 'subscription_prorated',
            reason:
              reason ||
              `Prorated subscription quantity ${oldQuantity} -> ${newQuantity}. Delta: ${proratedDelta >= 0 ? '+' : ''}${proratedDelta} ${org.currency}`,
            metadata: {
              subscriptionId: sub.id,
              oldQuantity,
              newQuantity,
              remainingDays,
              totalCycleDays,
              proratedDelta,
              creditNote: creditNoteResult,
              adjustmentInvoice: adjustmentInvoiceResult,
            },
          },
        });
      });

      emitToOrg(orgId, 'billing:prorated', {
        subscriptionId: sub.id,
        quotationId: sub.quotationId,
        oldQuantity,
        newQuantity,
        proratedDelta,
        creditNote: creditNoteResult,
        adjustmentInvoice: adjustmentInvoiceResult,
      });

      logger.info(
        { orgId, subscriptionId: sub.id, oldQuantity, newQuantity, proratedDelta },
        'Proration job completed successfully'
      );

      return {
        prorated: true,
        oldQuantity,
        newQuantity,
        proratedDelta,
        creditNote: creditNoteResult,
        adjustmentInvoice: adjustmentInvoiceResult,
      };
    },
    {
      connection: bullRedisConnection,
      concurrency: 5,
    }
  );

  registerWorker(PRORATION_QUEUE, 'Mid-Cycle Subscription Proration', prorationQueue, worker, 5);
  return worker;
}
