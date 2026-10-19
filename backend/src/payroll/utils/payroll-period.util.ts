import type { CalendarDate } from '../../audit/utils/business-day.util.js';
import {
  businessDateOf,
  formatDbDate,
  toDbDate,
} from '../../documents/utils/document-dates.util.js';

// Período de una liquidación (SPRINT-2-T13): un mes, que la API recibe y
// devuelve como YYYY-MM y la base de datos guarda como su primer día.
// Funciones puras, sin NestJS ni base de datos.

const PERIOD_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

// Primer día del mes "YYYY-MM"; null si el formato es inválido.
export function parsePayrollPeriod(value: string): CalendarDate | null {
  const match = PERIOD_PATTERN.exec(value);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]), day: 1 };
}

// Columna period (date) como YYYY-MM.
export function formatPayrollPeriod(period: Date): string {
  return formatDbDate(period).slice(0, 7);
}

// Indica si el período es posterior al mes en curso en hora de Chile: la
// liquidación de un mes se emite al terminarlo, nunca antes de que empiece.
export function isFuturePeriod(period: CalendarDate, now: Date): boolean {
  const today = businessDateOf(now);
  const currentMonth = toDbDate({ ...today, day: 1 });
  return toDbDate({ ...period, day: 1 }) > currentMonth;
}

// Revisión opaca de una liquidación: cambia con cada modificación (updated_at).
export function payslipRevision(updatedAt: Date): string {
  return updatedAt.toISOString();
}
