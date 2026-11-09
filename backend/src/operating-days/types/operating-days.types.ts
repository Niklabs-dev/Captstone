// Tipos del calendario de operación y del estado diario de ventas
// (SPRINT-4R-T12). Las fechas de negocio van como YYYY-MM-DD (hora de Chile).

import type {
  IsoWeekday,
  SalesDayStatus,
} from '../calculation/sales-day-status.js';

export const SALES_DAY_STATUSES = [
  'IMPORTADO',
  'PENDIENTE',
  'ATRASADO',
  'CERRADO',
] as const satisfies readonly SalesDayStatus[];

// Rango por defecto del listado (días hacia atrás desde «hasta») y máximo.
export const DEFAULT_SALES_DAYS_RANGE = 30;
export const MAX_SALES_DAYS_RANGE = 366;

export interface PersonRef {
  id: string;
  name: string;
}

export interface StoreClosureResponse {
  id: string;
  date: string;
  reason: string;
  createdAt: Date;
  createdBy: PersonRef;
}

export interface OperatingCalendarResponse {
  store: { id: string; name: string };
  // false mientras el administrador no lo configure (sin alertas).
  configured: boolean;
  weekdays: IsoWeekday[];
  trackingStartDate: string | null;
  updatedAt: Date | null;
  updatedBy: PersonRef | null;
  closures: StoreClosureResponse[];
}

export interface SalesDayItem {
  store: { id: string; name: string };
  businessDate: string;
  status: SalesDayStatus;
  // Importación vigente del día (IMPORTADO).
  activeImportId: string | null;
  // Importación cargada pero sin confirmar (no cuenta como importada).
  pendingImportId: string | null;
  // Excepción de cierre del día, si la hay (CERRADO por excepción).
  closure: { id: string; reason: string } | null;
}

export interface SalesDaysResponse {
  today: string;
  from: string;
  to: string;
  summary: Record<SalesDayStatus, number>;
  items: SalesDayItem[];
}
