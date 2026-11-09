import { ApiProperty } from '@nestjs/swagger';
import {
  CashClosingStatus,
  SaleSource,
} from '../../generated/prisma/client.js';
import type { SalesDayStatus } from '../../operating-days/calculation/sales-day-status.js';
import { SALES_DAY_STATUSES } from '../../operating-days/types/operating-days.types.js';
import {
  CASH_DIFFERENCE_TYPES,
  type CashDifference,
  type CashDifferenceLine,
  type CashDifferenceTotals,
  type CashDifferenceType,
  type DailyOperationFigures,
  type ImportClosure,
  type ImportedSales,
  type ImportStatusInfo,
  type ImportStatusSummary,
  LEGACY_BALANCE_STATUSES,
  type LegacyBalanceStatus,
  type LegacyClosing,
  type LegacyClosingLineDifference,
  type LegacySales,
  type LegacySalesReport,
  type PaymentMethodAmount,
  type PaymentMethodColumn,
  type ReportDay,
  type ReportStore,
  type SalesReport,
  type SalesReportTotals,
  type SalesTotals,
  type StoreRef,
  type StoreReport,
  type TipsTotals,
} from '../types/sales-reports.types.js';

// Documentación Swagger de los reportes de ventas y diferencias por período y
// local (SPRINT-4R-T13). Montos en CLP enteros. Varias clases se reutilizan en
// el panel consolidado (/sales-dashboard).

export class ReportStoreDto implements ReportStore {
  @ApiProperty({
    description: 'ID del local (UUID).',
    example: '1010021e-9bab-42d5-851c-417e9e2503bf',
  })
  id: string;

  @ApiProperty({ description: 'Nombre del local.', example: 'Santa María' })
  name: string;

  @ApiProperty({ description: 'Ciudad del local.', example: 'Melipilla' })
  city: string;

  @ApiProperty({
    description:
      'Indica si el local está activo. Un local inactivo solo aparece si tiene datos en el período (en el panel, también si tiene alertas legales vigentes).',
    example: true,
  })
  isActive: boolean;
}

export class ReportStoreRefDto implements StoreRef {
  @ApiProperty({
    description: 'ID del local (UUID).',
    example: '1010021e-9bab-42d5-851c-417e9e2503bf',
  })
  id: string;

  @ApiProperty({ description: 'Nombre del local.', example: 'Santa María' })
  name: string;
}

export class PaymentMethodColumnDto implements PaymentMethodColumn {
  @ApiProperty({
    description: 'Código estable del medio de pago en el catálogo.',
    example: 'DEBIT_CARD',
  })
  paymentMethod: string;

  @ApiProperty({
    description:
      'Nombre vigente del medio en el catálogo; se resuelve aunque el medio esté desactivado.',
    example: 'Tarjeta de débito',
  })
  paymentMethodName: string;

  @ApiProperty({
    description:
      'Indica si el medio está activo. Los inactivos solo aparecen si tienen ventas importadas en el período.',
    example: true,
  })
  isActive: boolean;
}

export class PaymentMethodAmountDto
  extends PaymentMethodColumnDto
  implements PaymentMethodAmount
{
  @ApiProperty({
    description:
      'Venta importada del medio (CLP, con signo: una nota de crédito puede restar). Nunca incluye propinas.',
    example: 254300,
  })
  amount: number;
}

export class ImportedSalesDto implements ImportedSales {
  @ApiProperty({
    description: 'ID de la importación vigente (ACTIVE) del Excel MrComanda.',
    example: '7c1e2d3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f',
  })
  importId: string;

  @ApiProperty({
    description: 'Versión de la importación vigente para el local y día.',
    example: 2,
  })
  version: number;

  @ApiProperty({
    description: 'Fecha y hora de confirmación de la importación.',
    example: '2026-11-07T13:05:00.000Z',
    type: String,
    format: 'date-time',
    nullable: true,
  })
  confirmedAt: Date | null;

  @ApiProperty({
    description:
      'Total de ventas del Excel vigente (suma de sus líneas por medio de pago). Sin propinas.',
    example: 675530,
  })
  totalAmount: number;

  @ApiProperty({
    description:
      'Desglose por medio de pago, con las mismas columnas del reporte (activos más inactivos con historial).',
    type: [PaymentMethodAmountDto],
  })
  byPaymentMethod: PaymentMethodAmountDto[];
}

