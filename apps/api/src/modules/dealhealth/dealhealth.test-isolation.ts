import http from 'http';
import { prisma } from '../../lib/prisma.js';
import { redis } from '../../lib/redis.js';
import { runDealHealthScanForOrg } from './dealhealth.worker.js';
import { dealHealthService } from './dealhealth.service.js';
import { signInternalToken } from '../../shared/jwt.js';
import { createApp } from '../../app.js';

async function runDealHealthIsolationTest() {
  console.log('--- Starting Phase 21 Deal Health Isolation Test ---');

  const orgs = await prisma.organization.findMany({
    where: { onboardingCompleted: true },
    orderBy: { createdAt: 'asc' },
    take: 2,
    include: { users: true },
  });
  if (orgs.length < 2 || !orgs[0] || !orgs[1]) {
    console.error('Error: Need at least 2 seeded organizations.');
    process.exit(1);
  }

  const orgA = orgs[0]!;
  const orgB = orgs[1]!;
  console.log(`Org A: ${orgA.name} (${orgA.id})`);
  console.log(`Org B: ${orgB.name} (${orgB.id})`);

  const repA = orgA.users.find((u) => u.role === 'rep')!;
  const adminA = orgA.users.find((u) => u.role === 'org_admin')!;
  const repB = orgB.users.find((u) => u.role === 'rep') || orgB.users[0]!;
  if (!repA || !adminA) throw new Error('Org A needs rep + org_admin users');

  const customerA = await prisma.customer.findFirst({ where: { organizationId: orgA.id } });
  if (!customerA) throw new Error('Org A needs a seeded customer');

  const productA = await prisma.product.findFirst({ where: { organizationId: orgA.id } });
  if (!productA) throw new Error('Org A needs a seeded product');

  // Clean prior test data
  await prisma.dealHealthAlert.deleteMany({ where: { organizationId: orgA.id } });
  await prisma.dealHealthAlert.deleteMany({ where: { organizationId: orgB.id } });

  const priorQuotes = await prisma.quotation.findMany({
    where: { organizationId: orgA.id, quotationNumber: { startsWith: 'TEST-DH-' } },
    select: { id: true },
  });
  for (const q of priorQuotes) {
    await prisma.quotationLine.deleteMany({ where: { quotationId: q.id } });
  }
  await prisma.quotation.deleteMany({ where: { organizationId: orgA.id, quotationNumber: { startsWith: 'TEST-DH-' } } });

  // ---------- Test 1: stalled quote detection (updated 30 days ago) ----------
  const stalled = await prisma.quotation.create({
    data: {
      organizationId: orgA.id,
      quotationNumber: 'TEST-DH-STALLED-1',
      customerId: customerA.id,
      tierId: customerA.tierId,
      repId: repA.id,
      status: 'sent',
      totalAmount: 1000,
      totalDiscount: 50,
      subtotal: 1050,
      updatedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      lines: {
        create: {
          productId: productA.id,
          quantity: 1,
          unitPrice: 1000,
          subtotal: 1000,
          total: 1000,
          billingFrequency: 'one_time',
        },
      },
    },
  });

  const scanA = await runDealHealthScanForOrg(orgA.id);
  const stalledAlert = await prisma.dealHealthAlert.findFirst({
    where: { organizationId: orgA.id, alertType: 'stalled_quote', quotationId: stalled.id, status: 'open' },
  });
  if (!stalledAlert) {
    throw new Error('Expected stalled_quote alert for the 30-day-inactive quotation');
  }
  if (stalledAlert.severity !== 'high') {
    throw new Error(`Expected high severity for 30 days (got ${stalledAlert.severity})`);
  }
  console.log('[PASS] Test 1: stalled quote detected with high severity (30 days inactive)');

  // ---------- Test 2: scan dedup — second scan does not duplicate ----------
  const scanA2 = await runDealHealthScanForOrg(orgA.id);
  const stalledAlertCount = await prisma.dealHealthAlert.count({
    where: { organizationId: orgA.id, alertType: 'stalled_quote', quotationId: stalled.id },
  });
  if (stalledAlertCount !== 1) {
    throw new Error(`Dedup failed: ${stalledAlertCount} alerts for one stalled quote`);
  }
  console.log('[PASS] Test 2: repeat scans deduplicate (no duplicate alerts)');

  // ---------- Test 3: fresh quotes do NOT alert ----------
  const fresh = await prisma.quotation.create({
    data: {
      organizationId: orgA.id,
      quotationNumber: 'TEST-DH-FRESH-1',
      customerId: customerA.id,
      tierId: customerA.tierId,
      repId: repA.id,
      status: 'draft',
      totalAmount: 500,
      updatedAt: new Date(),
      lines: {
        create: {
          productId: productA.id,
          quantity: 1,
          unitPrice: 500,
          subtotal: 500,
          total: 500,
          billingFrequency: 'one_time',
        },
      },
    },
  });
  await runDealHealthScanForOrg(orgA.id);
  const freshAlert = await prisma.dealHealthAlert.findFirst({
    where: { organizationId: orgA.id, quotationId: fresh.id },
  });
  if (freshAlert) {
    throw new Error('Fresh quote must not be flagged as stalled');
  }
  console.log('[PASS] Test 3: recently-updated quote produces no alert');

  // ---------- Test 4: cross-tenant isolation — org B scan never flags org A quotes ----------
  await runDealHealthScanForOrg(orgB.id);
  const orgBAlertsForAQuote = await prisma.dealHealthAlert.findFirst({
    where: { organizationId: orgB.id, quotationId: stalled.id },
  });
  if (orgBAlertsForAQuote) {
    throw new Error('SECURITY VIOLATION: Org B alert references Org A quotation');
  }
  console.log('[PASS] Test 4: org B scan created no alerts referencing org A quotations');

  // ---------- Test 5: cross-tenant HTTP 404 on direct alert access ----------
  const app = createApp();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Failed to bind test server');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const repAToken = signInternalToken({ sub: repA.id, email: repA.email, org_id: orgA.id, role: 'rep' }, '1h');
    const repBToken = signInternalToken({ sub: repB.id, email: repB.email, org_id: orgB.id, role: 'rep' }, '1h');
    const adminAToken = signInternalToken({ sub: adminA.id, email: adminA.email, org_id: orgA.id, role: 'org_admin' }, '1h');

    // Org B rep reads Org A's alert id -> 404
    const crossRes = await fetch(`${baseUrl}/api/dealhealth/alerts/${stalledAlert.id}`, {
      headers: { Authorization: `Bearer ${repBToken}` },
    });
    if (crossRes.status !== 404) {
      throw new Error(`SECURITY VIOLATION: cross-tenant alert read returned ${crossRes.status}, expected 404`);
    }
    console.log('[PASS] Test 5: org B rep gets 404 reading org A alert');

    // Org A rep lists alerts — sees the stalled alert for their own org
    const listRes = await fetch(`${baseUrl}/api/dealhealth/alerts`, {
      headers: { Authorization: `Bearer ${repAToken}` },
    });
    if (listRes.status !== 200) throw new Error(`Own-org alert list must be 200 (got ${listRes.status})`);
    const listJson: any = await listRes.json();
    const ownAlert = (listJson.data || []).find((a: any) => a.id === stalledAlert.id);
    if (!ownAlert) throw new Error('Own-org alert missing from list');
    console.log('[PASS] Test 6: org A rep sees own org alert in list');

    // Rep cannot nudge (RBAC 403), admin can
    const repNudge = await fetch(`${baseUrl}/api/dealhealth/alerts/${stalledAlert.id}/nudge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${repAToken}` },
      body: '{}',
    });
    if (repNudge.status !== 403) {
      throw new Error(`Rep nudge must be 403 (got ${repNudge.status})`);
    }
    const adminNudge = await fetch(`${baseUrl}/api/dealhealth/alerts/${stalledAlert.id}/nudge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminAToken}` },
      body: JSON.stringify({ escalate: false }),
    });
    if (adminNudge.status !== 200) {
      throw new Error(`Admin nudge must be 200 (got ${adminNudge.status})`);
    }
    const nudgedAlert = await prisma.dealHealthAlert.findUnique({ where: { id: stalledAlert.id } });
    if (nudgedAlert!.status !== 'nudged' || !nudgedAlert!.nudgedAt) {
      throw new Error('Nudge did not update alert status/nudgedAt');
    }
    console.log('[PASS] Test 7: RBAC enforced (rep 403, org_admin nudge 200) and alert marked nudged');

    // Nudge writes an audit log entry
    const auditCount = await prisma.auditLog.count({
      where: { organizationId: orgA.id, entityType: 'deal_health_alert', entityId: stalledAlert.id, action: 'alert_nudged' },
    });
    if (auditCount === 0) throw new Error('Missing alert_nudged audit entry');
    console.log('[PASS] Test 8: nudge recorded in audit trail');

    // Org B admin cannot nudge Org A's alert (404)
    const adminB = orgB.users.find((u) => u.role === 'org_admin') || orgB.users[0]!;
    const adminBToken = signInternalToken({ sub: adminB.id, email: adminB.email, org_id: orgB.id, role: 'org_admin' }, '1h');
    const crossNudge = await fetch(`${baseUrl}/api/dealhealth/alerts/${stalledAlert.id}/nudge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminBToken}` },
      body: '{}',
    });
    if (crossNudge.status !== 404) {
      throw new Error(`SECURITY VIOLATION: cross-tenant nudge returned ${crossNudge.status}, expected 404`);
    }
    console.log('[PASS] Test 9: cross-tenant nudge rejected with 404');

    // Resolve
    await dealHealthService.resolveAlert(orgA.id, stalledAlert.id, {
      userId: adminA.id,
      email: adminA.email,
      role: 'org_admin',
    });
    const resolved = await prisma.dealHealthAlert.findUnique({ where: { id: stalledAlert.id } });
    if (resolved!.status !== 'resolved' || !resolved!.resolvedAt) throw new Error('Resolve failed');
    console.log('[PASS] Test 10: alert resolved with timestamp');
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }

  // Cleanup test data
  await prisma.dealHealthAlert.deleteMany({ where: { organizationId: orgA.id } });
  await prisma.dealHealthAlert.deleteMany({ where: { organizationId: orgB.id } });
  await prisma.quotationLine.deleteMany({ where: { quotation: { quotationNumber: { startsWith: 'TEST-DH-' } } } });
  await prisma.quotation.deleteMany({ where: { organizationId: orgA.id, quotationNumber: { startsWith: 'TEST-DH-' } } });

  console.log('\n--- Phase 21 Deal Health Isolation Suite PASSED (10/10) ---');
}

runDealHealthIsolationTest()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Phase 21 Isolation Test FAILED:', err);
    process.exit(1);
  });
