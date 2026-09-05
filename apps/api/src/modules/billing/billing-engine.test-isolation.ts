import http from 'http';
import { prisma } from '../../lib/prisma.js';
import { redis } from '../../lib/redis.js';
import { billingService } from './billing.service.js';
import { quotationsService } from '../quotations/quotations.service.js';
import { signInternalToken } from '../../shared/jwt.js';
import { createApp } from '../../app.js';
import { startBillingScheduleWorker } from './billing.worker.js';

type UserCtx = { userId: string; email: string; role: string };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runBillingEngineIsolationTest() {
  console.log('--- Starting Phase 18 Billing Engine (Mixed Orders & Schedules) Isolation Test ---');

  // Start billing schedule worker to process BullMQ jobs in test process
  const worker = startBillingScheduleWorker();

  const orgs = await prisma.organization.findMany({
    where: { onboardingCompleted: true },
    orderBy: { createdAt: 'asc' },
    take: 2,
    include: { products: true, users: true },
  });

  if (orgs.length < 2 || !orgs[0] || !orgs[1]) {
    console.error('Error: Need at least 2 seeded organizations');
    process.exit(1);
  }

  const orgA = orgs[0]!;
  const orgB = orgs[1]!;
  console.log(`Org A: ${orgA.name} (${orgA.id}, slug: ${orgA.slug})`);
  console.log(`Org B: ${orgB.name} (${orgB.id}, slug: ${orgB.slug})`);

  const repA = orgA.users.find((u) => u.role === 'rep') || orgA.users[0]!;
  const repB = orgB.users.find((u) => u.role === 'rep') || orgB.users[0]!;
  const userCtxA: UserCtx = { userId: repA.id, email: repA.email, role: repA.role };
  const userCtxB: UserCtx = { userId: repB.id, email: repB.email, role: repB.role };

  const customerA = await prisma.customer.findFirst({ where: { organizationId: orgA.id } });
  const customerB = await prisma.customer.findFirst({ where: { organizationId: orgB.id } });
  if (!customerA || !customerB) throw new Error('Seeded customers missing');

  // Find or create 1 one-time product and 1 recurring monthly product for Org A
  let oneTimeProdA = orgA.products.find((p) => p.billingFrequency === 'one_time');
  if (!oneTimeProdA) {
    oneTimeProdA = await prisma.product.create({
      data: {
        organizationId: orgA.id,
        name: 'Enterprise Server Appliance',
        sku: 'SRV-APP-01',
        price: 5000,
        costPrice: 3000,
        billingFrequency: 'one_time',
      },
    });
  }

  let monthlyProdA = orgA.products.find((p) => p.billingFrequency === 'monthly');
  if (!monthlyProdA) {
    monthlyProdA = await prisma.product.create({
      data: {
        organizationId: orgA.id,
        name: 'Cloud Monitoring Suite',
        sku: 'CLOUD-MON-MO',
        price: 250,
        costPrice: 50,
        billingFrequency: 'monthly',
      },
    });
  }

  console.log(`Org A One-time product: ${oneTimeProdA.name} ($${oneTimeProdA.price})`);
  console.log(`Org A Monthly product: ${monthlyProdA.name} ($${monthlyProdA.price}/mo)`);

  // Clean up any prior test billing records for this customer
  const priorQuotes = await prisma.quotation.findMany({
    where: { organizationId: orgA.id, customerId: customerA.id, quotationNumber: { startsWith: 'TEST-BILL-' } },
    select: { id: true },
  });
  const priorQuoteIds = priorQuotes.map((q) => q.id);

  if (priorQuoteIds.length > 0) {
    await prisma.invoiceLine.deleteMany({ where: { invoice: { quotationId: { in: priorQuoteIds } } } });
    await prisma.payment.deleteMany({ where: { organizationId: orgA.id, invoice: { quotationId: { in: priorQuoteIds } } } });
    await prisma.billingSchedule.deleteMany({ where: { quotationId: { in: priorQuoteIds } } });
    await prisma.creditNote.deleteMany({ where: { quotationId: { in: priorQuoteIds } } });
    await prisma.invoice.deleteMany({ where: { quotationId: { in: priorQuoteIds } } });
    await prisma.subscription.deleteMany({ where: { quotationId: { in: priorQuoteIds } } });
    await prisma.auditLog.deleteMany({ where: { entityId: { in: priorQuoteIds } } });
    await prisma.quotationLine.deleteMany({ where: { quotationId: { in: priorQuoteIds } } });
    await prisma.quotation.deleteMany({ where: { id: { in: priorQuoteIds } } });
  }

  // 1. Create a Mixed Quotation in Org A
  const createdQuote = (await quotationsService.createQuotation(orgA.id, repA.id, {
    customerId: customerA.id,
    lines: [
      { productId: oneTimeProdA.id, quantity: 1 },
      { productId: monthlyProdA.id, quantity: 2 },
    ],
  }))!;
  const quoteA = await prisma.quotation.update({
    where: { id: createdQuote.id },
    data: { status: 'approved' },
    include: { lines: true },
  });

  console.log(`[PASS] Created Org A test quotation ${quoteA.quotationNumber} with 1 one-time line and 1 monthly line`);

  // 2. Confirm and Split Order
  console.log('Confirming and splitting order...');
  const splitResult = await billingService.confirmAndSplitOrder(orgA.id, quoteA.id);
  const oneTimeInvoice = splitResult.oneTimeInvoice;

  if (!oneTimeInvoice) {
    throw new Error('Expected one-time invoice to be generated for one-time lines');
  }
  console.log(`[PASS] One-time invoice generated: ${oneTimeInvoice.invoiceNumber}, total: $${oneTimeInvoice.totalAmount}`);

  // Validate invoice numbering scheme: ORG-INV-YYYY-XXXX
  const year = new Date().getFullYear();
  const expectedPrefix = `${orgA.slug.toUpperCase().replace(/[^A-Z0-9]/g, '')}-INV-${year}-`;
  if (!oneTimeInvoice.invoiceNumber.startsWith(expectedPrefix)) {
    throw new Error(`Invoice number ${oneTimeInvoice.invoiceNumber} did not match prefix ${expectedPrefix}`);
  }
  console.log(`[PASS] Invoice numbering pattern verified: ${oneTimeInvoice.invoiceNumber}`);

  // 3. Wait for BullMQ worker to generate multi-period subscription schedule and Period 1 invoice
  console.log('Waiting for billing schedule BullMQ worker to process...');
  let schedules = await prisma.billingSchedule.findMany({
    where: { organizationId: orgA.id, quotationId: quoteA.id },
    orderBy: { periodNumber: 'asc' },
  });

  let retries = 0;
  while (schedules.length < 12 && retries < 25) {
    await sleep(400);
    schedules = await prisma.billingSchedule.findMany({
      where: { organizationId: orgA.id, quotationId: quoteA.id },
      orderBy: { periodNumber: 'asc' },
    });
    retries++;
  }

  if (schedules.length !== 12) {
    throw new Error(`Expected 12 monthly billing schedule entries, found ${schedules.length}`);
  }
  console.log(`[PASS] BullMQ worker generated all 12 monthly billing schedule periods!`);

  // Check period 1 invoice
  const period1 = schedules[0]!;
  if (period1.status !== 'invoiced' || !period1.invoiceId) {
    throw new Error(`Expected period 1 schedule to be invoiced with invoiceId, got status=${period1.status}, invoiceId=${period1.invoiceId}`);
  }
  const period1Invoice = await prisma.invoice.findUnique({
    where: { id: period1.invoiceId },
  });
  if (!period1Invoice) {
    throw new Error('Period 1 invoice record not found');
  }
  console.log(`[PASS] Period 1 invoice issued: ${period1Invoice.invoiceNumber} ($${period1Invoice.totalAmount})`);

  // 4. Verify Billing Summary
  const summaryA = await billingService.getQuotationBillingSummary(orgA.id, quoteA.id);
  if (!summaryA.quotation || summaryA.invoices.length < 2 || summaryA.subscriptions.length !== 1) {
    throw new Error(`Billing summary incorrect: invoices=${summaryA.invoices.length}, subscriptions=${summaryA.subscriptions.length}`);
  }
  console.log(`[PASS] Org A summary has ${summaryA.invoices.length} invoices and ${summaryA.subscriptions.length} active subscription`);

  // 5. Cross-Tenant Isolation Checks
  console.log('Running cross-tenant isolation checks...');

  // 5a. Org B cannot query Org A invoice by ID
  let leakInvoiceFailed = false;
  try {
    await billingService.getInvoice(orgB.id, oneTimeInvoice.id);
  } catch (err: any) {
    if (err.statusCode === 404) leakInvoiceFailed = true;
  }
  if (!leakInvoiceFailed) {
    throw new Error(`Cross-tenant breach! Org B accessed Org A invoice ${oneTimeInvoice.id}`);
  }
  console.log(`[PASS] Org B cannot get Org A invoice (rejected with 404)`);

  // 5b. Org B listing invoices returns zero of Org A's invoices
  const orgBInvoices = await billingService.listInvoices(orgB.id);
  const foundOrgAInvoiceInB = orgBInvoices.find((i) => i.organizationId === orgA.id || i.id === oneTimeInvoice.id);
  if (foundOrgAInvoiceInB) {
    throw new Error(`Cross-tenant breach! Org B listInvoices leaked Org A invoice`);
  }
  console.log(`[PASS] Org B listInvoices contains no Org A invoices`);

  // 5c. Org B cannot access Org A subscription
  const subA = summaryA.subscriptions[0]!;
  let leakSubFailed = false;
  try {
    await billingService.getSubscription(orgB.id, subA.id);
  } catch (err: any) {
    if (err.statusCode === 404) leakSubFailed = true;
  }
  if (!leakSubFailed) {
    throw new Error(`Cross-tenant breach! Org B accessed Org A subscription ${subA.id}`);
  }
  console.log(`[PASS] Org B cannot get Org A subscription (rejected with 404)`);

  // 5d. Org B cannot get Org A quotation billing summary
  let summaryCrossTenantFailed = false;
  try {
    await billingService.getQuotationBillingSummary(orgB.id, quoteA.id);
  } catch (err: any) {
    if (err.statusCode === 404) summaryCrossTenantFailed = true;
  }
  if (!summaryCrossTenantFailed) {
    throw new Error(`Cross-tenant breach! Org B was able to retrieve Org A billing summary`);
  }
  console.log(`[PASS] Org B getQuotationBillingSummary for Org A quote was rejected with 404`);

  // 5e. Org B user cannot trigger order split on Org A quotation
  let splitCrossTenantFailed = false;
  try {
    await billingService.confirmAndSplitOrder(orgB.id, quoteA.id);
  } catch (err: any) {
    splitCrossTenantFailed = true;
  }
  if (!splitCrossTenantFailed) {
    throw new Error(`Cross-tenant breach! Org B was able to trigger confirmAndSplitOrder on Org A quotation`);
  }
  console.log(`[PASS] Org B confirmAndSplitOrder on Org A quote was rejected with tenant error`);

  // Clean up worker
  await worker.close();
  console.log('--- Phase 18 Billing Engine Isolation Test PASSED Successfully! ---');
  process.exit(0);
}

runBillingEngineIsolationTest().catch((err) => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
