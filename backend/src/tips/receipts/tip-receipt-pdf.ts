import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'pdf-lib';
import { BUSINESS_TIME_ZONE } from '../../audit/utils/business-day.util.js';
import type { TipPoolReceiptResponse } from '../types/tip-pools.types.js';

// Constancia de pago de propinas en PDF (SPRINT-3-T13). Se genera al vuelo a
// partir de la foto guardada en tip_pool_receipts: nunca recalcula. Funciones
// puras, sin NestJS ni base de datos, para testearlas directamente.

const PAGE_WIDTH = 595.28; // A4 en puntos.
const PAGE_HEIGHT = 841.89;
const MARGIN = 56;
const LABEL_WIDTH = 150;
const SHORT_ID_LENGTH = 8;

// Monto en CLP con separador de miles (ej. 15000 → "$15.000").
export function formatClp(amount: number): string {
  const sign = amount < 0 ? '-' : '';
  const digits = Math.abs(Math.round(amount))
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${sign}$${digits}`;
}

// YYYY-MM-DD → DD-MM-YYYY, el formato habitual en Chile.
export function formatChileanDate(value: string): string {
  const [year, month, day] = value.split('-');
  return `${day}-${month}-${year}`;
}

// Nombre sin datos personales: constancia-propinas_<inicio>_<fin>_<id corto>.pdf.
export function buildReceiptFileName(
  receipt: Pick<TipPoolReceiptResponse, 'id' | 'periodStart' | 'periodEnd'>,
): string {
  const shortId = receipt.id.replace(/-/g, '').slice(0, SHORT_ID_LENGTH);
  return `constancia-propinas_${receipt.periodStart}_${receipt.periodEnd}_${shortId}.pdf`;
}

// Las fuentes estándar del PDF usan WinAnsi: conserva tildes y ñ y reemplaza
// los caracteres que no puede dibujar.
function toWinAnsi(text: string): string {
  return Array.from(text.normalize('NFC'))
    .map((char) => (/^[\x20-\x7e\xa0-\xff]$/.test(char) ? char : '?'))
    .join('');
}

function formatIssuedAt(instant: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${get('day')}-${get('month')}-${get('year')} ${get('hour')}:${get('minute')} (hora de Chile)`;
}

function formatHours(hours: string): string {
  return hours.replace('.', ',');
}

// Filas etiqueta/valor de la constancia, en orden.
export function receiptRows(
  receipt: TipPoolReceiptResponse,
  issuedAt: Date,
): [string, string][] {
  const agreement = receipt.detail.agreementSnapshot;
  return [
    ['Local', receipt.store.name],
    [
      'Período',
      `${formatChileanDate(receipt.periodStart)} al ${formatChileanDate(receipt.periodEnd)}`,
    ],
    ['Trabajador', receipt.workerName],
    ['Horas trabajadas', formatHours(receipt.hoursWorked)],
    ['Monto pagado', formatClp(receipt.amount)],
    ['Fecha de pago', formatChileanDate(receipt.paymentDate)],
    ['Responsable del pago', receipt.paidBy.name],
    [
      'Pacto aplicado',
      agreement
        ? `${agreement.name} (${agreement.rule})`
        : 'Sin copia del pacto',
    ],
    ['Total del reparto', formatClp(receipt.detail.totalAmount)],
    ['Horas del reparto', formatHours(receipt.detail.totalHours)],
    ['ID de la constancia', receipt.id],
    ['Fecha de emisión', formatIssuedAt(issuedAt)],
  ];
}

// Corta un texto en líneas que caben en el ancho indicado.
function wrap(
  text: string,
  font: PDFFont,
  size: number,
  width: number,
): string[] {
  const lines: string[] = [];
  let current = '';
  for (const word of text.split(' ')) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && font.widthOfTextAtSize(candidate, size) > width) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

export async function renderTipReceiptPdf(
  receipt: TipPoolReceiptResponse,
  issuedAt: Date,
): Promise<Uint8Array> {
  // Determinista: con updateMetadata (por defecto) pdf-lib fija Producer,
  // CreationDate y ModDate con la hora actual. Todo sale de la constancia
  // guardada, así que cada descarga entrega el mismo archivo byte a byte
  // (pdf-lib no escribe /ID en el trailer).
  const pdf = await PDFDocument.create({ updateMetadata: false });
  pdf.setTitle('Constancia de pago de propinas');
  pdf.setCreator('Moi-food');
  pdf.setProducer('Moi-food');
  pdf.setCreationDate(issuedAt);
  pdf.setModificationDate(issuedAt);
  const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const valueWidth = PAGE_WIDTH - 2 * MARGIN - LABEL_WIDTH;

  let y = PAGE_HEIGHT - MARGIN;
  page.drawText(toWinAnsi('Constancia de pago de propinas'), {
    x: MARGIN,
    y,
    size: 18,
    font: bold,
  });
  y -= 22;
  page.drawText(toWinAnsi('Moi-food · Subway'), {
    x: MARGIN,
    y,
    size: 10,
    font: regular,
    color: rgb(0.35, 0.35, 0.35),
  });
  y -= 30;

  for (const [label, value] of receiptRows(receipt, issuedAt)) {
    page.drawText(toWinAnsi(label), { x: MARGIN, y, size: 11, font: bold });
    for (const line of wrap(toWinAnsi(value), regular, 11, valueWidth)) {
      page.drawText(line, {
        x: MARGIN + LABEL_WIDTH,
        y,
        size: 11,
        font: regular,
      });
      y -= 16;
    }
    y -= 4;
  }

  y -= 16;
  const footer =
    'Constancia emitida a partir del reparto guardado al momento del pago; sus montos no se recalculan.';
  for (const line of wrap(
    toWinAnsi(footer),
    regular,
    9,
    PAGE_WIDTH - 2 * MARGIN,
  )) {
    page.drawText(line, {
      x: MARGIN,
      y,
      size: 9,
      font: regular,
      color: rgb(0.35, 0.35, 0.35),
    });
    y -= 12;
  }

  return pdf.save();
}