export class CashDifferenceDto implements CashDifference {
  @ApiProperty({
    description:
      'Diferencia de efectivo declarada, con signo: positiva sobrante, negativa faltante.',
    example: -2500,
  })
  amount: number;

  @ApiProperty({
    description: 'Clasificación de la diferencia según su signo.',
    enum: CASH_DIFFERENCE_TYPES,
    example: 'FALTANTE',
  })
  type: CashDifferenceType;

  @ApiProperty({
    description:
      'Motivo declarado por el supervisor (obligatorio si la diferencia no es cero).',
    example: 'Vuelto mal entregado',
    type: String,
    nullable: true,
  })
  reason: string | null;
}

export class DailyOperationFiguresDto implements DailyOperationFigures {
  @ApiProperty({
    description: 'ID de la operación diaria.',
    example: '3f2e1d0c-9b8a-4765-8432-10fedcba9876',
  })
  operationId: string;

  @ApiProperty({
    description: 'Propina pagada con tarjeta (operación diaria).',
    example: 12000,
  })
  cardTipAmount: number;

  @ApiProperty({
    description: 'Propina en efectivo (operación diaria).',
    example: 8000,
  })
  cashTipAmount: number;

  @ApiProperty({
    description: 'Fondo de propinas del día (tarjeta + efectivo).',
    example: 20000,
  })
  tipFundAmount: number;

  @ApiProperty({
    description: 'Diferencia de efectivo declarada, con signo y motivo.',
    type: CashDifferenceDto,
  })
  cashDifference: CashDifferenceDto;
}

export class ImportClosureDto implements ImportClosure {
  @ApiProperty({
    description: 'ID de la excepción de cierre del local.',
    example: '5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d',
  })
  id: string;

  @ApiProperty({
    description: 'Motivo del cierre.',
    example: 'Feriado de Navidad',
  })
  reason: string;
}

export class ImportStatusInfoDto implements ImportStatusInfo {
  @ApiProperty({
    description:
      'Estado de la importación diaria (mismo cálculo de GET /sales-days). null cuando el día no se informa: local sin calendario, día anterior al inicio del calendario o local inactivo sin importación.',
    enum: SALES_DAY_STATUSES,
    example: 'IMPORTADO',
    nullable: true,
  })
  status: SalesDayStatus | null;

  @ApiProperty({
    description: 'Importación vigente del día, si existe.',
    example: '7c1e2d3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f',
    type: String,
    nullable: true,
  })
  activeImportId: string | null;

  @ApiProperty({
    description:
      'Última versión cargada pero sin confirmar (no cuenta como importada). Se informa también en locales inactivos o sin calendario.',
    example: null,
    type: String,
    nullable: true,
  })
  pendingImportId: string | null;

  @ApiProperty({
    description: 'Excepción de cierre del día, si la hay.',
    type: ImportClosureDto,
    nullable: true,
  })
  closure: ImportClosureDto | null;
}

export class ReportDayDto implements ReportDay {
  @ApiProperty({
    description: 'Día de negocio (YYYY-MM-DD, hora de Chile).',
    example: '2026-11-06',
  })
  businessDate: string;

  @ApiProperty({
    description: 'Estado de la importación diaria del Excel.',
    type: ImportStatusInfoDto,
  })
  importStatus: ImportStatusInfoDto;

  @ApiProperty({
    description:
      'Ventas de la importación vigente; null si no hay Excel vigente (ausencia de datos, no venta cero).',
    type: ImportedSalesDto,
    nullable: true,
  })
  sales: ImportedSalesDto | null;

  @ApiProperty({
    description:
      'Propinas y diferencia de efectivo de la operación diaria; null si el supervisor no la registró.',
    type: DailyOperationFiguresDto,
    nullable: true,
  })
  dailyOperation: DailyOperationFiguresDto | null;
}

export class CashDifferenceLineDto implements CashDifferenceLine {
  @ApiProperty({ description: 'Local.', type: ReportStoreRefDto })
  store: ReportStoreRefDto;

  @ApiProperty({
    description: 'Día de negocio (YYYY-MM-DD, hora de Chile).',
    example: '2026-11-06',
  })
  businessDate: string;

  @ApiProperty({
    description: 'ID de la operación diaria que declara la diferencia.',
    example: '3f2e1d0c-9b8a-4765-8432-10fedcba9876',
  })
  operationId: string;

