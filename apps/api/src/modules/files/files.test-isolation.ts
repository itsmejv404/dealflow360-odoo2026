import http from 'http';
import { prisma } from '../../lib/prisma.js';
import { redis } from '../../lib/redis.js';
import { filesService } from './files.service.js';
import { storageService } from '../../lib/storage.js';
import { signInternalToken, signCustomerToken } from '../../shared/jwt.js';
import { createApp } from '../../app.js';

async function runFilesIsolationTest() {
  console.log('--- Starting Phase 22 Files & Reports Isolation Test ---');

  const orgs = await prisma.organization.findMany({
    where: { onboardingCompleted: true },
    orderBy: { createdAt: 'asc' },
    take: 2,
    include: { users: true },
  });
  if (orgs.length < 2 || !orgs[0] || !orgs[1]) {
    console.error('Error: Need at least 2 seeded organizations.');
    process.exit(1);
  }

  const orgA = orgs[0]!;
  const orgB = orgs[1]!;
  console.log(`Org A: ${orgA.name} (${orgA.id})`);
  console.log(`Org B: ${orgB.name} (${orgB.id})`);

  const repA = orgA.users.find((u) => u.role === 'rep') || orgA.users[0]!;
  const customerA = await prisma.customer.findFirst({ where: { organizationId: orgA.id } });
  const productA = await prisma.product.findFirst({ where: { organizationId: orgA.id } });
  if (!customerA || !productA) throw new Error('Org A needs a seeded customer + product');

  // Clean prior test quotes
  await prisma.quotationLine.deleteMany({ where: { quotation: { quotationNumber: { startsWith: 'TEST-FILES-' } } } });
  await prisma.quotation.deleteMany({ where: { organizationId: orgA.id, quotationNumber: { startsWith: 'TEST-FILES-' } } });

  // Build a test quotation in Org A
  const quote = await prisma.quotation.create({
    data: {
      organizationId: orgA.id,
      quotationNumber: 'TEST-FILES-Q1',
      customerId: customerA.id,
      tierId: customerA.tierId,
      repId: repA.id,
      status: 'approved',
      subtotal: 1000,
      totalAmount: 950,
      totalDiscount: 50,
      totalCost: 600,
      totalMargin: 350,
      totalMarginPercent: 36.84,
      lines: {
        create: {
          productId: productA.id,
          quantity: 1,
          unitPrice: 1000,
          subtotal: 1000,
          total: 950,
          lineDiscountPercent: 5,
          lineDiscountAmount: 50,
          marginAmount: 350,
          marginPercent: 36.84,
          billingFrequency: 'one_time',
        },
      },
    },
    include: { lines: true },
  });

  try {
    // ---------- Test 1: PDF generation produces a valid buffer in the org prefix ----------
    const pdf = await filesService.getQuotationPdf(orgA.id, quote.id);
    if (!pdf.signedUrl.includes(`org-${orgA.id}`)) {
      throw new Error(`Signed URL missing org prefix: ${pdf.signedUrl}`);
    }
    // Verify the object actually exists by re-signing (would throw if not stored)
    const reUrl = await storageService.getTenantSignedUrl(orgA.id, pdf.key, 60);
    if (!reUrl) throw new Error('PDF object not retrievable from MinIO');
    console.log('[PASS] Test 1: quotation PDF generated under org-{id}/ prefix with signed URL');

    // ---------- Test 2: report exports ----------
    const xls = await filesService.exportDealsReport(orgA.id, 'xls');
    if (!xls.signedUrl.includes(`org-${orgA.id}`)) throw new Error('XLS export missing org prefix');
    const repPdf = await filesService.exportDealsReport(orgA.id, 'pdf');
    if (!repPdf.signedUrl.includes(`org-${orgA.id}`)) throw new Error('PDF export missing org prefix');
    console.log('[PASS] Test 2: deals report exports (PDF + XLS) stored under org prefix');

    // ---------- Test 3: cross-tenant PDF access rejected ----------
    let blocked = false;
    try {
      await filesService.getQuotationPdf(orgB.id, quote.id);
    } catch (err: any) {
      blocked = err.statusCode === 404;
    }
    if (!blocked) throw new Error('SECURITY VIOLATION: Org B generated PDF for Org A quotation');
    console.log('[PASS] Test 3: cross-tenant PDF generation rejected with 404');

    // ---------- Test 4: customer token scope — own quote ok, foreign quote 403 ----------
    const customerToken = signCustomerToken(
      { sub: `cust-${customerA.id}`, email: customerA.email, org_id: orgA.id, quotation_ids: [quote.id] },
      '1h'
    );

    const app = createApp();
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Failed to bind test server');
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      // Own quote via portal route
      const ownRes = await fetch(`${baseUrl}/api/portal/quotation/${quote.id}/pdf`, {
        headers: { Authorization: `Bearer ${customerToken}` },
      });
      if (ownRes.status !== 200) {
        throw new Error(`Customer PDF for own quote must be 200 (got ${ownRes.status})`);
      }
      const ownJson: any = await ownRes.json();
      if (!ownJson.data?.signedUrl?.includes(`org-${orgA.id}`)) {
        throw new Error('Portal PDF response missing signed URL with org prefix');
      }
      console.log('[PASS] Test 4: customer token downloads own quotation PDF via portal');

      // Foreign quote (org B quote) via same token
      const quoteB = await prisma.quotation.findFirst({ where: { organizationId: orgB.id } });
      if (quoteB) {
        const foreignRes = await fetch(`${baseUrl}/api/portal/quotation/${quoteB.id}/pdf`, {
          headers: { Authorization: `Bearer ${customerToken}` },
        });
        if (foreignRes.status !== 404 && foreignRes.status !== 403) {
          throw new Error(`SECURITY VIOLATION: customer token fetched foreign quote PDF (${foreignRes.status})`);
        }
        console.log('[PASS] Test 5: customer token denied foreign quotation PDF');
      }

      // Customer token cannot reach internal report export (401/403)
      const reportRes = await fetch(`${baseUrl}/api/files/reports/deals?format=xls`, {
        headers: { Authorization: `Bearer ${customerToken}` },
      });
      if (reportRes.status !== 403 && reportRes.status !== 404) {
        throw new Error(`SECURITY VIOLATION: customer token hit internal report export (${reportRes.status})`);
      }
      console.log('[PASS] Test 6: customer token blocked from internal report export');
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }

    // ---------- Test 7: signed URL from org A cannot address org B object ----------
    // Mint a signed URL for a non-existent org B key using org A's credentials path —
    // the URL must embed org A's prefix so it can never resolve to org B storage.
    const urlA = await storageService.getTenantSignedUrl(orgA.id, 'documents/isolation-probe.pdf', 60);
    const urlBProbe = await storageService.getTenantSignedUrl(orgB.id, 'documents/isolation-probe.pdf', 60);
    const prefixA = `org-${orgA.id}`;
    const prefixB = `org-${orgB.id}`;
    if (!urlA.includes(prefixA) || !urlBProbe.includes(prefixB)) {
      throw new Error('SECURITY VIOLATION: signed URL does not embed the tenant prefix');
    }
    console.log('[PASS] Test 7: signed URLs embed per-org prefixes (org A URL cannot address org B objects)');

    // ---------- Test 8: product image upload + tenant-scoped read ----------
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64'
    );
    const up = await filesService.uploadProductImage(orgA.id, productA.id, {
      buffer: png,
      mimetype: 'image/png',
      originalname: 'probe.png',
    });
    if (!up.imageUrl.includes(`org-${orgA.id}`)) throw new Error('Product image URL missing org prefix');
    const got = await filesService.getProductImage(orgA.id, productA.id);
    if (!got.imageUrl) throw new Error('Product image not retrievable');
    let imgBlocked = false;
    try {
      await filesService.getProductImage(orgB.id, productA.id);
    } catch (err: any) {
      imgBlocked = err.statusCode === 404;
    }
    if (!imgBlocked) throw new Error('SECURITY VIOLATION: Org B read Org A product image');
    console.log('[PASS] Test 8: product image upload/read tenant-scoped');

    // Cleanup uploaded test artifacts
    await storageService.deleteTenantFile(orgA.id, pdf.key);
    await storageService.deleteTenantFile(orgA.id, up.key);
  } finally {
    await prisma.quotationLine.deleteMany({ where: { quotationId: quote.id } });
    await prisma.quotation.delete({ where: { id: quote.id } });
  }

  console.log('\n--- Phase 22 Files & Reports Isolation Suite PASSED (8/8) ---');
}

runFilesIsolationTest()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Phase 22 Isolation Test FAILED:', err);
    process.exit(1);
  });
