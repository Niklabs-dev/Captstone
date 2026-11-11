import { ApiProperty } from '@nestjs/swagger';
import {
  CashDifferenceLineDto,
  CashDifferenceTotalsDto,
  DailyOperationFiguresDto,
  ImportedSalesDto,
  ImportStatusInfoDto,
  ImportStatusSummaryDto,
  PaymentMethodColumnDto,
  ReportStoreDto,
  SalesTotalsDto,
  TipsTotalsDto,
} from '../../sales-reports/dto/sales-reports-response.dto.js';
import {
  EXAMPLE_CASH_DIFFERENCE_LINE,
  EXAMPLE_DAILY_OPERATION,
  EXAMPLE_DAY_AMOUNTS,
  EXAMPLE_IMPORT_STATUS,
  EXAMPLE_IMPORTED_SALES,
  EXAMPLE_PAYMENT_METHODS,
  EXAMPLE_STORE,
  type Json,
} from '../../sales-reports/dto/sales-reports-examples.js';
import type {
  CashDifferenceTotals,
  ImportStatusSummary,
  SalesTotals,
  TipsTotals,
} from '../../sales-reports/types/sales-reports.types.js';
import { TipPaymentAlertSummaryDto } from '../../tips/dto/tip-payment-alert-response.dto.js';
import type { TipPaymentAlertSummary } from '../../tips/types/tip-payment-alerts.types.js';
import type {
  AlertCounts,
  SalesDashboard,
  SalesDashboardTotals,
  StoreAlertsSummary,
  StoreDashboard,
} from '../types/sales-dashboard.types.js';

// Documentación Swagger del panel consolidado (SPRINT-4R-T13). Montos en CLP
// enteros; los conceptos se documentan en /sales-reports.

// Ejemplos de un día del local de sales-reports-examples.ts: un Excel
// vigente y una operación con faltante; en el total, otro local ATRASADO y
// uno CERRADO.
const EXAMPLE_DT_ALERTS: AlertCounts = { overdue: 1, upcoming: 2 };
// Propinas diarias No pagadas fuera del plazo legal (SPRINT-4A-T22).
const EXAMPLE_TIP_ALERTS: TipPaymentAlertSummary = {
  alertCount: 2,
  allocationCount: 5,
  amount: 25000,
  oldestBusinessDate: '2026-10-20',
  newestBusinessDate: '2026-10-28',
  maxDaysOverdue: 9,
};

const EXAMPLE_STORE_ALERTS: StoreAlertsSummary = {
  dtRegistration: EXAMPLE_DT_ALERTS,
  tipPayment: EXAMPLE_TIP_ALERTS,
};

const EXAMPLE_STORE_DASHBOARD: Json<StoreDashboard> = {
  store: EXAMPLE_STORE,
  importStatus: EXAMPLE_IMPORT_STATUS,
  sales: EXAMPLE_IMPORTED_SALES,
  dailyOperation: EXAMPLE_DAILY_OPERATION,
  alerts: EXAMPLE_STORE_ALERTS,
};

const EXAMPLE_DAY_SALES: SalesTotals = {
  importedDays: 1,
  totalAmount: 675530,
  byPaymentMethod: EXAMPLE_DAY_AMOUNTS,
};

const EXAMPLE_DAY_TIPS: TipsTotals = {
  operationsCount: 1,
  cardTipAmount: 12000,
  cashTipAmount: 8000,
  tipFundAmount: 20000,
};

const EXAMPLE_DAY_CASH_DIFFERENCES: CashDifferenceTotals = {
  count: 1,
  surplusCount: 0,
  shortageCount: 1,
  surplusAmount: 0,
  shortageAmount: -2500,
};

const EXAMPLE_DAY_IMPORT_STATUS: ImportStatusSummary = {
  IMPORTADO: 1,
  PENDIENTE: 0,
  ATRASADO: 1,
  CERRADO: 1,
};

