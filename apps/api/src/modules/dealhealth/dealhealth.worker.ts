import { Worker, type Job } from 'bullmq';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { emitToOrg } from '../../lib/socket.js';
import {
  bullRedisConnection,
  DEAL_HEALTH_SCAN_QUEUE,
  dealHealthScanQueue,
  registerWorker,
  type DealHealthScanJobPayload,
} from '../../lib/queue.js';
import { getDaysDifferenceInTimezone } from '../billing/billing.worker.js';

/** Days of inactivity before a quote counts as stalled (Phase 21 spec default). */
const STALLED_DAYS_THRESHOLD = 7;
/** Rep's discount must exceed this multiple of their own historical average to flag an anomaly. */
const ANOMALY_MULTIPLIER = 1.5;
/** ...and the absolute discount must exceed this percent to be meaningful. */
const ANOMALY_FLOOR_PERCENT = 5;

interface CreatedAlert {
  id: string;
  alertType: string;
  quotationId: string | null;
  title: string;
}

/** Upsert-with-dedup: one open/nudged/escalated alert per (org, type, quotation/rep). */
async function upsertAlert(data: {
  organizationId: string;
  alertType: string;
  quotationId?: string | null;
  repId?: string | null;
  severity: string;
  title: string;
  detail: string;
  metadata?: Record<string, unknown>;
}): Promise<CreatedAlert | null> {
  const existing = await prisma.dealHealthAlert.findFirst({
    where: {
      organizationId: data.organizationId,
      alertType: data.alertType,
      quotationId: data.quotationId ?? null,
      status: { in: ['open', 'nudged', 'escalated'] },
    },
  });
  if (existing) {
    // Refresh detail/metadata but don't spam duplicate alerts
    await prisma.dealHealthAlert.update({
      where: { id: existing.id },
      data: { detail: data.detail, metadata: (data.metadata ?? undefined) as any },
    });
    return null;
  }
  const alert = await prisma.dealHealthAlert.create({
    data: {
      organizationId: data.organizationId,
      alertType: data.alertType,
      quotationId: data.quotationId ?? null,
      repId: data.repId ?? null,
      severity: data.severity,
      title: data.title,
      detail: data.detail,
      metadata: (data.metadata ?? undefined) as any,
    },
  });
  return { id: alert.id, alertType: alert.alertType, quotationId: alert.quotationId, title: alert.title };
}

/**
 * Deal Health scan for one organization (payload carries org_id — never globals).
 * 1. Stalled quotes: draft/pending/negotiating quotes inactive > N days (org timezone).
 * 2. Discount anomalies: rep's current quote discount vs. their own historical average.
 * 3. Delivery slippage: approved/confirmed quotes whose fulfillment plan is still unaccepted
 *    after N days, or with pending backorders.
 */
