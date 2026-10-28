import { parseCalendarDate } from '../../audit/utils/business-day.util.js';
import {
  businessDateOf,
  formatDbDate,
  toDbDate,
} from '../../documents/utils/document-dates.util.js';

// Fecha de pago de un reparto (SPRINT-3-T13). Función pura, sin NestJS, para
// testearla directamente.

export type PaymentDateResult =
  { valid: true; date: string } | { valid: false; message: string };

// Sin fecha se usa el día de hoy en hora de Chile. La fecha no puede ser
// futura ni anterior al último día del período (mismo límite que el CHECK
// tip_pools_status_consistency). Las fechas YYYY-MM-DD se comparan como texto.
export function resolvePaymentDate(
  value: string | undefined,
  periodEnd: string,
  now: Date,
): PaymentDateResult {
  const today = formatDbDate(toDbDate(businessDateOf(now)));
  if (value === undefined) {
    return today < periodEnd
      ? {
          valid: false,
          message: `El período termina el ${periodEnd}: todavía no se puede marcar como pagado`,
        }
      : { valid: true, date: today };
  }
  const parsed = parseCalendarDate(value);
  if (!parsed) {
    return {
      valid: false,
      message: 'paymentDate debe ser una fecha válida con formato YYYY-MM-DD',
    };
  }
  const date = formatDbDate(toDbDate(parsed));
  if (date > today) {
    return {
      valid: false,
      message: `paymentDate no puede ser futura (hoy es ${today})`,
    };
  }
  if (date < periodEnd) {
    return {
      valid: false,
      message: `paymentDate no puede ser anterior al término del período (${periodEnd})`,
    };
  }
  return { valid: true, date };
}
