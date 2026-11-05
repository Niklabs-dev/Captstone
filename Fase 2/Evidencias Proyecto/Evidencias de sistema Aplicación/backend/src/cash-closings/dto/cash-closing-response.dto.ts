import { ApiProperty } from '@nestjs/swagger';
import {
  CashClosingStatus,
  CashClosingVoucherSource,
  PaymentMethod,
} from '../../generated/prisma/client.js';
import type {
  CashClosingLineResponse,
  CashClosingPersonResponse,
  CashClosingResponse,
  CashClosingTipEntryResponse,
  CashClosingVoucherResponse,
} from '../types/cash-closings.types.js';

class CashClosingStoreDto {
  @ApiProperty({
    description: 'ID del local.',
    example: '1010021e-9bab-42d5-851c-417e9e2503bf',
  })
  id: string;

  @ApiProperty({ description: 'Nombre del local.', example: 'Santa María' })
  name: string;
}

class CashClosingPersonDto implements CashClosingPersonResponse {
  @ApiProperty({
    description: 'ID del usuario.',
    example: 'a9000000-0000-4000-8000-000000000001',
  })
  id: string;

  @ApiProperty({
    description: 'Nombre visible del usuario.',
    example: 'Supervisor Demo',
  })
  name: string;
}

class CashClosingLineResponseDto implements CashClosingLineResponse {
  @ApiProperty({
    description: 'ID de la línea.',
    example: 'a9000000-0000-4000-8000-000000000010',
  })
  id: string;

  @ApiProperty({
    description: 'Medio de pago.',
    enum: PaymentMethod,
    example: PaymentMethod.CASH,
  })
  paymentMethod: PaymentMethod;

  @ApiProperty({
    description: 'Venta neta esperada; en efectivo incluye el fondo inicial.',
    example: 150000,
  })
  expectedAmount: number;

  @ApiProperty({ description: 'Monto contado en CLP.', example: 149000 })
  countedAmount: number;

  @ApiProperty({
    description: 'Contado menos esperado en CLP.',
    example: -1000,
  })
  difference: number;
}

class CashClosingVoucherResponseDto implements CashClosingVoucherResponse {
  @ApiProperty({
    description: 'ID del voucher.',
    example: 'a9000000-0000-4000-8000-000000000020',
  })
  id: string;

  @ApiProperty({
    description: 'Fuente del voucher.',
    enum: CashClosingVoucherSource,
    example: CashClosingVoucherSource.MERCADO_PAGO,
  })
  source: CashClosingVoucherSource;

  @ApiProperty({
    description: 'Inicio del período de corte.',
    example: '2026-03-10T11:00:00.000Z',
  })
  periodStart: Date;

  @ApiProperty({
    description: 'Fin exclusivo del período de corte.',
    example: '2026-03-10T19:00:00.000Z',
  })
  periodEnd: Date;

  @ApiProperty({
    description: 'Monto original conservado en CLP.',
    example: 588732,
  })
  amount: number;

  @ApiProperty({
    description: 'Propina respaldada por el voucher en CLP.',
    example: 31602,
  })
  tipIncludedAmount: number;

  @ApiProperty({
    description: 'Referencia del comprobante, si existe.',
    example: 'RESUMEN DE VENTAS',
    nullable: true,
  })
  reference: string | null;
}

class CashClosingTipEntryResponseDto implements CashClosingTipEntryResponse {
  @ApiProperty({
    description: 'ID del registro diario existente.',
    example: 'a9000000-0000-4000-8000-000000000030',
  })
  id: string;

  @ApiProperty({
    description: 'Medio registrado sin inferir desgloses no respaldados.',
    enum: PaymentMethod,
    example: PaymentMethod.DEBIT_CARD,
  })
  paymentMethod: PaymentMethod;

  @ApiProperty({ description: 'Monto original en CLP.', example: 31602 })
  amount: number;
}

export class CashClosingResponseDto implements CashClosingResponse {
  @ApiProperty({
    description: 'ID del cierre.',
    example: 'a9000000-0000-4000-8000-000000000040',
  })
  id: string;

