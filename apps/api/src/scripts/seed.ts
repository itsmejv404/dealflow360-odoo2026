import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma.js';
import { storageService } from '../lib/storage.js';
import { signSuperAdminToken, signInternalToken } from '../shared/jwt.js';

export async function seedAll() {
  console.log('========================================');
  console.log('--- SEEDING DEALFLOW360 DATABASE ---');
  console.log('========================================\n');

  // 1. Clean Database
  await prisma.organizationInvite.deleteMany({});
  await prisma.orderLine.deleteMany({});
  await prisma.product.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.organization.deleteMany({});

  // 2. Super Admin Account
  const superAdminPassword = 'SuperAdminSecret123!';
  const superAdminHash = await bcrypt.hash(superAdminPassword, 10);
  const superAdmin = await prisma.user.create({
    data: {
      email: 'superadmin@dealflow360.com',
      passwordHash: superAdminHash,
      name: 'Platform Super Admin',
      role: 'super_admin',
      status: 'active',
    },
  });

  const superAdminToken = signSuperAdminToken({
    sub: superAdmin.id,
    email: superAdmin.email,
    role: 'super_admin',
  });

  console.log('✔ Seeded Super Admin: superadmin@dealflow360.com');

  // Sample 1x1 transparent PNG logo buffer
  const sampleLogoBuffer = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
  );

  // 3. Org 1: Acme Corp
  const defaultPasswordHash = await bcrypt.hash('Password123!', 10);
  const acme = await prisma.organization.create({
    data: {
      name: 'Acme Corp',
      slug: 'acme',
      status: 'active',
      address: '100 Industrial Parkway, Chicago, IL',
      description: 'Global manufacturer of industrial automation and hardware equipment.',
      contactEmail: 'contact@acme.com',
      contactPhone: '+1 (312) 555-0199',
      website: 'https://acme.com',
      currency: 'USD',
      timezone: 'America/New_York',
      onboardingCompleted: true,
      logoUrl: '/api/organization/logo?ext=png',
    },
  });

  await storageService.uploadTenantFile({
    orgId: acme.id,
    key: 'logo.png',
    buffer: sampleLogoBuffer,
    contentType: 'image/png',
  });

  // Seed all 5 roles for Acme Corp
  const acmeUsers = [
    { email: 'admin@acme.com', name: 'Alice Johnson (Admin)', role: 'org_admin' },
    { email: 'rep@acme.com', name: 'Robert Evans (Sales Rep)', role: 'rep' },
    { email: 'manager@acme.com', name: 'Marcus Vance (Sales Manager)', role: 'manager' },
    { email: 'finance@acme.com', name: 'Fiona Gallagher (Finance)', role: 'finance' },
    { email: 'ops@acme.com', name: 'Oliver Stone (Operations/Fulfillment)', role: 'ops' },
  ];

  for (const u of acmeUsers) {
    await prisma.user.create({
      data: {
        email: u.email,
        passwordHash: defaultPasswordHash,
        name: u.name,
        organizationId: acme.id,
        role: u.role,
        status: 'active',
      },
    });
  }

  // Suspended user for negative testing
  await prisma.user.create({
    data: {
      email: 'suspended@acme.com',
      passwordHash: defaultPasswordHash,
      name: 'Sam Suspended',
      organizationId: acme.id,
      role: 'rep',
      status: 'suspended',
    },
  });

  const acmeProduct1 = await prisma.product.create({
    data: {
      organizationId: acme.id,
      name: 'Acme Industrial Server Rack X1',
      sku: 'ACME-SRV-X1',
      price: 2500.0,
    },
  });

  const acmeProduct2 = await prisma.product.create({
    data: {
      organizationId: acme.id,
      name: 'Acme 24/7 Premium Enterprise Support',
      sku: 'ACME-SUPP-ENT',
      price: 600.0,
    },
  });

  await prisma.orderLine.create({
    data: {
      organizationId: acme.id,
      productId: acmeProduct1.id,
      quantity: 2,
      unitPrice: 2500.0,
    },
  });

  console.log('✔ Seeded Org 1: Acme Corp with 5 Roles (admin/rep/manager/finance/ops@acme.com) — Password: Password123!');

  // 4. Org 2: Globex Corporation
  const globex = await prisma.organization.create({
    data: {
      name: 'Globex Corporation',
      slug: 'globex',
      status: 'active',
      address: 'Friedrichstraße 44, 10117 Berlin, Germany',
      description: 'European leader in high-performance cloud hardware and networking.',
      contactEmail: 'contact@globex.de',
      contactPhone: '+49 30 1234567',
      website: 'https://globex.de',
      currency: 'EUR',
      timezone: 'Europe/Berlin',
      onboardingCompleted: true,
      logoUrl: '/api/organization/logo?ext=png',
    },
  });

  await storageService.uploadTenantFile({
    orgId: globex.id,
    key: 'logo.png',
    buffer: sampleLogoBuffer,
    contentType: 'image/png',
  });

  // Seed all 5 roles for Globex Corporation
  const globexUsers = [
    { email: 'admin@globex.com', name: 'Gerd Müller (Admin)', role: 'org_admin' },
    { email: 'rep@globex.com', name: 'Rachel Green (Sales Rep)', role: 'rep' },
    { email: 'manager@globex.com', name: 'Michael Scott (Sales Manager)', role: 'manager' },
    { email: 'finance@globex.com', name: 'Fabian Schmidt (Finance)', role: 'finance' },
    { email: 'ops@globex.com', name: 'Otto Becker (Operations/Fulfillment)', role: 'ops' },
  ];

  for (const u of globexUsers) {
    await prisma.user.create({
      data: {
        email: u.email,
        passwordHash: defaultPasswordHash,
        name: u.name,
        organizationId: globex.id,
        role: u.role,
        status: 'active',
      },
    });
  }

  const globexProduct1 = await prisma.product.create({
    data: {
      organizationId: globex.id,
      name: 'Globex Quantum Cluster Node',
      sku: 'GLBX-QNTM-01',
      price: 4800.0,
    },
  });

  await prisma.orderLine.create({
    data: {
      organizationId: globex.id,
      productId: globexProduct1.id,
      quantity: 1,
      unitPrice: 4800.0,
    },
  });

  console.log('✔ Seeded Org 2: Globex Corporation with 5 Roles (admin/rep/manager/finance/ops@globex.com) — Password: Password123!');

  // 5. Org 3: Apex Dynamics (Pending Onboarding with Active Invite Token)
  const apex = await prisma.organization.create({
    data: {
      name: 'Apex Dynamics',
      slug: 'apex',
      status: 'active',
      currency: 'GBP',
      timezone: 'Europe/London',
      onboardingCompleted: false,
    },
  });

  const apexInviteToken = 'apex-onboarding-demo-token-1234567890';
  await prisma.organizationInvite.create({
    data: {
      organizationId: apex.id,
      email: 'admin@apexdynamics.io',
      role: 'org_admin',
      token: apexInviteToken,
      expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
    },
  });

  console.log('✔ Seeded Org 3: Apex Dynamics (Pending Invite Activation)');
  console.log('\n========================================');
  console.log('🎉 DATABASE SEEDING COMPLETED SUCCESSFULLY');
  console.log('========================================\n');
}

if (process.argv[1]?.endsWith('seed.ts')) {
  seedAll()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Seeding failed:', err);
      process.exit(1);
    });
}
