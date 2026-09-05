import { prisma } from '../lib/prisma.js';
import { signInternalToken } from '../shared/jwt.js';

export async function seedPhase2() {
  console.log('--- Seeding Phase 2 Multi-Tenant Data ---');

  // Clean existing demo data
  await prisma.orderLine.deleteMany({});
  await prisma.product.deleteMany({});
  await prisma.organization.deleteMany({
    where: { slug: { in: ['acme', 'globex'] } },
  });

  // 1. Create Org A: Acme Corp
  const acme = await prisma.organization.create({
    data: {
      name: 'Acme Corp',
      slug: 'acme',
      status: 'active',
    },
  });

  // 2. Create Org B: Globex Corporation
  const globex = await prisma.organization.create({
    data: {
      name: 'Globex Corporation',
      slug: 'globex',
      status: 'active',
    },
  });

  // 3. Create Products for Acme
  const acmeProduct1 = await prisma.product.create({
    data: {
      organizationId: acme.id,
      name: 'Acme Industrial Widget',
      sku: 'ACME-WIDGET-01',
      price: 100.0,
    },
  });

  const acmeProduct2 = await prisma.product.create({
    data: {
      organizationId: acme.id,
      name: 'Acme Support Package',
      sku: 'ACME-SUPP-01',
      price: 250.0,
    },
  });

  // 4. Create OrderLine for Acme
  const acmeOrderLine = await prisma.orderLine.create({
    data: {
      organizationId: acme.id,
      productId: acmeProduct1.id,
      quantity: 2,
      unitPrice: 100.0,
    },
  });

  // 5. Create Products for Globex
  const globexProduct1 = await prisma.product.create({
    data: {
      organizationId: globex.id,
      name: 'Globex Super Server',
      sku: 'GLBX-SRV-01',
      price: 2000.0,
    },
  });

  // 6. Create OrderLine for Globex
  const globexOrderLine = await prisma.orderLine.create({
    data: {
      organizationId: globex.id,
      productId: globexProduct1.id,
      quantity: 1,
      unitPrice: 2000.0,
    },
  });

  // 7. Create Users for Acme and Globex
  const acmeUser = await prisma.user.create({
    data: {
      email: 'admin@acme.com',
      name: 'Acme Admin',
      passwordHash: 'dummyhash',
      organizationId: acme.id,
      role: 'org_admin',
      status: 'active',
    },
  });

  const globexUser = await prisma.user.create({
    data: {
      email: 'admin@globex.com',
      name: 'Globex Admin',
      passwordHash: 'dummyhash',
      organizationId: globex.id,
      role: 'org_admin',
      status: 'active',
    },
  });

  // Generate tokens
  const acmeToken = signInternalToken({
    sub: acmeUser.id,
    email: acmeUser.email,
    org_id: acme.id,
    role: 'org_admin',
  });

  const globexToken = signInternalToken({
    sub: globexUser.id,
    email: globexUser.email,
    org_id: globex.id,
    role: 'org_admin',
  });

  console.log(`[Org A - Acme] ID: ${acme.id}`);
  console.log(`  Products: ${acmeProduct1.id} (${acmeProduct1.name}), ${acmeProduct2.id} (${acmeProduct2.name})`);
  console.log(`  Order Line: ${acmeOrderLine.id}`);
  console.log(`  JWT Token: ${acmeToken}`);
  console.log(`\n[Org B - Globex] ID: ${globex.id}`);
  console.log(`  Products: ${globexProduct1.id} (${globexProduct1.name})`);
  console.log(`  Order Line: ${globexOrderLine.id}`);
  console.log(`  JWT Token: ${globexToken}`);
  console.log('\n--- Seeding Complete ---');

  return {
    acme,
    globex,
    acmeProduct1,
    acmeProduct2,
    globexProduct1,
    acmeOrderLine,
    globexOrderLine,
    acmeToken,
    globexToken,
  };
}

if (process.argv[1]?.endsWith('seed-phase2.ts')) {
  seedPhase2()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Seed failed:', err);
      process.exit(1);
    });
}
