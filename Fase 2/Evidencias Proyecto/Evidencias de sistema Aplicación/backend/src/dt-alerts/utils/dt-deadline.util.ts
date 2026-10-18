import {
  businessDateOf,
  toDbDate,
} from '../../documents/utils/document-dates.util.js';
import type { DtAlertStatus } from '../types/dt-alerts.types.js';

// Cálculo de los días restantes del plazo de registro en la DT
// (SPRINT-2-T08). Funciones puras, sin NestJS ni base de datos.

const DAY_MS = 24 * 60 * 60 * 1000;

// Días corridos desde hoy (en hora de Chile) hasta el último día del plazo:
// 0 el mismo día del vencimiento y negativo una vez vencido. deadline es una
// columna date leída como medianoche UTC.
export function daysUntilDeadline(deadline: Date, now: Date): number {
  const today = toDbDate(businessDateOf(now));
  return Math.round((deadline.getTime() - today.getTime()) / DAY_MS);
}

export function dtAlertStatus(daysRemaining: number): DtAlertStatus {
  return daysRemaining < 0 ? 'OVERDUE' : 'UPCOMING';
}

// Revisión opaca del documento: cambia con cada modificación (updated_at).
export function documentRevision(updatedAt: Date): string {
  return updatedAt.toISOString();
}
