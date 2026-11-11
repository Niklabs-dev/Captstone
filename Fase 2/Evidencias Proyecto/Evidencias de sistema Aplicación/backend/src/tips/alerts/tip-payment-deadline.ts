import {
  parseCalendarDate,
  type CalendarDate,
} from '../../audit/utils/business-day.util.js';
import {
  addDays,
  daysBetween,
  formatDbDate,
  toDbDate,
} from '../../documents/utils/document-dates.util.js';
import type {
  TipPaymentAlert,
  TipPaymentAlertSummary,
} from '../types/tip-payment-alerts.types.js';

// Plazo legal de pago de las propinas diarias (SPRINT-3-T14, configurable
// desde SPRINT-4A-T22). Funciones puras, sin NestJS ni base de datos.
//
// El plazo se cuenta en días hábiles (lunes a viernes, sin los feriados de
// TIP_ALERT_HOLIDAYS) desde el día siguiente a la fecha de negocio de la
// propina. Por defecto son 7: el «séptimo día hábil» que fijó la alerta legal
// original de SPRINT-3-T14. Como por convenio se puede pactar pagar en más
// días, TIP_LEGAL_PAYMENT_DAYS lo reemplaza sin cambiar código.

export const DEFAULT_TIP_LEGAL_PAYMENT_DAYS = 7;
// Tope de TIP_LEGAL_PAYMENT_DAYS: más de un año hábil no es un plazo de pago
// realista y suele ser un error de tipeo.
export const MAX_TIP_LEGAL_PAYMENT_DAYS = 260;

export type TipHolidayCalendar = ReadonlySet<string>;

function dateText(date: CalendarDate): string {
  return formatDbDate(toDbDate(date));
}

function isBusinessDay(
  date: CalendarDate,
  holidays: TipHolidayCalendar,
): boolean {
  const weekDay = toDbDate(date).getUTCDay();
  return weekDay !== 0 && weekDay !== 6 && !holidays.has(dateText(date));
}

export function parseTipAlertHolidays(
  value: string | undefined,
): TipHolidayCalendar {
  const holidays = new Set<string>();
  const invalid: string[] = [];
  for (const candidate of value?.split(',') ?? []) {
    const date = candidate.trim();
    if (!date) continue;
    if (parseCalendarDate(date)) holidays.add(date);
    else invalid.push(date);
  }
  if (invalid.length > 0) {
    throw new Error(
      `TIP_ALERT_HOLIDAYS contiene fechas inválidas: ${invalid.join(', ')}`,
    );
  }
  return holidays;
}

// TIP_LEGAL_PAYMENT_DAYS es opcional (vacío o ausente usa el valor por
// defecto); si viene, debe ser un entero entre 1 y MAX_TIP_LEGAL_PAYMENT_DAYS.
// Un valor inválido impide iniciar el backend, como el resto de la
// configuración.
export function parseTipLegalPaymentDays(value: string | undefined): number {
  const trimmed = value?.trim() ?? '';
  if (trimmed === '') return DEFAULT_TIP_LEGAL_PAYMENT_DAYS;
  const parsed = Number(trimmed);
  if (
    !/^[1-9]\d*$/.test(trimmed) ||
    !Number.isSafeInteger(parsed) ||
    parsed > MAX_TIP_LEGAL_PAYMENT_DAYS
  ) {
    throw new Error(
      `TIP_LEGAL_PAYMENT_DAYS debe ser un entero entre 1 y ${MAX_TIP_LEGAL_PAYMENT_DAYS} (valor recibido: "${value}")`,
    );
  }
  return parsed;
}

// Fecha límite de pago de una propina: el último de los legalDays días
// hábiles posteriores a su fecha de negocio. Ese día todavía está en plazo.
export function tipPaymentDeadline(
  businessDate: CalendarDate,
  legalDays: number,
  holidays: TipHolidayCalendar,
): CalendarDate {
  let result = businessDate;
  let remaining = legalDays;
  while (remaining > 0) {
    result = addDays(result, 1);
    if (isBusinessDay(result, holidays)) remaining -= 1;
  }
  return result;
}

// Una propina está vencida cuando ya pasaron más días hábiles que los
// establecidos: hoy es posterior a su fecha límite (el día límite no alerta).
export function isTipPaymentOverdue(
  businessDate: CalendarDate,
  today: CalendarDate,
  legalDays: number,
  holidays: TipHolidayCalendar,
): boolean {
  return (
    daysBetween(tipPaymentDeadline(businessDate, legalDays, holidays), today) >
    0
  );
}

// Última fecha de negocio cuyas propinas ya están vencidas hoy. La fecha
// límite crece con la fecha de negocio, así que toda propina con fecha igual
// o anterior también está vencida y la consulta filtra con un solo límite.
// Se parte de today - legalDays - 1 (el plazo nunca es menor que legalDays
// días corridos) y se retrocede hasta la primera fecha vencida.
export function latestOverdueBusinessDate(
  today: CalendarDate,
  legalDays: number,
  holidays: TipHolidayCalendar,
): CalendarDate {
  let candidate = addDays(today, -legalDays - 1);
  while (!isTipPaymentOverdue(candidate, today, legalDays, holidays)) {
    candidate = addDays(candidate, -1);
  }
  return candidate;
}

// Días corridos de atraso: desde la fecha límite hasta hoy (1 el día
// siguiente al límite).
export function tipPaymentDaysOverdue(
  deadline: CalendarDate,
  today: CalendarDate,
): number {
  return Math.max(daysBetween(deadline, today), 0);
}

// Resumen de un conjunto de alertas (todas o las de un local): lo usa el
// panel de ventas (SPRINT-4R-T13) para mostrar monto, días y atraso.
export function summarizeTipPaymentAlerts(
  alerts: readonly TipPaymentAlert[],
): TipPaymentAlertSummary {
  let oldest: string | null = null;
  let newest: string | null = null;
  let allocationCount = 0;
  let amount = 0;
  let maxDaysOverdue = 0;
  for (const alert of alerts) {
    allocationCount += alert.allocationCount;
    amount += alert.amount;
    maxDaysOverdue = Math.max(maxDaysOverdue, alert.daysOverdue);
    if (oldest === null || alert.oldestBusinessDate < oldest)
      oldest = alert.oldestBusinessDate;
    if (newest === null || alert.newestBusinessDate > newest)
      newest = alert.newestBusinessDate;
  }
  return {
    alertCount: alerts.length,
    allocationCount,
    amount,
    oldestBusinessDate: oldest,
    newestBusinessDate: newest,
    maxDaysOverdue,
  };
}
