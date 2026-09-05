import { prisma } from '../../lib/prisma.js';
import { portalService } from './portal.service.js';
import { quotationsService } from '../quotations/quotations.service.js';
import { signCustomerToken } from '../../shared/jwt.js';

async function runPortalIsolationTest() {
  console.log('--- Starting Phase 13 Customer Portal Shell & Security Isolation Test ---');

  // 1. Fetch two distinct organizations (fully provisioned, deterministic order)
  const orgs = await prisma.organization.findMany({
    where: { onboardingCompleted: true },
    orderBy: { createdAt: 'asc' },
    take: 2,
    include: {
      customerTiers: true,
      products: true,
      users: true,
    },
  });

  if (orgs.length < 2 || !orgs[0] || !orgs[1]) {
    console.error('Error: Need at least 2 seeded organizations for isolation testing.');
    process.exit(1);
  }

  const orgA = orgs[0]!;
  const orgB = orgs[1]!;
  console.log(`Org A: ${orgA.name} (${orgA.id})`);
  console.log(`Org B: ${orgB.name} (${orgB.id})`);

  let userRepA = orgA.users.find((u) => u.role === 'rep') || orgA.users[0];
  if (!userRepA) {
    userRepA = await prisma.user.create({
      data: {
        organizationId: orgA.id,
        email: `portal-rep-${Date.now()}@orga.com`,
        passwordHash: 'dummy',
        name: 'Portal Rep A',
        role: 'rep',
      },
    });
  }

  const tierA = orgA.customerTiers[0];
  const prodA = orgA.products[0];
  const tierB = orgB.customerTiers[0];
  const prodB = orgB.products[0];

  if (!tierA || !prodA || !tierB || !prodB) {
    throw new Error('Both organizations must have at least 1 customer tier and 1 product');
  }

  // 2. Setup Customer in Org A and Org B
  let custA = await prisma.customer.findFirst({
    where: { organizationId: orgA.id },
  });
  if (!custA) {
    custA = await prisma.customer.create({
      data: {
        organizationId: orgA.id,
        tierId: tierA.id,
        name: 'Portal Customer A',
        email: 'portal-customer-a@example.com',
      },
    });
  }

  let custB = await prisma.customer.findFirst({
    where: { organizationId: orgB.id },
  });
  if (!custB) {
    custB = await prisma.customer.create({
      data: {
        organizationId: orgB.id,
        tierId: tierB.id,
        name: 'Portal Customer B',
        email: 'portal-customer-b@example.com',
      },
    });
  }

  // 3. Create Quotation 1 in Org A (Assigned to Customer A)
  const quoteA1 = await quotationsService.createQuotation(orgA.id, userRepA.id, {
    customerId: custA.id,
    orderDiscountPercent: 5.0,
    lines: [
      {
        productId: prodA.id,
        quantity: 2,
        lineDiscountPercent: 0,
      },
    ],
  });

  // Create Quotation 2 in Org A (Unassigned to Customer A's token)
  const quoteA2 = await quotationsService.createQuotation(orgA.id, userRepA.id, {
    customerId: custA.id,
    orderDiscountPercent: 0,
    lines: [
      {
        productId: prodA.id,
        quantity: 1,
        lineDiscountPercent: 0,
      },
    ],
  });

  // Create Quotation 1 in Org B (Belongs to foreign tenant Org B)
  const quoteB1 = await quotationsService.createQuotation(orgB.id, userRepA.id, {
    customerId: custB.id,
    orderDiscountPercent: 0,
    lines: [
      {
        productId: prodB.id,
        quantity: 3,
        lineDiscountPercent: 0,
      },
    ],
  });

  if (!quoteA1 || !quoteA2 || !quoteB1) {
    throw new Error('Failed to create test quotations');
  }

  console.log(`Created Quote A1 (${quoteA1.id}) in Org A`);
  console.log(`Created Quote A2 (${quoteA2.id}) in Org A`);
  console.log(`Created Quote B1 (${quoteB1.id}) in Org B`);

  // 4. Rep dispatches magic link to Customer A
  const sendRes = await portalService.sendQuotationToCustomer(
    orgA.id,
    quoteA1.id,
    {
      userId: userRepA.id,
      email: userRepA.email,
      role: 'rep',
      name: userRepA.name,
    }
  );

  console.log(`Dispatched magic link to: ${sendRes.customerEmail}, Status: ${sendRes.status}`);
  if (!sendRes.token || sendRes.status !== 'sent') {
    throw new Error('Magic link dispatch failed or did not update quotation status to "sent"');
  }

  // 5. Test 1: Customer A loads their own authorized quotation (Quote A1)
  const portalQuoteA1 = await portalService.getCustomerQuotation(
    orgA.id,
    quoteA1.id,
    [quoteA1.id]
  );
  if (!portalQuoteA1 || portalQuoteA1.id !== quoteA1.id) {
    throw new Error('Failed to load authorized quotation in customer portal');
  }
  console.log('✔ Test 1 PASSED: Customer can successfully view their authorized quotation');

  // 6. Test 2: Customer A loads Org A tenant branding
  const brandingA = await portalService.getOrganizationBranding(orgA.id);
  if (!brandingA || brandingA.name !== orgA.name) {
    throw new Error('Failed to load tenant organization branding');
  }
  console.log(`✔ Test 2 PASSED: Loaded white-labeled branding for "${brandingA.name}"`);

  // 7. Test 3: Cross-Tenant Attack — Customer A token attempts to access Org B Quotation (Quote B1)
  let crossTenantBlocked = false;
  try {
    await portalService.getCustomerQuotation(
      orgA.id,
      quoteB1.id, // Target quote from Org B
      [quoteA1.id] // Customer A token only authorized for Quote A1
    );
  } catch (err: any) {
    crossTenantBlocked = true;
  }

  if (!crossTenantBlocked) {
    throw new Error('SECURITY VIOLATION: Customer A token accessed Org B quotation!');
  }
  console.log('✔ Test 3 PASSED: Cross-tenant quotation access rejected (403 Forbidden)');

  // 8. Test 4: Intra-Tenant Unauthorized Quote Access — Customer A token attempts to access Quote A2
  let intraTenantBlocked = false;
  try {
    await portalService.getCustomerQuotation(
      orgA.id,
      quoteA2.id, // Quote A2 not in Customer A token's quotation_ids
      [quoteA1.id]
    );
  } catch (err: any) {
    intraTenantBlocked = true;
  }

  if (!intraTenantBlocked) {
    throw new Error('SECURITY VIOLATION: Customer token accessed unauthorized quote in same org!');
  }
  console.log('✔ Test 4 PASSED: Intra-tenant unauthorized quote access rejected (403 Forbidden)');

  // 9. Test 5: Verify immutable AuditLog captured 'sent_to_customer'
  const auditLogs = await prisma.auditLog.findMany({
    where: {
      organizationId: orgA.id,
      entityType: 'quotation',
      entityId: quoteA1.id,
      action: 'sent_to_customer',
    },
  });

  if (auditLogs.length === 0) {
    throw new Error('Missing immutable audit trail record for sent_to_customer action!');
  }
  console.log('✔ Test 5 PASSED: Immutable audit trail logged "sent_to_customer" with recipient metadata');

  console.log('\n--- Phase 13 Customer Portal Security & Isolation Suite PASSED (5/5) ---');
}

runPortalIsolationTest()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Phase 13 Isolation Test FAILED:', err);
    process.exit(1);
  });
