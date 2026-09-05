import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { HttpError } from '../../shared/errors.js';
import { governanceService, type EvaluateRiskLineInput } from '../governance/governance.service.js';
import { quotationsService, type QuotationLineInput, type AuditActor } from '../quotations/quotations.service.js';
import { approvalsService, type UserContext } from '../approvals/approvals.service.js';
import { approvalNotificationQueue } from '../../lib/queue.js';
import { emitToOrg, emitToQuote } from '../../lib/socket.js';
import { logger } from '../../lib/logger.js';
import { billingService } from '../billing/billing.service.js';

export interface CustomerActor {
  name: string;
  email: string;
}

export type NegotiationActivityType =
  | 'comment'
  | 'change_request'
  | 'counter'
  | 'counter_accepted'
  | 'counter_declined'
  | 'change_request_accepted'
  | 'change_request_declined'
  | 'confirm'
  | 'reapproval';

/** Statuses in which a customer may confirm the quotation. */
const CONFIRMABLE_STATUSES = new Set(['sent', 'negotiating', 'approved']);
/**
 * Statuses in which a customer may negotiate (counter / change request).
 * 'confirmed' included on purpose: deals are re-openable — a follow-up message
 * or counter after closing starts another review round.
 */
const NEGOTIABLE_STATUSES = new Set(['sent', 'negotiating', 'approved', 'confirmed']);
/**
 * Statuses that flip to 'negotiating' on customer activity. 'confirmed'
 * included: a re-opened deal goes back through review before it can close again.
 */
const FLIP_TO_NEGOTIATING = new Set(['sent', 'approved', 'confirmed']);

/** Deterministic ordering shared by every line loader so index-based mutation is safe. */
const LINE_ORDER = [{ createdAt: 'asc' as const }, { id: 'asc' as const }];

export class NegotiationService {
  // ==================== INTERNAL HELPERS ====================

  private assertScope(quotationId: string, allowedIds: string[] | undefined) {
    if (!allowedIds || !allowedIds.includes(quotationId)) {
      throw new HttpError(403, 'Forbidden: Your access token is not authorized for this quotation');
    }
  }

  private async loadQuotation(orgId: string, quotationId: string) {
    const quotation = await prisma.quotation.findFirst({
      where: { id: quotationId, organizationId: orgId },
      include: {
        customer: true,
        tier: true,
        rep: { select: { id: true, name: true, email: true } },
        lines: { orderBy: LINE_ORDER },
      },
    });

    if (!quotation) {
      throw new HttpError(404, 'Quotation not found in this organization');
    }

    return quotation;
  }

  private riskInputFromLines(lines: Array<{ productId: string; categoryId: string | null; quantity: number; unitPrice: unknown; lineDiscountPercent: unknown; subtotal: unknown; total: unknown }>): EvaluateRiskLineInput[] {
    return lines.map((l) => ({
      productId: l.productId,
      categoryId: l.categoryId,
      quantity: l.quantity,
      unitPrice: Number(l.unitPrice),
      lineDiscountPercent: Number(l.lineDiscountPercent),
      subtotal: Number(l.subtotal),
      total: Number(l.total),
    }));
  }

  private async audit(
    orgId: string,
    quotationId: string,
    action: Parameters<typeof approvalsService.logAudit>[1]['action'],
    user: UserContext | null,
    reason: string,
    metadata?: Record<string, unknown>
  ) {
    await approvalsService.logAudit(orgId, {
      entityType: 'quotation',
      entityId: quotationId,
      user,
      action,
      reason,
      metadata: metadata ?? {},
    });
  }

  private emitNegotiation(orgId: string, quotationId: string, activity: NegotiationActivityType, extra: Record<string, unknown> = {}) {
    emitToOrg(orgId, 'negotiation:updated', { quotationId, activity, ...extra });
    emitToQuote(orgId, quotationId, 'negotiation:updated', { quotationId, activity, ...extra });
  }

  private emitStatus(orgId: string, quotationId: string, status: string, quotationNumber: string) {
    emitToOrg(orgId, 'quote:status_changed', { quotationId, status, quotationNumber });
    emitToQuote(orgId, quotationId, 'quote:status_changed', { quotationId, status, quotationNumber });
  }

