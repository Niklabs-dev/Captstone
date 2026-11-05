import { BadRequestException } from '@nestjs/common';
import {
  BUSINESS_TIME_ZONE,
  parseCalendarDate,
  startOfDay,
  type CalendarDate,
} from '../../audit/utils/business-day.util.js';

// Validación del período de un lote de totales MrComanda (SPRINT-4-T32).
// El período debe venir con zona horaria explícita y quedar contenido en un
// único día de negocio en Chile (America/Santiago), el mismo calendario con
// el que operan los cierres de caja.

const OFFSET_SUFFIX = /(?:Z|[+-]\d{2}:\d{2})$/;

export interface MrComandaPeriod {
  /** Inicio del período (inclusivo). */
  start: Date;
  /** Fin del período (exclusivo). La medianoche exacta del día siguiente
   * cierra el día completo de negocio. */
  end: Date;
  /** Día de negocio chileno que contiene al período completo. */
  businessDate: CalendarDate;
}

// Fecha local (YYYY-MM-DD) de un instante en la zona horaria del negocio.
function localDateOf(instant: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function nextCalendarDate({ year, month, day }: CalendarDate): CalendarDate {
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return {
    year: next.getUTCFullYear(),
    month: next.getUTCMonth() + 1,
    day: next.getUTCDate(),
  };
}

// Convierte una fecha de calendario al Date de medianoche UTC con la misma
// parte de fecha, el valor que persiste Prisma en columnas @db.Date.
export function calendarDateToUtcDate(date: CalendarDate): Date {
  return new Date(Date.UTC(date.year, date.month - 1, date.day));
}

function parseInstant(value: string, field: string): Date {
  if (!OFFSET_SUFFIX.test(value)) {
    throw new BadRequestException(
      `${field} debe incluir zona horaria explícita (ej. 2026-03-10T08:00:00-03:00)`,
    );
  }
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) {
    throw new BadRequestException(`${field} no es una fecha-hora válida`);
  }
  return instant;
}

export function parseMrComandaPeriod(
  periodStart: string,
  periodEnd: string,
): MrComandaPeriod {
  const start = parseInstant(periodStart, 'periodStart');
  const end = parseInstant(periodEnd, 'periodEnd');
  if (end.getTime() <= start.getTime()) {
    throw new BadRequestException('periodEnd debe ser posterior a periodStart');
  }

  const startDay = localDateOf(start);
  const businessDate = parseCalendarDate(startDay);
  if (!businessDate) {
    // Inalcanzable: localDateOf siempre produce YYYY-MM-DD válido.
    throw new BadRequestException('El día de negocio del período no es válido');
  }

  const dayStart = startOfDay(businessDate);
  const nextDayStart = startOfDay(nextCalendarDate(businessDate));
  // El fin exclusivo exactamente a medianoche del día siguiente es el corte
  // del día completo: se acepta. Cualquier otro instante de otro día
  // (incluso un segundo después de medianoche) cruza de día de negocio.
  const closesFullDay = end.getTime() === nextDayStart.getTime();
  if (localDateOf(end) !== startDay && !closesFullDay) {
    throw new BadRequestException(
      'El período debe estar contenido en un único día de negocio en Chile (America/Santiago)',
    );
  }
  if (
    start.getTime() < dayStart.getTime() ||
    end.getTime() > nextDayStart.getTime()
  ) {
    throw new BadRequestException(
      'El período debe quedar dentro del día de negocio en Chile',
    );
  }

  return { start, end, businessDate };
}
