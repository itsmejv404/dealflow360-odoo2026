import { prisma } from '../lib/prisma.js';
import { filesService } from '../modules/files/files.service.js';
import { warehousesService } from '../modules/warehouses/warehouses.service.js';
import { billingService } from '../modules/billing/billing.service.js';
import { generateInvoiceHtml, convertHtmlToPdf } from '../lib/gotenberg.js';

async function main() {
  console.log('=== VERIFYING INVOICE HTML-TO-PDF & LOG EXPORTS ===');

  const org = await prisma.organization.findFirst();
  if (!org) {
    throw new Error('No organization found in database. Seed data first.');
  }
  console.log(`[PASS] Found test organization: "${org.name}" (${org.id})`);

  // 1. Test Gotenberg HTML to PDF with logo (fallback to name if null)
  console.log('\n--- 1. Testing Invoice PDF Generation (Gotenberg) ---');
  const invoiceHtml = generateInvoiceHtml({
    orgName: org.name,
    orgSlug: org.slug,
    orgLogoBase64: null, // tests fallback to org name
    orgCurrency: org.currency,
    invoiceNumber: 'INV-2026-TEST-001',
    type: 'one_time',
    status: 'issued',
    issuedAt: '2026-09-06',
    dueDate: '2026-09-20',
    quotationNumber: 'Q-2026-0001',
    customerName: 'Enterprise Client Inc',
    customerEmail: 'billing@enterpriseclient.com',
    lines: [
      { description: 'Cloud Infrastructure License (1 Year)', quantity: 5, unitPrice: 1200, totalAmount: 6000 },
      { description: 'Professional Setup & Migration', quantity: 1, unitPrice: 1500, discountPercent: 10, totalAmount: 1350 },
    ],
    surcharges: [
      { label: 'Priority SLA Support', kind: 'percent', value: 5, computedAmount: 367.5 },
    ],
    subtotal: 7500,
    discountAmount: 150,
    totalAmount: 7717.5,
    notes: 'Payment terms: Net 14 days via direct bank transfer or gateway.',
  });

  const pdfBuffer = await convertHtmlToPdf(invoiceHtml);
  if (!pdfBuffer || pdfBuffer.length < 500) {
    throw new Error(`Generated PDF buffer is invalid or too small (${pdfBuffer?.length} bytes)`);
  }
  console.log(`[PASS] Invoice PDF generated successfully (${pdfBuffer.length} bytes, starts with: "${pdfBuffer.subarray(0, 5).toString('ascii')}")`);

  // 2. Test Quotation Logs Export in TXT format
  console.log('\n--- 2. Testing Quotation Logs TXT Export ---');
  const quote = await prisma.quotation.findFirst({ where: { organizationId: org.id } });
  if (quote) {
    const qLogs = await filesService.getQuotationLogsTxt(org.id, quote.id);
    if (!qLogs.content.includes(quote.quotationNumber) || !qLogs.fileName.endsWith('.txt')) {
      throw new Error(`Invalid quotation logs TXT result: ${JSON.stringify(qLogs)}`);
    }
    console.log(`[PASS] Quotation TXT export generated: "${qLogs.fileName}" (${qLogs.content.length} chars)`);
  } else {
    console.log('[INFO] No quotation found in org to test getQuotationLogsTxt directly.');
  }

  // 3. Test Warehouse Stock & Valuation CSV Export
  console.log('\n--- 3. Testing Warehouse Stocks & Valuation CSV Export ---');
  const whCsv = await warehousesService.exportStockAndLogsCsv(org.id);
  if (!whCsv.content.includes('CURRENT STOCK VALUATION') || !whCsv.fileName.endsWith('.csv')) {
    throw new Error(`Invalid warehouse CSV result: ${whCsv.fileName}`);
  }
  console.log(`[PASS] Warehouse CSV export generated: "${whCsv.fileName}" (${whCsv.content.length} chars)`);

  // 4. Test Billing Sales Activities CSV Export
  console.log('\n--- 4. Testing Billing Sales Activities CSV Export ---');
  const salesCsv = await billingService.exportSalesActivitiesCsv(org.id, {
    startDate: '2026-01-01',
    endDate: '2026-12-31',
  });
  if (!salesCsv.content.includes('SALES & BILLING ACTIVITIES REPORT') || !salesCsv.fileName.endsWith('.csv')) {
    throw new Error(`Invalid sales activities CSV result: ${salesCsv.fileName}`);
  }
  console.log(`[PASS] Sales Activities CSV export generated: "${salesCsv.fileName}" (${salesCsv.content.length} chars)`);

  console.log('\n=== ALL VERIFICATION TESTS PASSED SUCCESSFULLY! ===\n');
}

main().catch((err) => {
  console.error('Verification failed:', err);
  process.exit(1);
});
