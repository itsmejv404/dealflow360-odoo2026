import http from 'http';
import { prisma } from '../../lib/prisma.js';
import { redis } from '../../lib/redis.js';
import { fulfillmentService } from './fulfillment.service.js';
import { warehousesService } from '../warehouses/warehouses.service.js';
import { quotationsService } from '../quotations/quotations.service.js';
import { signInternalToken } from '../../shared/jwt.js';
import { createApp } from '../../app.js';

type UserCtx = { userId: string; email: string; role: string };

async function runFulfillmentIsolationTest() {
  console.log('--- Starting Phase 16 Fulfillment Split Isolation Test ---');

  const orgs = await prisma.organization.findMany({
    where: { onboardingCompleted: true },
    orderBy: { createdAt: 'asc' },
    take: 2,
    include: { products: true, users: true, customerTiers: true },
  });
  if (orgs.length < 2 || !orgs[0] || !orgs[1]) {
    console.error('Error: Need at least 2 seeded organizations.');
    process.exit(1);
  }

  const orgA = orgs[0]!;
  const orgB = orgs[1]!;
  console.log(`Org A: ${orgA.name} (${orgA.id})`);
  console.log(`Org B: ${orgB.name} (${orgB.id})`);

  const adminA = orgA.users.find((u) => u.role === 'org_admin');
  const opsA = orgA.users.find((u) => u.role === 'ops');
  const repA = orgA.users.find((u) => u.role === 'rep');
  if (!adminA || !opsA || !repA) throw new Error('Org A needs admin/ops/rep users (run npm run seed)');

  const opsUser: UserCtx = { userId: opsA.id, email: opsA.email, role: 'ops' };
  const adminCtx: UserCtx = { userId: adminA.id, email: adminA.email, role: 'org_admin' };
  const repCtx: UserCtx = { userId: repA!.id, email: repA.email, role: 'rep' };

  const customerA = await prisma.customer.findFirst({ where: { organizationId: orgA.id } });
  if (!customerA) throw new Error('Org A needs a seeded customer');

  const whCentral = await prisma.warehouse.findFirst({
    where: { organizationId: orgA.id, isDefault: true },
  });
  const whOther = await prisma.warehouse.findFirst({
    where: { organizationId: orgA.id, isDefault: false },
  });
  const whB = await prisma.warehouse.findFirst({ where: { organizationId: orgB.id } });
  if (!whCentral || !whOther || !whB) throw new Error('Seeded warehouses missing');

  const rackA = orgA.products.find((p) => p.sku === 'ACME-SRV-X1');
  const cablesA = orgA.products.find((p) => p.sku === 'ACME-ACC-CAB');
  if (!rackA || !cablesA) throw new Error('Seeded products missing');

  await warehousesService.setStock(orgA.id, whCentral.id, rackA.id, 12);
  await warehousesService.setStock(orgA.id, whCentral.id, cablesA.id, 4);
  await warehousesService.setStock(orgA.id, whOther.id, rackA.id, 3);
  await warehousesService.setStock(orgA.id, whOther.id, cablesA.id, 18);

  const rackCentral0 = await prisma.stockLevel.findFirst({
    where: { organizationId: orgA.id, warehouseId: whCentral.id, productId: rackA.id },
  });

  async function makeQuote(lines: Array<{ productId: string; quantity: number }>, status = 'approved') {
    const quote = await quotationsService.createQuotation(orgA.id, repA!.id, {
      customerId: customerA!.id,
      orderDiscountPercent: 0,
      lines,
    });
    if (!quote) throw new Error('Failed to create test quotation');
    if (status !== 'draft') {
      await prisma.quotation.update({ where: { id: quote.id }, data: { status } });
    }
    return quote;
  }

  // ---------- Test 1: cross-tenant plan access rejected ----------
  const quoteB = (await quotationsService.createQuotation(orgB.id, undefined, {
    customerId: (await prisma.customer.findFirst({ where: { organizationId: orgB.id } }))!.id,
    lines: [{ productId: orgB.products[0]!.id, quantity: 1 }],
  }))!;
  await prisma.quotation.update({ where: { id: quoteB.id }, data: { status: 'approved' } });

  let blocked = false;
  try {
    await fulfillmentService.getOrCreatePlan(orgA.id, quoteB.id);
  } catch {
    blocked = true;
  }
  if (!blocked) throw new Error('SECURITY VIOLATION: org A opened a plan view for an org B quotation');
  console.log('[PASS] Test 1: cross-tenant plan access rejected (404)');

  // ---------- Test 2: allocation correctness (primary first, split, shortfall) ----------
  const monA = await prisma.product.findFirst({ where: { organizationId: orgA.id, sku: 'ACME-SUB-MON' } });
  if (!monA) throw new Error('Monitoring product missing');
  const splitQuote = await makeQuote([
    { productId: rackA.id, quantity: 5 },    // central 12 -> ready (primary only)
    { productId: cablesA.id, quantity: 20 }, // central 4 + east 18 -> split
    { productId: monA.id, quantity: 2 },     // no stock anywhere -> shortfall
  ]);
  const view = await fulfillmentService.getOrCreatePlan(orgA.id, splitQuote.id);

  const rackLine = view.lines.find((l) => l.sku === 'ACME-SRV-X1')!;
  const cableLine = view.lines.find((l) => l.sku === 'ACME-ACC-CAB')!;
  const monLine = view.lines.find((l) => l.sku === 'ACME-SUB-MON')!;

  if (rackLine.lineStatus !== 'ready' || rackLine.allocations[0]?.warehouseId !== whCentral.id || rackLine.allocations[0]?.quantity !== 5) {
    throw new Error(`Primary-first allocation wrong: ${JSON.stringify(rackLine)}`);
  }
  if (cableLine.lineStatus !== 'split' || cableLine.allocations.length !== 2) {
    throw new Error(`Split allocation wrong: ${JSON.stringify(cableLine)}`);
  }
  const cableCentral = cableLine.allocations.find((a) => a.warehouseId === whCentral.id)?.quantity;
  if (cableCentral !== 4) throw new Error(`Primary should take full live stock (4), got ${cableCentral}`);
  if (monLine.lineStatus !== 'shortfall' || monLine.allocatedTotal !== 0) {
    throw new Error(`Zero-stock line should be a shortfall: ${JSON.stringify(monLine)}`);
  }
  if (view.plan.shipmentCount !== 2) throw new Error(`Expected 2 shipments, got ${view.plan.shipmentCount}`);
  if (view.plan.deliveryExtendedDays !== 3) throw new Error(`Expected +3 days from org rules, got ${view.plan.deliveryExtendedDays}`);
  if (!view.plan.extraChargeNote?.includes('No extra charge')) {
    throw new Error(`Policy note wrong: ${view.plan.extraChargeNote}`);
  }
  console.log('[PASS] Test 2: primary-first allocation, split across warehouses, shortfall math, policy note');

  // ---------- Test 3: ineligible quotation rejected ----------
  const draftQuote = await makeQuote([{ productId: rackA.id, quantity: 1 }], 'draft');
  blocked = false;
  try {
    await fulfillmentService.getOrCreatePlan(orgA.id, draftQuote.id);
  } catch {
    blocked = true;
  }
  if (!blocked) throw new Error('Draft quotations must not be fulfillable (400)');
  console.log('[PASS] Test 3: non-approved/non-confirmed quotations rejected');

  // ---------- Test 4: no-split policy -> single warehouse + shortfall ----------
  let noSplitCableAllocId = '';
  await warehousesService.updateShippingRules(orgA.id, { allowSplitShipments: false });
  try {
    const noSplitView = await fulfillmentService.proposePlan(orgA.id, splitQuote.id, adminCtx);
    const noSplitCable = noSplitView.lines.find((l) => l.sku === 'ACME-ACC-CAB')!;
    noSplitCableAllocId = noSplitCable.allocations[0]?.fulfillmentLineId ?? '';
    if (noSplitCable.allocations.length !== 1) {
      throw new Error(`allowSplitShipments=false must produce a single allocation, got ${noSplitCable.allocations.length}`);
    }
    if (noSplitCable.allocations[0]!.quantity !== 18) {
      throw new Error(`Single-warehouse allocation should come from the best-stocked warehouse (18), got ${noSplitCable.allocations[0]!.quantity}`);
    }
    if (noSplitCable.allocations[0]!.warehouseId !== whOther.id) {
      throw new Error('No-split allocation should pick the best-stocked (East) warehouse');
    }
  } finally {
    // Always restore the split policy, even when the assertions above fail.
    await warehousesService.updateShippingRules(orgA.id, { allowSplitShipments: true });
  }
  console.log('[PASS] Test 4: no-split policy honors single-warehouse cap with shortfall');

  // ---------- Test 5: override validation + reassignment ----------
  const cableAllocId = noSplitCableAllocId;
  blocked = false;
  try {
    // east holds 18 - asking for 30 exceeds live availability
    await fulfillmentService.overrideLineAllocations(
      orgA.id,
      cableAllocId,
      [{ warehouseId: whOther.id, quantity: 30 }],
      adminCtx
    );
  } catch {
    blocked = true;
  }
  if (!blocked) throw new Error('Override beyond live availability must be rejected (400)');

  blocked = false;
  try {
    await fulfillmentService.overrideLineAllocations(
      orgA.id,
      cableAllocId,
      [{ warehouseId: whB.id, quantity: 2 }],
      adminCtx
    );
  } catch {
    blocked = true;
  }
  if (!blocked) throw new Error('SECURITY VIOLATION: override accepted a foreign-organization warehouse');

  const overriddenView = await fulfillmentService.overrideLineAllocations(
    orgA.id,
    cableAllocId,
    [{ warehouseId: whOther.id, quantity: 18 }],
    adminCtx
  );
  const overriddenLine = overriddenView.lines.find((l) => l.sku === 'ACME-ACC-CAB')!;
  if (overriddenLine.allocations.length !== 1 || overriddenLine.allocations[0]!.warehouseId !== whOther.id) {
    throw new Error(`Override did not replace allocations: ${JSON.stringify(overriddenLine.allocations)}`);
  }
  if (!overriddenView.plan.isOverridden) throw new Error('Override flag not set on the plan');
  console.log('[PASS] Test 5: override validated (live stock, org-local warehouse) and applied');

  // ---------- Test 6: accept deducts stock exactly + locks the plan ----------
  const acceptQuote = await makeQuote([{ productId: rackA.id, quantity: 2 }]);
  await fulfillmentService.getOrCreatePlan(orgA.id, acceptQuote.id);
  const accepted = await fulfillmentService.acceptPlan(orgA.id, acceptQuote.id, opsUser);

  if (accepted.plan.status !== 'accepted') throw new Error('Accept did not lock the plan');
  const centralAfter = await prisma.stockLevel.findFirst({
    where: { organizationId: orgA.id, warehouseId: whCentral.id, productId: rackA.id },
  });
  const expectedCentral = rackCentral0!.quantity - 2;
  if (centralAfter!.quantity !== expectedCentral) {
    throw new Error(`Stock deduction wrong: expected ${expectedCentral}, got ${centralAfter!.quantity}`);
  }
  const cachedMatrix = await warehousesService.getStockMatrix(orgA.id);
  const cachedRack = cachedMatrix.rows.find((r) => r.productId === rackA.id)?.quantities[whCentral.id];
  if (cachedRack !== expectedCentral) {
    throw new Error(`Stock cache not invalidated after accept: read ${cachedRack}, expected ${expectedCentral}`);
  }

  blocked = false;
  try {
    await fulfillmentService.acceptPlan(orgA.id, acceptQuote.id, opsUser);
  } catch {
    blocked = true;
  }
  if (!blocked) throw new Error('Double accept must be rejected (400)');

  blocked = false;
  try {
    await fulfillmentService.proposePlan(orgA.id, acceptQuote.id, adminCtx);
  } catch {
    blocked = true;
  }
  if (!blocked) throw new Error('Regenerating an accepted plan must be rejected (400)');
  console.log('[PASS] Test 6: accept deducts stock exactly, invalidates cache, locks the plan');

  // ---------- Test 7: stock-drift guard (409) ----------
  const driftQuote = await makeQuote([{ productId: rackA.id, quantity: 5 }]);
  await fulfillmentService.getOrCreatePlan(orgA.id, driftQuote.id);
  // Simulate stock moving after the proposal: drop central stock below 5.
  const stockBeforeDrift = (await prisma.stockLevel.findFirst({ where: { id: rackCentral0!.id } }))!.quantity;
  await prisma.stockLevel.update({
    where: { id: rackCentral0!.id },
    data: { quantity: Math.max(0, stockBeforeDrift - 6) },
  });
  blocked = false;
  try {
    await fulfillmentService.acceptPlan(orgA.id, driftQuote.id, opsUser);
  } catch (err: any) {
    blocked = err.message?.includes('Stock changed') || err.message?.includes('Regenerate');
  }
  if (!blocked) throw new Error('Stock drift between proposal and accept must be rejected (409)');
  // restore exactly what was there before the drift simulation
  await prisma.stockLevel.update({ where: { id: rackCentral0!.id }, data: { quantity: stockBeforeDrift } });
  console.log('[PASS] Test 7: stock-drift guard returns 409 and asks for regeneration');

  // ---------- Test 8: fulfillment audit trail written ----------
  const auditCount = await prisma.auditLog.count({
    where: { organizationId: orgA.id, entityType: 'quotation', entityId: acceptQuote.id, action: 'fulfillment_accepted' },
  });
  if (auditCount === 0) throw new Error('Missing fulfillment_accepted audit entry');
  console.log('[PASS] Test 8: immutable audit entry recorded for fulfillment acceptance');

  // ---------- Test 9: HTTP RBAC - rep propose 403, ops read + accept 200 ----------
  const app = createApp();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Failed to bind test server');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const repToken = signInternalToken({ sub: repA!.id, email: repA.email, org_id: orgA.id, role: 'rep' }, '1h');
    const opsToken = signInternalToken({ sub: opsA.id, email: opsA.email, org_id: orgA.id, role: 'ops' }, '1h');

    const rbacQuote = await makeQuote([{ productId: cablesA.id, quantity: 1 }]);

    const repRes = await fetch(`${baseUrl}/api/fulfillment/quotation/${rbacQuote.id}/propose`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${repToken}` },
      body: '{}',
    });
    if (repRes.status !== 403) {
      throw new Error(`Rep propose must be 403 (got ${repRes.status})`);
    }

    const opsGet = await fetch(`${baseUrl}/api/fulfillment/quotation/${rbacQuote.id}`, {
      headers: { Authorization: `Bearer ${opsToken}` },
    });
    if (opsGet.status !== 200) {
      throw new Error(`Ops GET plan must be 200 (got ${opsGet.status})`);
    }
    const opsAccept = await fetch(`${baseUrl}/api/fulfillment/quotation/${rbacQuote.id}/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${opsToken}` },
      body: '{}',
    });
    if (opsAccept.status !== 200) {
      throw new Error(`Ops accept must be 200 (got ${opsAccept.status})`);
    }
    console.log('[PASS] Test 9: HTTP RBAC - rep 403 on propose, ops reads + accepts');
  } finally {
    await warehousesService.setStock(orgA.id, whCentral.id, rackA.id, 12);
    await warehousesService.setStock(orgA.id, whCentral.id, cablesA.id, 4);
    await warehousesService.setStock(orgA.id, whOther.id, rackA.id, 3);
    await warehousesService.setStock(orgA.id, whOther.id, cablesA.id, 18);
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }

  console.log('\n--- Phase 16 Fulfillment Split Isolation Suite PASSED (9/9) ---');
}

runFulfillmentIsolationTest()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Phase 16 Isolation Test FAILED:', err);
    process.exit(1);
  });
