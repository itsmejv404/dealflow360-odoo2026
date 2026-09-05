import { io as ClientIO } from 'socket.io-client';
import { prisma } from '../lib/prisma.js';
import { redis } from '../lib/redis.js';
import { env } from '../config/env.js';
import { signInternalToken } from '../shared/jwt.js';
import { pricingService } from '../modules/quotations/pricing.service.js';

async function verifyPhase9() {
  console.log('🚀 --- STARTING PHASE 9 ISOLATION & LIVE MARGIN VERIFICATION ---');

  // 1. Fetch two distinct fully-onboarded seeded organizations
  const orgs = await prisma.organization.findMany({
    where: { status: 'active', onboardingCompleted: true },
    take: 2,
    include: {
      customerTiers: true,
      products: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  if (orgs.length < 2) {
    throw new Error('Verification requires at least 2 active seeded organizations');
  }

  const orgA = orgs[0]!;
  const orgB = orgs[1]!;
  console.log(`✓ Testing Tenants: Org A = ${orgA.name} (${orgA.id}), Org B = ${orgB.name} (${orgB.id})`);

  const tierA = orgA.customerTiers[0];
  const prodA = orgA.products[0];
  const tierB = orgB.customerTiers[0];
  const prodB = orgB.products[0];

  if (!tierA || !prodA || !tierB || !prodB) {
    throw new Error('Both organizations must have at least 1 tier and 1 product');
  }

  // 2. Test Redis Price List Caching & Tenant Namespacing
  console.log('🔍 Testing Redis price-list caching & namespace isolation...');
  await pricingService.invalidateTierCache(orgA.id);
  await pricingService.invalidateTierCache(orgB.id);

  // Initial calculation loads into cache
  await pricingService.getTierPriceListMap(orgA.id, tierA.id);
  await pricingService.getTierPriceListMap(orgB.id, tierB.id);

  const cachedA = await redis.get(`org:${orgA.id}:pricelist:${tierA.id}`);
  const cachedB = await redis.get(`org:${orgB.id}:pricelist:${tierB.id}`);

  if (!cachedA || !cachedB) {
    throw new Error('Failed to cache tier price list in Redis');
  }
  console.log(`✓ Redis Keys verified: org:${orgA.id}:pricelist:${tierA.id} & org:${orgB.id}:pricelist:${tierB.id}`);

  // Cross-tenant key isolation: orgA must not access orgB's key
  const crossCheck = await redis.get(`org:${orgA.id}:pricelist:${tierB.id}`);
  if (crossCheck) {
    throw new Error('Tenant cross-contamination detected in Redis cache!');
  }
  console.log('✓ Cross-tenant Redis key isolation confirmed.');

  // 3. Test Live Pricing & Margin Calculation Engine
  console.log('🔍 Testing live pricing & margin calculation with cost basis...');
  const calcResult = await pricingService.calculateQuotationPricing(
    orgA.id,
    tierA.id,
    [
      {
        productId: prodA.id,
        quantity: 2,
        lineDiscountPercent: 10,
      },
    ],
    5
  );

  console.log(`✓ Pricing computed: Subtotal=$${calcResult.totals.subtotal}, Net Total=$${calcResult.totals.totalAmount}, Margin=${calcResult.totals.totalMarginPercent}%`);

  // 4. Test Socket.IO Multi-Tenant Room Isolation & Live Margin Broadcast
  console.log('🔍 Testing Socket.IO multi-tenant room isolation...');
  const repA =
    (await prisma.user.findFirst({ where: { organizationId: orgA.id, role: 'rep', status: 'active' } })) ||
    (await prisma.user.findFirst({ where: { organizationId: orgA.id, status: 'active' } }));
  const repB =
    (await prisma.user.findFirst({ where: { organizationId: orgB.id, role: 'rep', status: 'active' } })) ||
    (await prisma.user.findFirst({ where: { organizationId: orgB.id, status: 'active' } }));
  if (!repA || !repB) {
    throw new Error('Both organizations need at least one active user for socket testing');
  }

  const tokenA = signInternalToken({ sub: repA.id, email: repA.email, org_id: orgA.id, role: 'rep' }, '1h');
  const tokenB = signInternalToken({ sub: repB.id, email: repB.email, org_id: orgB.id, role: 'rep' }, '1h');

  const socketA = ClientIO(`http://localhost:${env.API_PORT}`, {
    path: '/socket.io',
    auth: { token: tokenA },
    transports: ['websocket'],
  });

  const socketB = ClientIO(`http://localhost:${env.API_PORT}`, {
    path: '/socket.io',
    auth: { token: tokenB },
    transports: ['websocket'],
  });

  await new Promise<void>((resolve, reject) => {
    let connectedCount = 0;
    const timeout = setTimeout(() => reject(new Error('Socket connection timed out')), 5000);

    socketA.on('connect', () => {
      connectedCount++;
      if (connectedCount === 2) {
        clearTimeout(timeout);
        resolve();
      }
    });

    socketB.on('connect', () => {
      connectedCount++;
      if (connectedCount === 2) {
        clearTimeout(timeout);
        resolve();
      }
    });
  });

  console.log('✓ Both tenant sockets authenticated and connected.');

  // Verify that events emitted during API actions reach only Org A
  let socketAReceived = false;
  let socketBReceived = false;

  socketA.on('quote:created', (data: any) => {
    if (data && data.quotation) {
      socketAReceived = true;
    }
  });

  socketB.on('quote:created', (_data: any) => {
    socketBReceived = true;
  });

  // Call API to create a quote in Org A
  const custA = await prisma.customer.findFirst({ where: { organizationId: orgA.id } });
  if (!custA) {
    throw new Error('Org A has no customer');
  }

  const createRes = await fetch(`http://localhost:${env.API_PORT}/api/quotations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenA}`,
    },
    body: JSON.stringify({
      customerId: custA.id,
      orderDiscountPercent: 5,
      lines: [
        {
          productId: prodA.id,
          quantity: 2,
          lineDiscountPercent: 10,
        },
      ],
    }),
  });

  if (!createRes.ok) {
    const errBody = await createRes.text();
    throw new Error(`Failed to create quote via API: ${createRes.status} ${errBody}`);
  }

  const createdQuote = (await createRes.json() as any).quotation;
  console.log(`✓ Created test quotation: ${createdQuote.quotationNumber}`);

  await new Promise((r) => setTimeout(r, 600));

  if (!socketAReceived) {
    throw new Error('Socket A failed to receive live quote:created event from server');
  }
  if (socketBReceived) {
    throw new Error('Socket B improperly received Org A quote:created broadcast (Cross-tenant socket leakage!)');
  }

  console.log('✓ Socket.IO tenant room isolation verified: Org B received 0 cross-tenant events.');

  // Clean up quote
  await prisma.quotation.delete({ where: { id: createdQuote.id } });

  socketA.disconnect();
  socketB.disconnect();

  console.log('🎉 --- PHASE 9 VERIFICATION COMPLETE & PASSED ALL CHECKS ---');
  process.exit(0);
}

verifyPhase9().catch((err) => {
  console.error('❌ Phase 9 Verification Failed:', err);
  process.exit(1);
});
