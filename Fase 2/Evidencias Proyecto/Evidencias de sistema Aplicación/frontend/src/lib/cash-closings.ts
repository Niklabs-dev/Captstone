// Contrato de GET /cash-closings/:id (SPRINT-4-T09/T10), documentado en Swagger
// (/api/docs). Todos los montos son CLP enteros.
//
// Los códigos de medio de pago se aceptan como texto (no una lista fija) para
// que el detalle siga funcionando cuando SPRINT-4-T32 reemplace el enum por un
// catálogo administrable.

export type CashClosingStatus = 'OPEN' | 'CLOSED';
export type VoucherSource = 'MRCOMANDA' | 'MERCADO_PAGO';

export interface CashClosingLine {
  id: string;
  paymentMethod: string;
  expectedAmount: number;
  countedAmount: number;
  difference: number;
}
export interface CashClosingVoucher {
  id: string;
  source: VoucherSource;
  periodStart: string;
  periodEnd: string;
  amount: number;
  tipIncludedAmount: number;
  reference: string | null;
}
export interface CashClosingPerson {
  id: string;
  name: string;
}
export interface CashClosing {
  id: string;
  store: { id: string; name: string };
  businessDate: string;
  shift: number;
  openingCash: number;
  status: CashClosingStatus;
  differenceReason: string | null;
  responsible: CashClosingPerson;
  closedAt: string | null;
  lines: CashClosingLine[];
  totalExpectedAmount: number;
  totalCountedAmount: number;
  totalDifference: number;
  vouchers: CashClosingVoucher[];
  mrcomandaNetSales: number;
  mercadoPagoGrossAmount: number;
  mercadoPagoTipAmount: number;
  mercadoPagoNetSales: number;
  reconciliationDifference: number;
  tipFundAmount: number;
  salesCount: number;
}

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  CASH: 'Efectivo',
  DEBIT_CARD: 'Tarjeta de débito',
  CREDIT_CARD: 'Tarjeta de crédito',
  TRANSFER: 'Transferencia',
};

// Nombre visible del medio; un código desconocido (catálogo de T32) se muestra
// tal cual en vez de ocultarse.
export function paymentMethodLabel(code: string): string {
  return PAYMENT_METHOD_LABELS[code] ?? code;
}

export function voucherSourceLabel(source: VoucherSource): string {
  return source === 'MRCOMANDA' ? 'MrComanda' : 'Mercado Pago';
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function isUuidValue(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}
export function isText(value: unknown, limit = 200): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <= limit &&
    !/[\u0000-\u001f]/.test(value)
  );
}
export function isTimestamp(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(
      value,
    ) &&
    Number.isFinite(Date.parse(value))
  );
}
export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const date = new Date(value + 'T12:00:00Z');
  return (
    Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value
  );
}
// Montos enteros en CLP; las diferencias pueden ser negativas.
export function isAmount(
  value: unknown,
  allowNegative = false,
): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    (allowNegative || value >= 0)
  );
}
export function isMethodCode(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Z][A-Z0-9_]{0,39}$/.test(value);
}
function nullableText(value: unknown, limit: number): value is string | null {
  return value === null || isText(value, limit);
}

