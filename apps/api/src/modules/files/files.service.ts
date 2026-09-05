import { prisma } from '../../lib/prisma.js';
import { storageService } from '../../lib/storage.js';
import { buildPdf, PDF_PAGE, type PdfElement } from '../../lib/pdf.js';
import { decodePng } from '../../lib/png.js';
import { buildXls, type XlsCell } from '../../lib/xls.js';
import { HttpError } from '../../shared/errors.js';
import { logger } from '../../lib/logger.js';

const M = PDF_PAGE.margin;
const CONTENT_W = PDF_PAGE.width - M * 2;

function money(n: unknown, currency: string): string {
  const num = Number(n || 0);
  return `${currency} ${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function wrapText(text: string, maxChars: number): string[] {
  const words = String(text || '').split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    if ((line + ' ' + w).trim().length > maxChars) {
      if (line) lines.push(line.trim());
      line = w;
    } else {
      line = (line + ' ' + w).trim();
    }
  }
  if (line) lines.push(line.trim());
  return lines.length > 0 ? lines : [''];
}

interface BrandedHeader {
  orgName: string;
  logoUrl?: string | null;
  docTitle: string;
  subtitle?: string;
}

/** Render a branded header block; returns elements + current y cursor. */
function renderHeader(h: BrandedHeader, y0: number): { elements: PdfElement[]; y: number } {
  const elements: PdfElement[] = [];
  let y = y0;
  elements.push({ kind: 'text', x: M, y, size: 18, bold: true, text: h.orgName });
  elements.push({ kind: 'text', x: PDF_PAGE.width - M - 160, y, size: 13, bold: true, text: h.docTitle, gray: 0.15 });
  if (h.subtitle) {
    y -= 16;
    elements.push({ kind: 'text', x: PDF_PAGE.width - M - 160, y, size: 9, text: h.subtitle, gray: 0.4 });
  }
  y -= 10;
  elements.push({ kind: 'rule', x1: M, y1: y, x2: PDF_PAGE.width - M, y2: y, gray: 0.2 });
  return { elements, y: y - 18 };
}

export class FilesService {
  /**
   * Load the org logo for PDF branding. Accepts a stored asset key (relative
   * to the tenant bucket) or an https URL. Returns raw RGB for the PDF image
   * XObject, or null when unavailable — documents still render without it.
   */
  private async loadLogoImage(
    orgId: string,
    logoUrl?: string | null
  ): Promise<{ width: number; height: number; rgb: Buffer } | null> {
    if (!logoUrl) return null;
    try {
      let buffer: Buffer;
      if (logoUrl.startsWith('http://') || logoUrl.startsWith('https://')) {
        const res = await fetch(logoUrl);
        if (!res.ok) return null;
        buffer = Buffer.from(await res.arrayBuffer());
      } else {
        const stream = await storageService.getTenantFileStream(orgId, logoUrl.replace(/^\//, ''));
        const chunks: Buffer[] = [];
        for await (const chunk of stream.body as unknown as AsyncIterable<Buffer>) {
          chunks.push(Buffer.from(chunk));
        }
        buffer = Buffer.concat(chunks);
      }
      if (!buffer || buffer.length === 0) return null;
      return decodePng(buffer);
    } catch (err: any) {
      logger.warn({ orgId, logoUrl, err: err.message }, 'Could not load org logo for PDF; rendering without it');
      return null;
    }
  }

  // ==================== Quotation PDF ====================

  /** Generate (or regenerate) the org-branded quotation PDF and return a signed URL */
  async getQuotationPdf(orgId: string, quotationId: string, viewer?: { isCustomer?: boolean; customerQuotationIds?: string[] }) {
    const quotation = await prisma.quotation.findFirst({
      where: { id: quotationId, organizationId: orgId },
      include: {
        organization: { select: { name: true, slug: true, currency: true, logoUrl: true } },
        customer: true,
        lines: { include: { product: { select: { name: true, sku: true } } }, orderBy: { id: 'asc' } },
      },
    });
    if (!quotation) throw new HttpError(404, 'Quotation not found in this organization');

    // Customer portal tokens can only fetch PDFs of their own quotes
    if (viewer?.isCustomer && !(viewer.customerQuotationIds || []).includes(quotationId)) {
      throw new HttpError(403, 'This quotation is not available to you');
    }

    const currency = quotation.organization.currency || 'USD';
    const key = `documents/quotation-${quotation.quotationNumber}.pdf`;

    const elements: PdfElement[] = [];
    let y = PDF_PAGE.height - M;

    const head = renderHeader(
      {
        orgName: quotation.organization.name,
        logoUrl: quotation.organization.logoUrl,
        docTitle: 'QUOTATION',
        subtitle: quotation.quotationNumber,
      },
      y
    );
    elements.push(...head.elements);
    y = head.y;

    elements.push({ kind: 'text', x: M, y, size: 10, bold: true, text: `Customer: ${quotation.customer.name}` });
    elements.push({
      kind: 'text',
      x: M + 220,
      y,
      size: 9,
      text: `Status: ${quotation.status}   Currency: ${currency}`,
      gray: 0.4,
    });
    y -= 14;
    elements.push({ kind: 'text', x: M, y, size: 9, text: `Email: ${quotation.customer.email}`, gray: 0.4 });
    y -= 22;
    elements.push({ kind: 'rule', x1: M, y1: y, x2: PDF_PAGE.width - M, y2: y, gray: 0.8 });
    y -= 16;

    // Table header
    elements.push({ kind: 'text', x: M, y, size: 9, bold: true, text: 'ITEM' });
    elements.push({ kind: 'text', x: M + 250, y, size: 9, bold: true, text: 'QTY' });
    elements.push({ kind: 'text', x: M + 300, y, size: 9, bold: true, text: 'UNIT' });
    elements.push({ kind: 'text', x: M + 360, y, size: 9, bold: true, text: 'DISC %' });
    elements.push({ kind: 'text', x: M + 430, y, size: 9, bold: true, text: 'TOTAL' });
    y -= 6;
    elements.push({ kind: 'rule', x1: M, y1: y, x2: PDF_PAGE.width - M, y2: y, gray: 0.8 });
    y -= 14;

    for (const line of quotation.lines) {
      const nameLines = wrapText(`${line.product.name} (${line.product.sku})`, 42);
      for (const nl of nameLines) {
        elements.push({ kind: 'text', x: M, y, size: 9, text: nl });
        y -= 12;
      }
      elements.push({ kind: 'text', x: M + 250, y: y + 12, size: 9, text: String(line.quantity) });
      elements.push({ kind: 'text', x: M + 300, y: y + 12, size: 9, text: money(line.unitPrice, '') });
      elements.push({ kind: 'text', x: M + 360, y: y + 12, size: 9, text: Number(line.lineDiscountPercent).toFixed(1) });
      elements.push({ kind: 'text', x: M + 430, y: y + 12, size: 9, text: money(line.total, '') });
      y -= 8;
    }

    y -= 12;
    elements.push({ kind: 'rule', x1: M, y1: y, x2: PDF_PAGE.width - M, y2: y, gray: 0.8 });
    y -= 18;
    elements.push({ kind: 'text', x: M + 300, y, size: 10, text: 'Subtotal' });
    elements.push({ kind: 'text', x: M + 430, y, size: 10, text: money(quotation.subtotal, currency) });
    y -= 14;
    elements.push({ kind: 'text', x: M + 300, y, size: 10, text: 'Discount' });
    elements.push({ kind: 'text', x: M + 430, y, size: 10, text: `-${money(quotation.totalDiscount, currency)}` });
    y -= 14;
    elements.push({ kind: 'text', x: M + 300, y, size: 12, bold: true, text: 'Grand Total' });
    elements.push({ kind: 'text', x: M + 430, y, size: 12, bold: true, text: money(quotation.totalAmount, currency) });
    y -= 14;
    if (Number(quotation.recurringMonthlyTotal) > 0) {
      elements.push({ kind: 'text', x: M + 300, y, size: 9, text: 'Recurring / month', gray: 0.4 });
      elements.push({ kind: 'text', x: M + 430, y, size: 9, text: money(quotation.recurringMonthlyTotal, currency), gray: 0.4 });
    }

    y -= 30;
    elements.push({ kind: 'text', x: M, y, size: 8, text: `Generated by ${quotation.organization.name} via DealFlow360`, gray: 0.55 });

    const pageCount = 1; // quotes fit one page for the foreseeable scale
    const pdf = buildPdf(elements, pageCount);
    await storageService.uploadTenantFile({ orgId, key, buffer: pdf, contentType: 'application/pdf' });

    const signedUrl = await storageService.getTenantSignedUrl(orgId, key, 900);
    logger.info({ orgId, quotationId, key }, 'Quotation PDF generated');
    return { key, signedUrl, fileName: `quotation-${quotation.quotationNumber}.pdf` };
  }

  // ==================== Invoice PDF ====================

  async getInvoicePdf(orgId: string, invoiceId: string) {
    const invoice = await prisma.invoice.findFirst({
      where: { id: invoiceId, organizationId: orgId },
      include: {
        organization: { select: { id: true, name: true, currency: true, logoUrl: true } },
        quotation: { select: { quotationNumber: true, customer: { select: { name: true, email: true } } } },
        lines: true,
        surcharges: true,
      },
    });
    if (!invoice) throw new HttpError(404, 'Invoice not found in this organization');

    const currency = invoice.currency || invoice.organization.currency || 'USD';
    const key = `documents/invoice-${invoice.invoiceNumber}.pdf`;

    const elements: PdfElement[] = [];
    let y = PDF_PAGE.height - M;

    // Company logo, top-left corner (falls back to a text-only header when
    // no logo is configured or the asset cannot be decoded)
    const logo = await this.loadLogoImage(orgId, invoice.organization.logoUrl);
    if (logo) {
      const logoH = 44;
      const logoW = Math.min((logo.width / logo.height) * logoH, 150);
      elements.push({
        kind: 'image',
        x: M,
        y: y - logoH,
        width: logoW,
        height: logoH,
        rgb: logo.rgb,
        pixelWidth: logo.width,
        pixelHeight: logo.height,
      });
      y -= logoH + 6;
    }

    const head = renderHeader(
      { orgName: invoice.organization.name, docTitle: 'INVOICE', subtitle: invoice.invoiceNumber },
      y
    );
    elements.push(...head.elements);
    y = head.y;

    elements.push({ kind: 'text', x: M, y, size: 10, bold: true, text: `Bill To: ${invoice.quotation?.customer?.name || 'N/A'}` });
    elements.push({ kind: 'text', x: M + 260, y, size: 9, text: `Issued: ${invoice.issuedAt.toISOString().split('T')[0]}   Due: ${invoice.dueDate.toISOString().split('T')[0]}`, gray: 0.4 });
    y -= 14;
    elements.push({ kind: 'text', x: M, y, size: 9, text: `Quotation: ${invoice.quotation?.quotationNumber || '—'}   Type: ${invoice.type}`, gray: 0.4 });
    y -= 24;
    elements.push({ kind: 'rule', x1: M, y1: y, x2: PDF_PAGE.width - M, y2: y, gray: 0.8 });
    y -= 16;

    elements.push({ kind: 'text', x: M, y, size: 9, bold: true, text: 'DESCRIPTION' });
    elements.push({ kind: 'text', x: M + 300, y, size: 9, bold: true, text: 'QTY' });
    elements.push({ kind: 'text', x: M + 350, y, size: 9, bold: true, text: 'UNIT' });
    elements.push({ kind: 'text', x: M + 430, y, size: 9, bold: true, text: 'TOTAL' });
    y -= 6;
    elements.push({ kind: 'rule', x1: M, y1: y, x2: PDF_PAGE.width - M, y2: y, gray: 0.8 });
    y -= 14;

    for (const line of invoice.lines) {
      const lines = wrapText(line.description, 50);
      for (const nl of lines) {
        elements.push({ kind: 'text', x: M, y, size: 9, text: nl });
        y -= 12;
      }
      elements.push({ kind: 'text', x: M + 300, y: y + 12, size: 9, text: String(line.quantity) });
      elements.push({ kind: 'text', x: M + 350, y: y + 12, size: 9, text: money(line.unitPrice, '') });
      elements.push({ kind: 'text', x: M + 430, y: y + 12, size: 9, text: money(line.totalAmount, '') });
      y -= 8;
    }

    // Surcharges (additional charges) above the total
    if (invoice.surcharges.length > 0) {
      y -= 12;
      elements.push({ kind: 'rule', x1: M, y1: y, x2: PDF_PAGE.width - M, y2: y, gray: 0.8 });
      y -= 16;
      for (const s of invoice.surcharges) {
        elements.push({
          kind: 'text',
          x: M + 300,
          y,
          size: 9,
          text: `${s.label} (${s.kind === 'percent' ? `${Number(s.value)}%` : money(s.value, currency)})`,
        });
        elements.push({ kind: 'text', x: M + 430, y, size: 9, text: money(s.computedAmount, currency) });
        y -= 13;
      }
    }

    y -= 12;
    elements.push({ kind: 'rule', x1: M, y1: y, x2: PDF_PAGE.width - M, y2: y, gray: 0.8 });
    y -= 20;
    elements.push({ kind: 'text', x: M + 330, y, size: 12, bold: true, text: 'Total Due' });
    elements.push({ kind: 'text', x: M + 430, y, size: 12, bold: true, text: money(invoice.totalAmount, currency) });

    y -= 30;
    elements.push({ kind: 'text', x: M, y, size: 8, text: `Invoice ${invoice.invoiceNumber} — ${invoice.organization.name} via DealFlow360`, gray: 0.55 });

    const pdf = buildPdf(elements, 1);
    await storageService.uploadTenantFile({ orgId, key, buffer: pdf, contentType: 'application/pdf' });

    const signedUrl = await storageService.getTenantSignedUrl(orgId, key, 900);
    return { key, signedUrl, fileName: `invoice-${invoice.invoiceNumber}.pdf` };
  }

  /**
   * Build the branded invoice PDF and return the raw buffer (used for email
   * attachments) without uploading to storage.
   */
  async buildInvoicePdf(orgId: string, invoiceId: string): Promise<{ pdf: Buffer; fileName: string }> {
    const invoice = await prisma.invoice.findFirst({
      where: { id: invoiceId, organizationId: orgId },
      include: {
        organization: { select: { id: true, name: true, currency: true, logoUrl: true } },
        quotation: { select: { quotationNumber: true, customer: { select: { name: true, email: true } } } },
        lines: true,
        surcharges: true,
      },
    });
    if (!invoice) throw new HttpError(404, 'Invoice not found in this organization');

    const currency = invoice.currency || invoice.organization.currency || 'USD';
    const elements: PdfElement[] = [];
    let y = PDF_PAGE.height - M;

    const logo = await this.loadLogoImage(orgId, invoice.organization.logoUrl);
    if (logo) {
      const logoH = 44;
      const logoW = Math.min((logo.width / logo.height) * logoH, 150);
      elements.push({
        kind: 'image',
        x: M,
        y: y - logoH,
        width: logoW,
        height: logoH,
        rgb: logo.rgb,
        pixelWidth: logo.width,
        pixelHeight: logo.height,
      });
      y -= logoH + 6;
    }

    const head = renderHeader(
      { orgName: invoice.organization.name, docTitle: 'INVOICE', subtitle: invoice.invoiceNumber },
      y
    );
    elements.push(...head.elements);
    y = head.y;

    elements.push({ kind: 'text', x: M, y, size: 10, bold: true, text: `Bill To: ${invoice.quotation?.customer?.name || 'N/A'}` });
    elements.push({ kind: 'text', x: M + 260, y, size: 9, text: `Issued: ${invoice.issuedAt.toISOString().split('T')[0]}   Due: ${invoice.dueDate.toISOString().split('T')[0]}`, gray: 0.4 });
    y -= 14;
    elements.push({ kind: 'text', x: M, y, size: 9, text: `Quotation: ${invoice.quotation?.quotationNumber || '—'}   Type: ${invoice.type}`, gray: 0.4 });
    y -= 24;
    elements.push({ kind: 'rule', x1: M, y1: y, x2: PDF_PAGE.width - M, y2: y, gray: 0.8 });
    y -= 16;

    elements.push({ kind: 'text', x: M, y, size: 9, bold: true, text: 'DESCRIPTION' });
    elements.push({ kind: 'text', x: M + 300, y, size: 9, bold: true, text: 'QTY' });
    elements.push({ kind: 'text', x: M + 350, y, size: 9, bold: true, text: 'UNIT' });
    elements.push({ kind: 'text', x: M + 430, y, size: 9, bold: true, text: 'TOTAL' });
    y -= 6;
    elements.push({ kind: 'rule', x1: M, y1: y, x2: PDF_PAGE.width - M, y2: y, gray: 0.8 });
    y -= 14;

    for (const line of invoice.lines) {
      const wrapped = wrapText(line.description, 50);
      for (const nl of wrapped) {
        elements.push({ kind: 'text', x: M, y, size: 9, text: nl });
        y -= 12;
      }
      elements.push({ kind: 'text', x: M + 300, y: y + 12, size: 9, text: String(line.quantity) });
      elements.push({ kind: 'text', x: M + 350, y: y + 12, size: 9, text: money(line.unitPrice, '') });
      elements.push({ kind: 'text', x: M + 430, y: y + 12, size: 9, text: money(line.totalAmount, '') });
      y -= 8;
    }

    if (invoice.surcharges.length > 0) {
      y -= 12;
      elements.push({ kind: 'rule', x1: M, y1: y, x2: PDF_PAGE.width - M, y2: y, gray: 0.8 });
      y -= 16;
      for (const s of invoice.surcharges) {
        elements.push({
          kind: 'text',
          x: M + 300,
          y,
          size: 9,
          text: `${s.label} (${s.kind === 'percent' ? `${Number(s.value)}%` : money(s.value, currency)})`,
        });
        elements.push({ kind: 'text', x: M + 430, y, size: 9, text: money(s.computedAmount, currency) });
        y -= 13;
      }
    }

    y -= 12;
    elements.push({ kind: 'rule', x1: M, y1: y, x2: PDF_PAGE.width - M, y2: y, gray: 0.8 });
    y -= 20;
    elements.push({ kind: 'text', x: M + 330, y, size: 12, bold: true, text: 'Total Due' });
    elements.push({ kind: 'text', x: M + 430, y, size: 12, bold: true, text: money(invoice.totalAmount, currency) });

    y -= 30;
    elements.push({ kind: 'text', x: M, y, size: 8, text: `Invoice ${invoice.invoiceNumber} — ${invoice.organization.name} via DealFlow360`, gray: 0.55 });

    return { pdf: buildPdf(elements, 1), fileName: `invoice-${invoice.invoiceNumber}.pdf` };
  }

  // ==================== Deals Report (PDF / XLS) ====================

  async exportDealsReport(orgId: string, format: 'pdf' | 'xls', userCtx?: { email?: string }) {
    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { name: true, currency: true, timezone: true },
    });
    if (!org) throw new HttpError(404, 'Organization not found');

    const quotations = await prisma.quotation.findMany({
      where: { organizationId: orgId },
      include: { customer: { select: { name: true } }, rep: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });

    const stamp = new Date().toISOString().split('T')[0];
    const currency = org.currency || 'USD';

    if (format === 'xls') {
      const headers = ['Quote #', 'Customer', 'Rep', 'Status', 'Risk', 'Subtotal', 'Discount', 'Total', 'Recurring/Mo', 'Created'];
      const rows: XlsCell[][] = quotations.map((q) => [
        q.quotationNumber,
        q.customer?.name || '',
        q.rep?.name || 'Unassigned',
        q.status,
        `${Number(q.riskScore).toFixed(0)} (${q.riskLevel})`,
        Number(q.subtotal),
        Number(q.totalDiscount),
        Number(q.totalAmount),
        Number(q.recurringMonthlyTotal),
        q.createdAt.toISOString().split('T')[0],
      ]);
      const xls = buildXls(headers, rows, `Deals ${stamp}`);
      const key = `reports/deals-report-${stamp}.xls`;
      await storageService.uploadTenantFile({ orgId, key, buffer: xls, contentType: 'application/vnd.ms-excel' });
      const signedUrl = await storageService.getTenantSignedUrl(orgId, key, 900);
      return { key, signedUrl, fileName: `deals-report-${stamp}.xls`, rowCount: rows.length };
    }

    // PDF report
    const elements: PdfElement[] = [];
    let y = PDF_PAGE.height - M;
    const head = renderHeader({ orgName: org.name, docTitle: 'DEALS REPORT', subtitle: `As of ${stamp}` }, y);
    elements.push(...head.elements);
    y = head.y;

    elements.push({ kind: 'text', x: M, y, size: 9, bold: true, text: 'QUOTE #' });
    elements.push({ kind: 'text', x: M + 110, y, size: 9, bold: true, text: 'CUSTOMER' });
    elements.push({ kind: 'text', x: M + 230, y, size: 9, bold: true, text: 'REP' });
    elements.push({ kind: 'text', x: M + 300, y, size: 9, bold: true, text: 'STATUS' });
    elements.push({ kind: 'text', x: M + 370, y, size: 9, bold: true, text: 'RISK' });
    elements.push({ kind: 'text', x: M + 430, y, size: 9, bold: true, text: 'TOTAL' });
    y -= 6;
    elements.push({ kind: 'rule', x1: M, y1: y, x2: PDF_PAGE.width - M, y2: y, gray: 0.8 });
    y -= 14;

    for (const q of quotations) {
      if (y < M + 40) break; // single-page cap
      elements.push({ kind: 'text', x: M, y, size: 8, text: q.quotationNumber });
      elements.push({ kind: 'text', x: M + 110, y, size: 8, text: (q.customer?.name || '').slice(0, 20) });
      elements.push({ kind: 'text', x: M + 230, y, size: 8, text: (q.rep?.name || 'Unassigned').slice(0, 12) });
      elements.push({ kind: 'text', x: M + 300, y, size: 8, text: q.status });
      elements.push({ kind: 'text', x: M + 370, y, size: 8, text: `${Number(q.riskScore).toFixed(0)} ${q.riskLevel}` });
      elements.push({ kind: 'text', x: M + 430, y, size: 8, text: money(q.totalAmount, currency) });
      y -= 12;
    }

    y -= 20;
    elements.push({ kind: 'text', x: M, y, size: 8, text: `${quotations.length} deals — generated${userCtx?.email ? ` by ${userCtx.email}` : ''} via DealFlow360`, gray: 0.55 });

    const pdf = buildPdf(elements, 1);
    const key = `reports/deals-report-${stamp}.pdf`;
    await storageService.uploadTenantFile({ orgId, key, buffer: pdf, contentType: 'application/pdf' });
    const signedUrl = await storageService.getTenantSignedUrl(orgId, key, 900);
    return { key, signedUrl, fileName: `deals-report-${stamp}.pdf`, rowCount: quotations.length };
  }

  // ==================== Product Images ====================

  async uploadProductImage(
    orgId: string,
    productId: string,
    file: { buffer: Buffer; mimetype: string; originalname: string }
  ) {
    const product = await prisma.product.findFirst({ where: { id: productId, organizationId: orgId } });
    if (!product) throw new HttpError(404, 'Product not found in this organization');

    const allowed = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
    if (!allowed.includes(file.mimetype)) {
      throw new HttpError(400, `Unsupported image type ${file.mimetype}. Allowed: ${allowed.join(', ')}`);
    }
    if (file.buffer.length > 5 * 1024 * 1024) {
      throw new HttpError(400, 'Image exceeds the 5 MB limit');
    }

    const ext = file.mimetype.split('/')[1]?.replace('jpeg', 'jpg') || 'png';
    const key = `products/${productId}/image.${ext}`;
    await storageService.uploadTenantFile({ orgId, key, buffer: file.buffer, contentType: file.mimetype });

    const existingImage = await prisma.product.findUnique({ where: { id: productId } });
    const imageUrl = await storageService.getTenantSignedUrl(orgId, key, 3600);
    return { key, imageUrl, productName: existingImage?.name };
  }

  async getProductImage(orgId: string, productId: string) {
    const product = await prisma.product.findFirst({ where: { id: productId, organizationId: orgId } });
    if (!product) throw new HttpError(404, 'Product not found in this organization');

    // Try common extensions
    for (const ext of ['png', 'jpg', 'webp', 'gif']) {
      const key = `products/${productId}/image.${ext}`;
      try {
        const url = await storageService.getTenantSignedUrl(orgId, key, 3600);
        return { key, imageUrl: url };
      } catch {
        continue;
      }
    }
    throw new HttpError(404, 'No image uploaded for this product');
  }
}

export const filesService = new FilesService();