  @ApiProperty({
    description:
      'Diferencia con signo (positiva sobrante, negativa faltante). Nunca se compensa con otras líneas.',
    example: -2500,
  })
  amount: number;

  @ApiProperty({
    description: 'Clasificación según el signo.',
    enum: ['SOBRANTE', 'FALTANTE'],
    example: 'FALTANTE',
  })
  type: 'SOBRANTE' | 'FALTANTE';

  @ApiProperty({
    description: 'Motivo declarado por el supervisor.',
    example: 'Vuelto mal entregado',
    type: String,
    nullable: true,
  })
  reason: string | null;
}

export class ImportStatusSummaryDto implements ImportStatusSummary {
  @ApiProperty({ description: 'Días con importación vigente.', example: 6 })
  IMPORTADO: number;

  @ApiProperty({
    description: 'Días de hoy aún sin importar (informativo).',
    example: 1,
  })
  PENDIENTE: number;

  @ApiProperty({
    description: 'Días pasados sin importar (alerta).',
    example: 0,
  })
  ATRASADO: number;

  @ApiProperty({
    description: 'Días en que el local no abrió.',
    example: 1,
  })
  CERRADO: number;
}

export class SalesTotalsDto implements SalesTotals {
  @ApiProperty({
    description: 'Días con importación vigente en el período.',
    example: 6,
  })
  importedDays: number;

  @ApiProperty({
    description:
      'Total de ventas importadas del período. Es la suma de byPaymentMethod y no incluye propinas.',
    example: 4053180,
  })
  totalAmount: number;

  @ApiProperty({
    description:
      'Ventas importadas por medio de pago (columnas dinámicas del catálogo).',
    type: [PaymentMethodAmountDto],
  })
  byPaymentMethod: PaymentMethodAmountDto[];
}

export class TipsTotalsDto implements TipsTotals {
  @ApiProperty({
    description: 'Operaciones diarias registradas en el período.',
    example: 6,
  })
  operationsCount: number;

  @ApiProperty({
    description: 'Propina con tarjeta de las operaciones diarias.',
    example: 72000,
  })
  cardTipAmount: number;

  @ApiProperty({
    description: 'Propina en efectivo de las operaciones diarias.',
    example: 48000,
  })
  cashTipAmount: number;

  @ApiProperty({
    description: 'Fondo de propinas (tarjeta + efectivo).',
    example: 120000,
  })
  tipFundAmount: number;
}

export class CashDifferenceTotalsDto implements CashDifferenceTotals {
  @ApiProperty({
    description: 'Operaciones con diferencia de efectivo distinta de cero.',
    example: 2,
  })
  count: number;

  @ApiProperty({ description: 'Operaciones con sobrante.', example: 1 })
  surplusCount: number;

  @ApiProperty({ description: 'Operaciones con faltante.', example: 1 })
  shortageCount: number;

  @ApiProperty({
    description: 'Suma de los sobrantes (>= 0), sin compensar con faltantes.',
    example: 1500,
  })
  surplusAmount: number;

  @ApiProperty({
    description:
      'Suma de los faltantes con signo (<= 0), sin compensar con sobrantes.',
    example: -2500,
  })
  shortageAmount: number;
}

export class StoreReportDto implements StoreReport {
  @ApiProperty({ description: 'Local.', type: ReportStoreDto })
  store: ReportStoreDto;

  @ApiProperty({
    description: 'Ventas importadas del local en el período.',
    type: SalesTotalsDto,
  })
  sales: SalesTotalsDto;

  @ApiProperty({
    description: 'Propinas de la operación diaria (concepto separado).',
    type: TipsTotalsDto,
  })
  tips: TipsTotalsDto;

  @ApiProperty({
    description: 'Diferencias de efectivo declaradas (concepto separado).',
    type: CashDifferenceTotalsDto,
  })
  cashDifferences: CashDifferenceTotalsDto;

  @ApiProperty({
    description: 'Días del período por estado de importación.',
    type: ImportStatusSummaryDto,
  })
  importStatus: ImportStatusSummaryDto;

  @ApiProperty({
    description:
      'Detalle diario (orden ascendente): días con importación vigente o pendiente, operación diaria o estado informado.',
    type: [ReportDayDto],
  })
  days: ReportDayDto[];
}

