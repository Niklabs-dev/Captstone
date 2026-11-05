import { ApiProperty } from '@nestjs/swagger';
import {
  CashClosingStatus,
  PaymentMethod,
} from '../../generated/prisma/client.js';
import type {
  AlertCounts,
  PaymentMethodSales,
  PendingClosingDifference,
  SalesDashboard,
  SalesDashboardStore,
  SalesDashboardTotals,
  StoreAlertsSummary,
  StoreCardTipsSummary,
  StoreClosingsSummary,
  StoreDashboard,
  StoreSalesSummary,
} from '../types/sales-dashboard.types.js';

// Documentación Swagger de la consulta consolidada (SPRINT-4-T13). Montos en
// CLP enteros.

class SalesDashboardStoreDto implements SalesDashboardStore {
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
    description: 'Indica si el local está activo.',
    example: true,
  })
  isActive: boolean;
}

class PaymentMethodSalesDto implements PaymentMethodSales {
  @ApiProperty({
    description: 'Medio de pago.',
    enum: PaymentMethod,
    example: PaymentMethod.DEBIT_CARD,
  })
  paymentMethod: PaymentMethod;

  @ApiProperty({ description: 'Cantidad de ventas del medio.', example: 42 })
  salesCount: number;

  @ApiProperty({
    description: 'Venta neta del medio (bruto menos propina).',
    example: 511730,
  })
  netAmount: number;
}

class StoreSalesSummaryDto implements StoreSalesSummary {
  @ApiProperty({
    description: 'Cantidad de ventas del día en hora de Chile.',
    example: 96,
  })
  salesCount: number;

  @ApiProperty({
    description:
      'Venta neta del día: suma de gross_amount menos tip_amount. Nunca incluye propinas.',
    example: 675530,
  })
  netAmount: number;

  @ApiProperty({
    description: 'Ventas del día ya conciliadas en un cierre de caja.',
    example: 90,
  })
  closedSalesCount: number;

  @ApiProperty({
    description: 'Venta neta del día ya conciliada en un cierre de caja.',
    example: 655530,
  })
  closedNetAmount: number;

  @ApiProperty({
    description: 'Ventas del día que aún no pertenecen a ningún cierre.',
    example: 6,
  })
  unclosedSalesCount: number;

  @ApiProperty({
    description: 'Venta neta del día que aún no pertenece a ningún cierre.',
    example: 20000,
  })
  unclosedNetAmount: number;

  @ApiProperty({
    description:
      'Desglose por medio de pago; siempre incluye los cuatro medios.',
    type: [PaymentMethodSalesDto],
  })
  byPaymentMethod: PaymentMethodSalesDto[];
}

class StoreCardTipsSummaryDto implements StoreCardTipsSummary {
  @ApiProperty({
    description:
      'Propina con débito o crédito del registro diario de propinas (fuente de los repartos).',
    example: 31602,
  })
  registeredAmount: number;

  @ApiProperty({
    description:
      'Propina informada por los vouchers de Mercado Pago de los cierres del día.',
    example: 31602,
  })
  closingsAmount: number;
}

class StoreClosingsSummaryDto implements StoreClosingsSummary {
  @ApiProperty({
    description: 'Cantidad de cierres de caja del día.',
    example: 2,
  })
  count: number;

  @ApiProperty({
    description: 'Turnos con cierre registrado, en orden.',
    type: [Number],
    example: [1, 2],
  })
  shifts: number[];

  @ApiProperty({
    description:
      'Venta neta conciliada por los cierres: lo esperado sin el fondo de caja.',
    example: 655530,
  })
  netSalesAmount: number;

  @ApiProperty({
    description: 'Total declarado por los supervisores en los cierres.',
    example: 704530,
  })
  countedAmount: number;

  @ApiProperty({
    description:
      'Diferencia de caja (contado menos esperado) sumada en los cierres del día.',
    example: -1000,
  })
  cashDifference: number;

  @ApiProperty({
    description:
      'Descuadre de vouchers: Mercado Pago neto menos MrComanda, sumado en los cierres del día.',
    example: 1600,
  })
  voucherDifference: number;

  @ApiProperty({
    description: 'Venta neta informada por MrComanda en los cierres.',
    example: 555530,
  })
  mrcomandaNetSales: number;

  @ApiProperty({
    description: 'Cobro de Mercado Pago sin propinas en los cierres.',
    example: 557130,
  })
  mercadoPagoNetSales: number;
}

class PendingClosingDifferenceDto implements PendingClosingDifference {
  @ApiProperty({
    description: 'ID del cierre de caja (UUID), consultable en /cash-closings.',
    example: 'c1000000-0000-4000-8000-000000000001',
  })
  closingId: string;

  @ApiProperty({ description: 'Número de turno.', example: 1 })
  shift: number;

  @ApiProperty({
    description: 'Estado del cierre.',
    enum: CashClosingStatus,
    example: CashClosingStatus.CLOSED,
  })
  status: CashClosingStatus;

  @ApiProperty({
    description: 'Diferencia de caja del cierre (contado menos esperado).',
    example: -1000,
  })
  cashDifference: number;

