// Conversión de fechas de negocio (YYYY-MM-DD) a instantes UTC según la zona
// horaria de los locales (SPRINT-1-T14). Un filtro "del 05-10 al 05-10" debe
// cubrir el día completo en Chile, no el día UTC: entre las 20:00/21:00 y la
// medianoche chilena ya es el día siguiente en UTC.

// Los tres locales de Moi-food (Melipilla y Calera) operan en Chile continental.
export const BUSINESS_TIME_ZONE = 'America/Santiago';

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_MINUTE = 60_000;

export interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

// Rango de instantes [start, end): start inclusivo, end exclusivo.
export interface InstantRange {
  start: Date;
  end: Date;
}

// Interpreta "YYYY-MM-DD"; null si el formato es inválido o la fecha no
// existe (ej. 2026-02-30).
export function parseCalendarDate(value: string): CalendarDate | null {
  const match = DATE_PATTERN.exec(value);
  if (!match) return null;
  const [year, month, day] = [match[1], match[2], match[3]].map(Number);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

function formatCalendarDate({ year, month, day }: CalendarDate): string {
  const pad = (n: number, size: number): string =>
    String(n).padStart(size, '0');
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

function nextCalendarDate({ year, month, day }: CalendarDate): CalendarDate {
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return {
    year: next.getUTCFullYear(),
    month: next.getUTCMonth() + 1,
    day: next.getUTCDate(),
  };
}

// Desfase de la zona respecto de UTC en minutos para un instante dado
// (ej. -180 para "GMT-03:00").
function offsetMinutes(instant: number, timeZone: string): number {
  const label =
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'longOffset',
    })
      .formatToParts(new Date(instant))
      .find((part) => part.type === 'timeZoneName')?.value ?? 'GMT';
  const match = /^GMT([+-])(\d{2}):(\d{2})$/.exec(label);
  if (!match) return 0; // "GMT" a secas: desfase cero.
  const sign = match[1] === '-' ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3]));
}

// Fecha local (YYYY-MM-DD) de un instante en la zona indicada.
function localDateOf(instant: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(instant));
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

// Primer instante del día indicado en la zona horaria. Contempla los cambios
// de horario: en Chile el horario de verano empieza a las 24:00, por lo que
// ese día la medianoche no existe y el día comienza a la 01:00.
export function startOfDay(
  date: CalendarDate,
  timeZone: string = BUSINESS_TIME_ZONE,
): Date {
  // La hora 00:00 de ese día leída como si fuera UTC; se corrige con el
  // desfase vigente. Se prueba con dos desfases (antes y después de un
  // posible cambio de horario) y se elige el primero que cae en ese día.
  const wallClock = Date.UTC(date.year, date.month - 1, date.day);
  const first = wallClock - offsetMinutes(wallClock, timeZone) * MS_PER_MINUTE;
  const second = wallClock - offsetMinutes(first, timeZone) * MS_PER_MINUTE;
  const target = formatCalendarDate(date);
  const valid = [first, second]
    .filter((candidate) => localDateOf(candidate, timeZone) === target)
    .sort((a, b) => a - b);
  return new Date(valid[0] ?? Math.max(first, second));
}

// Rango de instantes que cubre los días from..to (ambos inclusive) en la
// zona horaria. Cualquiera de los extremos puede omitirse.
export function businessDayRange(
  from: CalendarDate | null,
  to: CalendarDate | null,
  timeZone: string = BUSINESS_TIME_ZONE,
): Partial<InstantRange> {
  return {
    start: from ? startOfDay(from, timeZone) : undefined,
    end: to ? startOfDay(nextCalendarDate(to), timeZone) : undefined,
  };
}
