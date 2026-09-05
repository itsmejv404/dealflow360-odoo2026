import { prisma } from '../../lib/prisma.js';
import { rulebookService } from './rulebook.service.js';

async function runIsolationCheck() {
  console.log('--- Starting Phase 7 Multi-Tenancy & Governance Isolation Check ---');

  // Find or create two distinct test organizations
  let orgA = await prisma.organization.findFirst({ where: { slug: 'acme-corp' } });
  if (!orgA) {
    orgA = await prisma.organization.create({
      data: { name: 'Acme Corp', slug: 'acme-corp', status: 'active' },
    });
  }

  let orgB = await prisma.organization.findFirst({ where: { slug: 'globex-corp' } });
  if (!orgB) {
    orgB = await prisma.organization.create({
      data: { name: 'Globex Corp', slug: 'globex-corp', status: 'active' },
    });
  }

  console.log(`Org A: ${orgA.name} (${orgA.id})`);
  console.log(`Org B: ${orgB.name} (${orgB.id})`);

  // Ensure default rulebooks
  await rulebookService.ensureDefaultRulebook(orgA.id);
  await rulebookService.ensureDefaultRulebook(orgB.id);

  // Fetch categories and tiers for each org
  const rulebookA = await rulebookService.getRulebook(orgA.id);
  const rulebookB = await rulebookService.getRulebook(orgB.id);

  const goldA = rulebookA.tiers.find((t) => t.code === 'gold')!;
  const hwA = rulebookA.categories.find((c) => c.code === 'hardware')!;

  const goldB = rulebookB.tiers.find((t) => t.code === 'gold')!;
  const hwB = rulebookB.categories.find((c) => c.code === 'hardware')!;

  console.log(`Org A Gold Tier ID: ${goldA.id}, Hardware Category ID: ${hwA.id}`);
  console.log(`Org B Gold Tier ID: ${goldB.id}, Hardware Category ID: ${hwB.id}`);

  if (goldA.id === goldB.id || hwA.id === hwB.id) {
    throw new Error('FAILED: Tiers or categories are shared across tenants!');
  }

  // 1. Configure Org A: Gold x Hardware = 20%, Finance Threshold = 15%
  await rulebookService.updateCeilings(orgA.id, [
    { tierId: goldA.id, categoryId: hwA.id, maxDiscountPercent: 20 },
  ]);
  await rulebookService.updateApprovalChainConfig(orgA.id, {
    managerThresholdPercent: 0,
    financeThresholdPercent: 15,
    requireFinanceAboveThreshold: true,
    autoApproveWithinCeilings: true,
  });

  // 2. Configure Org B: Gold x Hardware = 10%, Finance Threshold = 5%
  await rulebookService.updateCeilings(orgB.id, [
    { tierId: goldB.id, categoryId: hwB.id, maxDiscountPercent: 10 },
  ]);
  await rulebookService.updateApprovalChainConfig(orgB.id, {
    managerThresholdPercent: 0,
    financeThresholdPercent: 5,
    requireFinanceAboveThreshold: true,
    autoApproveWithinCeilings: true,
  });

  // 3. Verify Org A and Org B rulebooks retain independent settings
  const checkA = await rulebookService.getRulebook(orgA.id);
  const checkB = await rulebookService.getRulebook(orgB.id);

  const ceilingA = checkA.matrix.find((m) => m.category.id === hwA.id)?.tierCeilings[goldA.id]?.maxDiscountPercent;
  const ceilingB = checkB.matrix.find((m) => m.category.id === hwB.id)?.tierCeilings[goldB.id]?.maxDiscountPercent;

  console.log(`Org A Gold x Hardware Ceiling: ${ceilingA}% (Expected: 20%)`);
  console.log(`Org B Gold x Hardware Ceiling: ${ceilingB}% (Expected: 10%)`);
  console.log(`Org A Finance Threshold: +${checkA.approvalConfig?.financeThresholdPercent}% (Expected: +15%)`);
  console.log(`Org B Finance Threshold: +${checkB.approvalConfig?.financeThresholdPercent}% (Expected: +5%)`);

  if (ceilingA !== 20 || ceilingB !== 10) {
    throw new Error('FAILED: Ceilings do not match expected tenant configurations!');
  }
  if (checkA.approvalConfig?.financeThresholdPercent !== 15 || checkB.approvalConfig?.financeThresholdPercent !== 5) {
    throw new Error('FAILED: Approval thresholds do not match expected tenant configurations!');
  }

  // 4. Cross-Tenant Attempt: Org B trying to update with Org A's IDs
  console.log('Testing cross-tenant reference prevention...');
  let crossTenantPrevented = false;
  try {
    await rulebookService.updateCeilings(orgB.id, [
      { tierId: goldA.id, categoryId: hwA.id, maxDiscountPercent: 50 },
    ]);
  } catch (err: any) {
    crossTenantPrevented = true;
    console.log(`Cross-tenant ceiling update correctly rejected: "${err.message}"`);
  }

  if (!crossTenantPrevented) {
    throw new Error('FAILED: Cross-tenant ceiling update was not rejected!');
  }

  // 5. Simulate Governance Evaluation across both orgs
  console.log('\n--- Testing Governance Simulator Outcomes ---');

  // Test Case 1: 18% Discount on Gold x Hardware
  const sim1A = await rulebookService.evaluateRule(orgA.id, {
    tierId: goldA.id,
    categoryId: hwA.id,
    proposedDiscountPercent: 18,
  });
  console.log(`Org A (18% proposed): outcome=${sim1A.outcome}, delta=${sim1A.discountDelta}%`);

  const sim1B = await rulebookService.evaluateRule(orgB.id, {
    tierId: goldB.id,
    categoryId: hwB.id,
    proposedDiscountPercent: 18,
  });
  console.log(`Org B (18% proposed): outcome=${sim1B.outcome}, delta=${sim1B.discountDelta}%`);

  if (sim1A.outcome !== 'AUTO_APPROVED') {
    throw new Error(`Expected Org A 18% to be AUTO_APPROVED, got ${sim1A.outcome}`);
  }
  if (sim1B.outcome !== 'MANAGER_THEN_FINANCE') {
    throw new Error(`Expected Org B 18% to be MANAGER_THEN_FINANCE, got ${sim1B.outcome}`);
  }

  // Test Case 2: 25% Discount on Gold x Hardware
  const sim2A = await rulebookService.evaluateRule(orgA.id, {
    tierId: goldA.id,
    categoryId: hwA.id,
    proposedDiscountPercent: 25,
  });
  console.log(`Org A (25% proposed): outcome=${sim2A.outcome}, delta=${sim2A.discountDelta}%`);

  if (sim2A.outcome !== 'MANAGER_ONLY') {
    throw new Error(`Expected Org A 25% to be MANAGER_ONLY, got ${sim2A.outcome}`);
  }

  console.log('\n✅ ALL PHASE 7 MULTI-TENANCY & GOVERNANCE ISOLATION CHECKS PASSED!');
}

runIsolationCheck()
  .catch((err) => {
    console.error('❌ Check failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
