// Conversión de una hora de reloj de Chile (fecha + hh:mm:ss) al instante UTC
// correspondiente (SPRINT-4R-T09). El reporte de MrComanda trae el período y
// el horario en hora local; la base guarda timestamptz y exige que la fecha de
// negocio sea la del inicio del período en America/Santiago.

import {
  BUSINESS_TIME_ZONE,
  type CalendarDate,
} from '../../audit/utils/business-day.util.js';

export interface ClockTime {
  hours: number;
  minutes: number;
  seconds: number;
}

const MS_PER_MINUTE = 60_000;

// Desfase de la zona respecto de UTC en minutos para un instante dado.
function offsetMinutes(instant: number, timeZone: string): number {
  const label =
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'longOffset',
    })
      .formatToParts(new Date(instant))
      .find((part) => part.type === 'timeZoneName')?.value ?? 'GMT';
  const match = /^GMT([+-])(\d{2}):(\d{2})$/.exec(label);
  if (!match) return 0;
  const sign = match[1] === '-' ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3]));
}

// Hora de reloj (fecha y hh:mm:ss) de un instante en la zona indicada.
function wallClockOf(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(instant));
  const get = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? '0');
  return Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
}

// Instante en que el reloj de la zona marca la fecha y hora indicadas. Se
// prueba con el desfase vigente antes y después de un posible cambio de
// horario y se elige el candidato cuyo reloj coincide. Si la hora no existe
// (en Chile el horario de verano empieza a las 24:00 y salta a la 01:00), se
// usa el primer instante válido posterior, igual que startOfDay.
export function zonedWallClockToInstant(
  date: CalendarDate,
  time: ClockTime,
  timeZone: string = BUSINESS_TIME_ZONE,
): Date {
  const wallClock = Date.UTC(
    date.year,
    date.month - 1,
    date.day,
    time.hours,
    time.minutes,
    time.seconds,
  );
  const first = wallClock - offsetMinutes(wallClock, timeZone) * MS_PER_MINUTE;
  const second = wallClock - offsetMinutes(first, timeZone) * MS_PER_MINUTE;
  const exact = [first, second]
    .filter((candidate) => wallClockOf(candidate, timeZone) === wallClock)
    .sort((a, b) => a - b);
  return new Date(exact[0] ?? Math.max(first, second));
}