  @ApiProperty({
    description: 'Descuadre de vouchers del cierre.',
    example: 1600,
  })
  voucherDifference: number;

  @ApiProperty({
    description: 'Motivo declarado por el supervisor.',
    example: 'Faltante de efectivo',
    nullable: true,
    type: String,
  })
  differenceReason: string | null;

  @ApiProperty({
    description: 'Instante en que se confirmó el cierre.',
    example: '2026-03-10T19:00:00.000Z',
    nullable: true,
    type: Date,
  })
  closedAt: Date | null;
}

class AlertCountsDto implements AlertCounts {
  @ApiProperty({ description: 'Alertas vencidas.', example: 1 })
  overdue: number;

  @ApiProperty({ description: 'Alertas por vencer.', example: 2 })
  upcoming: number;
}

class StoreAlertsSummaryDto implements StoreAlertsSummary {
  @ApiProperty({
    description:
      'Documentos laborales pendientes de registrar en la DT (vigentes al consultar).',
    type: AlertCountsDto,
  })
  dtRegistration: AlertCountsDto;

  @ApiProperty({
    description:
      'Propinas con tarjeta pendientes de entrega (vigentes al consultar).',
    type: AlertCountsDto,
  })
  tipPayment: AlertCountsDto;
}

class StoreDashboardDto implements StoreDashboard {
  @ApiProperty({ description: 'Local.', type: SalesDashboardStoreDto })
  store: SalesDashboardStoreDto;

  @ApiProperty({
    description: 'Ventas netas del día.',
    type: StoreSalesSummaryDto,
  })
  sales: StoreSalesSummaryDto;

  @ApiProperty({
    description: 'Propina con tarjeta, separada de las ventas.',
    type: StoreCardTipsSummaryDto,
  })
  cardTips: StoreCardTipsSummaryDto;

  @ApiProperty({
    description: 'Cifras de los cierres de caja del día.',
    type: StoreClosingsSummaryDto,
  })
  closings: StoreClosingsSummaryDto;

  @ApiProperty({
    description:
      'Cierres del día con alguna línea descuadrada o descuadre de vouchers.',
    type: [PendingClosingDifferenceDto],
  })
  pendingDifferences: PendingClosingDifferenceDto[];

  @ApiProperty({
    description: 'Alertas DT y de propinas del local.',
    type: StoreAlertsSummaryDto,
  })
  alerts: StoreAlertsSummaryDto;
}

class SalesDashboardTotalsDto implements SalesDashboardTotals {
  @ApiProperty({
    description: 'Ventas del día en todos los locales.',
    example: 250,
  })
  salesCount: number;

  @ApiProperty({
    description: 'Venta neta del día en todos los locales.',
    example: 1850000,
  })
  netAmount: number;

  @ApiProperty({
    description: 'Venta neta ya conciliada en cierres.',
    example: 1800000,
  })
  closedNetAmount: number;

  @ApiProperty({
    description: 'Venta neta sin cierre.',
    example: 50000,
  })
  unclosedNetAmount: number;

  @ApiProperty({
    description: 'Propina con tarjeta del registro diario.',
    example: 85000,
  })
  cardTipsRegisteredAmount: number;

  @ApiProperty({
    description: 'Propina con tarjeta de los vouchers de los cierres.',
    example: 85000,
  })
  cardTipsClosingsAmount: number;

  @ApiProperty({ description: 'Cierres de caja del día.', example: 5 })
  closingsCount: number;

  @ApiProperty({ description: 'Diferencia de caja total.', example: -1000 })
  cashDifference: number;

  @ApiProperty({ description: 'Descuadre de vouchers total.', example: 1600 })
  voucherDifference: number;

  @ApiProperty({
    description: 'Cierres con diferencias pendientes de revisión.',
    example: 1,
  })
  pendingDifferencesCount: number;

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
    description: 'Día de negocio consultado (YYYY-MM-DD).',
    example: '2026-03-10',
  })
  businessDate: string;

  @ApiProperty({
    description: 'Zona horaria usada para el día de negocio.',
    example: 'America/Santiago',
  })
  timeZone: string;

  @ApiProperty({
    description: 'Primer instante del día en hora de Chile (inclusive).',
    example: '2026-03-10T03:00:00.000Z',
  })
  periodStart: Date;

  @ApiProperty({
    description:
      'Primer instante del día siguiente en hora de Chile (exclusivo).',
    example: '2026-03-11T03:00:00.000Z',
  })
  periodEnd: Date;

  @ApiProperty({
    description: 'Instante en que se calculó el resumen y las alertas.',
    example: '2026-03-10T23:15:00.000Z',
  })
  calculatedAt: Date;

  @ApiProperty({
    description: 'Resumen de cada local, ordenado por nombre.',
    type: [StoreDashboardDto],
  })
  stores: StoreDashboardDto[];

  @ApiProperty({
    description: 'Totales de todos los locales.',
    type: SalesDashboardTotalsDto,
  })
  totals: SalesDashboardTotalsDto;
}
