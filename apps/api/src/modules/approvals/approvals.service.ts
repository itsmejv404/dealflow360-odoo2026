import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { HttpError } from '../../shared/errors.js';
import { governanceService, type EvaluateRiskLineInput } from '../governance/governance.service.js';
import { approvalNotificationQueue } from '../../lib/queue.js';
import { emitToOrg, emitToQuote } from '../../lib/socket.js';
import { logger } from '../../lib/logger.js';

export interface ApproverActionInput {
  reason: string;
}

export interface EditAndApproveInput {
  reason: string;
  orderDiscountPercent?: number;
  lines: Array<{
    productId: string;
    quantity: number;
    unitPrice?: number;
    lineDiscountPercent?: number;
    billingFrequency?: string;
  }>;
}

export interface UserContext {
  userId: string;
  email: string;
  role: string;
  name?: string | null;
}

export class ApprovalsService {
  /**
   * Log an immutable audit entry
   */
  async logAudit(
    orgId: string,
    params: {
      entityType: 'quotation' | 'rulebook' | 'user' | 'organization';
      entityId: string;
      user?: UserContext | null;
      action:
        | 'created'
        | 'updated'
        | 'deleted'
        | 'submitted_for_approval'
        | 'manager_approved'
        | 'finance_escalated'
        | 'finance_approved'
        | 'rejected'
        | 'edited'
        | 'auto_approved'
        | 'sent_to_customer'
        | 'customer_commented'
        | 'change_requested'
        | 'counter_proposed'
        | 'counter_accepted'
        | 'counter_declined'
        | 'change_request_accepted'
        | 'change_request_declined'
        | 'customer_confirmed'
        | 'reentered_approval';
      reason?: string | null;
      metadata?: any;
    }
  ) {
    return prisma.auditLog.create({
      data: {
        organizationId: orgId,
        entityType: params.entityType,
        entityId: params.entityId,
        userId: params.user?.userId || null,
        userEmail: params.user?.email || null,
        userRole: params.user?.role || null,
        action: params.action,
        reason: params.reason || null,
        metadata: params.metadata || Prisma.JsonNull,
      },
    });
  }

