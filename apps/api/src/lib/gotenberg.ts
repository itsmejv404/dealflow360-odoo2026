import { env } from '../config/env.js';
import { logger } from './logger.js';
import { buildPdf, PDF_PAGE, type PdfElement } from './pdf.js';

export interface InvoiceHtmlData {
  orgName: string;
  orgSlug?: string;
  orgLogoBase64?: string | null; // e.g. "data:image/png;base64,..." or URL
  orgCurrency: string;
  invoiceNumber: string;
  type: string;
  status: string;
  issuedAt: string;
  dueDate: string;
  quotationNumber?: string | null;
  customerName?: string | null;
  customerEmail?: string | null;
  lines: Array<{
    description: string;
    quantity: number;
    unitPrice: number;
    discountPercent?: number | null;
    totalAmount: number;
  }>;
  surcharges?: Array<{
    label: string;
    kind: string;
    value: number;
    computedAmount: number;
  }>;
  subtotal: number;
  discountAmount?: number;
  totalAmount: number;
  notes?: string | null;
}

export function generateInvoiceHtml(data: InvoiceHtmlData): string {
  const currency = data.orgCurrency || 'USD';
  const formatMoney = (val: number) =>
    `${currency} ${Number(val || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const linesHtml = data.lines
    .map(
      (l, idx) => `
      <tr class="${idx % 2 === 0 ? 'bg-white' : 'bg-slate-50'}">
        <td class="py-3 px-4 text-sm text-slate-800 border-b border-slate-200">
          <div class="font-medium">${escapeHtml(l.description)}</div>
          ${l.discountPercent && Number(l.discountPercent) > 0 ? `<div class="text-xs text-emerald-600">Discount: ${Number(l.discountPercent)}% off</div>` : ''}
        </td>
        <td class="py-3 px-4 text-sm text-center text-slate-600 border-b border-slate-200">${l.quantity}</td>
        <td class="py-3 px-4 text-sm text-right text-slate-600 border-b border-slate-200">${formatMoney(l.unitPrice)}</td>
        <td class="py-3 px-4 text-sm text-right font-semibold text-slate-800 border-b border-slate-200">${formatMoney(l.totalAmount)}</td>
      </tr>
    `
    )
    .join('');

  const surchargesHtml = (data.surcharges || [])
    .map(
      (s) => `
      <tr class="text-slate-600 text-sm">
        <td colspan="3" class="py-1.5 px-4 text-right">
          ${escapeHtml(s.label)} ${s.kind === 'percent' ? `(${s.value}%)` : ''}
        </td>
        <td class="py-1.5 px-4 text-right font-medium text-slate-800">
          +${formatMoney(s.computedAmount)}
        </td>
      </tr>
    `
    )
    .join('');

  const logoOrNameHeader = data.orgLogoBase64
    ? `
      <div style="display: flex; align-items: center; gap: 16px;">
        <img src="${data.orgLogoBase64}" alt="${escapeHtml(data.orgName)}" style="max-height: 56px; max-width: 180px; object-fit: contain;" />
        <div style="border-left: 1px solid #cbd5e1; padding-left: 14px;">
          <div style="font-size: 18px; font-weight: 700; color: #0f172a; line-height: 1.2;">${escapeHtml(data.orgName)}</div>
          <div style="font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px;">Official Invoice</div>
        </div>
      </div>
    `
    : `
      <div>
        <div style="display: inline-flex; align-items: center; gap: 10px;">
          <div style="width: 36px; height: 36px; border-radius: 8px; background: #4f46e5; display: flex; align-items: center; justify-content: center; color: #ffffff; font-weight: 900; font-size: 18px;">
            ${escapeHtml(data.orgName.charAt(0).toUpperCase())}
          </div>
          <h1 style="font-size: 24px; font-weight: 800; letter-spacing: -0.5px; color: #0f172a; margin: 0;">${escapeHtml(data.orgName)}</h1>
        </div>
        <div style="font-size: 11px; color: #64748b; margin-top: 4px; text-transform: uppercase; letter-spacing: 0.5px;">Commercial Billing & Invoicing</div>
      </div>
    `;

  const statusStyle =
    data.status === 'paid'
      ? 'background: #dcfce7; color: #166534; border-color: #86efac;'
      : data.status === 'issued'
      ? 'background: #dbeafe; color: #1e40af; border-color: #93c5fd;'
      : 'background: #fef3c7; color: #92400e; border-color: #fcd34d;';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Invoice ${escapeHtml(data.invoiceNumber)}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #1e293b;
      background: #ffffff;
      padding: 36px 44px;
      font-size: 13px;
      line-height: 1.5;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      padding-bottom: 24px;
      border-bottom: 2px solid #e2e8f0;
      margin-bottom: 28px;
    }
    .invoice-title {
      text-align: right;
    }
    .invoice-title h2 {
      font-size: 26px;
      font-weight: 800;
      letter-spacing: -0.5px;
      color: #0f172a;
      text-transform: uppercase;
    }
    .invoice-badge {
      display: inline-block;
      padding: 3px 12px;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      border-radius: 9999px;
      border: 1px solid;
      margin-top: 4px;
    }
    .meta-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 24px;
      margin-bottom: 28px;
    }
    .meta-box {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 16px 20px;
    }
    .meta-box-title {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #64748b;
      margin-bottom: 8px;
    }
    .meta-row {
      display: flex;
      justify-content: space-between;
      margin-bottom: 4px;
      font-size: 13px;
    }
    .meta-label { color: #64748b; }
    .meta-val { font-weight: 600; color: #1e293b; }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 24px;
    }
    th {
      background: #f1f5f9;
      color: #475569;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      padding: 10px 16px;
      border-top: 1px solid #cbd5e1;
      border-bottom: 2px solid #cbd5e1;
    }
    .summary-card {
      margin-left: auto;
      width: 320px;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 16px 20px;
      margin-bottom: 32px;
    }
    .summary-row {
      display: flex;
      justify-content: space-between;
      margin-bottom: 8px;
      font-size: 13px;
    }
    .summary-total {
      display: flex;
      justify-content: space-between;
      border-top: 2px solid #cbd5e1;
      padding-top: 10px;
      margin-top: 8px;
      font-size: 16px;
      font-weight: 800;
      color: #0f172a;
    }
    .footer {
      border-top: 1px solid #e2e8f0;
      padding-top: 16px;
      text-align: center;
      font-size: 11px;
      color: #94a3b8;
    }
  </style>
</head>
<body>

  <!-- Top Header -->
  <div class="header">
    ${logoOrNameHeader}
    <div class="invoice-title">
      <h2>INVOICE</h2>
      <div style="font-size: 13px; font-weight: 700; color: #475569; margin-top: 2px;"># ${escapeHtml(data.invoiceNumber)}</div>
      <div class="invoice-badge" style="${statusStyle}">${escapeHtml(data.status)}</div>
    </div>
  </div>

  <!-- Meta Information -->
  <div class="meta-grid">
    <div class="meta-box">
      <div class="meta-box-title">Billed To</div>
      <div style="font-size: 15px; font-weight: 700; color: #0f172a; margin-bottom: 4px;">
        ${escapeHtml(data.customerName || 'Valued Customer')}
      </div>
      <div style="font-size: 13px; color: #475569;">${escapeHtml(data.customerEmail || '—')}</div>
    </div>

    <div class="meta-box">
      <div class="meta-box-title">Invoice Details</div>
      <div class="meta-row">
        <span class="meta-label">Issued Date:</span>
        <span class="meta-val">${escapeHtml(data.issuedAt)}</span>
      </div>
      <div class="meta-row">
        <span class="meta-label">Payment Due:</span>
        <span class="meta-val">${escapeHtml(data.dueDate)}</span>
      </div>
      ${data.quotationNumber ? `
      <div class="meta-row">
        <span class="meta-label">Quotation Ref:</span>
        <span class="meta-val">${escapeHtml(data.quotationNumber)}</span>
      </div>` : ''}
      <div class="meta-row">
        <span class="meta-label">Billing Type:</span>
        <span class="meta-val" style="text-transform: capitalize;">${escapeHtml(data.type.replace(/_/g, ' '))}</span>
      </div>
    </div>
  </div>

  <!-- Items Table -->
  <table>
    <thead>
      <tr>
        <th style="text-align: left;">Item Description</th>
        <th style="text-align: center; width: 60px;">Qty</th>
        <th style="text-align: right; width: 110px;">Unit Price</th>
        <th style="text-align: right; width: 120px;">Line Total</th>
      </tr>
    </thead>
    <tbody>
      ${linesHtml}
    </tbody>
  </table>

  <!-- Financial Summary -->
  <div class="summary-card">
    <div class="summary-row">
      <span class="meta-label">Subtotal</span>
      <span class="meta-val">${formatMoney(data.subtotal)}</span>
    </div>
    ${data.discountAmount && Number(data.discountAmount) > 0 ? `
    <div class="summary-row" style="color: #16a34a;">
      <span>Discounts Applied</span>
      <span style="font-weight: 600;">-${formatMoney(data.discountAmount)}</span>
    </div>` : ''}
    ${surchargesHtml}
    <div class="summary-total">
      <span>Total Due</span>
      <span>${formatMoney(data.totalAmount)}</span>
    </div>
  </div>

  ${data.notes ? `
  <div style="background: #f8fafc; border: 1px dashed #cbd5e1; border-radius: 6px; padding: 12px 16px; margin-bottom: 24px; font-size: 12px; color: #475569;">
    <strong style="color: #1e293b;">Notes:</strong> ${escapeHtml(data.notes)}
  </div>` : ''}

  <!-- Footer -->
  <div class="footer">
    Invoice ${escapeHtml(data.invoiceNumber)} · Generated by ${escapeHtml(data.orgName)} via DealFlow360
  </div>

</body>
</html>`;
}

