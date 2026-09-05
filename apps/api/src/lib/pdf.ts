/**
 * Minimal dependency-free PDF generator (Phase 22).
 * Produces a valid single/multi-page PDF 1.4 document with Helvetica text lines,
 * headings, and horizontal rules — enough for org-branded quotation/invoice PDFs
 * and report exports without adding a heavyweight dependency.
 */

interface PdfText {
  kind: 'text';
  x: number;
  y: number;
  size: number;
  bold?: boolean;
  text: string;
  gray?: number; // 0..1 fill gray
}

interface PdfRule {
  kind: 'rule';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  width?: number;
  gray?: number;
}

/** RGB image drawn from a raw pixel buffer (PNG/JPEG pre-decoded by the caller). */
export interface PdfImage {
  kind: 'image';
  x: number;
  y: number;
  width: number;
  height: number;
  /** Raw RGB bytes, width*height*3. */
  rgb: Buffer;
  pixelWidth: number;
  pixelHeight: number;
}

export type PdfElement = PdfText | PdfRule | PdfImage;

const PAGE_W = 595.28; // A4 portrait
const PAGE_H = 841.89;

function escapePdfText(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    // Strip non-latin1 characters that would break the simple font encoding
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, '?');
}

/**
 * Build a complete PDF from a list of elements laid out on one or more pages.
 *
 * Object layout (stable, explicit):
 *   1: Catalog
 *   2: Pages tree
 *   3: F1 Helvetica
 *   4: F2 Helvetica-Bold
 *   5 .. 5+n-1: Image XObjects (n = images.length)
 *   then per page: page object (even id) + content stream (odd id)
 */
export function buildPdf(elements: PdfElement[], pageCount: number): Buffer {
  const images = elements.filter((el): el is PdfImage => el.kind === 'image');
  const imageCount = images.length;

  const firstPageObj = 5 + imageCount;

  // ---- Content streams per page (text + rules; images drawn via XObject) ----
  const pageContents: string[] = [];
  for (let p = 0; p < pageCount; p++) {
    const parts: string[] = [];
    for (const el of elements) {
      if (el.kind === 'text') {
        const font = el.bold ? '/F2' : '/F1';
        const gray = el.gray ?? 0;
        parts.push(
          `BT ${gray} g ${font} ${el.size} Tf 1 0 0 1 ${el.x.toFixed(2)} ${el.y.toFixed(2)} Tm (${escapePdfText(el.text)}) Tj ET`
        );
      } else if (el.kind === 'rule') {
        const gray = el.gray ?? 0.7;
        const w = el.width ?? 0.7;
        parts.push(
          `${gray} G ${w} w ${el.x1.toFixed(2)} ${el.y1.toFixed(2)} m ${el.x2.toFixed(2)} ${el.y2.toFixed(2)} l S`
        );
      }
    }
    for (let i = 0; i < images.length; i++) {
      const img = images[i]!;
      parts.push(
        `q ${img.width.toFixed(2)} 0 0 ${img.height.toFixed(2)} ${img.x.toFixed(2)} ${img.y.toFixed(2)} cm /Im${i + 1} Do Q`
      );
    }
    pageContents.push(parts.join('\n'));
  }

  const pageObjIds: number[] = [];
  for (let i = 0; i < pageCount; i++) {
    pageObjIds.push(firstPageObj + i * 2);
  }

  // ---- Ordered object list: each entry is text body or binary {dict, data, end} ----
  type PdfObjBody = string | { dict: string; data: Buffer; end: string };
  const objects: PdfObjBody[] = new Array(5 + imageCount + pageCount * 2).fill(undefined);
  const setObject = (id: number, body: string | { dict: string; data: Buffer; end: string }) => {
    objects[id] = body;
  };

  setObject(
    1,
    '<< /Type /Catalog /Pages 2 0 R >>'
  );
  setObject(
    2,
    `<< /Type /Pages /Kids [${pageObjIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageCount} >>`
  );
  setObject(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  setObject(4, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');

  // Image XObjects (ids 5..5+n-1)
  images.forEach((img, i) => {
    const imageObj: { dict: string; data: Buffer; end: string } = {
      dict:
        `<< /Type /XObject /Subtype /Image /Width ${img.pixelWidth} /Height ${img.pixelHeight} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Length ${img.rgb.length} >>\nstream\n`,
      data: img.rgb,
      end: '\nendstream',
    };
    setObject(5 + i, imageObj);
  });

  // Pages + content streams
  pageContents.forEach((content, i) => {
    const pageObj = pageObjIds[i]!;
    const contentObj = pageObj + 1;
    const xObjects = imageCount
      ? ` /XObject << ${images.map((_, j) => `/Im${j + 1} ${5 + j} 0 R`).join(' ')} >>`
      : '';
    setObject(
      pageObj,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] ` +
        `/Resources << /Font << /F1 3 0 R /F2 4 0 R >>${xObjects} >> /Contents ${contentObj} 0 R >>`
    );
    setObject(
      contentObj,
      `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`
    );
  });

  // ---- Serialize with exact xref offsets ----
  const chunks: Buffer[] = [];
  let pos = 0;
  const offsets: (number | undefined)[] = [];

  const push = (s: string | Buffer) => {
    const buf = typeof s === 'string' ? Buffer.from(s, 'latin1') : s;
    chunks.push(buf);
    pos += buf.length;
  };

  push('%PDF-1.4\n');

  const maxObj = objects.length - 1;
  for (let i = 1; i <= maxObj; i++) {
    const body = objects[i];
    if (body === undefined) continue;
    offsets[i] = pos;
    push(`${i} 0 obj\n`);
    if (typeof body === 'string') {
      push(body);
      push('\nendobj\n');
    } else {
      push(body.dict);
      push(body.data);
      push(`${body.end}\nendobj\n`);
    }
  }

  const xrefStart = pos;
  push(`xref\n0 ${maxObj + 1}\n0000000000 65535 f \n`);
  for (let i = 1; i <= maxObj; i++) {
    const off = offsets[i];
    push(off !== undefined ? `${String(off).padStart(10, '0')} 00000 n \n` : '0000000000 65535 f \n');
  }
  push(`trailer\n<< /Size ${maxObj + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`);

  return Buffer.concat(chunks);
}

export const PDF_PAGE = { width: PAGE_W, height: PAGE_H, margin: 48 };
