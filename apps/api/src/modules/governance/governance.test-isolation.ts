import { prisma } from '../../lib/prisma.js';
import { governanceService } from './governance.service.js';

async function runGovernanceIsolationCheck() {
  console.log('--- Starting Phase 11 Multi-Tenancy & Governance Isolation Check ---');

  const orgA = await prisma.organization.upsert({
    where: { slug: 'gov-test-org-a' },
    create: { name: 'Gov Test Org A', slug: 'gov-test-org-a', currency: 'USD' },
    update: {},
  });

  const orgB = await prisma.organization.upsert({
    where: { slug: 'gov-test-org-b' },
    create: { name: 'Gov Test Org B', slug: 'gov-test-org-b', currency: 'USD' },
    update: {},
  });

  const tierBronzeA = await prisma.customerTier.upsert({
    where: { organizationId_code: { organizationId: orgA.id, code: 'bronze' } },
    create: { organizationId: orgA.id, name: 'Bronze', code: 'bronze', defaultDiscountPercent: 0 },
    update: {},
  });

  const tierGoldB = await prisma.customerTier.upsert({
    where: { organizationId_code: { organizationId: orgB.id, code: 'gold' } },
    create: { organizationId: orgB.id, name: 'Gold', code: 'gold', defaultDiscountPercent: 10 },
    update: {},
  });

  const hardwareCatA = await prisma.productCategory.upsert({
    where: { organizationId_code: { organizationId: orgA.id, code: 'hardware' } },
    create: { organizationId: orgA.id, name: 'Hardware', code: 'hardware' },
    update: {},
  });

  const hardwareCatB = await prisma.productCategory.upsert({
    where: { organizationId_code: { organizationId: orgB.id, code: 'hardware' } },
    create: { organizationId: orgB.id, name: 'Hardware', code: 'hardware' },
    update: {},
  });

  // Ceilings: Org A Bronze x Hardware = 5%, Org B Gold x Hardware = 20%
  await prisma.discountCeiling.upsert({
    where: {
      organizationId_tierId_categoryId: {
        organizationId: orgA.id,
        tierId: tierBronzeA.id,
        categoryId: hardwareCatA.id,
      },
    },
    create: {
      organizationId: orgA.id,
      tierId: tierBronzeA.id,
      categoryId: hardwareCatA.id,
      maxDiscountPercent: 5.0,
    },
    update: { maxDiscountPercent: 5.0 },
  });

  await prisma.discountCeiling.upsert({
    where: {
      organizationId_tierId_categoryId: {
        organizationId: orgB.id,
        tierId: tierGoldB.id,
        categoryId: hardwareCatB.id,
      },
    },
    create: {
      organizationId: orgB.id,
      tierId: tierGoldB.id,
      categoryId: hardwareCatB.id,
      maxDiscountPercent: 20.0,
    },
    update: { maxDiscountPercent: 20.0 },
  });

  const productHwA = await prisma.product.upsert({
    where: { organizationId_sku: { organizationId: orgA.id, sku: 'HW-GOV-A' } },
    create: {
      organizationId: orgA.id,
      name: 'Hardware Server A',
      sku: 'HW-GOV-A',
      price: 1000,
      costPrice: 500,
      categoryId: hardwareCatA.id,
    },
    update: {},
  });

  const productHwB = await prisma.product.upsert({
    where: { organizationId_sku: { organizationId: orgB.id, sku: 'HW-GOV-B' } },
    create: {
      organizationId: orgB.id,
      name: 'Hardware Server B',
      sku: 'HW-GOV-B',
      price: 1000,
      costPrice: 500,
      categoryId: hardwareCatB.id,
    },
    update: {},
  });

  // Test 1: 12% Hardware discount in Org A (Ceiling 5%) -> triggers Sales Manager
  const res1 = await governanceService.calculateRiskScore(
    orgA.id,
    tierBronzeA.id,
    [{
      productId: productHwA.id,
      categoryId: hardwareCatA.id,
      quantity: 1,
      unitPrice: 1000,
      lineDiscountPercent: 12.0,
      subtotal: 1000,
      total: 880,
    }],
    0
  );

  console.log(`Org A (12% Disc on 5% Ceiling) -> Routing: ${res1.approvalRouting}, HasBreach: ${res1.hasLineOverCeiling}, RiskScore: ${res1.riskScore}`);
  if (res1.approvalRouting !== 'manager') throw new Error('Expected manager routing for 12% disc on 5% ceiling');

  // Test 2: 25% Hardware discount in Org A (Ceiling 5%, Finance Threshold 15%) -> triggers Manager + Finance
  const res2 = await governanceService.calculateRiskScore(
    orgA.id,
    tierBronzeA.id,
    [{
      productId: productHwA.id,
      categoryId: hardwareCatA.id,
      quantity: 1,
      unitPrice: 1000,
      lineDiscountPercent: 25.0,
      subtotal: 1000,
      total: 750,
    }],
    0
  );

  console.log(`Org A (25% Disc on 5% Ceiling) -> Routing: ${res2.approvalRouting}, RiskLevel: ${res2.riskLevel}`);
  if (res2.approvalRouting !== 'manager_finance') throw new Error('Expected manager_finance routing for 25% disc');

  // Test 3: Cross-Tenant Isolation with identical 15% discount in Org A vs Org B
  const resIsoA = await governanceService.calculateRiskScore(
    orgA.id,
    tierBronzeA.id,
    [{
      productId: productHwA.id,
      categoryId: hardwareCatA.id,
      quantity: 1,
      unitPrice: 1000,
      lineDiscountPercent: 15.0,
      subtotal: 1000,
      total: 850,
    }],
    0
  );

  const resIsoB = await governanceService.calculateRiskScore(
    orgB.id,
    tierGoldB.id,
    [{
      productId: productHwB.id,
      categoryId: hardwareCatB.id,
      quantity: 1,
      unitPrice: 1000,
      lineDiscountPercent: 15.0,
      subtotal: 1000,
      total: 850,
    }],
    0
  );

  console.log(`Isolation Comparison for 15% Discount:`);
  console.log(`  Org A (Bronze, 5% Ceiling): Routing=${resIsoA.approvalRouting}, Flagged=${resIsoA.hasLineOverCeiling}`);
  console.log(`  Org B (Gold, 20% Ceiling):  Routing=${resIsoB.approvalRouting}, Flagged=${resIsoB.hasLineOverCeiling}`);

  if (resIsoA.approvalRouting !== 'manager' || resIsoA.hasLineOverCeiling !== true) {
    throw new Error('Org A should have flagged 15% discount as over ceiling');
  }

  if (resIsoB.approvalRouting !== 'none' || resIsoB.hasLineOverCeiling !== false) {
    throw new Error('Org B should have auto-approved 15% discount within 20% ceiling');
  }

  console.log('? All Phase 11 Governance & Isolation checks passed successfully!');
}

runGovernanceIsolationCheck()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Isolation check failed:', err);
    process.exit(1);
  });
