/**
 * Minimal dependency-free SpreadsheetML 2003 exporter (Phase 22).
 * Produces an Excel-compatible .xls file from row matrices — sufficient for
 * org deals report exports without a heavyweight dependency.
 */

export interface XlsColumn {
  header: string;
}

export type XlsCell = string | number | boolean | null | undefined;

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildXls(columnHeaders: string[], rows: XlsCell[][], sheetName = 'Report'): Buffer {
  const headerCells = columnHeaders
    .map((h) => `<Cell ss:StyleID="sHeader"><Data ss:Type="String">${esc(h)}</Data></Cell>`)
    .join('');

  const bodyRows = rows
    .map(
      (row) =>
        `<Row>${row
          .map((c) => {
            if (c === null || c === undefined) return '<Cell/>';
            if (typeof c === 'number' && Number.isFinite(c)) {
              return `<Cell><Data ss:Type="Number">${c}</Data></Cell>`;
            }
            if (typeof c === 'boolean') {
              return `<Cell><Data ss:Type="String">${c ? 'Yes' : 'No'}</Data></Cell>`;
            }
            return `<Cell><Data ss:Type="String">${esc(String(c))}</Data></Cell>`;
          })
          .join('')}</Row>`
    )
    .join('\n');

  const xml = `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Styles>
  <Style ss:ID="sHeader">
   <Font ss:Bold="1"/>
   <Interior ss:Color="#E2E8F0" ss:Pattern="Solid"/>
  </Style>
 </Styles>
 <Worksheet ss:Name="${esc(sheetName).slice(0, 31)}">
  <Table>
   <Row>${headerCells}</Row>
${bodyRows}
  </Table>
 </Worksheet>
</Workbook>`;

  return Buffer.from(xml, 'utf8');
}