const EXAMPLE_DASHBOARD_TOTALS: SalesDashboardTotals = {
  sales: EXAMPLE_DAY_SALES,
  storesWithoutImport: 1,
  tips: EXAMPLE_DAY_TIPS,
  storesWithoutDailyOperation: 1,
  cashDifferences: EXAMPLE_DAY_CASH_DIFFERENCES,
  importStatus: EXAMPLE_DAY_IMPORT_STATUS,
  dtRegistrationAlerts: EXAMPLE_DT_ALERTS,
  tipPaymentAlerts: EXAMPLE_TIP_ALERTS,
};

class AlertCountsDto implements AlertCounts {
  @ApiProperty({ description: 'Alertas vencidas.', example: 1 })
  overdue: number;

  @ApiProperty({ description: 'Alertas por vencer.', example: 2 })
  upcoming: number;
}

class StoreAlertsSummaryDto implements StoreAlertsSummary {
  @ApiProperty({
    description:
      'Documentos laborales pendientes de registrar en la DT (art. 9 bis).',
    type: AlertCountsDto,
    example: EXAMPLE_DT_ALERTS,
  })
  dtRegistration: AlertCountsDto;

  @ApiProperty({
    description:
      'Propinas diarias No pagadas del local fuera del plazo legal de pago (TIP_LEGAL_PAYMENT_DAYS días hábiles): cantidad de alertas por trabajador, días, monto, fechas y mayor atraso (mismo cálculo de GET /tip-payment-alerts).',
    type: TipPaymentAlertSummaryDto,
    example: EXAMPLE_TIP_ALERTS,
  })
  tipPayment: TipPaymentAlertSummaryDto;
}

class StoreDashboardDto implements StoreDashboard {
  @ApiProperty({
    description: 'Local.',
    type: ReportStoreDto,
    example: EXAMPLE_STORE,
  })
  store: ReportStoreDto;

  @ApiProperty({
    description:
      'Estado de la importación diaria del Excel (mismo cálculo de GET /sales-days).',
    type: ImportStatusInfoDto,
    example: EXAMPLE_IMPORT_STATUS,
  })
  importStatus: ImportStatusInfoDto;

  @ApiProperty({
    description:
      'Ventas de la versión vigente del Excel; null si el día no tiene importación vigente (ausencia de datos, no venta cero).',
    type: ImportedSalesDto,
    nullable: true,
    example: EXAMPLE_IMPORTED_SALES,
  })
  sales: ImportedSalesDto | null;

  @ApiProperty({
    description:
      'Propinas de tarjeta/efectivo y diferencia de efectivo de la operación diaria; null si no se registró.',
    type: DailyOperationFiguresDto,
    nullable: true,
    example: EXAMPLE_DAILY_OPERATION,
  })
  dailyOperation: DailyOperationFiguresDto | null;

  @ApiProperty({
    description:
      'Alertas legales vigentes hoy del local (ver alertsAsOf), aunque se consulte un día pasado.',
    type: StoreAlertsSummaryDto,
    example: EXAMPLE_STORE_ALERTS,
  })
  alerts: StoreAlertsSummaryDto;
}

class SalesDashboardTotalsDto implements SalesDashboardTotals {
  @ApiProperty({
    description: 'Ventas importadas del día de todos los locales.',
    type: SalesTotalsDto,
    example: EXAMPLE_DAY_SALES,
  })
  sales: SalesTotalsDto;

  @ApiProperty({
    description:
      'Locales del panel sin importación vigente en un día que debían informarla (PENDIENTE o ATRASADO). No cuenta los días CERRADO ni los no informados (sin calendario o anteriores al inicio del seguimiento).',
    example: 1,
  })
  storesWithoutImport: number;

  @ApiProperty({
    description: 'Propinas del día de todos los locales (concepto separado).',
    type: TipsTotalsDto,
    example: EXAMPLE_DAY_TIPS,
  })
  tips: TipsTotalsDto;