export async function runDealHealthScanForOrg(orgId: string): Promise<{ alertsCreated: number; alerts: CreatedAlert[] }> {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { id: true, name: true, timezone: true, status: true },
  });
  if (!org) throw new Error(`Organization ${orgId} not found`);
  if (org.status !== 'active') {
    logger.info({ orgId }, 'Organization suspended — skipping deal health scan');
    return { alertsCreated: 0, alerts: [] };
  }

  const tz = org.timezone || 'UTC';
  const now = new Date();
  const created: CreatedAlert[] = [];

  // ---------- 1. Stalled quotes ----------
  const activeStatuses = ['draft', 'pending_approval', 'sent', 'negotiating'];
  const candidates = await prisma.quotation.findMany({
    where: { organizationId: orgId, status: { in: activeStatuses } },
    select: {
      id: true,
      quotationNumber: true,
      status: true,
      updatedAt: true,
      totalAmount: true,
      rep: { select: { id: true, name: true, email: true } },
      customer: { select: { name: true } },
    },
  });

  for (const q of candidates) {
    const inactiveDays = getDaysDifferenceInTimezone(q.updatedAt, now, tz);
    if (inactiveDays <= STALLED_DAYS_THRESHOLD) continue;

    const severity = inactiveDays > STALLED_DAYS_THRESHOLD * 2 ? 'high' : 'medium';
    const alert = await upsertAlert({
      organizationId: orgId,
      alertType: 'stalled_quote',
      quotationId: q.id,
      repId: q.rep?.id ?? null,
      severity,
      title: `Quotation ${q.quotationNumber} stalled for ${inactiveDays} days`,
      detail: `Quote for customer "${q.customer?.name || 'N/A'}" (${q.status}) has had no activity for ${inactiveDays} days (evaluated in ${tz}). Total: ${Number(q.totalAmount).toFixed(2)}.`,
      metadata: { inactiveDays, status: q.status, timezone: tz, totalAmount: Number(q.totalAmount) },
    });
    if (alert) created.push(alert);
  }

  // ---------- 2. Discount anomalies ----------
  // Rep's recent quotes (last 14 days) vs. that rep's historical average (all older quotes).
  const recentSince = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
  const repIds = [...new Set(candidates.map((q) => q.rep?.id).filter((v): v is string => Boolean(v)))];

  for (const repId of repIds) {
    const rep = candidates.find((q) => q.rep?.id === repId)?.rep;

    const history = await prisma.quotation.aggregate({
      where: { organizationId: orgId, repId, updatedAt: { lt: recentSince } },
      _avg: { totalDiscount: true, totalAmount: true },
      _count: true,
    });
    if (!history._count || history._count < 3 || !history._avg.totalAmount) continue;

    const histAvgDiscountPct =
      Number(history._avg.totalDiscount ?? 0) / Number(history._avg.totalAmount) * 100;

    const recent = await prisma.quotation.findMany({
      where: { organizationId: orgId, repId, updatedAt: { gte: recentSince } },
      select: { id: true, quotationNumber: true, totalDiscount: true, totalAmount: true },
    });

    for (const q of recent) {
      if (!q.totalAmount || Number(q.totalAmount) <= 0) continue;
      const discountPct = (Number(q.totalDiscount) / Number(q.totalAmount)) * 100;
      const isAnomaly =
        histAvgDiscountPct > 0 &&
        discountPct >= ANOMALY_FLOOR_PERCENT &&
        discountPct > histAvgDiscountPct * ANOMALY_MULTIPLIER;
      if (!isAnomaly) continue;

      const alert = await upsertAlert({
        organizationId: orgId,
        alertType: 'discount_anomaly',
        quotationId: q.id,
        repId,
        severity: 'high',
        title: `Discount anomaly on ${q.quotationNumber} (${discountPct.toFixed(1)}% vs ${histAvgDiscountPct.toFixed(1)}% avg)`,
        detail: `Rep ${rep?.name || repId} is discounting at ${discountPct.toFixed(1)}% on quotation ${q.quotationNumber}, which is ${(discountPct / histAvgDiscountPct).toFixed(1)}× their own historical average of ${histAvgDiscountPct.toFixed(1)}%.`,
        metadata: {
          currentDiscountPercent: Number(discountPct.toFixed(2)),
          historicalAveragePercent: Number(histAvgDiscountPct.toFixed(2)),
          multiplier: ANOMALY_MULTIPLIER,
          repId,
        },
      });
      if (alert) created.push(alert);
    }
  }

  // ---------- 3. Delivery slippage ----------
  const slipped = await prisma.fulfillmentPlan.findMany({
    where: {
      organizationId: orgId,
      status: 'proposed',
      proposedAt: { lt: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000) },
    },
    select: {
      id: true,
      quotationId: true,
      proposedAt: true,
      quotation: { select: { quotationNumber: true } },
    },
  });
  for (const plan of slipped) {
    const daysWaiting = getDaysDifferenceInTimezone(plan.proposedAt, now, tz);
    const alert = await upsertAlert({
      organizationId: orgId,
      alertType: 'delivery_slippage',
      quotationId: plan.quotationId,
      severity: 'medium',
      title: `Fulfillment plan pending Ops acceptance for ${daysWaiting} days`,
      detail: `Quotation ${plan.quotation?.quotationNumber || plan.quotationId} has an unaccepted fulfillment split proposed on ${plan.proposedAt.toISOString().split('T')[0]} — delivery is slipping.`,
      metadata: { planId: plan.id, daysWaiting, timezone: tz },
    });
    if (alert) created.push(alert);
  }

  if (created.length > 0) {
    emitToOrg(orgId, 'dealhealth:alerts', {
      orgId,
      newAlertCount: created.length,
      alerts: created,
    });
  }

  return { alertsCreated: created.length, alerts: created };
}

/** Worker entry — processes enqueued scans (and can be triggered on demand from the API). */
export function startDealHealthWorker(): Worker<DealHealthScanJobPayload> {
  const worker = new Worker<DealHealthScanJobPayload>(
    DEAL_HEALTH_SCAN_QUEUE,
    async (job: Job<DealHealthScanJobPayload>) => {
      const { orgId } = job.data;
      logger.info({ orgId, jobId: job.id }, 'Processing deal health scan job');
      const result = await runDealHealthScanForOrg(orgId);
      logger.info({ orgId, created: result.alertsCreated }, 'Deal health scan completed');
      return { alertsCreated: result.alertsCreated };
    },
    { connection: bullRedisConnection, concurrency: 5 }
  );

  registerWorker(DEAL_HEALTH_SCAN_QUEUE, 'Deal Health Scanner', dealHealthScanQueue, worker, 5);
  return worker;
}

/** Kick off scans for all active orgs (used by the scheduler). */
export async function enqueueScansForAllOrgs(): Promise<number> {
  const orgs = await prisma.organization.findMany({
    where: { status: 'active' },
    select: { id: true },
  });
  for (const org of orgs) {
    await dealHealthScanQueue.add('scan_org', { orgId: org.id });
  }
  return orgs.length;
}
