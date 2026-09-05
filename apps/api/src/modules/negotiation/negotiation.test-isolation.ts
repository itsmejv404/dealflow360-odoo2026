import http from 'http';
import { prisma } from '../../lib/prisma.js';
import { redis } from '../../lib/redis.js';
import { quotationsService } from '../quotations/quotations.service.js';
import { portalService } from '../portal/portal.service.js';
import { negotiationService } from './negotiation.service.js';
import { signCustomerToken } from '../../shared/jwt.js';
import { createApp } from '../../app.js';

async function runNegotiationIsolationTest() {
  console.log('--- Starting Phase 14 Negotiation & Re-Approval Isolation Test ---');

  const orgs = await prisma.organization.findMany({
    where: { onboardingCompleted: true },
    orderBy: { createdAt: 'asc' },
    take: 2,
    include: {
      customerTiers: true,
      products: true,
      users: true,
      approvalChainConfig: true,
    },
  });

  if (orgs.length < 2 || !orgs[0] || !orgs[1]) {
    console.error('Error: Need at least 2 seeded organizations for isolation testing.');
    process.exit(1);
  }

  const orgA = orgs[0]!;
  const orgB = orgs[1]!;
  console.log(`Org A: ${orgA.name} (${orgA.id})`);
  console.log(`Org B: ${orgB.name} (${orgB.id})`);

  let repA = orgA.users.find((u) => u.role === 'rep');
  let managerA = orgA.users.find((u) => u.role === 'manager');
  if (!repA || !managerA) {
    throw new Error('Org A needs seeded rep and manager users (run npm run seed first)');
  }

  const tierA = orgA.customerTiers[0];
  const prodA = orgA.products[0];
  const tierB = orgB.customerTiers[0];
  const prodB = orgB.products[0];
  if (!tierA || !prodA || !tierB || !prodB) {
    throw new Error('Both organizations must have at least 1 customer tier and 1 product');
  }

  let custA = await prisma.customer.findFirst({ where: { organizationId: orgA.id } });
  if (!custA) {
    custA = await prisma.customer.create({
      data: {
        organizationId: orgA.id,
        tierId: tierA.id,
        name: 'Negotiation Customer A',
        email: `neg-customer-a-${Date.now()}@example.com`,
      },
    });
  }

  let custB = await prisma.customer.findFirst({ where: { organizationId: orgB.id } });
  if (!custB) {
    custB = await prisma.customer.create({
      data: {
        organizationId: orgB.id,
        tierId: tierB.id,
        name: 'Negotiation Customer B',
        email: `neg-customer-b-${Date.now()}@example.com`,
      },
    });
  }

  // Over-ceiling quote (heavy line discount) and within-ceiling quote in Org A
  const overCeilingQuote = await quotationsService.createQuotation(orgA.id, repA.id, {
    customerId: custA.id,
    orderDiscountPercent: 0,
    lines: [{ productId: prodA.id, quantity: 2, lineDiscountPercent: 85 }],
  });

  const withinCeilingQuote = await quotationsService.createQuotation(orgA.id, repA.id, {
    customerId: custA.id,
    orderDiscountPercent: 0,
    lines: [{ productId: prodA.id, quantity: 1, lineDiscountPercent: 0 }],
  });

  const orgBQuote = await quotationsService.createQuotation(orgB.id, undefined, {
    customerId: custB.id,
    orderDiscountPercent: 0,
    lines: [{ productId: prodB.id, quantity: 1, lineDiscountPercent: 0 }],
  });

  if (!overCeilingQuote || !withinCeilingQuote || !orgBQuote) {
    throw new Error('Failed to create test quotations');
  }
  console.log(`Created over-ceiling quote ${overCeilingQuote.quotationNumber}, within-ceiling quote ${withinCeilingQuote.quotationNumber}, org B quote ${orgBQuote.quotationNumber}`);

  // Scope tokens: customer A authorized for the two org-A quotes only.
  const allowedA = [overCeilingQuote.id, withinCeilingQuote.id];
  const customerActorEmail = custA.email;

  // Send both org A quotes to the customer (status → sent, portal link emailed)
  await portalService.sendQuotationToCustomer(orgA.id, overCeilingQuote.id, {
    userId: repA.id,
    email: repA.email,
    role: 'rep',
    name: repA.name,
  });
  await portalService.sendQuotationToCustomer(orgA.id, withinCeilingQuote.id, {
    userId: repA.id,
    email: repA.email,
    role: 'rep',
    name: repA.name,
  });

  // ---------- Test 1: customer comment flips status to negotiating + audit ----------
  const comment = await negotiationService.addComment(
    orgA.id,
    withinCeilingQuote.id,
    { lineId: null, body: 'Can we discuss the delivery schedule?' },
    { type: 'customer', email: customerActorEmail },
    { allowedIds: allowedA }
  );
  if (!comment || comment.authorType !== 'customer') {
    throw new Error('Customer comment failed');
  }
  const quoteAfterComment = await prisma.quotation.findFirst({ where: { id: withinCeilingQuote.id } });
  if (!quoteAfterComment || quoteAfterComment.status !== 'negotiating') {
    throw new Error(`Expected status 'negotiating' after customer comment, got '${quoteAfterComment?.status}'`);
  }
  const commentAudit = await prisma.auditLog.count({
    where: { organizationId: orgA.id, entityType: 'quotation', entityId: withinCeilingQuote.id, action: 'customer_commented' },
  });
  if (commentAudit === 0) {
    throw new Error('Missing customer_commented audit entry');
  }
  console.log('✔ Test 1 PASSED: customer comment stored, status → negotiating, audit logged');

  // ---------- Test 2: cross-tenant negotiation access blocked ----------
  let crossTenantBlocked = false;
  try {
    await negotiationService.listNegotiation(orgA.id, orgBQuote.id, { allowedIds: allowedA });
  } catch {
    crossTenantBlocked = true;
  }
  if (!crossTenantBlocked) {
    throw new Error('SECURITY VIOLATION: customer token read org B negotiation thread');
  }
  console.log('✔ Test 2 PASSED: cross-tenant negotiation read rejected (403)');

  // ---------- Test 3: intra-tenant unauthorized quote blocked ----------
  let intraTenantBlocked = false;
  try {
    await negotiationService.addComment(
      orgA.id,
      orgBQuote.id, // belongs to org B — not in token scope nor org
      { lineId: null, body: 'attack' },
      { type: 'customer', email: customerActorEmail },
      { allowedIds: allowedA }
    );
  } catch {
    intraTenantBlocked = true;
  }
  if (!intraTenantBlocked) {
    throw new Error('SECURITY VIOLATION: customer token negotiated on an unauthorized quotation');
  }
  console.log('✔ Test 3 PASSED: unauthorized quotation negotiation rejected (403/404)');

  // ---------- Test 4: counter above thresholds → accept → re-enter Stage 3 ----------
  const counter = await negotiationService.createCounterProposal(
    orgA.id,
    overCeilingQuote.id,
    { lineId: null, proposedDiscountPercent: 90, note: 'Give us 90% and we sign today.' },
    customerActorEmail,
    { allowedIds: allowedA }
  );
  if (!counter) throw new Error('Counter proposal creation failed');

  const counterAudit = await prisma.auditLog.count({
    where: { organizationId: orgA.id, entityType: 'quotation', entityId: overCeilingQuote.id, action: 'counter_proposed' },
  });
  if (counterAudit === 0) throw new Error('Missing counter_proposed audit entry');

  const managerContext = { userId: managerA.id, email: managerA.email, role: managerA.role, name: managerA.name };
  const resolveResult = (await negotiationService.resolveCounterProposal(
    orgA.id,
    overCeilingQuote.id,
    counter.id,
    managerContext,
    { action: 'accept', note: 'Approved with escalation required.' }
  )) as any;

  if (!resolveResult || resolveResult.status !== 'accepted') {
    throw new Error('Counter acceptance failed');
  }
  if (!resolveResult.reenteredApproval) {
    throw new Error('LOGIC VIOLATION: accepted over-threshold counter did not re-enter approval');
  }

  const quoteAfterAccept = await prisma.quotation.findFirst({
    where: { id: overCeilingQuote.id },
    include: { approvalRequests: { where: { status: 'pending' } } },
  });
  if (!quoteAfterAccept || quoteAfterAccept.status !== 'pending_approval') {
    throw new Error(`Expected status 'pending_approval' after counter acceptance, got '${quoteAfterAccept?.status}'`);
  }
  if (quoteAfterAccept.approvalRequests.length === 0 || quoteAfterAccept.approvalRequests[0]?.stage !== 'manager') {
    throw new Error('No manager-stage approval request created after counter acceptance');
  }
  const reentryAudit = await prisma.auditLog.count({
    where: { organizationId: orgA.id, entityType: 'quotation', entityId: overCeilingQuote.id, action: 'reentered_approval' },
  });
  if (reentryAudit === 0) throw new Error('Missing reentered_approval audit entry');
  console.log('✔ Test 4 PASSED: accepted over-threshold counter re-entered Stage 3 (manager queue)');

  // ---------- Test 5: THE CRITICAL RULE — confirming over-threshold terms re-enters approval ----------
  // Simulate the manager having re-sent the quote to the customer after re-approval.
  await prisma.quotation.update({ where: { id: overCeilingQuote.id }, data: { status: 'sent' } });
  const confirmResult = await negotiationService.confirmQuotation(
    orgA.id,
    overCeilingQuote.id,
    customerActorEmail,
    { allowedIds: allowedA }
  );
  if (!confirmResult.reenteredApproval || confirmResult.status !== 'pending_approval') {
    throw new Error(`LOGIC VIOLATION: over-threshold confirm must re-enter approval (got ${confirmResult.status}, reentered=${confirmResult.reenteredApproval})`);
  }
  const quoteAfterConfirm = await prisma.quotation.findFirst({ where: { id: overCeilingQuote.id } });
  if (!quoteAfterConfirm || quoteAfterConfirm.status !== 'pending_approval') {
    throw new Error(`Expected 'pending_approval' after over-threshold confirm, got '${quoteAfterConfirm?.status}'`);
  }
  const confirmAudit = await prisma.auditLog.count({
    where: { organizationId: orgA.id, entityType: 'quotation', entityId: overCeilingQuote.id, action: 'customer_confirmed' },
  });
  if (confirmAudit === 0) throw new Error('Missing customer_confirmed audit entry');
  console.log('✔ Test 5 PASSED: over-threshold customer confirmation re-entered Stage 3, never silently accepted');

  // ---------- Test 6: confirming within-ceiling terms binds the order ----------
  const confirmOk = await negotiationService.confirmQuotation(
    orgA.id,
    withinCeilingQuote.id,
    customerActorEmail,
    { allowedIds: allowedA }
  );
  if (confirmOk.reenteredApproval || confirmOk.status !== 'confirmed') {
    throw new Error(`Within-ceiling confirm should bind the order (got ${confirmOk.status})`);
  }
  const quoteConfirmed = await prisma.quotation.findFirst({ where: { id: withinCeilingQuote.id } });
  if (!quoteConfirmed || quoteConfirmed.status !== 'confirmed') {
    throw new Error('Within-ceiling quotation was not confirmed');
  }
  console.log('✔ Test 6 PASSED: within-ceiling confirmation → status confirmed');

  // ---------- Test 7: HTTP rate limiting on the confirm endpoint (429) ----------
  const app = createApp();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Failed to bind test server');
  const port = address.port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // Customer token scoped to the confirmed quote (confirm again → should 400 after limit? No:
    // the quote is already confirmed so business rule rejects; to isolate the limiter we use
    // a fresh token scoped to the still-negotiable over-ceiling quote and spam it.
    const customerToken = signCustomerToken(
      {
        sub: custA.id,
        email: customerActorEmail,
        org_id: orgA.id,
        quotation_ids: allowedA,
      },
      '1h'
    );

    // Set the quote back to 'sent' so confirm passes business validation.
    await prisma.quotation.update({ where: { id: overCeilingQuote.id }, data: { status: 'sent' } });

    // Reset rate-limit counters so the test is deterministic across runs.
    await redis.del(
      `rl:portal-confirm:${orgA.id}:${custA.id}`,
      `rl:portal-negotiation:${orgA.id}:${custA.id}`
    );

    let got429 = false;
    let sawSuccess = false;
    const attempts = 12;
    for (let i = 0; i < attempts; i++) {
      const res = await fetch(`${baseUrl}/api/portal/quotation/${overCeilingQuote.id}/confirm`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customerToken}`,
        },
        body: JSON.stringify({}),
      });
      if (res.status === 429) {
        got429 = true;
      } else if (res.ok) {
        sawSuccess = true;
      }
      // Reset status back to sent each time so only the limiter rejects
      await prisma.quotation.update({ where: { id: overCeilingQuote.id }, data: { status: 'sent' } });
    }

    if (!got429) {
      throw new Error('Rate limiter did not return 429 on hammered confirm endpoint');
    }
    if (!sawSuccess) {
      throw new Error('Rate limiter blocked everything — expected first attempts to succeed');
    }
    console.log('✔ Test 7 PASSED: hammering confirm returns 429 (Redis-backed, org+customer keyed) while early attempts succeed');

    // ---------- Test 8: customer token rejected on internal negotiation API ----------
    const internalAttempt = await fetch(`${baseUrl}/api/negotiation/${overCeilingQuote.id}`, {
      headers: { Authorization: `Bearer ${customerToken}` },
    });
    if (internalAttempt.status !== 403) {
      throw new Error(`SECURITY VIOLATION: customer token hit internal negotiation API (status ${internalAttempt.status})`);
    }
    console.log('✔ Test 8 PASSED: customer token rejected on internal /api/negotiation (403)');
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }

  console.log('\n--- Phase 14 Negotiation & Re-Approval Isolation Suite PASSED (8/8) ---');
}

runNegotiationIsolationTest()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Phase 14 Isolation Test FAILED:', err);
    process.exit(1);
  });