  @ApiProperty({
    description:
      'Locales del panel sin operación diaria registrada en un día que debían operar (IMPORTADO, PENDIENTE o ATRASADO). No cuenta los días CERRADO ni los no informados.',
    example: 0,
  })
  storesWithoutDailyOperation: number;

  @ApiProperty({
    description:
      'Diferencias de efectivo del día: sobrantes y faltantes por separado, sin compensar.',
    type: CashDifferenceTotalsDto,
    example: EXAMPLE_DAY_CASH_DIFFERENCES,
  })
  cashDifferences: CashDifferenceTotalsDto;

  @ApiProperty({
    description: 'Locales por estado de importación del día.',
    type: ImportStatusSummaryDto,
    example: EXAMPLE_DAY_IMPORT_STATUS,
  })
  importStatus: ImportStatusSummaryDto;

  @ApiProperty({
    description:
      'Todas las alertas vigentes de registro en la DT (de cualquier local, activo o inactivo).',
    type: AlertCountsDto,
    example: EXAMPLE_DT_ALERTS,
  })
  dtRegistrationAlerts: AlertCountsDto;

  @ApiProperty({
    description:
      'Todas las propinas diarias No pagadas fuera del plazo legal de pago (de cualquier local, activo o inactivo).',
    type: TipPaymentAlertSummaryDto,
    example: EXAMPLE_TIP_ALERTS,
  })
  tipPaymentAlerts: TipPaymentAlertSummaryDto;
}

export class SalesDashboardDto implements SalesDashboard {
  @ApiProperty({
    description: 'Día de negocio consultado (YYYY-MM-DD, hora de Chile).',
    example: '2026-11-07',
  })
  businessDate: string;

  @ApiProperty({
    description: 'Día de negocio actual en Chile al calcular (YYYY-MM-DD).',
    example: '2026-11-08',
  })
  today: string;

  @ApiProperty({
    description:
      'Día de negocio (YYYY-MM-DD, hora de Chile) al que corresponden las alertas legales DT y de propinas: siempre hoy. Son las alertas vigentes al consultar, no las de businessDate; si businessDate es un día pasado, las cifras del día y las alertas son de fechas distintas.',
    example: '2026-11-08',
  })
  alertsAsOf: string;

  @ApiProperty({
    description:
      'Plazo legal de pago de propinas vigente en días hábiles (TIP_LEGAL_PAYMENT_DAYS; 7 por defecto) con que se calculan las alertas de propinas.',
    example: 7,
  })
  tipLegalPaymentDays: number;

  @ApiProperty({
    description: 'Zona horaria de los días de negocio.',
    example: 'America/Santiago',
  })
  timeZone: string;

  @ApiProperty({
    description: 'Instante del cálculo.',
    example: '2026-11-08T12:00:00.000Z',
  })
  calculatedAt: Date;

  @ApiProperty({
    description:
      'Medios de pago del panel: activos del catálogo más inactivos con ventas importadas el día, en el orden del catálogo.',
    type: [PaymentMethodColumnDto],
    example: EXAMPLE_PAYMENT_METHODS,
  })
  paymentMethods: PaymentMethodColumnDto[];

  @ApiProperty({
    description:
      'Un elemento por local activo y por local inactivo con datos del día o con alertas legales vigentes (ninguna alerta queda fuera), ordenados por nombre.',
    type: [StoreDashboardDto],
    example: [EXAMPLE_STORE_DASHBOARD],
  })
  stores: StoreDashboardDto[];

  @ApiProperty({
    description:
      'Diferencias de efectivo distintas de cero del día, con signo y motivo, sin compensar ni ocultar líneas.',
    type: [CashDifferenceLineDto],
    example: [EXAMPLE_CASH_DIFFERENCE_LINE],
  })
  cashDifferences: CashDifferenceLineDto[];

  @ApiProperty({
    description: 'Totales del día, por concepto.',
    type: SalesDashboardTotalsDto,
    example: EXAMPLE_DASHBOARD_TOTALS,
  })
  totals: SalesDashboardTotalsDto;
}
