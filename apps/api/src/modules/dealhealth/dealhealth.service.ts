import { prisma } from '../../lib/prisma.js';
import { emitToOrg } from '../../lib/socket.js';
import { HttpError } from '../../shared/errors.js';
import { sendDealHealthNudgeEmail } from '../../lib/deal-health-mailer.js';
import { redis } from '../../lib/redis.js';
import { logger } from '../../lib/logger.js';

export class DealHealthService {
  /**
   * List alerts for organization (tenant-scoped).
   * With `refresh` set, any org-namespaced deal-health cache entries are cleared
   * first so the read always reflects fresh data. Scans themselves run
   * automatically on the 6-hour schedule — there is no manual trigger.
   */
  async listAlerts(orgId: string, filters?: { status?: string; alertType?: string; refresh?: boolean }) {
    if (filters?.refresh) {
      try {
        const keys = await redis.keys(`org:${orgId}:dealhealth:*`);
        if (keys.length > 0) {
          await redis.del(...keys);
          logger.info({ orgId, cleared: keys.length }, 'Cleared deal health cache on refresh');
        }
      } catch {
        // Cache clearing is best-effort; fall through to a fresh DB read
      }
    }
    return prisma.dealHealthAlert.findMany({
      where: {
        organizationId: orgId,
        ...(filters?.status ? { status: filters.status } : {}),
        ...(filters?.alertType ? { alertType: filters.alertType } : {}),
      },
      include: {
        quotation: {
          select: { id: true, quotationNumber: true, status: true, totalAmount: true, customerId: true },
        },
        rep: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  /** Get a single alert — tenant check enforced by the compound where */
  async getAlert(orgId: string, alertId: string) {
    const alert = await prisma.dealHealthAlert.findFirst({
      where: { id: alertId, organizationId: orgId },
      include: {
        quotation: { select: { id: true, quotationNumber: true, status: true } },
        rep: { select: { id: true, name: true, email: true } },
      },
    });
    if (!alert) throw new HttpError(404, 'Alert not found in this organization');
    return alert;
  }

  /** Send a nudge email for an alert (rep by default; escalation goes to managers + admin) */
  async nudgeAlert(
    orgId: string,
    alertId: string,
    opts: { escalate?: boolean; userCtx?: { userId?: string; email?: string; role?: string } }
  ) {
    const alert = await this.getAlert(orgId, alertId);

    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { id: true, name: true },
    });
    if (!org) throw new HttpError(404, 'Organization not found');

    let recipients: string[] = [];
    if (alert.repId && alert.rep?.email) {
      recipients.push(alert.rep.email);
    }
    if (opts.escalate) {
      // Escalations also go to managers and org admins of this org
      const managers = await prisma.user.findMany({
        where: { organizationId: orgId, role: { in: ['manager', 'org_admin'] }, status: 'active' },
        select: { email: true },
      });
      recipients = [...new Set([...recipients, ...managers.map((m) => m.email)])];
    }
    if (recipients.length === 0) {
      throw new HttpError(400, 'No recipients available for this alert (no assigned rep)');
    }

    await sendDealHealthNudgeEmail({
      to: recipients,
      orgName: org.name,
      alertTitle: alert.title,
      alertDetail: alert.detail,
      alertType: alert.alertType,
      severity: alert.severity,
      quotationNumber: alert.quotation?.quotationNumber ?? undefined,
      quotationId: alert.quotationId ?? undefined,
      repName: alert.rep?.name ?? undefined,
      escalate: opts.escalate,
    });

    const updated = await prisma.dealHealthAlert.update({
      where: { id: alert.id },
      data: {
        status: opts.escalate ? 'escalated' : 'nudged',
        ...(opts.escalate ? { escalatedAt: new Date() } : { nudgedAt: new Date() }),
      },
    });

    await prisma.auditLog.create({
      data: {
        organizationId: orgId,
        entityType: 'deal_health_alert',
        entityId: alert.id,
        userId: opts.userCtx?.userId,
        userEmail: opts.userCtx?.email,
        userRole: opts.userCtx?.role,
        action: opts.escalate ? 'alert_escalated' : 'alert_nudged',
        reason: `${opts.escalate ? 'Escalation' : 'Nudge'} sent to: ${recipients.join(', ')}`,
        metadata: { alertType: alert.alertType, quotationId: alert.quotationId },
      },
    });

    emitToOrg(orgId, 'dealhealth:updated', { alertId: alert.id, status: updated.status });

    return { alert: updated, recipients };
  }

  /** Resolve an alert */
  async resolveAlert(orgId: string, alertId: string, userCtx?: { userId?: string; email?: string; role?: string }) {
    const alert = await this.getAlert(orgId, alertId);
    const updated = await prisma.dealHealthAlert.update({
      where: { id: alert.id },
      data: { status: 'resolved', resolvedAt: new Date() },
    });
    await prisma.auditLog.create({
      data: {
        organizationId: orgId,
        entityType: 'deal_health_alert',
        entityId: alert.id,
        userId: userCtx?.userId,
        userEmail: userCtx?.email,
        userRole: userCtx?.role,
        action: 'alert_resolved',
        reason: 'Alert marked resolved',
      },
    });
    emitToOrg(orgId, 'dealhealth:updated', { alertId: alert.id, status: 'resolved' });
    return updated;
  }

  /** Dashboard summary counts for the workspace home */
  async getSummary(orgId: string) {
    const alerts = await prisma.dealHealthAlert.groupBy({
      by: ['alertType', 'status'],
      where: { organizationId: orgId },
      _count: true,
    });
    const open = await prisma.dealHealthAlert.count({
      where: { organizationId: orgId, status: { in: ['open', 'nudged', 'escalated'] } },
    });
    return { open, breakdown: alerts };
  }
}

export const dealHealthService = new DealHealthService();