  /**
   * Submit a quotation for review / approval
   */
  async submitForApproval(orgId: string, quotationId: string, user: UserContext, notes?: string) {
    const quote = await prisma.quotation.findFirst({
      where: { id: quotationId, organizationId: orgId },
      include: {
        lines: true,
        customer: true,
        tier: true,
        rep: true,
      },
    });

    if (!quote) {
      throw new HttpError(404, 'Quotation not found');
    }

    if (quote.status === 'approved') {
      throw new HttpError(400, 'Quotation is already approved');
    }

    // Re-evaluate risk score using governance engine
    const riskInput: EvaluateRiskLineInput[] = quote.lines.map((l) => ({
      productId: l.productId,
      categoryId: l.categoryId,
      quantity: l.quantity,
      unitPrice: Number(l.unitPrice),
      lineDiscountPercent: Number(l.lineDiscountPercent),
      subtotal: Number(l.subtotal),
      total: Number(l.total),
    }));

    const riskEval = await governanceService.calculateRiskScore(
      orgId,
      quote.tierId,
      riskInput,
      Number(quote.orderDiscountPercent)
    );

    // Save evaluated risk score & approval routing
    await prisma.quotation.update({
      where: { id: quotationId },
      data: {
        riskScore: riskEval.riskScore,
        riskLevel: riskEval.riskLevel,
        approvalRouting: riskEval.approvalRouting,
        riskDetails: riskEval as any,
      },
    });

    // Check if auto-approved
    if (riskEval.approvalRouting === 'none') {
      const updated = await prisma.quotation.update({
        where: { id: quotationId },
        data: { status: 'approved' },
      });

      await this.logAudit(orgId, {
        entityType: 'quotation',
        entityId: quotationId,
        user,
        action: 'auto_approved',
        reason: notes || 'Quotation complies with all discount ceilings. Auto-approved.',
        metadata: { riskScore: riskEval.riskScore, riskLevel: riskEval.riskLevel },
      });

      emitToOrg(orgId, 'quote:status_changed', {
        quotationId,
        status: 'approved',
        quotationNumber: quote.quotationNumber,
      });
      emitToQuote(orgId, quotationId, 'quote:status_changed', {
        quotationId,
        status: 'approved',
        quotationNumber: quote.quotationNumber,
      });

      return {
        quotation: updated,
        status: 'approved',
        message: 'Quotation complies with rulebook discount ceilings and was automatically approved.',
        riskEvaluation: riskEval,
      };
    }

    // Otherwise mark as pending_approval and route to stage 'manager'
    const [updatedQuote, request] = await prisma.$transaction([
      prisma.quotation.update({
        where: { id: quotationId },
        data: { status: 'pending_approval' },
      }),
      prisma.approvalRequest.create({
        data: {
          organizationId: orgId,
          quotationId,
          stage: 'manager',
          status: 'pending',
          assignedRole: 'manager',
          requestedById: user.userId,
          reason: notes || riskEval.routingReason,
        },
      }),
    ]);

    await this.logAudit(orgId, {
      entityType: 'quotation',
      entityId: quotationId,
      user,
      action: 'submitted_for_approval',
      reason: notes || riskEval.routingReason,
      metadata: {
        riskScore: riskEval.riskScore,
        riskLevel: riskEval.riskLevel,
        approvalRouting: riskEval.approvalRouting,
      },
    });

    // Lookup managers in this organization to dispatch emails
    const managers = await prisma.user.findMany({
      where: {
        organizationId: orgId,
        role: { in: ['manager', 'org_admin'] },
        status: 'active',
      },
      select: { email: true },
    });

    const recipientEmails = managers.map((m) => m.email);

    if (recipientEmails.length > 0) {
      await approvalNotificationQueue.add('manager_review_notification', {
        orgId,
        type: 'manager_review_requested',
        quotationId,
        quotationNumber: quote.quotationNumber,
        customerName: quote.customer?.name,
        requestedByEmail: user.email,
        requestedByName: user.name || user.email,
        riskScore: riskEval.riskScore,
        riskLevel: riskEval.riskLevel,
        recipients: recipientEmails,
      });
    }

    // Realtime notifications
    emitToOrg(orgId, 'approvals:updated', { orgId, quotationId, action: 'submitted' });
    emitToOrg(orgId, 'quote:status_changed', {
      quotationId,
      status: 'pending_approval',
      stage: 'manager',
      quotationNumber: quote.quotationNumber,
    });
    emitToQuote(orgId, quotationId, 'quote:status_changed', {
      quotationId,
      status: 'pending_approval',
      stage: 'manager',
      quotationNumber: quote.quotationNumber,
    });

    return {
      quotation: updatedQuote,
      approvalRequest: request,
      status: 'pending_approval',
      stage: 'manager',
      riskEvaluation: riskEval,
    };
  }