export class SalesReportTotalsDto implements SalesReportTotals {
  @ApiProperty({
    description: 'Ventas importadas de todos los locales del reporte.',
    type: SalesTotalsDto,
  })
  sales: SalesTotalsDto;

  @ApiProperty({
    description: 'Propinas de todos los locales del reporte.',
    type: TipsTotalsDto,
  })
  tips: TipsTotalsDto;

  @ApiProperty({
    description: 'Diferencias de efectivo de todos los locales del reporte.',
    type: CashDifferenceTotalsDto,
  })
  cashDifferences: CashDifferenceTotalsDto;

  @ApiProperty({
    description: 'Días por estado de importación de todos los locales.',
    type: ImportStatusSummaryDto,
  })
  importStatus: ImportStatusSummaryDto;
}

export class SalesReportDto implements SalesReport {
  @ApiProperty({ description: 'Desde (YYYY-MM-DD).', example: '2026-11-01' })
  from: string;

  @ApiProperty({ description: 'Hasta (YYYY-MM-DD).', example: '2026-11-07' })
  to: string;

  @ApiProperty({
    description: 'Día de negocio actual en Chile al calcular (YYYY-MM-DD).',
    example: '2026-11-08',
  })
  today: string;

  @ApiProperty({
    description: 'Zona horaria de los días de negocio.',
    example: 'America/Santiago',
  })
  timeZone: string;

  @ApiProperty({
    description: 'Local filtrado; null si el reporte incluye todos.',
    example: null,
    type: String,
    nullable: true,
  })
  storeId: string | null;

  @ApiProperty({
    description: 'Instante del cálculo.',
    example: '2026-11-08T12:00:00.000Z',
  })
  calculatedAt: Date;

  @ApiProperty({
    description:
      'Medios de pago del reporte: activos del catálogo más inactivos con ventas importadas en el período, en el orden del catálogo.',
    type: [PaymentMethodColumnDto],
  })
  paymentMethods: PaymentMethodColumnDto[];

  @ApiProperty({ description: 'Detalle por local.', type: [StoreReportDto] })
  stores: StoreReportDto[];

  @ApiProperty({
    description:
      'Todas las diferencias de efectivo distintas de cero del período, con signo y motivo, sin compensar ni ocultar líneas.',
    type: [CashDifferenceLineDto],
  })
  cashDifferences: CashDifferenceLineDto[];

  @ApiProperty({
    description: 'Totales del reporte, por concepto.',
    type: SalesReportTotalsDto,
  })
  totals: SalesReportTotalsDto;
}

// --- Legado ---

export class LegacyClosingLineDifferenceDto implements LegacyClosingLineDifference {
  @ApiProperty({
    description: 'Código del medio de pago de la línea.',
    example: 'CASH',
  })
  paymentMethod: string;

  @ApiProperty({
    description: 'Nombre vigente del medio de pago.',
    example: 'Efectivo',
  })
  paymentMethodName: string;

  @ApiProperty({
    description: 'Monto esperado de la línea (legado).',
    example: 20000,
  })
  expectedAmount: number;

  @ApiProperty({
    description: 'Monto contado de la línea (legado).',
    example: 19500,
  })
  countedAmount: number;

  @ApiProperty({
    description:
      'Diferencia con signo (contado - esperado). Nunca se compensa con otras líneas.',
    example: -500,
  })
  difference: number;
}

export class LegacyClosingDto implements LegacyClosing {
  @ApiProperty({
    description: 'ID del cierre de caja histórico.',
    example: '9b8a7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d',
  })
  closingId: string;

  @ApiProperty({ description: 'Local.', type: ReportStoreRefDto })
  store: ReportStoreRefDto;

  @ApiProperty({
    description: 'Día de negocio del cierre (YYYY-MM-DD).',
    example: '2026-10-30',
  })
  businessDate: string;

  @ApiProperty({ description: 'Turno del cierre.', example: 1 })
  shift: number;

  @ApiProperty({
    description: 'Estado del cierre.',
    enum: CashClosingStatus,
    example: 'CLOSED',
  })
  status: CashClosingStatus;

  @ApiProperty({
    description: 'Venta neta MrComanda conciliada (legado).',
    example: 511730,
  })
  mrcomandaNetSales: number;

