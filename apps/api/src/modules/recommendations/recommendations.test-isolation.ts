import { prisma } from '../../lib/prisma.js';
import { recommendationsService } from './recommendations.service.js';

async function runIsolationTests() {
  console.log('====================================================');
  console.log('--- RUNNING PHASE 10 UPSELL ISOLATION TESTS ---');
  console.log('====================================================\n');

  const acme = await prisma.organization.findUnique({ where: { slug: 'acme' } });
  const globex = await prisma.organization.findUnique({ where: { slug: 'globex' } });

  if (!acme || !globex) {
    throw new Error('Required seeded organizations (Acme, Globex) not found.');
  }

  // 1. Fetch Acme Server Rack (hardware)
  const acmeServer = await prisma.product.findFirst({
    where: { organizationId: acme.id, sku: 'ACME-SRV-X1' },
  });
  if (!acmeServer) throw new Error('Acme Server Rack product not found');

  // 2. Fetch Globex Quantum Node (hardware)
  const globexNode = await prisma.product.findFirst({
    where: { organizationId: globex.id, sku: 'GLBX-QNTM-01' },
  });
  if (!globexNode) throw new Error('Globex Cluster Node product not found');

  const isSameCategoryScope = (suggestions: { categoryId: string | null }[], categories: Set<string | null>) =>
    suggestions.every((s) => categories.has(s.categoryId));

  // Test 1: Acme context returns same-category (hardware) Acme suggestions only
  console.log('Test 1: Acme rep asks for similar products with Acme Server Rack (hardware) in cart...');
  const acmeSuggestions = await recommendationsService.getUpsellSuggestions(acme.id, {
    currentProductIds: [acmeServer.id],
    currentTotalAmount: 2500,
    currentTotalCost: 1500,
  });

  const cartCategoriesA = new Set<string | null>([acmeServer.categoryId]);

  if (acmeSuggestions.length === 0) {
    throw new Error('Expected Acme suggestions but received empty array');
  }

  const hasAcmeCables = acmeSuggestions.some((s) => s.sku === 'ACME-ACC-CAB');
  const hasCrossCategoryLeak = acmeSuggestions.some((s) => !cartCategoriesA.has(s.categoryId));
  const hasGlobexLeak = acmeSuggestions.some((s) => s.sku.startsWith('GLBX-'));

  if (!hasAcmeCables) {
    throw new Error('Acme suggestions missing same-category item ACME-ACC-CAB');
  }
  if (hasCrossCategoryLeak) {
    throw new Error('Suggestions included products outside the cart category');
  }
  if (hasGlobexLeak) {
    throw new Error('Cross-tenant data leak! Acme suggestions contained Globex products');
  }
  if (!isSameCategoryScope(acmeSuggestions, cartCategoriesA)) {
    throw new Error('Suggestion category scope violated');
  }
  const topAcme = acmeSuggestions[0];
  if (!topAcme) throw new Error('Expected top Acme suggestion');
  console.log(`✔ Passed: Acme received ${acmeSuggestions.length} same-category suggestions (Top: ${topAcme.name}, margin delta: +$${topAcme.deltaMarginAmount})`);

  // Test 2: Globex context querying with its only hardware product
  console.log('\nTest 2: Globex rep asks for similar products with Globex Quantum Node (hardware) in cart...');
  const globexSuggestions = await recommendationsService.getUpsellSuggestions(globex.id, {
    currentProductIds: [globexNode.id],
    currentTotalAmount: 4800,
    currentTotalCost: 3000,
  });

  const hasAcmeLeak = globexSuggestions.some((s) => s.sku.startsWith('ACME-'));
  const globexHardwareCount = await prisma.product.count({
    where: { organizationId: globex.id, categoryId: globexNode.categoryId, status: 'active' },
  });

  // Only one active Globex hardware product exists (the cart item itself),
  // so the same-category suggestion set must be empty — and never leak Acme.
  if (globexSuggestions.length !== 0) {
    throw new Error('Expected empty same-category suggestions for Globex hardware cart');
  }
  if (hasAcmeLeak) {
    throw new Error('Cross-tenant data leak! Globex suggestions contained Acme products');
  }
  if (globexHardwareCount !== 1) {
    throw new Error(`Test precondition broken: expected 1 active Globex hardware product, found ${globexHardwareCount}`);
  }
  console.log('✔ Passed: Globex same-category set is correctly empty and fully isolated');

  // Test 3: Replaying Acme product ID within Globex context
  console.log('\nTest 3: Attempting cross-tenant lookup (passing Acme product ID to Globex org context)...');
  const crossTenantAttempt = await recommendationsService.getUpsellSuggestions(globex.id, {
    currentProductIds: [acmeServer.id],
    currentTotalAmount: 2500,
    currentTotalCost: 1500,
  });

  const leakedAnyAcme = crossTenantAttempt.some((s) => s.sku.startsWith('ACME-'));
  if (crossTenantAttempt.length > 0) {
    throw new Error('Foreign product IDs resolved to suggestions in another tenant!');
  }
  if (leakedAnyAcme) {
    throw new Error('Cross-tenant leak detected when passing foreign product IDs!');
  }
  console.log('✔ Passed: No foreign tenant items resolved across tenant boundaries');

  console.log('\n====================================================');
  console.log('🎉 ALL PHASE 10 ISOLATION TESTS PASSED');
  console.log('====================================================\n');
}

runIsolationTests()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Test failed:', err);
    process.exit(1);
  });
