import { prisma } from '../../lib/prisma.js';
import { billingService } from './billing.service.js';
import { paymentsService } from './payments.service.js';
import { quotationsService } from '../quotations/quotations.service.js';

type UserCtx = { userId: string; email: string; role: string };

async function runPaymentsDlqIsolationTest() {
  console.log('--- Starting Phase 20 Payment Gateway & Webhook DLQ Isolation Test ---');

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
  console.log(`Org A: ${orgA.name} (${orgA.id}, slug: ${orgA.slug})`);
  console.log(`Org B: ${orgB.name} (${orgB.id}, slug: ${orgB.slug})`);

  const repA = orgA.users.find((u) => u.role === 'rep') || orgA.users[0]!;
  const repB = orgB.users.find((u) => u.role === 'rep') || orgB.users[0]!;
  const userCtxA: UserCtx = { userId: repA.id, email: repA.email, role: repA.role };
  const userCtxB: UserCtx = { userId: repB.id, email: repB.email, role: repB.role };

  const customerA = await prisma.customer.findFirst({ where: { organizationId: orgA.id } });
  if (!customerA) throw new Error('Customer A missing');

  const productA = orgA.products[0]!;

  // 1. Direct Invoice Payment Charge
  console.log('Testing direct invoice payment charge...');
  const quoteA = (await quotationsService.createQuotation(orgA.id, repA.id, {
    customerId: customerA.id,
    lines: [{ productId: productA.id, quantity: 1 }],
  }))!;

  const splitResult = await billingService.confirmAndSplitOrder(orgA.id, quoteA.id);
  const invoiceA = await prisma.invoice.findFirst({
    where: { organizationId: orgA.id, quotationId: quoteA.id },
  });
  if (!invoiceA) throw new Error('Invoice not generated for quote');

  console.log(`Charging invoice ${invoiceA.invoiceNumber} ($${invoiceA.totalAmount})...`);
  const chargeResult = await paymentsService.chargeInvoice(orgA.id, invoiceA.id, {
    paymentMethod: 'sandbox_credit_card',
    userCtx: userCtxA,
  });

  if (chargeResult.invoice.status !== 'paid') {
    throw new Error(`Expected invoice status 'paid', got '${chargeResult.invoice.status}'`);
  }
  if (!chargeResult.payment || chargeResult.payment.status !== 'succeeded') {
    throw new Error(`Payment record failed or missing: ${JSON.stringify(chargeResult.payment)}`);
  }
  console.log(`[PASS] Invoice successfully paid! Payment ID: ${chargeResult.payment.id}, Ref: ${chargeResult.payment.transactionReference}`);

  // Cannot double-pay already paid invoice
  let doublePayFailed = false;
  try {
    await paymentsService.chargeInvoice(orgA.id, invoiceA.id);
  } catch (err: any) {
    doublePayFailed = true;
  }
  if (!doublePayFailed) throw new Error('Allowed double-payment on already paid invoice');
  console.log(`[PASS] Prevented double-payment on already paid invoice`);

  // 2. Credit Note Refund
  console.log('Testing credit note refund...');
  let subA = await prisma.subscription.findFirst({ where: { organizationId: orgA.id } });
  if (!subA) {
    subA = await prisma.subscription.create({
      data: {
        organizationId: orgA.id,
        customerId: customerA.id,
        productId: productA.id,
        quotationId: quoteA.id,
        subscriptionNumber: `${orgA.slug.toUpperCase()}-SUB-2026-DLQTEST`,
        name: productA.name,
        billingFrequency: 'monthly',
        quantity: 1,
        unitPrice: 100,
        recurringAmount: 100,
        currency: orgA.currency,
        status: 'active',
        startDate: new Date(),
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        nextBillingDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });
  }

  const creditNoteA = await prisma.creditNote.create({
    data: {
      organizationId: orgA.id,
      quotationId: quoteA.id,
      invoiceId: invoiceA.id,
      subscriptionId: subA.id,
      creditNoteNumber: `${orgA.slug.toUpperCase()}-CN-2026-TEST-${Date.now()}`,
      amount: 150,
      currency: orgA.currency,
      reason: 'Test refund for returned hardware',
      status: 'issued',
    },
  });

  const refundResult = await paymentsService.refundCreditNote(orgA.id, creditNoteA.id, {
    paymentMethod: 'credit_card',
    userCtx: userCtxA,
  });

  if (refundResult.creditNote.status !== 'refunded') {
    throw new Error(`Expected credit note status 'refunded', got '${refundResult.creditNote.status}'`);
  }
  if (refundResult.payment.paymentType !== 'refund') {
    throw new Error(`Expected paymentType 'refund', got '${refundResult.payment.paymentType}'`);
  }
  console.log(`[PASS] Credit note refunded: ${refundResult.creditNote.creditNoteNumber}, Refund Ref: ${refundResult.payment.transactionReference}`);

  // 3. Webhook Ingestion & Dead Letter Queue (DLQ)
  console.log('Testing unroutable webhook -> DLQ persistence...');
  const unroutableWebhook = {
    id: `evt_unroutable_${Date.now()}`,
    type: 'invoice.payment_succeeded',
    data: { object: { amount: 500 } }, // Missing org routing
  };

  const dlqResult = await paymentsService.handleWebhook(unroutableWebhook);
  if (dlqResult.success !== false || !dlqResult.deadLetterId) {
    throw new Error(`Expected unroutable webhook to fail and write to DLQ: ${JSON.stringify(dlqResult)}`);
  }

  const deadJob = await prisma.deadLetterJob.findUnique({
    where: { id: dlqResult.deadLetterId },
  });
  if (!deadJob || deadJob.status !== 'failed') {
    throw new Error('DLQ job was not persisted in database');
  }
  console.log(`[PASS] Unroutable webhook captured in DLQ: Job ${deadJob.jobId}, Error: "${deadJob.errorMessage}"`);

  // 4. DLQ Dismiss
  console.log('Testing DLQ job dismissal...');
  const dismissResult = await paymentsService.dismissDlqJob(deadJob.id);
  if (dismissResult.job.status !== 'dismissed') {
    throw new Error(`Expected status 'dismissed', got ${dismissResult.job.status}`);
  }
  console.log(`[PASS] DLQ job successfully dismissed`);

  // 5. DLQ Capture with Org Context and Retry
  console.log('Testing webhook DLQ capture with Org context and retry...');
  const invoiceB = await prisma.invoice.create({
    data: {
      organizationId: orgA.id,
      quotationId: quoteA.id,
      invoiceNumber: `${orgA.slug.toUpperCase()}-INV-2026-WEBHOOK-TEST`,
      type: 'one_time',
      status: 'issued',
      currency: orgA.currency,
      subtotal: 350,
      totalAmount: 350,
      dueDate: new Date(),
    },
  });

  const tenantWebhook = {
    id: `evt_test_${Date.now()}`,
    type: 'invoice.payment_succeeded',
    orgId: orgA.id,
    data: { object: { invoiceId: invoiceB.id } },
  };

  const webhookSuccess = await paymentsService.handleWebhook(tenantWebhook);
  if (!webhookSuccess.success) {
    throw new Error(`Valid webhook failed: ${JSON.stringify(webhookSuccess)}`);
  }
  const paidViaWebhook = await prisma.invoice.findUnique({ where: { id: invoiceB.id } });
  if (paidViaWebhook?.status !== 'paid') {
    throw new Error(`Invoice was not marked paid via webhook`);
  }
  console.log(`[PASS] Webhook successfully routed to tenant Org A and marked invoice paid`);

  // 6. Cross-Tenant Isolation Checks
  console.log('Running cross-tenant isolation checks for Phase 20...');

  // 6a. Org B cannot pay Org A invoice
  let leakPayFailed = false;
  try {
    await paymentsService.chargeInvoice(orgB.id, invoiceA.id, { userCtx: userCtxB });
  } catch (err: any) {
    if (err.statusCode === 404) leakPayFailed = true;
  }
  if (!leakPayFailed) {
    throw new Error(`Cross-tenant breach! Org B was able to charge Org A invoice`);
  }
  console.log(`[PASS] Org B cannot charge Org A invoice (rejected with 404)`);

  // 6b. Org B cannot refund Org A credit note
  let leakRefundFailed = false;
  try {
    await paymentsService.refundCreditNote(orgB.id, creditNoteA.id, { userCtx: userCtxB });
  } catch (err: any) {
    if (err.statusCode === 404) leakRefundFailed = true;
  }
  if (!leakRefundFailed) {
    throw new Error(`Cross-tenant breach! Org B was able to refund Org A credit note`);
  }
  console.log(`[PASS] Org B cannot refund Org A credit note (rejected with 404)`);

  // 6c. Org B listing DLQ jobs contains zero of Org A's DLQ jobs
  const orgA_dlq = await prisma.deadLetterJob.create({
    data: {
      organizationId: orgA.id,
      queueName: 'billing_webhooks',
      jobId: `evt_dlq_orgA_${Date.now()}`,
      jobName: 'invoice.payment_succeeded',
      payload: { test: true },
      errorMessage: 'Org A specific webhook test failure',
      status: 'failed',
    },
  });

  const orgBDlqJobs = await paymentsService.listDlqJobs({ orgId: orgB.id });
  const leakedDlq = orgBDlqJobs.find((j) => j.organizationId === orgA.id || j.id === orgA_dlq.id);
  if (leakedDlq) {
    throw new Error(`Cross-tenant breach! Org B listDlqJobs leaked Org A DLQ job`);
  }
  console.log(`[PASS] Org B listDlqJobs contains zero Org A DLQ jobs`);

  // 6d. Org B cannot retry or dismiss Org A DLQ job
  let dlqRetryLeakFailed = false;
  try {
    await paymentsService.retryDlqJob(orgA_dlq.id, orgB.id);
  } catch (err: any) {
    if (err.statusCode === 404) dlqRetryLeakFailed = true;
  }
  if (!dlqRetryLeakFailed) {
    throw new Error(`Cross-tenant breach! Org B was able to retry Org A DLQ job`);
  }
  console.log(`[PASS] Org B cannot retry Org A DLQ job (rejected with 404)`);

  let dlqDismissLeakFailed = false;
  try {
    await paymentsService.dismissDlqJob(orgA_dlq.id, orgB.id);
  } catch (err: any) {
    if (err.statusCode === 404) dlqDismissLeakFailed = true;
  }
  if (!dlqDismissLeakFailed) {
    throw new Error(`Cross-tenant breach! Org B was able to dismiss Org A DLQ job`);
  }
  console.log(`[PASS] Org B cannot dismiss Org A DLQ job (rejected with 404)`);

  console.log('--- Phase 20 Payment Gateway & Webhook DLQ Isolation Test PASSED Successfully! ---');
  process.exit(0);
}

runPaymentsDlqIsolationTest().catch((err) => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