function escapeHtml(text: unknown): string {
  if (text === null || text === undefined) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Converts HTML to a PDF Buffer via Gotenberg API, falling back to local
 * PDF builder if Gotenberg service is unreachable.
 */
export async function convertHtmlToPdf(html: string): Promise<Buffer> {
  const gotenbergUrl = env.GOTENBERG_URL || 'http://gotenberg:3000';

  try {
    const formData = new FormData();
    const htmlBlob = new Blob([html], { type: 'text/html' });
    formData.append('files', htmlBlob, 'index.html');
    formData.append('paperWidth', '8.27'); // A4 inches
    formData.append('paperHeight', '11.69');
    formData.append('marginTop', '0.4');
    formData.append('marginBottom', '0.4');
    formData.append('marginLeft', '0.4');
    formData.append('marginRight', '0.4');
    formData.append('preferCssPageSize', 'true');
    formData.append('printBackground', 'true');

    const res = await fetch(`${gotenbergUrl}/forms/chromium/convert/html`, {
      method: 'POST',
      body: formData,
      signal: AbortSignal.timeout(15000),
    });

    if (res.ok) {
      const arrayBuf = await res.arrayBuffer();
      logger.info({ bytes: arrayBuf.byteLength }, 'Gotenberg converted HTML to PDF successfully');
      return Buffer.from(arrayBuf);
    }

    logger.warn({ status: res.status, text: await res.text().catch(() => '') }, 'Gotenberg returned non-200 response; falling back to internal PDF builder');
  } catch (err: any) {
    logger.warn({ err: err.message }, 'Gotenberg request failed; falling back to internal PDF builder');
  }

  // Fallback: build minimal PDF with buildPdf
  const elements: PdfElement[] = [
    { kind: 'text', x: PDF_PAGE.margin, y: PDF_PAGE.height - PDF_PAGE.margin, size: 16, bold: true, text: 'INVOICE' },
    { kind: 'text', x: PDF_PAGE.margin, y: PDF_PAGE.height - PDF_PAGE.margin - 24, size: 10, text: 'Rendered via DealFlow360 document generator' },
  ];
  return buildPdf(elements, 1);
}
