import http from 'http';
import { prisma } from '../../lib/prisma.js';
import { redis } from '../../lib/redis.js';
import { fulfillmentService } from './fulfillment.service.js';
import { warehousesService } from '../warehouses/warehouses.service.js';
import { quotationsService } from '../quotations/quotations.service.js';
import { signInternalToken } from '../../shared/jwt.js';
import { createApp } from '../../app.js';
import { getQueueHealthStatus } from '../../lib/queue.js';
import { startBackorderConsolidationWorker } from './fulfillment.worker.js';

type UserCtx = { userId: string; email: string; role: string };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runBackordersIsolationTest() {
  console.log('--- Starting Phase 17 Backorders & Auto-Consolidation Isolation Test ---');

  // Ensure worker is listening in this test process
  const worker = startBackorderConsolidationWorker();

  const orgs = await prisma.organization.findMany({
    where: { onboardingCompleted: true },
    orderBy: { createdAt: 'asc' },
    take: 2,
    include: { products: true, users: true },
  });
  if (orgs.length < 2 || !orgs[0] || !orgs[1]) {
    console.error('Error: Need at least 2 seeded organizations (run npm run seed)');
    process.exit(1);
  }

  const orgA = orgs[0]!;
  const orgB = orgs[1]!;
  console.log(`Org A: ${orgA.name} (${orgA.id})`);
  console.log(`Org B: ${orgB.name} (${orgB.id})`);

  const adminA = orgA.users.find((u) => u.role === 'org_admin');
  const opsA = orgA.users.find((u) => u.role === 'ops');
  const repA = orgA.users.find((u) => u.role === 'rep');
  if (!adminA || !opsA || !repA) throw new Error('Org A needs admin/ops/rep users');

  const opsUserA: UserCtx = { userId: opsA.id, email: opsA.email, role: 'ops' };
  const adminCtxA: UserCtx = { userId: adminA.id, email: adminA.email, role: 'org_admin' };
  const repCtxA: UserCtx = { userId: repA.id, email: repA.email, role: 'rep' };

  const customerA = await prisma.customer.findFirst({ where: { organizationId: orgA.id } });
  const customerB = await prisma.customer.findFirst({ where: { organizationId: orgB.id } });
  if (!customerA || !customerB) throw new Error('Seeded customers missing');

  const whCentralA = await prisma.warehouse.findFirst({
    where: { organizationId: orgA.id, isDefault: true },
  });
  const whEastA = await prisma.warehouse.findFirst({
    where: { organizationId: orgA.id, isDefault: false },
  });
  const whMainB = await prisma.warehouse.findFirst({
    where: { organizationId: orgB.id, isDefault: true },
  });
  if (!whCentralA || !whEastA || !whMainB) throw new Error('Seeded warehouses missing');

  const rackA = orgA.products.find((p) => p.sku === 'ACME-SRV-X1');
  const productB = orgB.products[0];
  if (!rackA || !productB) throw new Error('Seeded products missing');

  // Clean up any prompts or backorders from previous test runs
  await prisma.consolidationPrompt.deleteMany({
    where: { organizationId: { in: [orgA.id, orgB.id] } },
  });
  await prisma.backorderItem.deleteMany({
    where: { organizationId: { in: [orgA.id, orgB.id] } },
  });

  // Record initial stock levels so we can restore them cleanly upon test completion
  const initialRackCentral = (await prisma.stockLevel.findFirst({ where: { organizationId: orgA.id, warehouseId: whCentralA.id, productId: rackA.id } }))?.quantity ?? 12;
  const initialRackEast = (await prisma.stockLevel.findFirst({ where: { organizationId: orgA.id, warehouseId: whEastA.id, productId: rackA.id } }))?.quantity ?? 3;
  const initialProductMainB = (await prisma.stockLevel.findFirst({ where: { organizationId: orgB.id, warehouseId: whMainB.id, productId: productB.id } }))?.quantity ?? 7;

  // Set predictable stock levels for Org A
  await warehousesService.setStock(orgA.id, whCentralA.id, rackA.id, 4);
  await warehousesService.setStock(orgA.id, whEastA.id, rackA.id, 0);

  // Set predictable stock levels for Org B
  await warehousesService.setStock(orgB.id, whMainB.id, productB.id, 2);

  // ==================== TEST 1: Backorder creation on accept ====================
  console.log('\n--- Test 1: Quotation with shortfall transitions to Backorder on accept ---');
  // Order 10 units when only 4 are in stock -> 4 allocated, 6 shortfall
  const quoteA = (await quotationsService.createQuotation(orgA.id, repA.id, {
    customerId: customerA.id,
    lines: [{ productId: rackA.id, quantity: 10 }],
  }))!;
  await prisma.quotation.update({ where: { id: quoteA.id }, data: { status: 'approved' } });

  const planViewBefore = await fulfillmentService.getOrCreatePlan(orgA.id, quoteA.id);
  const rackLine = planViewBefore.lines.find((l) => l.productId === rackA.id)!;
  if (rackLine.shortfall !== 6 || rackLine.allocatedTotal !== 4) {
    throw new Error(`Expected 4 allocated and 6 shortfall, got alloc=${rackLine.allocatedTotal} shortfall=${rackLine.shortfall}`);
  }

  // Accept the plan -> should deduct 4 from stock and create BackorderItem for 6
  const acceptedPlanView = await fulfillmentService.acceptPlan(orgA.id, quoteA.id, opsUserA);
  const acceptedRackLine = acceptedPlanView.lines.find((l) => l.productId === rackA.id)!;
  if (acceptedRackLine.lineStatus !== 'backordered') {
    throw new Error(`Expected lineStatus 'backordered', got '${acceptedRackLine.lineStatus}'`);
  }

  const backorderA = await prisma.backorderItem.findFirst({
    where: { organizationId: orgA.id, quotationId: quoteA.id, productId: rackA.id },
  });
  if (!backorderA || backorderA.quantity !== 6 || backorderA.fulfilledQty !== 0 || backorderA.status !== 'pending') {
    throw new Error(`BackorderItem not created correctly: ${JSON.stringify(backorderA)}`);
  }

  const stockCentralAfterAccept = await prisma.stockLevel.findFirst({
    where: { organizationId: orgA.id, warehouseId: whCentralA.id, productId: rackA.id },
  });
  if (stockCentralAfterAccept?.quantity !== 0) {
    throw new Error(`Expected Central stock to be 0 after deducting 4, got ${stockCentralAfterAccept?.quantity}`);
  }
  console.log('[PASS] Test 1: Partial fulfillment accepted -> stock deducted, BackorderItem(qty=6, status=pending) persisted');

  // ==================== TEST 2: Setup Backorder in Org B for isolation check ====================
  console.log('\n--- Test 2: Create Backorder in Org B for cross-tenant isolation testing ---');
  const quoteB = (await quotationsService.createQuotation(orgB.id, undefined, {
    customerId: customerB.id,
    lines: [{ productId: productB.id, quantity: 5 }],
  }))!;
  await prisma.quotation.update({ where: { id: quoteB.id }, data: { status: 'approved' } });
  await fulfillmentService.getOrCreatePlan(orgB.id, quoteB.id);
  const opsB = orgB.users.find((u) => u.role === 'ops') || orgB.users[0]!;
  await fulfillmentService.acceptPlan(orgB.id, quoteB.id, { userId: opsB.id, email: opsB.email, role: 'ops' });

  const backorderB = await prisma.backorderItem.findFirst({
    where: { organizationId: orgB.id, quotationId: quoteB.id },
  });
  if (!backorderB || backorderB.status !== 'pending') {
    throw new Error(`Org B backorder setup failed`);
  }
  console.log('[PASS] Test 2: Org B backorder created');

  // ==================== TEST 3: Stock Arrival triggers BullMQ consolidation job ====================
  console.log('\n--- Test 3: Stock arrival in Org A enqueues job and raises Consolidation Prompt ---');
  // Stock arrives at East Hub in Org A: 6 units of rackA arrive
  await warehousesService.recordStockArrival(orgA.id, whEastA.id, rackA.id, 6);

  // Wait for BullMQ worker to consume and process job
  let promptA: any = null;
  for (let i = 0; i < 20; i++) {
    await sleep(300);
    promptA = await prisma.consolidationPrompt.findFirst({
      where: {
        organizationId: orgA.id,
        quotationId: quoteA.id,
        productId: rackA.id,
        status: 'pending',
      },
    });
    if (promptA) break;
  }

  if (!promptA) {
    throw new Error('Consolidation prompt was not generated by the background worker within timeout');
  }
  if (promptA.suggestedQty !== 6 || promptA.warehouseId !== whEastA.id) {
    throw new Error(`Prompt values incorrect: ${JSON.stringify(promptA)}`);
  }
  console.log('[PASS] Test 3: Stock arrival enqueued job -> worker generated ConsolidationPrompt(suggestedQty=6, warehouse=East)');

  // ==================== TEST 4: Cross-Tenant Isolation ====================
  console.log('\n--- Test 4: Verify stock event in Org A never touches Org B backorders ---');
  const promptsInOrgB = await prisma.consolidationPrompt.findMany({
    where: { organizationId: orgB.id, status: 'pending' },
  });
  if (promptsInOrgB.length !== 0) {
    throw new Error(`SECURITY VIOLATION: Stock arrival in Org A created a prompt in Org B!`);
  }

  const backorderBCheck = await prisma.backorderItem.findFirst({
    where: { id: backorderB.id },
  });
  if (backorderBCheck?.fulfilledQty !== 0 || backorderBCheck?.status !== 'pending') {
    throw new Error(`SECURITY VIOLATION: Org B backorder was modified by Org A stock event!`);
  }
  console.log('[PASS] Test 4: Strict Tenant Isolation confirmed: Org B backorders untouched');

  // ==================== TEST 5: Ops Consolidates Prompt ====================
  console.log('\n--- Test 5: Ops consolidates prompt -> stock deducted, plan updated, audit written ---');
  const consolidatedView = await fulfillmentService.consolidatePrompt(orgA.id, promptA.id, opsUserA);

  const consolidatedRackLine = consolidatedView.lines.find((l) => l.productId === rackA.id)!;
  if (consolidatedRackLine.allocatedTotal !== 10 || consolidatedRackLine.shortfall !== 0) {
    throw new Error(`Consolidation did not fulfill entire quantity: alloc=${consolidatedRackLine.allocatedTotal}, shortfall=${consolidatedRackLine.shortfall}`);
  }
  if (consolidatedRackLine.lineStatus !== 'fulfilled') {
    throw new Error(`Expected lineStatus 'fulfilled' after consolidation, got '${consolidatedRackLine.lineStatus}'`);
  }

  // Verify warehouse stock deduction at East Hub
  const eastStockAfter = await prisma.stockLevel.findFirst({
    where: { organizationId: orgA.id, warehouseId: whEastA.id, productId: rackA.id },
  });
  if (eastStockAfter?.quantity !== 0) {
    throw new Error(`East Hub stock should be 0 after consolidating 6, got ${eastStockAfter?.quantity}`);
  }

  // Verify BackorderItem updated to 'consolidated'
  const backorderAfter = await prisma.backorderItem.findFirst({
    where: { id: backorderA.id },
  });
  if (backorderAfter?.status !== 'consolidated' || backorderAfter?.fulfilledQty !== 6) {
    throw new Error(`BackorderItem status not consolidated: ${JSON.stringify(backorderAfter)}`);
  }

  // Verify ConsolidationPrompt marked 'consolidated'
  const promptAfter = await prisma.consolidationPrompt.findFirst({
    where: { id: promptA.id },
  });
  if (promptAfter?.status !== 'consolidated' || !promptAfter?.consolidatedAt) {
    throw new Error(`ConsolidationPrompt status not consolidated: ${JSON.stringify(promptAfter)}`);
  }

  // Verify audit log
  const audit = await prisma.auditLog.findFirst({
    where: {
      organizationId: orgA.id,
      entityType: 'quotation',
      entityId: quoteA.id,
      action: 'backorder_consolidated',
    },
  });
  if (!audit) throw new Error('Missing backorder_consolidated audit entry');
  console.log('[PASS] Test 5: Backorder consolidated: stock deducted, status fulfilled, audit recorded');

  // ==================== TEST 6: Queue Health Status & Worker Liveness ====================
  console.log('\n--- Test 6: Queue health report & worker liveness metrics ---');
  const queueHealth = await getQueueHealthStatus();
  if (queueHealth.status !== 'healthy') {
    throw new Error(`Expected queue health status 'healthy', got '${queueHealth.status}'`);
  }
  const consolidationQueueMetric = queueHealth.queues.find((q) => q.name === 'org_backorder_consolidation');
  if (!consolidationQueueMetric || !consolidationQueueMetric.worker.isAlive) {
    throw new Error(`Backorder consolidation worker not reported alive: ${JSON.stringify(consolidationQueueMetric)}`);
  }
  if (consolidationQueueMetric.counts.completed < 1) {
    throw new Error(`Expected at least 1 completed job in queue metric, got ${consolidationQueueMetric.counts.completed}`);
  }
  console.log('[PASS] Test 6: Queue health status healthy and worker reported alive with metrics');

  // ==================== TEST 7: HTTP RBAC Guards ====================
  console.log('\n--- Test 7: HTTP RBAC guards for backorder consolidation endpoints ---');
  const app = createApp();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Failed to bind test server');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const repToken = signInternalToken({ sub: repA.id, email: repA.email, org_id: orgA.id, role: 'rep' }, '1h');
    const opsToken = signInternalToken({ sub: opsA.id, email: opsA.email, org_id: orgA.id, role: 'ops' }, '1h');

    // Rep cannot access /backorders (403)
    const repBackorders = await fetch(`${baseUrl}/api/fulfillment/backorders`, {
      headers: { Authorization: `Bearer ${repToken}` },
    });
    if (repBackorders.status !== 403) {
      throw new Error(`Rep GET /backorders should be 403, got ${repBackorders.status}`);
    }

    // Ops can access /backorders (200)
    const opsBackorders = await fetch(`${baseUrl}/api/fulfillment/backorders`, {
      headers: { Authorization: `Bearer ${opsToken}` },
    });
    if (opsBackorders.status !== 200) {
      throw new Error(`Ops GET /backorders should be 200, got ${opsBackorders.status}`);
    }

    // Any internal user can check queue status (200)
    const queueStatusRes = await fetch(`${baseUrl}/api/fulfillment/queue-status`, {
      headers: { Authorization: `Bearer ${repToken}` },
    });
    if (queueStatusRes.status !== 200) {
      throw new Error(`GET /queue-status should be 200, got ${queueStatusRes.status}`);
    }
    const queueData = (await queueStatusRes.json()) as any;
    if (!queueData.queues || queueData.queues.length !== 2) {
      throw new Error(`Queue status payload invalid: ${JSON.stringify(queueData)}`);
    }

    console.log('[PASS] Test 7: HTTP RBAC guards: rep 403 on backorders, ops 200, queue-status 200');
  } finally {
    await warehousesService.setStock(orgA.id, whCentralA.id, rackA.id, 12);
    await warehousesService.setStock(orgA.id, whEastA.id, rackA.id, 3);
    await warehousesService.setStock(orgB.id, whMainB.id, productB.id, 7);
    await prisma.consolidationPrompt.deleteMany({
      where: { organizationId: { in: [orgA.id, orgB.id] } },
    });
    await prisma.backorderItem.deleteMany({
      where: { organizationId: { in: [orgA.id, orgB.id] } },
    });
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    await worker.close();
  }

  console.log('\n🎉 Phase 17 Backorders & Auto-Consolidation Isolation Suite PASSED (7/7) 🎉');
}

runBackordersIsolationTest()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Phase 17 Isolation Test FAILED:', err);
    process.exit(1);
  });