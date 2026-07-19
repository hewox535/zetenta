// Renderiza el comprobante de retención como PDF (formato oficial, legal
// horizontal) con pdf-lib. Réplica del layout de WithholdingPrint.jsx.

import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from 'npm:pdf-lib@1.17.1';

// Anchos de columna del formato oficial (% del ancho útil), como en el frontend
const WIDTHS = [5.77, 6.64, 5.85, 6.25, 6.32, 5.22, 6.32, 6.32, 8.06, 6.32, 10.35, 4.66, 7.43, 6.4, 8.06];

const PAGE_W = 1008; // legal horizontal: 14 x 8.5 pulgadas en puntos
const PAGE_H = 612;
const MX = 62; // ~22mm
const MY = 45; // ~16mm
const CONTENT_W = PAGE_W - 2 * MX;

const BLACK = rgb(0, 0, 0);
const GRAY = rgb(0.847, 0.847, 0.847);
const BLUE = rgb(0.584, 0.702, 0.843);

const fmt = new Intl.NumberFormat('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = (n: number) => fmt.format(Number(n) || 0);
const ddmmyyyy = (iso: string) => {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
};

export interface WithholdingLine {
  operation_date: string;
  invoice_number: string;
  control_number: string;
  debit_note: string;
  credit_note: string;
  transaction_type: string;
  affected_document: string;
  total_with_vat: number;
  exempt_amount: number;
  vat_rate: number;
  retention_rate: number;
}

export interface PdfData {
  business: { name: string; rif: string; fiscal_address: string };
  number: string;
  issue_date: string;
  fiscal_period: string;
  supplier_name: string;
  supplier_rif: string;
  lines: WithholdingLine[];
}

interface CellOpts {
  text?: string;
  size?: number;
  bold?: boolean;
  align?: 'left' | 'center' | 'right';
  fill?: ReturnType<typeof rgb>;
  border?: boolean;
  borderWidth?: number;
}

export async function renderWithholdingPdf(d: PdfData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([PAGE_W, PAGE_H]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  let yTop = MY; // cursor medido desde el borde superior

  const colX = (i: number) => MX + (WIDTHS.slice(0, i).reduce((a, b) => a + b, 0) / 100) * CONTENT_W;
  const colW = (i: number, span: number) =>
    (WIDTHS.slice(i, i + span).reduce((a, b) => a + b, 0) / 100) * CONTENT_W;

  function drawCell(page: PDFPage, x: number, w: number, h: number, o: CellOpts) {
    const y = PAGE_H - yTop - h;
    if (o.fill) page.drawRectangle({ x, y, width: w, height: h, color: o.fill });
    if (o.border) {
      page.drawRectangle({
        x, y, width: w, height: h,
        borderColor: BLACK, borderWidth: o.borderWidth ?? 0.6,
      });
    }
    if (o.text) {
      const f: PDFFont = o.bold ? bold : font;
      const size = o.size ?? 7;
      let text = o.text;
      // recorta si no cabe (comportamiento del formato: overflow hidden)
      const maxW = w - 5;
      while (text.length > 1 && f.widthOfTextAtSize(text, size) > maxW) text = text.slice(0, -1);
      const tw = f.widthOfTextAtSize(text, size);
      const tx = o.align === 'center' ? x + (w - tw) / 2 : o.align === 'right' ? x + w - tw - 2.5 : x + 2.5;
      page.drawText(text, { x: tx, y: y + (h - size * 0.72) / 2, size, font: f, color: BLACK });
    }
  }

  // celda alineada a la grilla de 15 columnas
  const cell = (ci: number, span: number, h: number, o: CellOpts) =>
    drawCell(page, colX(ci), colW(ci, span), h, o);

  // ---- Fila 1: nombre de la empresa sobre fondo azul ----
  cell(0, 5, 20, { text: d.business.name, size: 12, bold: true, fill: BLUE });
  yTop += 20 + 6;

  // ---- Texto legal + Nro. de comprobante + fecha ----
  const legal = [
    'LEY DE IVA ART.11 "SERAN RESPONSABLES DEL PAGO DEL IMPUESTO EN CALIDAD',
    'DE AGENTES DE RETENCION, LOS COMPRADORES O ADQUIRIENTES DE DETERMINADOS',
    'BIENES MUEBLES E INMUEBLES Y LOS RECEPTORES DE CIERTOS SERVICIOS A QUIENES',
    'LA ADMINISTRACION TRIBUTARIA DESIGNE COMO TAL"',
  ];
  const legalTop = yTop;
  legal.forEach((line, i) => {
    page.drawText(line, {
      x: colX(0), y: PAGE_H - (legalTop + 6 + i * 8.6), size: 5.6, font, color: BLACK,
    });
  });
  cell(6, 4, 11, { text: 'Nro. DE COMPROBANTE', size: 5.6, bold: true, align: 'center', border: true });
  cell(11, 2, 11, { text: '1. FECHA', size: 7, bold: true, align: 'center', border: true });
  yTop += 11;
  cell(6, 4, 15, { text: d.number, size: 9, bold: true, align: 'center', fill: GRAY, border: true });
  cell(11, 2, 15, { text: ddmmyyyy(d.issue_date), size: 7, align: 'center', fill: GRAY, border: true });
  yTop += 15 + 16;

  // ---- Agente de retención, RIF y período fiscal ----
  cell(0, 5, 12, { text: '2. NOMBRE O RAZON SOCIAL DEL AGENTE DE RETENCION', size: 6.4, bold: true, border: true });
  cell(6, 5, 12, { text: '3. REGISTRO DE INFORMACION FISCAL AGENTE DE RETENCION', size: 6.4, bold: true, align: 'center', border: true });
  cell(12, 2, 12, { text: '4. PERIODO FISCAL', size: 6.4, bold: true, align: 'center', border: true });
  yTop += 12;
  const period = d.fiscal_period || '';
  cell(0, 5, 14, { text: d.business.name, size: 7, fill: GRAY, border: true });
  cell(6, 5, 14, { text: d.business.rif, size: 7, bold: true, fill: GRAY, border: true });
  cell(12, 2, 14, { text: `AÑO ${period.slice(0, 4)}/${period.slice(4)}`, size: 7, align: 'center', fill: GRAY, border: true });
  yTop += 14 + 9;

  // ---- Dirección fiscal ----
  cell(0, 11, 12, { text: '5. DIRECCION FISCAL DEL AGENTE DE RETENCION', size: 6.4, bold: true, border: true });
  yTop += 12;
  cell(0, 11, 14, { text: d.business.fiscal_address, size: 7, fill: GRAY, border: true });
  yTop += 14 + 9;

  // ---- Sujeto retenido ----
  cell(0, 6, 12, { text: '6. NOMBRE O RAZON SOCIAL DEL SUJETO RETENIDO', size: 6.4, bold: true, border: true });
  cell(7, 6, 12, { text: '7. REGISTRO DE INFORMACION FISCAL DEL SUJETO RETENIDO', size: 6.4, bold: true, align: 'center', border: true });
  yTop += 12;
  cell(0, 6, 14, { text: d.supplier_name, size: 7, bold: true, fill: GRAY, border: true });
  cell(7, 6, 14, { text: d.supplier_rif, size: 7, bold: true, fill: GRAY, border: true });
  yTop += 14 + 13;

  // ---- Cabecera de la tabla de operaciones ----
  const HEADERS = [
    'OPER.', 'FECHA', 'Nº DE FACTURA', 'Nº DE CONTROL', 'Nº NOTA DEBITO', 'Nº NOTA CREDITO',
    'TIPO DE TRANS.', 'Nº DOC AFECTADO', 'TOTAL COMPRA CON IVA', 'EXENTO', 'BASE IMPONIBLE',
    '% ALICUOTA', 'IMPUESTO I.V.A', '% DE RETENCION', 'I.V.A RETENIDO',
  ];
  const headH = 26;
  HEADERS.forEach((h, i) => {
    cell(i, 1, headH, { border: true, borderWidth: i === 0 || i === HEADERS.length - 1 ? 1.2 : 0.6 });
    // texto envuelto en varias líneas, centrado
    const w = colW(i, 1) - 4;
    const words = h.split(' ');
    const rows: string[] = [];
    let cur = '';
    for (const word of words) {
      const probe = cur ? `${cur} ${word}` : word;
      if (bold.widthOfTextAtSize(probe, 5.6) <= w) cur = probe;
      else { if (cur) rows.push(cur); cur = word; }
    }
    if (cur) rows.push(cur);
    const startY = PAGE_H - yTop - (headH - rows.length * 6.4) / 2 - 5.4;
    rows.forEach((r, ri) => {
      const tw = bold.widthOfTextAtSize(r, 5.6);
      page.drawText(r, { x: colX(i) + (colW(i, 1) - tw) / 2, y: startY - ri * 6.4, size: 5.6, font: bold, color: BLACK });
    });
  });
  // línea gruesa superior de la cabecera
  page.drawLine({
    start: { x: colX(0), y: PAGE_H - yTop }, end: { x: colX(14) + colW(14, 1), y: PAGE_H - yTop },
    thickness: 1.2, color: BLACK,
  });
  yTop += headH;

  // ---- Filas de operaciones (siempre 5, como el formato oficial) ----
  let totalPurchase = 0;
  let totalWithheld = 0;
  const rowH = 13;
  for (let r = 0; r < 5; r++) {
    const l = d.lines[r] ?? null;
    let values: string[] = Array(15).fill('');
    if (l) {
      const total = Number(l.total_with_vat) || 0;
      const exempt = Number(l.exempt_amount) || 0;
      const vatRate = Number(l.vat_rate) || 0;
      const retRate = Number(l.retention_rate) || 0;
      const base = (total - exempt) / (1 + vatRate / 100);
      const vat = base * (vatRate / 100);
      const withheld = vat * (retRate / 100);
      totalPurchase += total;
      totalWithheld += withheld;
      values = [
        String(r + 1), ddmmyyyy(l.operation_date), l.invoice_number, l.control_number,
        l.debit_note, l.credit_note, l.transaction_type, l.affected_document,
        money(total), exempt ? money(exempt) : '', money(base), money(vatRate),
        money(vat), `${retRate}%`, money(withheld),
      ];
    }
    const RIGHT = new Set([0, 2, 8, 9, 10, 11, 12, 13, 14]);
    values.forEach((v, i) => {
      cell(i, 1, rowH, {
        text: v, size: 6.4, border: true,
        borderWidth: i === 0 || i === 14 ? 1.2 : 0.6,
        align: RIGHT.has(i) ? 'right' : i === 6 ? 'center' : 'left',
      });
    });
    yTop += rowH;
  }

  // ---- Totales ----
  cell(8, 1, rowH, { text: money(totalPurchase), size: 6.4, align: 'right', border: true });
  cell(9, 1, rowH, { border: true });
  cell(10, 4, rowH, { text: 'TOTAL IVA RETENIDO', size: 7, bold: true, align: 'center', border: true, borderWidth: 1.2 });
  cell(14, 1, rowH, { text: money(totalWithheld), size: 6.4, align: 'right', border: true, borderWidth: 1.2 });
  yTop += rowH + 8;

  cell(10, 4, rowH, { text: 'TOTAL A PAGAR. . . .', size: 7, bold: true, border: true, borderWidth: 1.2 });
  cell(14, 1, rowH, { text: money(totalPurchase - totalWithheld), size: 6.4, bold: true, align: 'right', border: true, borderWidth: 1.2 });
  yTop += rowH + 42;

  // ---- Firmas ----
  cell(2, 6, 12, { text: 'POR LA EMPRESA', size: 8.5, bold: true });
  cell(8, 7, 12, { text: 'RECIBE:', size: 8.5, bold: true });
  yTop += 12 + 22;
  cell(2, 6, 12, { text: d.business.name, size: 8.5, bold: true });
  cell(8, 7, 12, { text: 'FECHA DE RECEPCION', size: 8.5, bold: true });

  return await doc.save();
}