  @ApiProperty({
    description: 'Cobro bruto Mercado Pago (legado).',
    example: 543332,
  })
  mercadoPagoGrossAmount: number;

  @ApiProperty({
    description: 'Propina incluida en el bruto Mercado Pago (legado).',
    example: 31602,
  })
  mercadoPagoTipAmount: number;

  @ApiProperty({
    description:
      'Descuadre de conciliación de vouchers (legado): Mercado Pago bruto - propina - MrComanda.',
    example: 0,
  })
  voucherDifference: number;

  @ApiProperty({
    description:
      'Suma neta de las diferencias por línea del cierre (legado). Puede ser 0 aunque haya líneas descuadradas: ver balanceStatus y lineDifferences.',
    example: 0,
  })
  cashDifference: number;

  @ApiProperty({
    description:
      'NO_CUADRADO si alguna línea tiene diferencia (aunque otra la compense) o si hay descuadre de vouchers; CUADRADO en otro caso.',
    enum: LEGACY_BALANCE_STATUSES,
    example: 'NO_CUADRADO',
  })
  balanceStatus: LegacyBalanceStatus;

  @ApiProperty({
    description:
      'Líneas del cierre con diferencia distinta de cero, sin compensar, en el orden del catálogo.',
    type: [LegacyClosingLineDifferenceDto],
    example: [
      {
        paymentMethod: 'DEBIT_CARD',
        paymentMethodName: 'Tarjeta de débito',
        expectedAmount: 80000,
        countedAmount: 80500,
        difference: 500,
      },
      {
        paymentMethod: 'CASH',
        paymentMethodName: 'Efectivo',
        expectedAmount: 20000,
        countedAmount: 19500,
        difference: -500,
      },
    ],
  })
  lineDifferences: LegacyClosingLineDifferenceDto[];

  @ApiProperty({
    description: 'Motivo de la diferencia registrado en el cierre.',
    example: 'Billete falso detectado',
    type: String,
    nullable: true,
  })
  differenceReason: string | null;

  @ApiProperty({
    description: 'Fecha y hora de cierre.',
    example: '2026-10-31T02:10:00.000Z',
    type: String,
    format: 'date-time',
    nullable: true,
  })
  closedAt: Date | null;
}

export class LegacySalesDto implements LegacySales {
  @ApiProperty({ description: 'Local.', type: ReportStoreRefDto })
  store: ReportStoreRefDto;

  @ApiProperty({
    description: 'Código del medio de pago.',
    example: 'CASH',
  })
  paymentMethod: string;

  @ApiProperty({
    description: 'Nombre vigente del medio de pago.',
    example: 'Efectivo',
  })
  paymentMethodName: string;

  @ApiProperty({
    description: 'Origen de la venta histórica.',
    enum: SaleSource,
    example: 'MANUAL',
  })
  source: SaleSource;

  @ApiProperty({ description: 'Cantidad de ventas.', example: 42 })
  salesCount: number;

  @ApiProperty({
    description: 'Venta neta histórica (bruto menos propina).',
    example: 164000,
  })
  netAmount: number;
}

export class LegacySalesReportDto implements LegacySalesReport {
  @ApiProperty({ description: 'Desde (YYYY-MM-DD).', example: '2026-10-01' })
  from: string;

  @ApiProperty({ description: 'Hasta (YYYY-MM-DD).', example: '2026-10-31' })
  to: string;

  @ApiProperty({
    description: 'Zona horaria de los días de negocio.',
    example: 'America/Santiago',
  })
  timeZone: string;

  @ApiProperty({
    description: 'Local filtrado; null si incluye todos.',
    example: null,
    type: String,
    nullable: true,
  })
  storeId: string | null;

  @ApiProperty({
    description: 'Advertencia de que son datos históricos de solo lectura.',
    example:
      'Histórico previo a SPRINT-4R-T01 (solo lectura): no se mezcla con las ventas importadas ni con la diferencia de efectivo de la operación diaria.',
  })
  notice: string;

  @ApiProperty({
    description: 'Cierres de caja por turno históricos del período.',
    type: [LegacyClosingDto],
  })
  closings: LegacyClosingDto[];

  @ApiProperty({
    description:
      'Ventas históricas de la tabla sales (manuales o agregadas MrComanda previas), por local, medio y origen.',
    type: [LegacySalesDto],
  })
  sales: LegacySalesDto[];
}
