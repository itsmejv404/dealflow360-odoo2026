import http from 'http';
import { prisma } from '../../lib/prisma.js';
import { redis } from '../../lib/redis.js';
import { warehousesService } from './warehouses.service.js';
import { signInternalToken } from '../../shared/jwt.js';
import { createApp } from '../../app.js';

async function runWarehousesIsolationTest() {
  console.log('--- Starting Phase 15 Warehouses & Inventory Isolation Test ---');

  const orgs = await prisma.organization.findMany({
    where: { onboardingCompleted: true },
    orderBy: { createdAt: 'asc' },
    take: 2,
    include: { products: true, users: true },
  });

  if (orgs.length < 2 || !orgs[0] || !orgs[1]) {
    console.error('Error: Need at least 2 seeded organizations for isolation testing.');
    process.exit(1);
  }

  const orgA = orgs[0]!;
  const orgB = orgs[1]!;
  console.log(`Org A: ${orgA.name} (${orgA.id})`);
  console.log(`Org B: ${orgB.name} (${orgB.id})`);

  const adminA = orgA.users.find((u) => u.role === 'org_admin');
  const opsA = orgA.users.find((u) => u.role === 'ops');
  const repA = orgA.users.find((u) => u.role === 'rep');
  if (!adminA || !opsA || !repA) {
    throw new Error('Org A needs seeded admin, ops and rep users (run npm run seed first)');
  }

  const whA1 = await prisma.warehouse.findFirst({
    where: { organizationId: orgA.id },
    orderBy: { createdAt: 'asc' },
  });
  const whB1 = await prisma.warehouse.findFirst({
    where: { organizationId: orgB.id },
    orderBy: { createdAt: 'asc' },
  });
  const prodA = orgA.products[0];
  const prodB = orgB.products[0];
  if (!whA1 || !whB1 || !prodA || !prodB) {
    throw new Error('Both organizations need a seeded warehouse and product');
  }

  // ---------- Test 1: warehouse lists are org-scoped ----------
  const listA = await warehousesService.listWarehouses(orgA.id);
  const listB = await warehousesService.listWarehouses(orgB.id);
  if (listA.some((w) => w.organizationId !== orgA.id) || listB.some((w) => w.organizationId !== orgB.id)) {
    throw new Error('CROSS-TENANT LEAK: warehouse list contained foreign organizations');
  }
  if (listA.some((w) => w.id === whB1.id) || listB.some((w) => w.id === whA1.id)) {
    throw new Error('CROSS-TENANT LEAK: org A warehouses visible in org B list (or vice versa)');
  }
  console.log('✔ Test 1 PASSED: warehouse lists are strictly org-scoped');

  // ---------- Test 2: cross-tenant warehouse mutations rejected ----------
  let blocked = false;
  try {
    await warehousesService.updateWarehouse(orgA.id, whB1.id, { name: 'Hijacked' });
  } catch {
    blocked = true;
  }
  if (!blocked) throw new Error('SECURITY VIOLATION: org A updated org B warehouse');
  blocked = false;
  try {
    await warehousesService.deleteWarehouse(orgA.id, whB1.id);
  } catch {
    blocked = true;
  }
  if (!blocked) throw new Error('SECURITY VIOLATION: org A deleted org B warehouse');
  console.log('✔ Test 2 PASSED: cross-tenant warehouse update/delete rejected (404)');

  // ---------- Test 3: warehouse code unique per org, reusable across orgs ----------
  let conflictBlocked = false;
  try {
    await warehousesService.createWarehouse(orgA.id, {
      name: 'Duplicate Code WH',
      code: listB[0]!.code, // same code as an org B warehouse — allowed across orgs
    });
  } catch {
    conflictBlocked = true;
  }
  if (conflictBlocked) {
    throw new Error('Same warehouse code should be allowed across different organizations');
  }
  blocked = false;
  try {
    await warehousesService.createWarehouse(orgA.id, {
      name: 'Same Code Again',
      code: listB[0]!.code,
    });
  } catch {
    blocked = true;
  }
  if (!blocked) throw new Error('Duplicate code inside one organization must be rejected (409)');
  const scratchWh = await prisma.warehouse.findFirst({
    where: { organizationId: orgA.id, name: 'Duplicate Code WH' },
  });
  if (!scratchWh) throw new Error('Scratch warehouse missing');
  await prisma.warehouse.delete({ where: { id: scratchWh.id } });
  console.log('✔ Test 3 PASSED: codes unique per organization, reusable across organizations');

  // ---------- Test 4: cross-tenant stock adjustments rejected ----------
  blocked = false;
  try {
    await warehousesService.setStock(orgA.id, whB1.id, prodB.id, 999);
  } catch {
    blocked = true;
  }
  if (!blocked) throw new Error('SECURITY VIOLATION: org A adjusted org B stock (foreign warehouse)');
  blocked = false;
  try {
    await warehousesService.setStock(orgA.id, whA1.id, prodB.id, 999);
  } catch {
    blocked = true;
  }
  if (!blocked) throw new Error('SECURITY VIOLATION: org A stocked a foreign product in its own warehouse');
  console.log('✔ Test 4 PASSED: cross-tenant stock adjustments rejected (foreign warehouse/product)');

  // ---------- Test 5: cache correctness — adjust reflects immediately ----------
  const before = await warehousesService.getStockMatrix(orgA.id);
  const rowBefore = before.rows.find((r) => r.productId === prodA.id);
  const beforeQty = rowBefore?.quantities[whA1.id] ?? 0;
  const newQty = beforeQty + 5;

  await warehousesService.setStock(orgA.id, whA1.id, prodA.id, newQty);
  const after = await warehousesService.getStockMatrix(orgA.id);
  const afterQty = after.rows.find((r) => r.productId === prodA.id)?.quantities[whA1.id];
  if (afterQty !== newQty) {
    throw new Error(`Cache not invalidated: expected ${newQty} after adjust, read ${afterQty}`);
  }
  const cachedKeyExists = await redis.exists(`org:${orgA.id}:stock:all`);
  if (!cachedKeyExists) {
    throw new Error('Stock matrix was not served from the org-namespaced cache key');
  }
  // restore
  await warehousesService.setStock(orgA.id, whA1.id, prodA.id, beforeQty);
  console.log('✔ Test 5 PASSED: adjust invalidates cache; next read reflects it immediately (org:{id}:stock:all)');

  // ---------- Test 6: cache isolation between orgs ----------
  const cacheB = await redis.get(`org:${orgB.id}:stock:all`);
  await warehousesService.setStock(orgA.id, whA1.id, prodA.id, beforeQty + 1);
  const cacheBAfter = await redis.get(`org:${orgB.id}:stock:all`);
  if (cacheB !== cacheBAfter) {
    throw new Error('CROSS-TENANT LEAK: org A stock adjustment mutated org B cached stock');
  }
  await warehousesService.setStock(orgA.id, whA1.id, prodA.id, beforeQty);
  console.log('✔ Test 6 PASSED: org A stock changes never touch org B cached matrix');

  // ---------- Test 7: shipping rules are org-scoped with the standing policy ----------
  const rulesA0 = await warehousesService.getShippingRules(orgA.id);
  if (rulesA0.allowSplitShipments !== true || rulesA0.chargeForSplitShipments !== false) {
    throw new Error('Seeded/default shipping policy wrong: splits allowed, never charged to customer');
  }
  await warehousesService.updateShippingRules(orgA.id, { deliveryExtensionDays: 5 });
  const rulesA1 = await warehousesService.getShippingRules(orgA.id);
  const rulesB = await warehousesService.getShippingRules(orgB.id);
  if (rulesA1.deliveryExtensionDays !== 5) throw new Error('Shipping rule update did not persist');
  if (rulesB.deliveryExtensionDays === 5) {
    throw new Error('CROSS-TENANT LEAK: org A shipping rules changed org B rules');
  }
  await warehousesService.updateShippingRules(orgA.id, { deliveryExtensionDays: 3 });
  console.log('✔ Test 7 PASSED: shipping rules scoped per org (splits allowed, customer never pays extra)');

  // ---------- Test 8: delete guard for stocked warehouses ----------
  blocked = false;
  try {
    await warehousesService.deleteWarehouse(orgA.id, whA1.id);
  } catch {
    blocked = true;
  }
  if (!blocked) throw new Error('Warehouse holding stock records must refuse deletion (400)');
  console.log('✔ Test 8 PASSED: warehouses with stock cannot be deleted (clear stock first)');

  // ---------- Test 9: HTTP RBAC — ops adjusts, rep blocked ----------
  const app = createApp();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Failed to bind test server');
  const port = address.port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const opsToken = signInternalToken({ sub: opsA.id, email: opsA.email, org_id: orgA.id, role: 'ops' }, '1h');
    const repToken = signInternalToken({ sub: repA.id, email: repA.email, org_id: orgA.id, role: 'rep' }, '1h');

    // Clear the rate-limit-free endpoint anyway (defense: no limiter here)
    await redis.del(`rl:${orgA.id}:${opsA.id}`);

    const opsRes = await fetch(`${baseUrl}/api/warehouses/${whA1.id}/stock/${prodA.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${opsToken}` },
      body: JSON.stringify({ quantity: beforeQty }),
    });
    if (opsRes.status !== 200) {
      throw new Error(`Ops stock adjustment should succeed (got ${opsRes.status})`);
    }

    const repRes = await fetch(`${baseUrl}/api/warehouses/${whA1.id}/stock/${prodA.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${repToken}` },
      body: JSON.stringify({ quantity: 42 }),
    });
    if (repRes.status !== 403) {
      throw new Error(`Rep stock adjustment must be rejected with 403 (got ${repRes.status})`);
    }

    const anonRes = await fetch(`${baseUrl}/api/warehouses`);
    if (anonRes.status !== 401) {
      throw new Error(`Unauthenticated warehouse list must be 401 (got ${anonRes.status})`);
    }
    console.log('✔ Test 9 PASSED: HTTP RBAC — ops adjusts stock, rep 403, anonymous 401');
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }

  console.log('\n--- Phase 15 Warehouses & Inventory Isolation Suite PASSED (9/9) ---');
}

runWarehousesIsolationTest()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Phase 15 Isolation Test FAILED:', err);
    process.exit(1);
  });