  /** Rep + org admins of this org are the default negotiation email audience. */
  private async negotiationRecipients(orgId: string, repEmail?: string | null): Promise<string[]> {
    const admins = await prisma.user.findMany({
      where: { organizationId: orgId, role: 'org_admin', status: 'active' },
      select: { email: true },
    });
    const set = new Set<string>();
    if (repEmail) set.add(repEmail);
    for (const a of admins) set.add(a.email);
    return [...set];
  }

  /**
   * After terms changed (counter accepted, change request applied), route the
   * quotation back into Stage 3 when the recomputed approval routing says the
   * terms exceed this org's thresholds. Over-threshold negotiated terms are
   * never silently accepted.
   */
  private async reenterApprovalIfNeeded(
    orgId: string,
    quotationId: string,
    actingUser: UserContext | null,
    context: { reason: string; source: string }
  ): Promise<{ reentered: boolean; approvalRouting: string; riskScore: number; riskLevel: string; quotationNumber: string }> {
    const quote = await this.loadQuotation(orgId, quotationId);

    if (quote.approvalRouting === 'none') {
      return {
        reentered: false,
        approvalRouting: quote.approvalRouting,
        riskScore: Number(quote.riskScore),
        riskLevel: quote.riskLevel,
        quotationNumber: quote.quotationNumber,
      };
    }

    await prisma.$transaction([
      prisma.approvalRequest.updateMany({
        where: { quotationId, organizationId: orgId, status: 'pending' },
        data: { status: 'superseded' },
      }),
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
          requestedById: actingUser?.userId ?? quote.repId ?? null,
          reason: context.reason,
        },
      }),
    ]);

    await this.audit(orgId, quotationId, 'reentered_approval', actingUser, context.reason, {
      source: context.source,
      approvalRouting: quote.approvalRouting,
      riskScore: Number(quote.riskScore),
      riskLevel: quote.riskLevel,
    });

    const managers = await prisma.user.findMany({
      where: { organizationId: orgId, role: { in: ['manager', 'org_admin'] }, status: 'active' },
      select: { email: true },
    });
    if (managers.length > 0) {
      await approvalNotificationQueue.add('negotiation_reapproval', {
        orgId,
        type: 'manager_review_requested',
        quotationId,
        quotationNumber: quote.quotationNumber,
        customerName: quote.customer.name,
        requestedByName: quote.customer.name,
        requestedByEmail: quote.customer.email,
        riskScore: Number(quote.riskScore),
        riskLevel: quote.riskLevel,
        reason: context.reason,
        recipients: managers.map((m) => m.email),
      });
    }

    emitToOrg(orgId, 'approvals:updated', { orgId, quotationId, action: 'submitted' });
    this.emitStatus(orgId, quotationId, 'pending_approval', quote.quotationNumber);
    this.emitNegotiation(orgId, quotationId, 'reapproval', { status: 'pending_approval' });

    logger.info({ orgId, quotationId, source: context.source }, 'Quotation re-entered approval after negotiated terms');

    return {
      reentered: true,
      approvalRouting: quote.approvalRouting,
      riskScore: Number(quote.riskScore),
      riskLevel: quote.riskLevel,
      quotationNumber: quote.quotationNumber,
    };
  }

  private mapLineInputs(quote: { lines: Array<{ productId: string; quantity: number; unitPrice: unknown; lineDiscountPercent: unknown }> }): QuotationLineInput[] {
    return quote.lines.map((l) => ({
      productId: l.productId,
      quantity: l.quantity,
      unitPrice: Number(l.unitPrice),
      lineDiscountPercent: Number(l.lineDiscountPercent),
    }));
  }

  // ==================== READ ====================

  async listNegotiation(orgId: string, quotationId: string, opts?: { allowedIds?: string[] }) {
    if (opts?.allowedIds) {
      this.assertScope(quotationId, opts.allowedIds);
    }

    const quotation = await this.loadQuotation(orgId, quotationId);

    const [comments, changeRequests, counterProposals] = await Promise.all([
      prisma.negotiationComment.findMany({
        where: { organizationId: orgId, quotationId },
        orderBy: { createdAt: 'asc' },
        include: { line: { select: { id: true, productId: true } } },
      }),
      prisma.changeRequest.findMany({
        where: { organizationId: orgId, quotationId },
        orderBy: { createdAt: 'desc' },
        include: { line: { select: { id: true, productId: true } } },
      }),
      prisma.counterProposal.findMany({
        where: { organizationId: orgId, quotationId },
        orderBy: { createdAt: 'desc' },
        include: { line: { select: { id: true, productId: true } } },
      }),
    ]);

    return {
      quotation: {
        id: quotation.id,
        quotationNumber: quotation.quotationNumber,
        status: quotation.status,
        riskLevel: quotation.riskLevel,
        approvalRouting: quotation.approvalRouting,
        customerName: quotation.customer.name,
      },
      comments,
      changeRequests,
      counterProposals,
    };
  }

  // ==================== COMMENTS ====================

  async addComment(
    orgId: string,
    quotationId: string,
    input: { lineId?: string | null; body: string },
    author: { type: 'customer' | 'internal'; id?: string; name?: string; email?: string },
    opts?: { allowedIds?: string[] }
  ) {
    if (opts?.allowedIds) {
      this.assertScope(quotationId, opts.allowedIds);
    }

    const body = input.body.trim();
    if (!body) {
      throw new HttpError(400, 'Comment body is required');
    }
    if (body.length > 2000) {
      throw new HttpError(400, 'Comment is too long (max 2000 characters)');
    }

    const quote = await this.loadQuotation(orgId, quotationId);

    // Customer identity is resolved from the quotation's own customer record —
    // never trusted from client input.
    const resolvedAuthor =
      author.type === 'customer'
        ? { ...author, name: quote.customer.name || author.name || author.email || 'Customer' }
        : { ...author, name: author.name || author.email || 'Internal User' };

    if (input.lineId) {
      const lineExists = quote.lines.some((l) => l.id === input.lineId);
      if (!lineExists) {
        throw new HttpError(400, 'Line not found on this quotation');
      }
    }

    const transactionOps: Prisma.PrismaPromise<unknown>[] = [
      prisma.negotiationComment.create({
        data: {
          organizationId: orgId,
          quotationId,
          lineId: input.lineId ?? null,
          authorType: author.type,
          authorId: author.id ?? null,
          authorName: resolvedAuthor.name,
          authorEmail: resolvedAuthor.email ?? null,
          body,
        },
      }),
    ];
    // Only CUSTOMER activity re-opens / advances the deal — internal replies
    // must never change the quotation status.
    const customerFlips = author.type === 'customer' && FLIP_TO_NEGOTIATING.has(quote.status);
    if (customerFlips) {
      transactionOps.push(prisma.quotation.update({ where: { id: quotationId }, data: { status: 'negotiating' } }));
    }
    const [comment] = await prisma.$transaction(transactionOps);
    const createdComment = comment as { id: string };

    if (customerFlips) {
      this.emitStatus(orgId, quotationId, 'negotiating', quote.quotationNumber);
    }

    // Only customer activity is audit-logged; internal replies live in the thread.
    if (author.type === 'customer') {
      await this.audit(orgId, quotationId, 'customer_commented', null, `Customer commented on ${input.lineId ? 'a line' : 'the quotation'}`, {
        authorType: author.type,
        authorName: resolvedAuthor.name,
        authorEmail: resolvedAuthor.email ?? null,
        lineId: input.lineId ?? null,
        commentId: createdComment.id,
      });

      if (quote.status === 'confirmed') {
        await this.audit(orgId, quotationId, 'deal_reopened', null, 'Customer resumed negotiation after the deal was confirmed', {
          previousStatus: 'confirmed',
          activity: 'comment',
        });
      }

      const recipients = await this.negotiationRecipients(orgId, quote.rep?.email);
      if (recipients.length > 0) {
        await approvalNotificationQueue.add('negotiation_comment', {
          orgId,
          type: 'change_request_received',
          activity: 'comment',
          quotationId,
          quotationNumber: quote.quotationNumber,
          customerName: quote.customer.name,
          requestedByName: resolvedAuthor.name,
          requestedByEmail: resolvedAuthor.email,
          negotiationNote: body,
          recipients,
        });
      }
    }

    this.emitNegotiation(orgId, quotationId, 'comment', { authorType: author.type });

    return prisma.negotiationComment.findUnique({
      where: { id: createdComment.id },
      include: { line: { select: { id: true, productId: true } } },
    });
  }

  // ==================== CHANGE REQUESTS ====================

  async createChangeRequest(
    orgId: string,
    quotationId: string,
    input: {
      lineId?: string | null;
      requestType: 'quantity_change' | 'remove_line' | 'discount_change' | 'other';
      proposedQuantity?: number;
      proposedDiscountPercent?: number;
      note?: string;
    },
    customerEmail: string,
    opts?: { allowedIds?: string[] }
  ) {
    if (opts?.allowedIds) {
      this.assertScope(quotationId, opts.allowedIds);
    }

    const quote = await this.loadQuotation(orgId, quotationId);
    const actor: CustomerActor = { name: quote.customer.name, email: customerEmail };

    if (!NEGOTIABLE_STATUSES.has(quote.status)) {
      throw new HttpError(400, `Change requests are only available on sent, negotiating or confirmed quotations (current: '${quote.status}')`);
    }

    if (input.requestType !== 'other' && !input.lineId) {
      throw new HttpError(400, 'A line must be selected for this change request type');
    }

    if (input.lineId) {
      const lineExists = quote.lines.some((l) => l.id === input.lineId);
      if (!lineExists) {
        throw new HttpError(400, 'Line not found on this quotation');
      }
    }

    if (input.requestType === 'quantity_change') {
      if (!input.proposedQuantity || input.proposedQuantity < 1) {
        throw new HttpError(400, 'Proposed quantity must be at least 1');
      }
    }

    if (input.requestType === 'discount_change') {
      if (input.proposedDiscountPercent === undefined || input.proposedDiscountPercent < 0 || input.proposedDiscountPercent > 100) {
        throw new HttpError(400, 'Proposed discount must be between 0 and 100');
      }
    }

    const transactionOps: Prisma.PrismaPromise<unknown>[] = [
      prisma.changeRequest.create({
        data: {
          organizationId: orgId,
          quotationId,
          lineId: input.lineId ?? null,
          requestType: input.requestType,
          proposedQuantity: input.proposedQuantity ?? null,
          proposedDiscountPercent:
            input.proposedDiscountPercent !== undefined ? new Prisma.Decimal(input.proposedDiscountPercent) : null,
          note: input.note?.trim() || null,
          requestedByType: 'customer',
          requestedByName: actor.name,
          requestedByEmail: actor.email,
        },
      }),
    ];
    const flips = FLIP_TO_NEGOTIATING.has(quote.status);
    if (flips) {
      transactionOps.push(prisma.quotation.update({ where: { id: quotationId }, data: { status: 'negotiating' } }));
    }
    const [changeRequest] = await prisma.$transaction(transactionOps);
    const created = changeRequest as { id: string };

    await this.audit(orgId, quotationId, 'change_requested', null, `Customer requested a change (${input.requestType})`, {
      changeRequestId: created.id,
      lineId: input.lineId ?? null,
      proposedQuantity: input.proposedQuantity ?? null,
      proposedDiscountPercent: input.proposedDiscountPercent ?? null,
      note: input.note ?? null,
      requestedBy: actor.email,
    });

    if (quote.status === 'confirmed') {
      await this.audit(orgId, quotationId, 'deal_reopened', null, 'Customer resumed negotiation after the deal was confirmed', {
        previousStatus: 'confirmed',
        activity: 'change_request',
      });
    }

    const recipients = await this.negotiationRecipients(orgId, quote.rep?.email);
    if (recipients.length > 0) {
      await approvalNotificationQueue.add('negotiation_change_request', {
        orgId,
        type: 'change_request_received',
        activity: 'change_request',
        quotationId,
        quotationNumber: quote.quotationNumber,
        customerName: quote.customer.name,
        requestedByName: actor.name,
        requestedByEmail: actor.email,
        negotiationNote: input.note,
        recipients,
      });
    }

    this.emitNegotiation(orgId, quotationId, 'change_request', { changeRequestId: created.id });
    if (flips) {
      this.emitStatus(orgId, quotationId, 'negotiating', quote.quotationNumber);
    }

    return prisma.changeRequest.findUnique({
      where: { id: created.id },
      include: { line: { select: { id: true, productId: true } } },
    });
  }

  async resolveChangeRequest(
    orgId: string,
    quotationId: string,
    changeRequestId: string,
    user: UserContext,
    input: { action: 'accept' | 'decline'; note?: string }
  ) {
    const request = await prisma.changeRequest.findFirst({
      where: { id: changeRequestId, organizationId: orgId, quotationId },
    });

    if (!request) {
      throw new HttpError(404, 'Change request not found');
    }

    if (request.status !== 'open') {
      throw new HttpError(400, `Change request is already '${request.status}'`);
    }

    const quote = await this.loadQuotation(orgId, quotationId);

    if (input.action === 'decline') {
      const updated = await prisma.changeRequest.update({
        where: { id: changeRequestId },
        data: {
          status: 'declined',
          resolvedById: user.userId,
          resolvedAt: new Date(),
          resolutionNote: input.note?.trim() || null,
        },
      });

      await this.audit(orgId, quotationId, 'change_request_declined', user, input.note?.trim() || 'Change request declined', {
        changeRequestId,
        requestType: request.requestType,
      });
      this.emitNegotiation(orgId, quotationId, 'change_request_declined', { changeRequestId });
      return updated;
    }

    // Accept → apply the requested mutation to the quotation terms.
    const lineInputs = this.mapLineInputs(quote);

    let updatedTerms: QuotationLineInput[] | undefined;

    if (request.requestType !== 'other') {
      if (!request.lineId) {
        throw new HttpError(400, 'Change request is missing its target line');
      }
      const idx = quote.lines.findIndex((l) => l.id === request.lineId);
      if (idx < 0) {
        throw new HttpError(400, 'Requested line no longer exists on this quotation');
      }

      if (request.requestType === 'quantity_change') {
        if (!request.proposedQuantity || request.proposedQuantity < 1) {
          throw new HttpError(400, 'Change request is missing a valid proposed quantity');
        }
        lineInputs[idx] = { ...lineInputs[idx]!, quantity: request.proposedQuantity };
      } else if (request.requestType === 'remove_line') {
        if (lineInputs.length <= 1) {
          throw new HttpError(400, 'Cannot remove the only remaining line of a quotation');
        }
        lineInputs.splice(idx, 1);
      } else if (request.requestType === 'discount_change') {
        if (request.proposedDiscountPercent === null) {
          throw new HttpError(400, 'Change request is missing the proposed discount');
        }
        lineInputs[idx] = { ...lineInputs[idx]!, lineDiscountPercent: Number(request.proposedDiscountPercent) };
      }

      updatedTerms = lineInputs;
    }

    const actorForAudit: AuditActor = { userId: user.userId, email: user.email, role: user.role };

    if (updatedTerms) {
      await quotationsService.updateQuotation(orgId, quotationId, { lines: updatedTerms }, actorForAudit);
    }

    const updated = await prisma.changeRequest.update({
      where: { id: changeRequestId },
      data: {
        status: updatedTerms ? 'applied' : 'accepted',
        resolvedById: user.userId,
        resolvedAt: new Date(),
        resolutionNote: input.note?.trim() || null,
      },
    });

    await this.audit(orgId, quotationId, 'change_request_accepted', user, input.note?.trim() || `Change request accepted (${request.requestType})`, {
      changeRequestId,
      requestType: request.requestType,
      applied: Boolean(updatedTerms),
    });

    // New terms → governance re-check; over-threshold terms re-enter Stage 3.
    const recheck = await this.reenterApprovalIfNeeded(orgId, quotationId, user, {
      reason: `Change request accepted by ${user.name || user.email} — terms changed, re-validating against the rulebook`,
      source: 'change_request_accepted',
    });

    this.emitNegotiation(orgId, quotationId, 'change_request_accepted', { changeRequestId, reenteredApproval: recheck.reentered });
    return updated;
  }

  // ==================== COUNTER PROPOSALS ====================

  async createCounterProposal(
    orgId: string,
    quotationId: string,
    input: { lineId?: string | null; proposedDiscountPercent: number; note?: string },
    customerEmail: string,
    opts?: { allowedIds?: string[] }
  ) {
    if (opts?.allowedIds) {
      this.assertScope(quotationId, opts.allowedIds);
    }

    if (input.proposedDiscountPercent === undefined || input.proposedDiscountPercent < 0 || input.proposedDiscountPercent > 100) {
      throw new HttpError(400, 'Proposed discount must be between 0 and 100');
    }

    const quote = await this.loadQuotation(orgId, quotationId);
    const actor: CustomerActor = { name: quote.customer.name, email: customerEmail };

    if (!NEGOTIABLE_STATUSES.has(quote.status)) {
      throw new HttpError(400, `Counter proposals are only available on sent, negotiating or confirmed quotations (current: '${quote.status}')`);
    }

    if (input.lineId) {
      const lineExists = quote.lines.some((l) => l.id === input.lineId);
      if (!lineExists) {
        throw new HttpError(400, 'Line not found on this quotation');
      }
    }

    const transactionOps: Prisma.PrismaPromise<unknown>[] = [
      prisma.counterProposal.create({
        data: {
          organizationId: orgId,
          quotationId,
          lineId: input.lineId ?? null,
          proposedDiscountPercent: new Prisma.Decimal(input.proposedDiscountPercent),
          note: input.note?.trim() || null,
          proposedByType: 'customer',
          proposedByName: actor.name,
          proposedByEmail: actor.email,
        },
      }),
    ];
    const flips = FLIP_TO_NEGOTIATING.has(quote.status);
    if (flips) {
      transactionOps.push(prisma.quotation.update({ where: { id: quotationId }, data: { status: 'negotiating' } }));
    }
    const [counter] = await prisma.$transaction(transactionOps);
    const created = counter as { id: string };

    await this.audit(orgId, quotationId, 'counter_proposed', null, `Customer countered with a ${input.lineId ? 'line-level' : 'order-level'} discount of ${input.proposedDiscountPercent}%`, {
      counterId: created.id,
      lineId: input.lineId ?? null,
      proposedDiscountPercent: input.proposedDiscountPercent,
      proposedBy: actor.email,
    });

    if (quote.status === 'confirmed') {
      await this.audit(orgId, quotationId, 'deal_reopened', null, 'Customer resumed negotiation after the deal was confirmed', {
        previousStatus: 'confirmed',
        activity: 'counter',
      });
    }

    const recipients = await this.negotiationRecipients(orgId, quote.rep?.email);
    if (recipients.length > 0) {
      await approvalNotificationQueue.add('negotiation_counter', {
        orgId,
        type: 'counter_received',
        activity: 'counter',
        quotationId,
        quotationNumber: quote.quotationNumber,
        customerName: quote.customer.name,
        requestedByName: actor.name,
        requestedByEmail: actor.email,
        negotiationNote: input.note,
        proposedDiscountPercent: input.proposedDiscountPercent,
        recipients,
      });
    }

    this.emitNegotiation(orgId, quotationId, 'counter', { counterId: created.id });
    if (flips) {
      this.emitStatus(orgId, quotationId, 'negotiating', quote.quotationNumber);
    }

    return prisma.counterProposal.findUnique({
      where: { id: created.id },
      include: { line: { select: { id: true, productId: true } } },
    });
  }

  async resolveCounterProposal(
    orgId: string,
    quotationId: string,
    counterId: string,
    user: UserContext,
    input: { action: 'accept' | 'decline'; note?: string }
  ) {
    const counter = await prisma.counterProposal.findFirst({
      where: { id: counterId, organizationId: orgId, quotationId },
    });

    if (!counter) {
      throw new HttpError(404, 'Counter proposal not found');
    }

    if (counter.status !== 'open') {
      throw new HttpError(400, `Counter proposal is already '${counter.status}'`);
    }

    const quote = await this.loadQuotation(orgId, quotationId);
    const actorForAudit: AuditActor = { userId: user.userId, email: user.email, role: user.role };

    if (input.action === 'decline') {
      const updated = await prisma.counterProposal.update({
        where: { id: counterId },
        data: {
          status: 'declined',
          decidedById: user.userId,
          decidedAt: new Date(),
          decisionNote: input.note?.trim() || null,
        },
      });

      await this.audit(orgId, quotationId, 'counter_declined', user, input.note?.trim() || `Counter discount of ${Number(counter.proposedDiscountPercent)}% declined`, {
        counterId,
        proposedDiscountPercent: Number(counter.proposedDiscountPercent),
      });
      this.emitNegotiation(orgId, quotationId, 'counter_declined', { counterId });
      return updated;
    }

    // Accept → apply the proposed discount to the terms.
    let updatePayload: { lines?: QuotationLineInput[]; orderDiscountPercent?: number };

    if (counter.lineId) {
      const lineInputs = this.mapLineInputs(quote);
      const idx = quote.lines.findIndex((l) => l.id === counter.lineId);
      if (idx < 0) {
        throw new HttpError(400, 'Countered line no longer exists on this quotation');
      }
      lineInputs[idx] = { ...lineInputs[idx]!, lineDiscountPercent: Number(counter.proposedDiscountPercent) };
      updatePayload = { lines: lineInputs };
    } else {
      updatePayload = { orderDiscountPercent: Number(counter.proposedDiscountPercent) };
    }

    await quotationsService.updateQuotation(orgId, quotationId, updatePayload, actorForAudit);

    await prisma.$transaction([
      prisma.counterProposal.update({
        where: { id: counterId },
        data: {
          status: 'accepted',
          decidedById: user.userId,
          decidedAt: new Date(),
          decisionNote: input.note?.trim() || null,
        },
      }),
      // Other open counters on this quote are superseded by the accepted one.
      prisma.counterProposal.updateMany({
        where: { quotationId, organizationId: orgId, status: 'open', id: { not: counterId } },
        data: { status: 'superseded' },
      }),
    ]);

    await this.audit(orgId, quotationId, 'counter_accepted', user, `Counter discount of ${Number(counter.proposedDiscountPercent)}% accepted`, {
      counterId,
      scope: counter.lineId ? 'line' : 'order',
      proposedDiscountPercent: Number(counter.proposedDiscountPercent),
      decisionNote: input.note ?? null,
    });

    // Governance re-check — over-threshold negotiated terms re-enter Stage 3.
    const recheck = await this.reenterApprovalIfNeeded(orgId, quotationId, user, {
      reason: `Counter discount of ${Number(counter.proposedDiscountPercent)}% accepted — re-validating terms against the rulebook`,
      source: 'counter_accepted',
    });

    this.emitNegotiation(orgId, quotationId, 'counter_accepted', { counterId, reenteredApproval: recheck.reentered });
    return { ...counter, status: 'accepted', reenteredApproval: recheck.reentered };
  }

  // ==================== ONE-CLICK CONFIRM (THE CRITICAL RULE) ====================

  async confirmQuotation(orgId: string, quotationId: string, customerEmail: string, opts?: { allowedIds?: string[] }) {
    if (opts?.allowedIds) {
      this.assertScope(quotationId, opts.allowedIds);
    }

    const quote = await this.loadQuotation(orgId, quotationId);
    const customerActor: CustomerActor = { name: quote.customer.name, email: customerEmail };

    if (!CONFIRMABLE_STATUSES.has(quote.status)) {
      throw new HttpError(400, `Quotation in '${quote.status}' status cannot be confirmed by the customer`);
    }

    // Re-evaluate the confirmed terms against THIS org's rulebook.
    const riskEval = await governanceService.calculateRiskScore(
      orgId,
      quote.tierId,
      this.riskInputFromLines(quote.lines),
      Number(quote.orderDiscountPercent)
    );

    await prisma.quotation.update({
      where: { id: quotationId },
      data: {
        riskScore: riskEval.riskScore,
        riskLevel: riskEval.riskLevel,
        approvalRouting: riskEval.approvalRouting,
        riskDetails: riskEval as unknown as Prisma.InputJsonValue,
      },
    });

    const recipients = await this.negotiationRecipients(orgId, quote.rep?.email);

    if (riskEval.approvalRouting === 'none') {
      // Terms comply → bind the order.
      await prisma.quotation.update({
        where: { id: quotationId },
        data: { status: 'confirmed' },
      });

      // Phase 18: Split order into one-time invoice and recurring subscriptions
      try {
        await billingService.confirmAndSplitOrder(orgId, quotationId);
      } catch (err: any) {
        logger.error({ orgId, quotationId, err: err.message }, 'Failed to split billing for confirmed order');
      }

      await this.audit(orgId, quotationId, 'customer_confirmed', null, 'Customer confirmed the quotation terms from the portal', {
        confirmedBy: customerActor.email,
        confirmedByName: customerActor.name,
        riskScore: riskEval.riskScore,
        riskLevel: riskEval.riskLevel,
      });

      if (recipients.length > 0) {
        await approvalNotificationQueue.add('quote_confirmed', {
          orgId,
          type: 'quote_confirmed',
          quotationId,
          quotationNumber: quote.quotationNumber,
          customerName: quote.customer.name,
          requestedByName: customerActor.name,
          requestedByEmail: customerActor.email,
          recipients,
        });
      }

      this.emitStatus(orgId, quotationId, 'confirmed', quote.quotationNumber);
      this.emitNegotiation(orgId, quotationId, 'confirm', { status: 'confirmed', reenteredApproval: false });

      logger.info({ orgId, quotationId }, 'Customer confirmed quotation within ceilings');
      return { status: 'confirmed', reenteredApproval: false, riskScore: riskEval.riskScore };
    }

    // THE CRITICAL RULE: confirmed terms exceeding thresholds re-enter Stage 3
    // automatically, routed by this org's own chain config — never silently accepted.
    await prisma.$transaction([
      prisma.approvalRequest.updateMany({
        where: { quotationId, organizationId: orgId, status: 'pending' },
        data: { status: 'superseded' },
      }),
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
          requestedById: quote.repId ?? null,
          reason: `Customer confirmed terms exceeding approval thresholds (risk ${riskEval.riskScore}/100, ${riskEval.riskLevel}). Routed per this organization's approval chain.`,
        },
      }),
    ]);

    await this.audit(orgId, quotationId, 'customer_confirmed', null, 'Customer confirmed the quotation terms from the portal', {
      confirmedBy: customerActor.email,
      confirmedByName: customerActor.name,
      riskScore: riskEval.riskScore,
      riskLevel: riskEval.riskLevel,
      approvalRouting: riskEval.approvalRouting,
    });
    await this.audit(orgId, quotationId, 'reentered_approval', null, 'Confirmed terms exceed thresholds — quotation re-entered Stage 3 automatically', {
      source: 'customer_confirm',
      approvalRouting: riskEval.approvalRouting,
    });

    const managers = await prisma.user.findMany({
      where: { organizationId: orgId, role: { in: ['manager', 'org_admin'] }, status: 'active' },
      select: { email: true },
    });
    if (managers.length > 0) {
      await approvalNotificationQueue.add('negotiation_reapproval_confirm', {
        orgId,
        type: 'manager_review_requested',
        quotationId,
        quotationNumber: quote.quotationNumber,
        customerName: quote.customer.name,
        requestedByName: quote.customer.name,
        requestedByEmail: quote.customer.email,
        riskScore: riskEval.riskScore,
        riskLevel: riskEval.riskLevel,
        reason: 'Customer-confirmed terms exceed thresholds — queued for manager review',
        recipients: managers.map((m) => m.email),
      });
    }
    if (recipients.length > 0) {
      await approvalNotificationQueue.add('quote_confirmed_reapproval', {
        orgId,
        type: 'quote_confirmed',
        quotationId,
        quotationNumber: quote.quotationNumber,
        customerName: quote.customer.name,
        requestedByName: customerActor.name,
        requestedByEmail: customerActor.email,
        reason: 'reentered_approval',
        recipients,
      });
    }

    emitToOrg(orgId, 'approvals:updated', { orgId, quotationId, action: 'submitted' });
    this.emitStatus(orgId, quotationId, 'pending_approval', quote.quotationNumber);
    this.emitNegotiation(orgId, quotationId, 'reapproval', { status: 'pending_approval', reenteredApproval: true });

    logger.info({ orgId, quotationId, routing: riskEval.approvalRouting }, 'Confirmed terms re-entered Stage 3 approval');
    return { status: 'pending_approval', reenteredApproval: true, riskScore: riskEval.riskScore };
  }
}

export const negotiationService = new NegotiationService();