  /**
   * Approve a quotation (Manager or Finance)
   */
  async approveQuotation(orgId: string, quotationId: string, user: UserContext, input: ApproverActionInput) {
    if (!input.reason || !input.reason.trim()) {
      throw new HttpError(400, 'A mandatory reason is required to approve quotation terms.');
    }

    const quote = await prisma.quotation.findFirst({
      where: { id: quotationId, organizationId: orgId },
      include: {
        customer: true,
        rep: true,
        approvalRequests: {
          where: { status: 'pending' },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!quote) {
      throw new HttpError(404, 'Quotation not found');
    }

    if (quote.status !== 'pending_approval') {
      throw new HttpError(400, `Cannot approve quotation in '${quote.status}' status`);
    }

    const pendingRequest = quote.approvalRequests[0];
    if (!pendingRequest) {
      throw new HttpError(400, 'No active pending approval request found for this quotation');
    }

    // Validate approver role matches stage
    if (pendingRequest.stage === 'manager' && !['manager', 'org_admin'].includes(user.role)) {
      throw new HttpError(403, 'Only Sales Managers or Org Admins can approve manager-stage requests');
    }

    if (pendingRequest.stage === 'finance' && !['finance', 'org_admin'].includes(user.role)) {
      throw new HttpError(403, 'Only Finance Approvers or Org Admins can approve finance-stage requests');
    }

    // Check if Manager approval triggers escalation to Finance
    if (pendingRequest.stage === 'manager' && quote.approvalRouting === 'manager_finance') {
      // Transition current request to escalated, create finance request
      await prisma.$transaction([
        prisma.approvalRequest.update({
          where: { id: pendingRequest.id },
          data: {
            status: 'escalated',
            actionedById: user.userId,
            actionedAt: new Date(),
            reason: input.reason.trim(),
          },
        }),
        prisma.approvalRequest.create({
          data: {
            organizationId: orgId,
            quotationId,
            stage: 'finance',
            status: 'pending',
            assignedRole: 'finance',
            requestedById: user.userId,
            reason: `Escalated from Manager (${user.name || user.email}): ${input.reason.trim()}`,
          },
        }),
      ]);

      await this.logAudit(orgId, {
        entityType: 'quotation',
        entityId: quotationId,
        user,
        action: 'finance_escalated',
        reason: input.reason.trim(),
        metadata: {
          previousStage: 'manager',
          nextStage: 'finance',
          riskScore: Number(quote.riskScore),
        },
      });

      // Dispatch escalation email to Finance users
      const financeUsers = await prisma.user.findMany({
        where: {
          organizationId: orgId,
          role: { in: ['finance', 'org_admin'] },
          status: 'active',
        },
        select: { email: true },
      });

      const recipientEmails = financeUsers.map((f) => f.email);
      if (recipientEmails.length > 0) {
        await approvalNotificationQueue.add('finance_escalation_notification', {
          orgId,
          type: 'finance_escalation_requested',
          quotationId,
          quotationNumber: quote.quotationNumber,
          customerName: quote.customer?.name,
          requestedByEmail: user.email,
          requestedByName: user.name || user.email,
          riskScore: Number(quote.riskScore),
          riskLevel: quote.riskLevel,
          recipients: recipientEmails,
        });
      }

      emitToOrg(orgId, 'approvals:updated', { orgId, quotationId, action: 'escalated' });
      emitToOrg(orgId, 'quote:status_changed', {
        quotationId,
        status: 'pending_approval',
        stage: 'finance',
        quotationNumber: quote.quotationNumber,
      });
      emitToQuote(orgId, quotationId, 'quote:status_changed', {
        quotationId,
        status: 'pending_approval',
        stage: 'finance',
        quotationNumber: quote.quotationNumber,
      });

      return {
        status: 'pending_approval',
        stage: 'finance',
        message: 'Sales Manager approved. Quotation escalated to Finance for final approval.',
      };
    }

    // Final Approval (either Manager-only chain, or Finance stage approval)
    const auditAction = pendingRequest.stage === 'finance' ? 'finance_approved' : 'manager_approved';

    await prisma.$transaction([
      prisma.quotation.update({
        where: { id: quotationId },
        data: { status: 'approved' },
      }),
      prisma.approvalRequest.update({
        where: { id: pendingRequest.id },
        data: {
          status: 'approved',
          actionedById: user.userId,
          actionedAt: new Date(),
          reason: input.reason.trim(),
        },
      }),
    ]);

    await this.logAudit(orgId, {
      entityType: 'quotation',
      entityId: quotationId,
      user,
      action: auditAction,
      reason: input.reason.trim(),
      metadata: { stage: pendingRequest.stage, riskScore: Number(quote.riskScore) },
    });

    // Notify Rep via email
    if (quote.rep?.email) {
      await approvalNotificationQueue.add('decision_notification', {
        orgId,
        type: 'decision_rendered',
        quotationId,
        quotationNumber: quote.quotationNumber,
        customerName: quote.customer?.name,
        decision: 'approved',
        reason: input.reason.trim(),
        requestedByName: quote.rep.name || quote.rep.email,
        recipients: [quote.rep.email],
      });
    }

    emitToOrg(orgId, 'approvals:updated', { orgId, quotationId, action: 'approved' });
    emitToOrg(orgId, 'quote:status_changed', {
      quotationId,
      status: 'approved',
      quotationNumber: quote.quotationNumber,
    });
    emitToQuote(orgId, quotationId, 'quote:status_changed', {
      quotationId,
      status: 'approved',
      quotationNumber: quote.quotationNumber,
    });

    return {
      status: 'approved',
      message: `Quotation approved successfully at ${pendingRequest.stage} stage.`,
    };
  }

  /**
   * Reject a quotation
   */
  async rejectQuotation(orgId: string, quotationId: string, user: UserContext, input: ApproverActionInput) {
    if (!input.reason || !input.reason.trim()) {
      throw new HttpError(400, 'A mandatory reason is required to reject a quotation.');
    }

    const quote = await prisma.quotation.findFirst({
      where: { id: quotationId, organizationId: orgId },
      include: {
        rep: true,
        customer: true,
        approvalRequests: {
          where: { status: 'pending' },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!quote) {
      throw new HttpError(404, 'Quotation not found');
    }

    if (quote.status !== 'pending_approval') {
      throw new HttpError(400, `Cannot reject quotation in '${quote.status}' status`);
    }

    const pendingRequest = quote.approvalRequests[0];
    if (pendingRequest) {
      await prisma.approvalRequest.update({
        where: { id: pendingRequest.id },
        data: {
          status: 'rejected',
          actionedById: user.userId,
          actionedAt: new Date(),
          reason: input.reason.trim(),
        },
      });
    }

    await prisma.quotation.update({
      where: { id: quotationId },
      data: { status: 'rejected' },
    });

    await this.logAudit(orgId, {
      entityType: 'quotation',
      entityId: quotationId,
      user,
      action: 'rejected',
      reason: input.reason.trim(),
      metadata: { stage: pendingRequest?.stage || 'manager' },
    });

    // Notify Rep
    if (quote.rep?.email) {
      await approvalNotificationQueue.add('decision_notification', {
        orgId,
        type: 'decision_rendered',
        quotationId,
        quotationNumber: quote.quotationNumber,
        customerName: quote.customer?.name,
        decision: 'rejected',
        reason: input.reason.trim(),
        requestedByName: quote.rep.name || quote.rep.email,
        recipients: [quote.rep.email],
      });
    }

    emitToOrg(orgId, 'approvals:updated', { orgId, quotationId, action: 'rejected' });
    emitToOrg(orgId, 'quote:status_changed', {
      quotationId,
      status: 'rejected',
      quotationNumber: quote.quotationNumber,
    });
    emitToQuote(orgId, quotationId, 'quote:status_changed', {
      quotationId,
      status: 'rejected',
      quotationNumber: quote.quotationNumber,
    });

    return {
      status: 'rejected',
      message: 'Quotation rejected.',
    };
  }

  /**
   * Get pending approvals filtered by organization and optionally role
   */
  async getPendingApprovals(orgId: string, role?: string) {
    const stageFilter = role === 'finance' ? 'finance' : role === 'manager' ? 'manager' : undefined;

    return prisma.approvalRequest.findMany({
      where: {
        organizationId: orgId,
        status: 'pending',
        ...(stageFilter ? { stage: stageFilter } : {}),
      },
      include: {
        quotation: {
          include: {
            customer: true,
            tier: true,
            rep: true,
            lines: {
              include: { product: true, category: true },
            },
          },
        },
        requestedBy: {
          select: { id: true, name: true, email: true, role: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Get audit trail for a specific quotation
   */
  async getQuotationAuditTrail(orgId: string, quotationId: string) {
    const quotation = await prisma.quotation.findFirst({
      where: { id: quotationId, organizationId: orgId },
      select: { id: true },
    });

    if (!quotation) {
      throw new HttpError(404, 'Quotation not found');
    }

    return prisma.auditLog.findMany({
      where: {
        organizationId: orgId,
        entityType: 'quotation',
        entityId: quotationId,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Get org-wide audit logs
   */
  async getOrgAuditLogs(orgId: string, limit = 50, entityType?: string) {
    return prisma.auditLog.findMany({
      where: {
        organizationId: orgId,
        ...(entityType ? { entityType } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }
}

export const approvalsService = new ApprovalsService();
