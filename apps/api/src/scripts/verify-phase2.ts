import assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';
import { seedPhase2 } from './seed-phase2.js';
import { getTenantDb } from '../shared/tenant-db.js';
import { createApp } from '../app.js';
import { prisma } from '../lib/prisma.js';

export async function verifyPhase2() {
  console.log('\n========================================');
  console.log('--- STARTING PHASE 2 VERIFICATION TEST ---');
  console.log('========================================\n');

  // 1. Run Seed
  const data = await seedPhase2();

  const acmeDb = getTenantDb(data.acme.id);
  const globexDb = getTenantDb(data.globex.id);

  console.log('\n[TEST 1] Tenant-Scoped DB Helper Data Scoping');
  const acmeProducts = await acmeDb.product.findMany();
  console.log(`- Acme DB query returned ${acmeProducts.length} products (expected 2)`);
  assert.equal(acmeProducts.length, 2, 'Acme DB must return exactly 2 products');
  assert.ok(acmeProducts.every((p) => p.organizationId === data.acme.id), 'All Acme products must belong to Acme');

  const globexProducts = await globexDb.product.findMany();
  console.log(`- Globex DB query returned ${globexProducts.length} products (expected 1)`);
  assert.equal(globexProducts.length, 1, 'Globex DB must return exactly 1 product');
  assert.ok(globexProducts.every((p) => p.organizationId === data.globex.id), 'All Globex products must belong to Globex');
  console.log('✅ TEST 1 PASSED: Query scoping works across tenants.');

  console.log('\n[TEST 2] Cross-Tenant Read Prevention');
  const crossTenantProduct = await acmeDb.product.findFirst({
    where: { id: data.globexProduct1.id },
  });
  console.log(`- Acme DB attempting to find Globex product by ID result: ${crossTenantProduct}`);
  assert.equal(crossTenantProduct, null, 'Acme context must not find Globex product');
  console.log('✅ TEST 2 PASSED: Cross-tenant records unreachable in scoped DB queries.');

  console.log('\n[TEST 3] PostgreSQL Composite Foreign Key Tenant-Local Integrity');
  console.log('- Attempting to insert an OrderLine in Acme referencing Globex Product...');
  let fkRejected = false;
  try {
    // Attempt inserting directly with prisma (raw or tenant db)
    await prisma.orderLine.create({
      data: {
        organizationId: data.acme.id,
        productId: data.globexProduct1.id, // Belongs to Globex!
        quantity: 5,
        unitPrice: 2000.0,
      },
    });
  } catch (err: unknown) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      console.log(`- Rejected by Postgres with code: ${err.code} (${err.message.split('\n').pop()})`);
      if (err.code === 'P2003') {
        fkRejected = true;
      }
    } else {
      console.log('- Rejected with error:', err);
      fkRejected = true;
    }
  }
  assert.ok(fkRejected, 'Database must reject cross-tenant composite foreign key references');
  console.log('✅ TEST 3 PASSED: Postgres composite FK constraint strictly enforced.');

  console.log('\n[TEST 4] HTTP API Endpoint Isolation & Middleware');
  const app = createApp();
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 4a. Unauthenticated request
    const unauthRes = await fetch(`${baseUrl}/api/demo/products`);
    assert.equal(unauthRes.status, 401, 'Unauthenticated request must be 401');
    console.log('- Unauthenticated request rejected with 401 Unauthorized');

    // 4b. Acme requests products
    const acmeRes = await fetch(`${baseUrl}/api/demo/products`, {
      headers: { Authorization: `Bearer ${data.acmeToken}` },
    });
    assert.equal(acmeRes.status, 200);
    const acmeBody = (await acmeRes.json()) as { data: Array<{ id: string; name: string }> };
    assert.equal(acmeBody.data.length, 2);
    console.log(`- Acme API request returned ${acmeBody.data.length} products`);

    // 4c. Globex requests products
    const globexRes = await fetch(`${baseUrl}/api/demo/products`, {
      headers: { Authorization: `Bearer ${data.globexToken}` },
    });
    assert.equal(globexRes.status, 200);
    const globexBody = (await globexRes.json()) as { data: Array<{ id: string; name: string }> };
    assert.equal(globexBody.data.length, 1);
    console.log(`- Globex API request returned ${globexBody.data.length} product`);

    // 4d. Globex querying Acme product ID via API -> 404
    const crossApiRes = await fetch(`${baseUrl}/api/demo/products/${data.acmeProduct1.id}`, {
      headers: { Authorization: `Bearer ${data.globexToken}` },
    });
    assert.equal(crossApiRes.status, 404, 'Cross-tenant single item lookup must be 404');
    console.log('- Globex accessing Acme product ID via API correctly returned 404 Not Found');

    console.log('✅ TEST 4 PASSED: HTTP API tenant isolation verified.');
  } finally {
    server.close();
  }

  console.log('\n========================================');
  console.log('🎉 ALL PHASE 2 VERIFICATION CHECKS PASSED!');
  console.log('========================================\n');
}

if (process.argv[1]?.endsWith('verify-phase2.ts')) {
  verifyPhase2()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Verification failed:', err);
      process.exit(1);
    });
}