  @ApiProperty({ description: 'Local del cierre.', type: CashClosingStoreDto })
  store: CashClosingStoreDto;

  @ApiProperty({ description: 'Día de negocio.', example: '2026-03-10' })
  businessDate: string;

  @ApiProperty({ description: 'Número de turno.', example: 1 })
  shift: number;

  @ApiProperty({ description: 'Fondo inicial en CLP.', example: 50000 })
  openingCash: number;

  @ApiProperty({
    description: 'Estado del cierre confirmado.',
    enum: CashClosingStatus,
    example: CashClosingStatus.CLOSED,
  })
  status: CashClosingStatus;

  @ApiProperty({
    description: 'Observaciones del turno.',
    example: 'Cierre verificado con ambos comprobantes.',
    nullable: true,
  })
  notes: string | null;

  @ApiProperty({
    description: 'Motivo de las diferencias.',
    example: 'Faltante de efectivo y descuadre de conciliación.',
    nullable: true,
  })
  differenceReason: string | null;

  @ApiProperty({
    description: 'Responsable obtenido del JWT.',
    type: CashClosingPersonDto,
  })
  responsible: CashClosingPersonDto;

  @ApiProperty({
    description: 'Usuario que confirmó el cierre.',
    type: CashClosingPersonDto,
    nullable: true,
  })
  closedBy: CashClosingPersonDto | null;

  @ApiProperty({
    description: 'Fecha-hora de confirmación.',
    example: '2026-03-10T19:05:00.000Z',
    nullable: true,
  })
  closedAt: Date | null;

  @ApiProperty({
    description: 'Diferencias calculadas por medio de pago.',
    type: CashClosingLineResponseDto,
    isArray: true,
  })
  lines: CashClosingLineResponseDto[];

  @ApiProperty({ description: 'Suma esperada en CLP.', example: 780530 })
  totalExpectedAmount: number;

  @ApiProperty({ description: 'Suma contada en CLP.', example: 779530 })
  totalCountedAmount: number;

  @ApiProperty({
    description: 'Diferencia total de las líneas en CLP.',
    example: -1000,
  })
  totalDifference: number;

  @ApiProperty({
    description: 'Vouchers originales asociados.',
    type: CashClosingVoucherResponseDto,
    isArray: true,
  })
  vouchers: CashClosingVoucherResponseDto[];

  @ApiProperty({
    description: 'Venta neta de tarjetas declarada por MrComanda.',
    example: 555530,
  })
  mrcomandaNetSales: number;

  @ApiProperty({
    description: 'Cobro bruto de tarjetas declarado por Mercado Pago.',
    example: 588732,
  })
  mercadoPagoGrossAmount: number;

  @ApiProperty({
    description: 'Total oficial PROPINAS de Mercado Pago.',
    example: 31602,
  })
  mercadoPagoTipAmount: number;

  @ApiProperty({
    description: 'Venta neta conciliable: bruto Mercado Pago menos PROPINAS.',
    example: 557130,
  })
  mercadoPagoNetSales: number;

  @ApiProperty({
    description: 'Venta neta Mercado Pago menos venta neta MrComanda.',
    example: 1600,
  })
  reconciliationDifference: number;

  @ApiProperty({
    description: 'Registros diarios vinculados sin crear otro fondo.',
    type: CashClosingTipEntryResponseDto,
    isArray: true,
  })
  tipEntries: CashClosingTipEntryResponseDto[];

  @ApiProperty({
    description: 'Fondo existente a repartir; coincide con PROPINAS.',
    example: 31602,
  })
  tipFundAmount: number;

  @ApiProperty({
    description: 'Cantidad de ventas usadas para calcular lo esperado.',
    example: 4,
  })
  salesCount: number;

  @ApiProperty({
    description: 'Fecha de creación.',
    example: '2026-03-10T19:04:00.000Z',
  })
  createdAt: Date;

  @ApiProperty({
    description: 'Fecha de última modificación.',
    example: '2026-03-10T19:05:00.000Z',
  })
  updatedAt: Date;
}
