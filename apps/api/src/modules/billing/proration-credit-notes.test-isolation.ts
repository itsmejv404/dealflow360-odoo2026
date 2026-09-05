import { prisma } from '../../lib/prisma.js';
import { billingService } from './billing.service.js';
import { quotationsService } from '../quotations/quotations.service.js';
import { startBillingScheduleWorker, startProrationWorker } from './billing.worker.js';

type UserCtx = { userId: string; email: string; role: string };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runProrationCreditNotesIsolationTest() {
  console.log('--- Starting Phase 19 Proration & Credit Notes Isolation Test ---');

  // Start workers to process jobs in test process
  const scheduleWorker = startBillingScheduleWorker();
  const prorationWorker = startProrationWorker();

  const orgs = await prisma.organization.findMany({
    where: { onboardingCompleted: true },
    orderBy: { createdAt: 'asc' },
    take: 2,
    include: { products: true, users: true },
  });

  if (orgs.length < 2 || !orgs[0] || !orgs[1]) {
    throw new Error('Need at least 2 seeded organizations');
  }

  const orgA = orgs[0]!;
  const orgB = orgs[1]!;
  console.log(`Org A: ${orgA.name} (${orgA.id}, slug: ${orgA.slug}, tz: ${orgA.timezone})`);
  console.log(`Org B: ${orgB.name} (${orgB.id}, slug: ${orgB.slug})`);

  const repA = orgA.users.find((u) => u.role === 'rep') || orgA.users[0]!;
  const repB = orgB.users.find((u) => u.role === 'rep') || orgB.users[0]!;
  const userCtxA: UserCtx = { userId: repA.id, email: repA.email, role: repA.role };
  const userCtxB: UserCtx = { userId: repB.id, email: repB.email, role: repB.role };

  const customerA = await prisma.customer.findFirst({ where: { organizationId: orgA.id } });
  if (!customerA) throw new Error('Customer A missing');

  // Find or create monthly subscription product for Org A
  let monthlyProdA = orgA.products.find((p) => p.billingFrequency === 'monthly');
  if (!monthlyProdA) {
    monthlyProdA = await prisma.product.create({
      data: {
        organizationId: orgA.id,
        name: 'Enterprise Cloud Portal',
        sku: 'CLOUD-PORTAL-MO',
        price: 100,
        costPrice: 20,
        billingFrequency: 'monthly',
      },
    });
  }

  // 1. Create Quotation with 10 units of monthly subscription
  console.log('Creating quotation with 10 monthly subscription seats...');
  const createdQuote = (await quotationsService.createQuotation(orgA.id, repA.id, {
    customerId: customerA.id,
    lines: [{ productId: monthlyProdA.id, quantity: 10 }],
  }))!;

  await prisma.quotation.update({
    where: { id: createdQuote.id },
    data: { status: 'approved' },
  });

  // 2. Confirm order and wait for schedule worker to issue Period 1 invoice
  console.log('Confirming quotation to initialize subscription...');
  await billingService.confirmAndSplitOrder(orgA.id, createdQuote.id);

  let sub = await prisma.subscription.findFirst({
    where: { organizationId: orgA.id, quotationId: createdQuote.id },
    include: {
      schedules: { orderBy: { periodNumber: 'asc' } },
      invoices: true,
    },
  });

  let retries = 0;
  while ((!sub || sub.schedules.length < 12 || sub.invoices.length === 0) && retries < 25) {
    await sleep(350);
    sub = await prisma.subscription.findFirst({
      where: { organizationId: orgA.id, quotationId: createdQuote.id },
      include: {
        schedules: { orderBy: { periodNumber: 'asc' } },
        invoices: true,
      },
    });
    retries++;
  }

  if (!sub || sub.schedules.length < 12) {
    throw new Error('Subscription or schedules were not generated');
  }

  console.log(`[PASS] Subscription created: ${sub.subscriptionNumber}, qty: ${sub.quantity}, recurring: $${sub.recurringAmount}`);
  const initialQty = sub.quantity;
  const initialRecurring = Number(sub.recurringAmount);

  // 3. Test Proration Preview for Seat Reduction (10 -> 6 seats)
  console.log('Testing proration preview for downgrade (10 -> 6 seats)...');
  const previewDowngrade = await billingService.previewProration(orgA.id, sub.id, 6);

  if (previewDowngrade.action !== 'credit_note') {
    throw new Error(`Expected action 'credit_note', got '${previewDowngrade.action}'`);
  }
  if (previewDowngrade.proratedDelta >= 0) {
    throw new Error(`Expected negative proratedDelta for downgrade, got ${previewDowngrade.proratedDelta}`);
  }
  if (previewDowngrade.creditAmount <= 0) {
    throw new Error(`Expected positive creditAmount, got ${previewDowngrade.creditAmount}`);
  }
  if (previewDowngrade.newRecurringAmount !== Number(sub.unitPrice) * (1 - Number(sub.discountPercent) / 100) * 6) {
    throw new Error(`New recurring amount mismatch: ${previewDowngrade.newRecurringAmount}`);
  }
  console.log(`[PASS] Proration preview accurate: Action=${previewDowngrade.action}, Credit=$${previewDowngrade.creditAmount}, New recurring=$${previewDowngrade.newRecurringAmount}, ${previewDowngrade.remainingDays}/${previewDowngrade.totalCycleDays} days remaining`);

  // 4. Trigger Mid-Cycle Seat Reduction (10 -> 6 seats)
  console.log('Modifying subscription quantity mid-cycle (10 -> 6)...');
  await billingService.modifySubscriptionQuantity(orgA.id, sub.id, 6, 'Downgraded 4 seats due to reorg', userCtxA);

  // Wait for proration worker to process
  let cnCount = 0;
  retries = 0;
  while (cnCount === 0 && retries < 25) {
    await sleep(350);
    cnCount = await prisma.creditNote.count({
      where: { organizationId: orgA.id, subscriptionId: sub.id },
    });
    retries++;
  }

  if (cnCount === 0) {
    throw new Error('Credit Note was not generated by proration worker');
  }

  const creditNote = await prisma.creditNote.findFirst({
    where: { organizationId: orgA.id, subscriptionId: sub.id },
    orderBy: { createdAt: 'desc' },
  });
  if (!creditNote) throw new Error('Credit note record missing');

  const expectedPrefix = `${orgA.slug.toUpperCase().replace(/[^A-Z0-9]/g, '')}-CN-${new Date().getFullYear()}-`;
  if (!creditNote.creditNoteNumber.startsWith(expectedPrefix)) {
    throw new Error(`Credit note number ${creditNote.creditNoteNumber} does not match prefix ${expectedPrefix}`);
  }
  console.log(`[PASS] Credit Note issued: ${creditNote.creditNoteNumber}, Amount: $${creditNote.amount}, Reason: "${creditNote.reason}"`);

  // Verify subscription updated
  const updatedSubDowngrade = await prisma.subscription.findUnique({
    where: { id: sub.id },
    include: { schedules: { where: { status: 'pending' }, orderBy: { periodNumber: 'asc' } } },
  });
  if (updatedSubDowngrade?.quantity !== 6) {
    throw new Error(`Subscription quantity not updated: ${updatedSubDowngrade?.quantity}`);
  }
  // Verify future schedules updated
  const pendingSchedules = updatedSubDowngrade.schedules;
  if (pendingSchedules.length > 0 && Number(pendingSchedules[0]!.expectedAmount) !== Number(updatedSubDowngrade.recurringAmount)) {
    throw new Error(`Future pending schedule amount not updated: expected ${updatedSubDowngrade.recurringAmount}, got ${pendingSchedules[0]!.expectedAmount}`);
  }
  console.log(`[PASS] Subscription and all future ${pendingSchedules.length} pending schedules updated to $${updatedSubDowngrade.recurringAmount}`);

  // 5. Test Mid-Cycle Seat Expansion (6 -> 9 seats)
  console.log('Testing mid-cycle upgrade (6 -> 9 seats)...');
  const previewUpgrade = await billingService.previewProration(orgA.id, sub.id, 9);
  if (previewUpgrade.action !== 'supplemental_invoice') {
    throw new Error(`Expected action 'supplemental_invoice', got '${previewUpgrade.action}'`);
  }
  if (previewUpgrade.adjustmentAmount <= 0) {
    throw new Error(`Expected positive adjustmentAmount, got ${previewUpgrade.adjustmentAmount}`);
  }
  console.log(`[PASS] Upgrade preview accurate: Action=${previewUpgrade.action}, Adjustment Due=$${previewUpgrade.adjustmentAmount}`);

  // Trigger Upgrade
  await billingService.modifySubscriptionQuantity(orgA.id, sub.id, 9, 'Added 3 seats for new hires', userCtxA);

  // Wait for supplemental invoice
  let adjInvoice = await prisma.invoice.findFirst({
    where: { organizationId: orgA.id, subscriptionId: sub.id, type: 'proration_adjustment' },
  });
  retries = 0;
  while (!adjInvoice && retries < 25) {
    await sleep(350);
    adjInvoice = await prisma.invoice.findFirst({
      where: { organizationId: orgA.id, subscriptionId: sub.id, type: 'proration_adjustment' },
    });
    retries++;
  }

  if (!adjInvoice) {
    throw new Error('Supplemental proration adjustment invoice was not generated');
  }
  console.log(`[PASS] Supplemental invoice generated: ${adjInvoice.invoiceNumber}, Amount: $${adjInvoice.totalAmount}`);

  // 6. Cross-Tenant Isolation Checks
  console.log('Running cross-tenant isolation checks for Phase 19...');

  // 6a. Org B cannot view Org A's credit note
  let leakCnFailed = false;
  try {
    await billingService.getCreditNote(orgB.id, creditNote.id);
  } catch (err: any) {
    if (err.statusCode === 404) leakCnFailed = true;
  }
  if (!leakCnFailed) {
    throw new Error(`Cross-tenant breach! Org B accessed Org A credit note ${creditNote.id}`);
  }
  console.log(`[PASS] Org B cannot get Org A credit note (rejected with 404)`);

  // 6b. Org B listing credit notes returns 0 of Org A's credit notes
  const orgBCreditNotes = await billingService.listCreditNotes(orgB.id);
  const leakedCn = orgBCreditNotes.find((cn) => cn.organizationId === orgA.id || cn.id === creditNote.id);
  if (leakedCn) {
    throw new Error(`Cross-tenant breach! Org B listCreditNotes leaked Org A credit note`);
  }
  console.log(`[PASS] Org B listCreditNotes contains 0 Org A credit notes`);

  // 6c. Org B cannot preview proration on Org A subscription
  let previewLeakFailed = false;
  try {
    await billingService.previewProration(orgB.id, sub.id, 5);
  } catch (err: any) {
    if (err.statusCode === 404) previewLeakFailed = true;
  }
  if (!previewLeakFailed) {
    throw new Error(`Cross-tenant breach! Org B previewed proration on Org A subscription`);
  }
  console.log(`[PASS] Org B cannot preview proration on Org A subscription (rejected with 404)`);

  // 6d. Org B cannot modify quantity on Org A subscription
  let modifyLeakFailed = false;
  try {
    await billingService.modifySubscriptionQuantity(orgB.id, sub.id, 5, 'Illicit cross-tenant mod', userCtxB);
  } catch (err: any) {
    if (err.statusCode === 404) modifyLeakFailed = true;
  }
  if (!modifyLeakFailed) {
    throw new Error(`Cross-tenant breach! Org B modified quantity on Org A subscription`);
  }
  console.log(`[PASS] Org B cannot modify Org A subscription quantity (rejected with 404)`);

  // Clean up workers
  await scheduleWorker.close();
  await prorationWorker.close();

  console.log('--- Phase 19 Proration & Credit Notes Isolation Test PASSED Successfully! ---');
  process.exit(0);
}

runProrationCreditNotesIsolationTest().catch((err) => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
