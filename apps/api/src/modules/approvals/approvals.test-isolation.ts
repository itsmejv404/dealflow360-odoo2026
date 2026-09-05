import { prisma } from '../../lib/prisma.js';
import { approvalsService } from './approvals.service.js';
import { governanceService } from '../governance/governance.service.js';
import { quotationsService } from '../quotations/quotations.service.js';


async function runApprovalsIsolationTest() {
  console.log('--- Starting Phase 12 Approvals & Audit Isolation Verification ---');

  // 1. Fetch two distinct orgs (fully provisioned, deterministic order)
  const orgs = await prisma.organization.findMany({
    where: { onboardingCompleted: true },
    orderBy: { createdAt: 'asc' },
    take: 2,
    include: {
      customerTiers: true,
      categories: true,
      products: true,
      users: true,
    },
  });

  if (orgs.length < 2 || !orgs[0] || !orgs[1]) {
    console.error('Error: Need at least 2 organizations seeded to run isolation tests.');
    process.exit(1);
  }

  const orgA = orgs[0]!;
  const orgB = orgs[1]!;
  console.log(`Org A: ${orgA.name} (${orgA.id})`);
  console.log(`Org B: ${orgB.name} (${orgB.id})`);

  let userRepA = orgA.users.find((u) => u.role === 'rep');
  if (!userRepA) {
    userRepA = await prisma.user.create({
      data: {
        organizationId: orgA.id,
        email: `rep-${Date.now()}@orga.com`,
        passwordHash: 'dummy',
        name: 'Rep User A',
        role: 'rep',
      },
    });
  }

  let userManagerA = orgA.users.find((u) => u.role === 'manager');
  if (!userManagerA) {
    userManagerA = await prisma.user.create({
      data: {
        organizationId: orgA.id,
        email: `mgr-${Date.now()}@orga.com`,
        passwordHash: 'dummy',
        name: 'Manager User A',
        role: 'manager',
      },
    });
  }

  let userFinanceA = orgA.users.find((u) => u.role === 'finance');
  if (!userFinanceA) {
    userFinanceA = await prisma.user.create({
      data: {
        organizationId: orgA.id,
        email: `fin-${Date.now()}@orga.com`,
        passwordHash: 'dummy',
        name: 'Finance User A',
        role: 'finance',
      },
    });
  }

  let userManagerB = orgB.users.find((u) => u.role === 'manager');
  if (!userManagerB) {
    userManagerB = await prisma.user.create({
      data: {
        organizationId: orgB.id,
        email: `mgr-${Date.now()}@orgb.com`,
        passwordHash: 'dummy',
        name: 'Manager User B',
        role: 'manager',
      },
    });
  }

  // 2. Setup Customer in Org A
  const tierA = orgA.customerTiers[0];
  if (!tierA) throw new Error('Org A has no customer tiers seeded');

  let custA = await prisma.customer.findFirst({
    where: { organizationId: orgA.id },
  });
  if (!custA) {
    custA = await prisma.customer.create({
      data: {
        organizationId: orgA.id,
        tierId: tierA.id,
        name: 'Test Customer A',
        email: 'test-cust-a@test.com',
      },
    });
  }

  // 3. Create a Quote in Org A with heavy discount (High risk -> manager_finance)
  const productA = orgA.products[0];
  if (!productA) throw new Error('Org A has no products seeded');

  const quoteA = await quotationsService.createQuotation(orgA.id, userRepA.id, {
    customerId: custA.id,
    orderDiscountPercent: 25.0,
    lines: [
      {
        productId: productA.id,
        quantity: 2,
        lineDiscountPercent: 20.0,
      },
    ],
  });

  if (!quoteA) throw new Error('Failed to create test quotation');
  console.log(`Created quotation in Org A: ${quoteA.quotationNumber} (${quoteA.id})`);

  // 4. Submit Quote for approval in Org A
  const submitRes = await approvalsService.submitForApproval(
    orgA.id,
    quoteA.id,
    {
      userId: userRepA.id,
      email: userRepA.email,
      role: 'rep',
      name: userRepA.name,
    },
    'Submitting with special strategic discount'
  );

  console.log(`Submitted quote. Status: ${submitRes.status}, Stage: ${submitRes.stage}`);
  if (submitRes.status !== 'pending_approval') {
    throw new Error('Expected status to be pending_approval');
  }

  // 5. Cross-tenant check: Org B Manager attempts to view Org A pending approvals
  const orgBPending = await approvalsService.getPendingApprovals(orgB.id, 'manager');
  const leakedRequest = orgBPending.find((r) => r.quotationId === quoteA.id);
  if (leakedRequest) {
    throw new Error('CROSS-TENANT LEAK: Org B manager sees Org A quotation approval request!');
  }
  console.log('✔ Cross-tenant pending approvals isolated (Org B cannot see Org A approval queue)');

  // 6. Cross-tenant check: Org B Manager attempts to approve Org A quotation
  let crossOrgBlocked = false;
  try {
    await approvalsService.approveQuotation(
      orgB.id, // Trying to approve with Org B tenant context
      quoteA.id,
      {
        userId: userManagerB.id,
        email: userManagerB.email,
        role: 'manager',
        name: userManagerB.name,
      },
      { reason: 'Illegitimately approving Org A quote' }
    );
  } catch (err: any) {
    crossOrgBlocked = true;
  }
  if (!crossOrgBlocked) {
    throw new Error('CROSS-TENANT SECURITY FAILURE: Org B manager approved Org A quotation!');
  }
  console.log('✔ Cross-tenant action rejected (Org B manager cannot approve Org A quote)');

  // 7. Mandatory reason validation
  let reasonEnforced = false;
  try {
    await approvalsService.approveQuotation(
      orgA.id,
      quoteA.id,
      {
        userId: userManagerA.id,
        email: userManagerA.email,
        role: 'manager',
        name: userManagerA.name,
      },
      { reason: '' }
    );
  } catch (err: any) {
    reasonEnforced = true;
  }
  if (!reasonEnforced) {
    throw new Error('Mandatory reason requirement was not enforced!');
  }
  console.log('✔ Mandatory reason validation enforced on approval');

  // 8. Manager Approves in Org A -> Escalates to Finance stage
  const mgrApproveRes = await approvalsService.approveQuotation(
    orgA.id,
    quoteA.id,
    {
      userId: userManagerA.id,
      email: userManagerA.email,
      role: 'manager',
      name: userManagerA.name,
    },
    { reason: 'Approved by Sales Manager, escalating for high discount margin impact.' }
  );

  console.log(`Manager Approval result: ${mgrApproveRes.message}, Next Stage: ${mgrApproveRes.stage}`);
  if (mgrApproveRes.stage !== 'finance') {
    throw new Error('Expected high-risk quotation to escalate to Finance stage');
  }

  // 9. Finance Approver in Org A approves final stage
  const finApproveRes = await approvalsService.approveQuotation(
    orgA.id,
    quoteA.id,
    {
      userId: userFinanceA.id,
      email: userFinanceA.email,
      role: 'finance',
      name: userFinanceA.name,
    },
    { reason: 'Finance discount approved based on executive quota commitment.' }
  );

  console.log(`Finance Approval result: ${finApproveRes.message}, Final Status: ${finApproveRes.status}`);
  if (finApproveRes.status !== 'approved') {
    throw new Error('Expected final quotation status to be approved');
  }

  // 10. Verify Immutable Audit Trail
  const auditLogs = await approvalsService.getQuotationAuditTrail(orgA.id, quoteA.id);
  console.log(`Quotation Audit Trail entries: ${auditLogs.length}`);
  const actionsLogged = auditLogs.map((l) => l.action);
  console.log('Logged actions:', actionsLogged);

  if (
    !actionsLogged.includes('submitted_for_approval') ||
    !actionsLogged.includes('finance_escalated') ||
    !actionsLogged.includes('finance_approved')
  ) {
    throw new Error('Audit trail is missing mandatory lifecycle actions!');
  }
  console.log('✔ Immutable audit log captured complete approval lifecycle');

  // 11. Cross-tenant check: Org B queries Org A audit logs
  let orgBAuditBlocked = false;
  try {
    await approvalsService.getQuotationAuditTrail(orgB.id, quoteA.id);
  } catch (err: any) {
    orgBAuditBlocked = true;
  }
  if (!orgBAuditBlocked) {
    throw new Error('CROSS-TENANT LEAK: Org B context was able to retrieve Org A quotation audit trail!');
  }
  console.log('✔ Audit trail tenant isolation verified (Org B cannot read Org A audit logs)');

  console.log('\n--- Phase 12 Approvals & Audit Isolation Verification PASSED successfully ---');
}

runApprovalsIsolationTest()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Phase 12 Isolation test failed:', err);
    process.exit(1);
  });
