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
import type {
  AlertCounts,
  SalesDashboard,
  SalesDashboardTotals,
  StoreAlertsSummary,
  StoreDashboard,
} from '../types/sales-dashboard.types.js';

// Documentación Swagger del panel consolidado (SPRINT-4R-T13). Montos en CLP
// enteros; los conceptos se documentan en /sales-reports.

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
  })
  dtRegistration: AlertCountsDto;

  @ApiProperty({
    description: 'Propinas con tarjeta pendientes de entregar (art. 64).',
    type: AlertCountsDto,
  })
  tipPayment: AlertCountsDto;
}

class StoreDashboardDto implements StoreDashboard {
  @ApiProperty({ description: 'Local.', type: ReportStoreDto })
  store: ReportStoreDto;

  @ApiProperty({
    description:
      'Estado de la importación diaria del Excel (mismo cálculo de GET /sales-days).',
    type: ImportStatusInfoDto,
  })
  importStatus: ImportStatusInfoDto;

  @ApiProperty({
    description:
      'Ventas de la versión vigente del Excel; null si el día no tiene importación vigente (ausencia de datos, no venta cero).',
    type: ImportedSalesDto,
    nullable: true,
  })
  sales: ImportedSalesDto | null;

  @ApiProperty({
    description:
      'Propinas de tarjeta/efectivo y diferencia de efectivo de la operación diaria; null si no se registró.',
    type: DailyOperationFiguresDto,
    nullable: true,
  })
  dailyOperation: DailyOperationFiguresDto | null;

  @ApiProperty({
    description: 'Alertas legales vigentes del local.',
    type: StoreAlertsSummaryDto,
  })
  alerts: StoreAlertsSummaryDto;
}

class SalesDashboardTotalsDto implements SalesDashboardTotals {
  @ApiProperty({
    description: 'Ventas importadas del día de todos los locales.',
    type: SalesTotalsDto,
  })
  sales: SalesTotalsDto;

  @ApiProperty({
    description: 'Locales del panel sin importación vigente para el día.',
    example: 1,
  })
  storesWithoutImport: number;

  @ApiProperty({
    description: 'Propinas del día de todos los locales (concepto separado).',
    type: TipsTotalsDto,
  })
  tips: TipsTotalsDto;

  @ApiProperty({
    description: 'Locales del panel sin operación diaria registrada.',
    example: 0,
  })
  storesWithoutDailyOperation: number;

  @ApiProperty({
    description:
      'Diferencias de efectivo del día: sobrantes y faltantes por separado, sin compensar.',
    type: CashDifferenceTotalsDto,
  })
  cashDifferences: CashDifferenceTotalsDto;

  @ApiProperty({
    description: 'Locales por estado de importación del día.',
    type: ImportStatusSummaryDto,
  })
  importStatus: ImportStatusSummaryDto;

  @ApiProperty({
    description: 'Alertas de registro en la DT de todos los locales.',
    type: AlertCountsDto,
  })
  dtRegistrationAlerts: AlertCountsDto;

  @ApiProperty({
    description: 'Alertas de entrega de propinas de todos los locales.',
    type: AlertCountsDto,
  })
  tipPaymentAlerts: AlertCountsDto;
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
  })
  paymentMethods: PaymentMethodColumnDto[];

  @ApiProperty({
    description:
      'Un elemento por local activo (y por local inactivo con datos del día), ordenados por nombre.',
    type: [StoreDashboardDto],
  })
  stores: StoreDashboardDto[];

  @ApiProperty({
    description:
      'Diferencias de efectivo distintas de cero del día, con signo y motivo, sin compensar ni ocultar líneas.',
    type: [CashDifferenceLineDto],
  })
  cashDifferences: CashDifferenceLineDto[];

  @ApiProperty({
    description: 'Totales del día, por concepto.',
    type: SalesDashboardTotalsDto,
  })
  totals: SalesDashboardTotalsDto;
}
