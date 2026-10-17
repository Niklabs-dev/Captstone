import {
  BUSINESS_TIME_ZONE,
  type CalendarDate,
} from '../../audit/utils/business-day.util.js';
import { DT_REGISTRATION_DAYS } from '../types/documents.types.js';

// Plazos de un documento laboral al crearlo (SPRINT-2-T05). Funciones puras,
// sin NestJS ni base de datos, para testearlas directamente.

// Fecha del calendario de un instante en la zona horaria de los locales: un
// documento cargado a las 22:00 en Chile ya es el día siguiente en UTC.
export function businessDateOf(
  instant: Date,
  timeZone: string = BUSINESS_TIME_ZONE,
): CalendarDate {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value);
  return { year: get('year'), month: get('month'), day: get('day') };
}

// Suma años igual que make_interval de PostgreSQL (migración de SPRINT-2-T03):
// si el día no existe en el año destino (29 de febrero) queda el último del mes.
export function addYears(date: CalendarDate, years: number): CalendarDate {
  const year = date.year + years;
  const lastDayOfMonth = new Date(Date.UTC(year, date.month, 0)).getUTCDate();
  return { year, month: date.month, day: Math.min(date.day, lastDayOfMonth) };
}

// Suma días corridos.
export function addDays(date: CalendarDate, days: number): CalendarDate {
  const result = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return {
    year: result.getUTCFullYear(),
    month: result.getUTCMonth() + 1,
    day: result.getUTCDate(),
  };
}

// Fecha del calendario como Date a medianoche UTC, que Prisma guarda tal cual
// en las columnas date.
export function toDbDate({ year, month, day }: CalendarDate): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

// Columna date leída de la base como texto YYYY-MM-DD.
export function formatDbDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export interface DocumentDeadlineInput {
  // Fecha de celebración (firma) informada; null si no se indicó.
  issuedAt: CalendarDate | null;
  // Instante de la carga.
  uploadedAt: Date;
  retentionYears: number;
  requiresDtRegistration: boolean;
}

export interface DocumentDeadlines {
  issuedAt: Date | null;
  retainUntil: Date;
  dtRegistrationDueAt: Date | null;
}

// Plazos que se fijan al crear el documento (ver modelo Document): ambos se
// cuentan desde la fecha de celebración o, si no se indicó, desde el día de
// carga en Chile.
// - retain_until: conservación de retention_years años (art. 9 bis CT).
// - dt_registration_due_at: 15 días corridos para registrarlo en la Dirección
//   del Trabajo, solo si el tipo lo exige.
export function computeDocumentDeadlines(
  input: DocumentDeadlineInput,
): DocumentDeadlines {
  const base = input.issuedAt ?? businessDateOf(input.uploadedAt);
  return {
    issuedAt: input.issuedAt ? toDbDate(input.issuedAt) : null,
    retainUntil: toDbDate(addYears(base, input.retentionYears)),
    dtRegistrationDueAt: input.requiresDtRegistration
      ? toDbDate(addDays(base, DT_REGISTRATION_DAYS))
      : null,
  };
}
