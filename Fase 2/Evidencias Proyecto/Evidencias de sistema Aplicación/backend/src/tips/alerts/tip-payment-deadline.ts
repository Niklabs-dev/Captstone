import {
  parseCalendarDate,
  type CalendarDate,
} from '../../audit/utils/business-day.util.js';
import {
  addDays,
  businessDateOf,
  formatDbDate,
  toDbDate,
} from '../../documents/utils/document-dates.util.js';
import type { TipPaymentAlertStatus } from '../types/tip-payment-alerts.types.js';

export const TIP_PAYMENT_BUSINESS_DAYS = 7;

export type TipHolidayCalendar = ReadonlySet<string>;

export interface TipPaymentDeadline {
  deadline: string;
  daysRemaining: number;
  status: TipPaymentAlertStatus;
}

function dateText(date: CalendarDate): string {
  return formatDbDate(toDbDate(date));
}

function compareDates(left: CalendarDate, right: CalendarDate): number {
  return dateText(left).localeCompare(dateText(right));
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

function addBusinessDays(
  start: CalendarDate,
  days: number,
  holidays: TipHolidayCalendar,
): CalendarDate {
  let result = start;
  let remaining = days;
  while (remaining > 0) {
    result = addDays(result, 1);
    if (isBusinessDay(result, holidays)) remaining -= 1;
  }
  return result;
}

function businessDaysBetween(
  start: CalendarDate,
  end: CalendarDate,
  holidays: TipHolidayCalendar,
): number {
  let days = 0;
  let cursor = start;
  while (compareDates(cursor, end) < 0) {
    cursor = addDays(cursor, 1);
    if (isBusinessDay(cursor, holidays)) days += 1;
  }
  return days;
}

export function calculateTipPaymentDeadline(
  businessDate: CalendarDate,
  now: Date,
  holidays: TipHolidayCalendar,
): TipPaymentDeadline {
  const deadline = addBusinessDays(
    businessDate,
    TIP_PAYMENT_BUSINESS_DAYS,
    holidays,
  );
  const today = businessDateOf(now);
  const comparison = compareDates(today, deadline);
  const daysRemaining =
    comparison < 0
      ? businessDaysBetween(today, deadline, holidays)
      : comparison === 0
        ? 0
        : -businessDaysBetween(deadline, today, holidays);
  return {
    deadline: dateText(deadline),
    daysRemaining: daysRemaining === 0 ? 0 : daysRemaining,
    status: comparison > 0 ? 'OVERDUE' : 'UPCOMING',
  };
}
