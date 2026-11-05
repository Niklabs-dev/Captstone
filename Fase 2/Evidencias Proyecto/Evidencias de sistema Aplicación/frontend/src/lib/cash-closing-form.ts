// Formulario de cierre de caja del supervisor (SPRINT-4-T11). Lógica pura:
// validación de campos, vista previa de la conciliación de vouchers y armado
// del cuerpo de POST /cash-closings (SPRINT-4-T09/T10). Montos en CLP enteros.
import {
  isAmount,
  isCalendarDate,
  isMethodCode,
  isRecord,
  isText,
  isTimestamp,
  isUuidValue,
} from './cash-closings';

// El backend actual exige lo contado para estos cuatro medios. Cuando
// SPRINT-4-T32 publique el catálogo administrable, esta lista se reemplaza por
// los medios activos más los que tengan ventas en el período.
export const CLOSING_METHODS = [
  'CASH',
  'DEBIT_CARD',
  'CREDIT_CARD',
  'TRANSFER',
] as const;
export type ClosingMethod = (typeof CLOSING_METHODS)[number];

export const MAX_CLOSING_AMOUNT = 9_999_999_999;
export const MAX_REASON_LENGTH = 500;
export const MAX_NOTES_LENGTH = 255;
const CHILE_TIME_ZONE = 'America/Santiago';

export interface ClosingFields {
  businessDate: string;
  shift: string;
  openingCash: string;
  counted: Record<ClosingMethod, string>;
  mrcomandaStart: string;
  mrcomandaEnd: string;
  mrcomandaDebit: string;
  mrcomandaCredit: string;
  mercadoPagoStart: string;
  mercadoPagoEnd: string;
  mercadoPagoDebit: string;
  mercadoPagoCredit: string;
  mercadoPagoTips: string;
  tipEntryIds: string[];
  differenceReason: string;
  notes: string;
}

// Las claves coinciden con el atributo name de cada control del formulario,
// para poder enfocar el primer campo inválido.
export type ClosingErrors = Partial<Record<string, string>>;

export interface ClosingVoucherInput {
  source: 'MRCOMANDA' | 'MERCADO_PAGO';
  periodStart: string;
  periodEnd: string;
  amount: number;
  tipIncludedAmount: number;
  reference: string;
}

export interface ClosingInput {
  businessDate: string;
  shift: number;
  openingCash: number;
  lines: { paymentMethod: string; countedAmount: number }[];
  vouchers: ClosingVoucherInput[];
  tipEntryIds: string[];
  differenceReason?: string;
  notes?: string;
}

export interface ClosingTipOption {
  id: string;
  paymentMethod: string;
  amount: number;
}

export interface VoucherPreview {
  mrcomandaNetSales: number;
  mercadoPagoGrossAmount: number;
  mercadoPagoTipAmount: number;
  mercadoPagoNetSales: number;
  reconciliationDifference: number;
}

export function emptyClosingFields(businessDate: string): ClosingFields {
  return {
    businessDate,
    shift: '1',
    openingCash: '',
    counted: { CASH: '', DEBIT_CARD: '', CREDIT_CARD: '', TRANSFER: '' },
    mrcomandaStart: '',
    mrcomandaEnd: '',
    mrcomandaDebit: '',
    mrcomandaCredit: '',
    mercadoPagoStart: '',
    mercadoPagoEnd: '',
    mercadoPagoDebit: '',
    mercadoPagoCredit: '',
    mercadoPagoTips: '',
    tipEntryIds: [],
    differenceReason: '',
    notes: '',
  };
}

export function parseClosingAmount(value: string): number | null {
  const text = value.trim();
  if (!/^\d+$/.test(text)) return null;
  const amount = Number(text);
  return Number.isSafeInteger(amount) && amount <= MAX_CLOSING_AMOUNT
    ? amount
    : null;
}

function parseShift(value: string): number | null {
  const text = value.trim();
  if (!/^\d+$/.test(text)) return null;
  const shift = Number(text);
  return shift >= 1 && shift <= 32767 ? shift : null;
}

function isClockTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function addDays(date: string, days: number): string {
  const value = new Date(date + 'T12:00:00Z');
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

// Desfase de Chile (en minutos) vigente en un instante; considera el horario
// de verano, por eso no se fija -03:00.
function chileOffsetMinutes(instant: number): number {
  const label =
    new Intl.DateTimeFormat('en-US', {
      timeZone: CHILE_TIME_ZONE,
      timeZoneName: 'longOffset',
    })
      .formatToParts(instant)
      .find((part) => part.type === 'timeZoneName')?.value ?? 'GMT';
  const match = /GMT([+-])(\d{2}):(\d{2})/.exec(label);
  if (!match) return 0;
  const minutes = Number(match[2]) * 60 + Number(match[3]);
  return match[1] === '-' ? -minutes : minutes;
}

// Convierte una fecha y hora de Chile en fecha-hora con zona explícita, como
// exige el backend. Devuelve null si la hora no existe (cambio de horario).
export function chileTimestamp(date: string, time: string): string | null {
  if (!isCalendarDate(date) || !isClockTime(time)) return null;
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const wallClock = Date.UTC(year, month - 1, day, hour, minute);
  let offset = chileOffsetMinutes(wallClock);
  const corrected = chileOffsetMinutes(wallClock - offset * 60_000);
  if (corrected !== offset) offset = corrected;
  const instant = wallClock - offset * 60_000;
  if (instant + chileOffsetMinutes(instant) * 60_000 !== wallClock) return null;
  const sign = offset < 0 ? '-' : '+';
  const absolute = Math.abs(offset);
  const hours = String(Math.floor(absolute / 60)).padStart(2, '0');
  const minutes = String(absolute % 60).padStart(2, '0');
  return `${date}T${time}:00${sign}${hours}:${minutes}`;
}

// Período de corte de un voucher dentro del día de negocio. Un fin 00:00
// representa la medianoche que cierra el día (fin exclusivo).
export function closingPeriod(
  date: string,
  start: string,
  end: string,
): { periodStart: string; periodEnd: string } | null {
  if (!isClockTime(start) || !isClockTime(end)) return null;
  const endsAtMidnight = end === '00:00';
  if (!endsAtMidnight && end <= start) return null;
  const periodStart = chileTimestamp(date, start);
  const periodEnd = chileTimestamp(
    endsAtMidnight ? addDays(date, 1) : date,
    end,
  );
  return periodStart && periodEnd ? { periodStart, periodEnd } : null;
}

function amountOrZero(value: string): number {
  return parseClosingAmount(value) ?? 0;
}

// Misma fórmula del backend (T09): venta neta Mercado Pago = bruto − PROPINAS;
// el descuadre se compara contra la venta neta de MrComanda. La propina se
// ingresa desde el voucher; nunca se deduce restando vouchers.
export function previewVouchers(fields: ClosingFields): VoucherPreview {
  const mrcomandaNetSales =
    amountOrZero(fields.mrcomandaDebit) + amountOrZero(fields.mrcomandaCredit);
  const mercadoPagoGrossAmount =
    amountOrZero(fields.mercadoPagoDebit) +
    amountOrZero(fields.mercadoPagoCredit);
  const mercadoPagoTipAmount = amountOrZero(fields.mercadoPagoTips);
  const mercadoPagoNetSales = mercadoPagoGrossAmount - mercadoPagoTipAmount;
  return {
    mrcomandaNetSales,
    mercadoPagoGrossAmount,
    mercadoPagoTipAmount,
    mercadoPagoNetSales,
    reconciliationDifference: mercadoPagoNetSales - mrcomandaNetSales,
  };
}

// Los cortes deben coincidir; solo se compara cuando ambos están completos.
export function periodsMismatch(fields: ClosingFields): boolean {
  const filled = [
    fields.mrcomandaStart,
    fields.mrcomandaEnd,
    fields.mercadoPagoStart,
    fields.mercadoPagoEnd,
  ].every(isClockTime);
  return (
    filled &&
    (fields.mrcomandaStart !== fields.mercadoPagoStart ||
      fields.mrcomandaEnd !== fields.mercadoPagoEnd)
  );
}

export function selectedTipTotal(
  options: readonly ClosingTipOption[],
  selected: readonly string[],
): number {
  return options
    .filter((option) => selected.includes(option.id))
    .reduce((total, option) => total + option.amount, 0);
}

function amountError(value: string, label: string): string | undefined {
  if (!value.trim()) return `Ingresa ${label}.`;
  return parseClosingAmount(value) === null
    ? 'Ingresa pesos completos entre 0 y 9.999.999.999, sin puntos, decimales ni negativos.'
    : undefined;
}

export function closingFieldErrors(
  fields: ClosingFields,
  tipOptions: readonly ClosingTipOption[],
): ClosingErrors {
  const errors: ClosingErrors = {};
  if (!isCalendarDate(fields.businessDate))
    errors.businessDate = 'Selecciona una fecha válida.';
  if (parseShift(fields.shift) === null)
    errors.shift = 'Ingresa un turno entero entre 1 y 32767.';
  const opening = amountError(fields.openingCash, 'el fondo inicial');
  if (opening) errors.openingCash = opening;
  for (const method of CLOSING_METHODS) {
    const error = amountError(fields.counted[method], 'el monto contado');
    if (error) errors['counted.' + method] = error;
  }
  for (const [name, label] of [
    ['mrcomandaDebit', 'T. DÉBITO de MrComanda'],
    ['mrcomandaCredit', 'T. CRÉDITO de MrComanda'],
    ['mercadoPagoDebit', 'DÉBITO de Mercado Pago'],
    ['mercadoPagoCredit', 'CRÉDITO de Mercado Pago'],
    ['mercadoPagoTips', 'PROPINAS de Mercado Pago'],
  ] as const) {
    const error = amountError(fields[name], label);
    if (error) errors[name] = error;
  }
  const date = isCalendarDate(fields.businessDate) ? fields.businessDate : '';
  for (const [start, end, source] of [
    ['mrcomandaStart', 'mrcomandaEnd', 'MrComanda'],
    ['mercadoPagoStart', 'mercadoPagoEnd', 'Mercado Pago'],
  ] as const) {
    if (!isClockTime(fields[start]))
      errors[start] = `Ingresa la hora de inicio del corte de ${source}.`;
    else if (!isClockTime(fields[end]))
      errors[end] = `Ingresa la hora de término del corte de ${source}.`;
    else if (date && !closingPeriod(date, fields[start], fields[end]))
      errors[end] =
        'El término debe ser posterior al inicio (usa 00:00 para la medianoche) y existir en el horario de Chile.';
  }
  if (
    !errors.mercadoPagoStart &&
    !errors.mercadoPagoEnd &&
    periodsMismatch(fields)
  )
    errors.mercadoPagoStart =
      'El corte de Mercado Pago debe coincidir con el de MrComanda. Revisa ambos comprobantes.';
  const preview = previewVouchers(fields);
  if (
    !errors.mercadoPagoTips &&
    preview.mercadoPagoTipAmount > preview.mercadoPagoGrossAmount
  )
    errors.mercadoPagoTips =
      'PROPINAS no puede superar el cobro bruto de Mercado Pago.';
  if (!errors.mercadoPagoTips) {
    const linked = selectedTipTotal(tipOptions, fields.tipEntryIds);
    if (linked !== preview.mercadoPagoTipAmount)
      errors.tipEntryIds =
        preview.mercadoPagoTipAmount > 0 && tipOptions.length === 0
          ? 'No hay propinas registradas para este día. Registra PROPINAS en Propinas diarias antes de cerrar.'
          : 'Los registros de propinas seleccionados deben sumar exactamente PROPINAS de Mercado Pago.';
  }
  const reason = fields.differenceReason.trim();
  if (reason.length > MAX_REASON_LENGTH)
    errors.differenceReason = `El motivo no puede superar ${MAX_REASON_LENGTH} caracteres.`;
  else if (preview.reconciliationDifference !== 0 && !reason)
    errors.differenceReason =
      'Explica el motivo: hay un descuadre entre MrComanda y Mercado Pago.';
  if (fields.notes.trim().length > MAX_NOTES_LENGTH)
    errors.notes = `Las observaciones no pueden superar ${MAX_NOTES_LENGTH} caracteres.`;
  return errors;
}

// Arma el cuerpo de POST /cash-closings. MrComanda se envía como dos vouchers
// netos (T. DÉBITO y T. CRÉDITO); Mercado Pago como su resumen bruto con la
// propina oficial, sin inventar un desglose de propina por tipo de tarjeta.
export function buildClosingInput(fields: ClosingFields): ClosingInput | null {
  const shift = parseShift(fields.shift);
  const openingCash = parseClosingAmount(fields.openingCash);
  const mrcomanda = closingPeriod(
    fields.businessDate,
    fields.mrcomandaStart,
    fields.mrcomandaEnd,
  );
  const mercadoPago = closingPeriod(
    fields.businessDate,
    fields.mercadoPagoStart,
    fields.mercadoPagoEnd,
  );
  const amounts = [
    fields.mrcomandaDebit,
    fields.mrcomandaCredit,
    fields.mercadoPagoDebit,
    fields.mercadoPagoCredit,
    fields.mercadoPagoTips,
  ].map(parseClosingAmount);
  const counted = CLOSING_METHODS.map((method) =>
    parseClosingAmount(fields.counted[method]),
  );
  if (
    !isCalendarDate(fields.businessDate) ||
    shift === null ||
    openingCash === null ||
    !mrcomanda ||
    !mercadoPago ||
    amounts.some((amount) => amount === null) ||
    counted.some((amount) => amount === null)
  )
    return null;
  const [mrDebit, mrCredit, mpDebit, mpCredit, mpTips] = amounts as number[];
  const reason = fields.differenceReason.trim();
  const notes = fields.notes.trim();
  return {
    businessDate: fields.businessDate,
    shift,
    openingCash,
    lines: CLOSING_METHODS.map((paymentMethod, index) => ({
      paymentMethod,
      countedAmount: counted[index] as number,
    })),
    vouchers: [
      {
        source: 'MRCOMANDA',
        ...mrcomanda,
        amount: mrDebit,
        tipIncludedAmount: 0,
        reference: 'T. DÉBITO',
      },
      {
        source: 'MRCOMANDA',
        ...mrcomanda,
        amount: mrCredit,
        tipIncludedAmount: 0,
        reference: 'T. CRÉDITO',
      },
      {
        source: 'MERCADO_PAGO',
        ...mercadoPago,
        amount: mpDebit + mpCredit,
        tipIncludedAmount: mpTips,
        reference: 'RESUMEN DE VENTAS',
      },
    ],
    tipEntryIds: [...fields.tipEntryIds],
    ...(reason ? { differenceReason: reason } : {}),
    ...(notes ? { notes } : {}),
  };
}

const INPUT_KEYS = [
  'businessDate',
  'shift',
  'openingCash',
  'lines',
  'vouchers',
  'tipEntryIds',
  'differenceReason',
  'notes',
];
const VOUCHER_KEYS = [
  'source',
  'periodStart',
  'periodEnd',
  'amount',
  'tipIncludedAmount',
  'reference',
];

function isClosingAmount(value: unknown): value is number {
  return isAmount(value) && value <= MAX_CLOSING_AMOUNT;
}

// Validación estricta en la ruta del servidor: solo se reenvía al backend un
// cuerpo con la forma exacta del formulario. El local lo pone el servidor.
export function parseClosingInput(value: unknown): ClosingInput | null {
  if (
    !isRecord(value) ||
    Object.keys(value).some((key) => !INPUT_KEYS.includes(key)) ||
    !isCalendarDate(value.businessDate) ||
    !isAmount(value.shift) ||
    value.shift < 1 ||
    value.shift > 32767 ||
    !isClosingAmount(value.openingCash) ||
    !Array.isArray(value.lines) ||
    value.lines.length === 0 ||
    value.lines.length > 20 ||
    !Array.isArray(value.vouchers) ||
    value.vouchers.length === 0 ||
    value.vouchers.length > 10 ||
    !Array.isArray(value.tipEntryIds) ||
    value.tipEntryIds.length > 50 ||
    !value.tipEntryIds.every(isUuidValue) ||
    new Set(value.tipEntryIds).size !== value.tipEntryIds.length ||
    (value.differenceReason !== undefined &&
      !isText(value.differenceReason, MAX_REASON_LENGTH)) ||
    (value.notes !== undefined && !isText(value.notes, MAX_NOTES_LENGTH))
  )
    return null;
  const lines: ClosingInput['lines'] = [];
  for (const line of value.lines) {
    if (
      !isRecord(line) ||
      Object.keys(line).length !== 2 ||
      !isMethodCode(line.paymentMethod) ||
      !isClosingAmount(line.countedAmount) ||
      lines.some((previous) => previous.paymentMethod === line.paymentMethod)
    )
      return null;
    lines.push({
      paymentMethod: line.paymentMethod,
      countedAmount: line.countedAmount,
    });
  }
  const vouchers: ClosingVoucherInput[] = [];
  for (const voucher of value.vouchers) {
    if (
      !isRecord(voucher) ||
      Object.keys(voucher).some((key) => !VOUCHER_KEYS.includes(key)) ||
      (voucher.source !== 'MRCOMANDA' && voucher.source !== 'MERCADO_PAGO') ||
      !isTimestamp(voucher.periodStart) ||
      !isTimestamp(voucher.periodEnd) ||
      !isClosingAmount(voucher.amount) ||
      !isClosingAmount(voucher.tipIncludedAmount) ||
      !isText(voucher.reference, 100)
    )
      return null;
    vouchers.push({
      source: voucher.source,
      periodStart: voucher.periodStart,
      periodEnd: voucher.periodEnd,
      amount: voucher.amount,
      tipIncludedAmount: voucher.tipIncludedAmount,
      reference: voucher.reference,
    });
  }
  return {
    businessDate: value.businessDate,
    shift: value.shift,
    openingCash: value.openingCash,
    lines,
    vouchers,
    tipEntryIds: [...value.tipEntryIds],
    ...(typeof value.differenceReason === 'string'
      ? { differenceReason: value.differenceReason.trim() }
      : {}),
    ...(typeof value.notes === 'string' ? { notes: value.notes.trim() } : {}),
  };
}

// Mensajes de validación del backend (T09/T10) que se pueden mostrar tal cual
// al supervisor; cualquier otro 400 se reemplaza por un mensaje genérico.
const PUBLIC_BACKEND_MESSAGES: Record<string, string> = {
  'differenceReason es obligatorio cuando existe una diferencia':
    'REASON_REQUIRED',
  'MrComanda y Mercado Pago deben tener el mismo período de corte':
    'PERIOD_MISMATCH',
  'El período de los vouchers debe pertenecer al día de negocio en Chile':
    'PERIOD_OUTSIDE_DAY',
  'Los registros vinculados deben sumar exactamente PROPINAS de Mercado Pago':
    'TIP_FUND_MISMATCH',
  'Las propinas vinculadas deben ser del mismo local y día del cierre':
    'TIP_ENTRIES_INVALID',
  'Uno o más registros de propinas no existen': 'TIP_ENTRIES_INVALID',
  'El local indicado no existe o está inactivo': 'STORE_INACTIVE',
};

export const CLOSING_ERROR_MESSAGES: Record<string, string> = {
  REASON_REQUIRED:
    'El cierre tiene diferencias entre lo esperado y lo contado. Explica el motivo para poder confirmarlo.',
  PERIOD_MISMATCH:
    'Los cortes de MrComanda y Mercado Pago no coinciden. Revisa las horas de ambos comprobantes.',
  PERIOD_OUTSIDE_DAY:
    'El corte de los vouchers debe pertenecer al día de negocio seleccionado.',
  TIP_FUND_MISMATCH:
    'Las propinas vinculadas no suman PROPINAS de Mercado Pago. Revisa la selección o el registro diario.',
  TIP_ENTRIES_INVALID:
    'Los registros de propinas seleccionados ya no están disponibles. Actualiza la lista.',
  STORE_INACTIVE:
    'Tu local está inactivo. Consulta con el administrador para registrar cierres.',
  CLOSING_EXISTS:
    'Ya existe un cierre distinto para este local, fecha y turno. Puedes consultar el cierre existente; no se modificó.',
  SALES_ALREADY_CLOSED:
    'Una o más ventas del período ya pertenecen a otro cierre. Revisa el turno y el corte.',
};

export function publicClosingErrorCode(message: unknown): string | null {
  return typeof message === 'string'
    ? (PUBLIC_BACKEND_MESSAGES[message] ?? null)
    : null;
}

export function closingErrorMessage(status: number, code?: string): string {
  if (code && CLOSING_ERROR_MESSAGES[code]) return CLOSING_ERROR_MESSAGES[code];
  const messages: Record<number, string> = {
    400: 'Los datos del cierre no son válidos. Revisa el formulario.',
    401: 'Tu sesión venció. Vuelve a iniciar sesión.',
    403: 'Solo el supervisor del local puede registrar su cierre de caja.',
    404: 'El local indicado no existe.',
    409: CLOSING_ERROR_MESSAGES.CLOSING_EXISTS,
    429: 'Demasiadas solicitudes. Espera unos momentos e intenta nuevamente.',
    502: 'No se pudo verificar la respuesta del servicio. Revisa el cierre antes de reintentar.',
    503: 'No se pudo conectar con el servicio. Intenta nuevamente más tarde.',
  };
  return messages[status] ?? messages[502];
}