export function parseCashClosing(value: unknown): CashClosing | null {
  if (
    !isRecord(value) ||
    !isUuidValue(value.id) ||
    !isRecord(value.store) ||
    !isUuidValue(value.store.id) ||
    !isText(value.store.name) ||
    !isCalendarDate(value.businessDate) ||
    !isAmount(value.shift) ||
    value.shift < 1 ||
    !isAmount(value.openingCash) ||
    (value.status !== 'OPEN' && value.status !== 'CLOSED') ||
    !nullableText(value.differenceReason, 500) ||
    !isRecord(value.responsible) ||
    !isUuidValue(value.responsible.id) ||
    !isText(value.responsible.name) ||
    !(value.closedAt === null || isTimestamp(value.closedAt)) ||
    !Array.isArray(value.lines) ||
    !Array.isArray(value.vouchers) ||
    !isAmount(value.totalExpectedAmount) ||
    !isAmount(value.totalCountedAmount) ||
    !isAmount(value.totalDifference, true) ||
    !isAmount(value.mrcomandaNetSales) ||
    !isAmount(value.mercadoPagoGrossAmount) ||
    !isAmount(value.mercadoPagoTipAmount) ||
    !isAmount(value.mercadoPagoNetSales, true) ||
    !isAmount(value.reconciliationDifference, true) ||
    !isAmount(value.tipFundAmount) ||
    !isAmount(value.salesCount)
  )
    return null;

  const lines: CashClosingLine[] = [];
  for (const line of value.lines) {
    if (
      !isRecord(line) ||
      !isUuidValue(line.id) ||
      !isMethodCode(line.paymentMethod) ||
      !isAmount(line.expectedAmount) ||
      !isAmount(line.countedAmount) ||
      !isAmount(line.difference, true) ||
      line.difference !== line.countedAmount - line.expectedAmount ||
      lines.some((previous) => previous.paymentMethod === line.paymentMethod)
    )
      return null;
    lines.push({
      id: line.id,
      paymentMethod: line.paymentMethod,
      expectedAmount: line.expectedAmount,
      countedAmount: line.countedAmount,
      difference: line.difference,
    });
  }
  const vouchers: CashClosingVoucher[] = [];
  for (const voucher of value.vouchers) {
    if (
      !isRecord(voucher) ||
      !isUuidValue(voucher.id) ||
      (voucher.source !== 'MRCOMANDA' && voucher.source !== 'MERCADO_PAGO') ||
      !isTimestamp(voucher.periodStart) ||
      !isTimestamp(voucher.periodEnd) ||
      !isAmount(voucher.amount) ||
      !isAmount(voucher.tipIncludedAmount) ||
      !nullableText(voucher.reference, 100)
    )
      return null;
    vouchers.push({
      id: voucher.id,
      source: voucher.source,
      periodStart: voucher.periodStart,
      periodEnd: voucher.periodEnd,
      amount: voucher.amount,
      tipIncludedAmount: voucher.tipIncludedAmount,
      reference: voucher.reference,
    });
  }
  return {
    id: value.id,
    store: { id: value.store.id, name: value.store.name },
    businessDate: value.businessDate,
    shift: value.shift,
    openingCash: value.openingCash,
    status: value.status,
    differenceReason: value.differenceReason,
    responsible: { id: value.responsible.id, name: value.responsible.name },
    closedAt: value.closedAt,
    lines,
    totalExpectedAmount: value.totalExpectedAmount,
    totalCountedAmount: value.totalCountedAmount,
    totalDifference: value.totalDifference,
    vouchers,
    mrcomandaNetSales: value.mrcomandaNetSales,
    mercadoPagoGrossAmount: value.mercadoPagoGrossAmount,
    mercadoPagoTipAmount: value.mercadoPagoTipAmount,
    mercadoPagoNetSales: value.mercadoPagoNetSales,
    reconciliationDifference: value.reconciliationDifference,
    tipFundAmount: value.tipFundAmount,
    salesCount: value.salesCount,
  };
}

// Regla de cuadre (misma de T09/T13): cualquier línea descuadrada, aunque otra
// la compense, o un descuadre de vouchers deja el cierre «No cuadrado».
export function isClosingBalanced(
  closing: Pick<CashClosing, 'lines' | 'reconciliationDifference'>,
): boolean {
  return (
    closing.lines.every((line) => line.difference === 0) &&
    closing.reconciliationDifference === 0
  );
}

// Líneas que se anulan entre sí: el total es 0 pero hay líneas descuadradas.
export function hasCompensatedLines(
  closing: Pick<CashClosing, 'lines'>,
): boolean {
  return (
    closing.lines.some((line) => line.difference !== 0) &&
    closing.lines.reduce((total, line) => total + line.difference, 0) === 0
  );
}

export function formatClpAmount(amount: number): string {
  return new Intl.NumberFormat('es-CL', {
    style: 'currency',
    currency: 'CLP',
    maximumFractionDigits: 0,
  }).format(amount);
}

// Diferencia con signo explícito: +$500 sobrante, −$500 faltante.
export function formatSignedClp(amount: number): string {
  if (amount === 0) return formatClpAmount(0);
  return (amount > 0 ? '+' : '−') + formatClpAmount(Math.abs(amount));
}

export function formatChileDateTime(value: string): string {
  return new Intl.DateTimeFormat('es-CL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Santiago',
  }).format(new Date(value));
}
