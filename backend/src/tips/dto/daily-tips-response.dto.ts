import { ApiProperty } from '@nestjs/swagger';
import {
  DAILY_TIP_SETTLEMENT_STATUSES,
  TIP_ALLOCATION_STATUSES,
} from '../types/daily-tips.types.js';

// DTO de respuesta de la consulta de propinas diarias por trabajador
// (SPRINT-4A-T04). Montos en CLP entero. Las personas se exponen solo con id
// y nombre: jamás RUT, correo ni teléfono (Ley N°21.719).

export class DailyTipStoreDto {
  @ApiProperty({
    description: 'ID del local.',
    example: '1010021e-9bab-42d5-851c-417e9e2503bf',
  })
  id: string;

  @ApiProperty({
    description: 'Nombre del local.',
    example: 'Subway Melipilla Centro',
  })
  name: string;
}

export class DailyTipPersonDto {
  @ApiProperty({
    description: 'ID del trabajador o supervisor.',
    example: 'b2c3d4e5-f6a7-4890-b1c2-d3e4f5a6b7c8',
  })
  id: string;

  @ApiProperty({
    description: 'Nombre y apellido.',
    example: 'María Contreras',
  })
  name: string;
}

export class DailyTipAmountsDto {
  @ApiProperty({
    description: 'Total de propinas en CLP (pagado + pendiente).',
    example: 40_000,
  })
  totalAmount: number;

  @ApiProperty({
    description: 'Monto ya pagado (propinas en estado PAID).',
    example: 0,
  })
  paidAmount: number;

  @ApiProperty({
    description: 'Monto pendiente de pago (propinas en estado UNPAID).',
    example: 40_000,
  })
  unpaidAmount: number;
}

export class DailyTipDaySummaryDto extends DailyTipAmountsDto {
  @ApiProperty({
    description: 'ID de la operación diaria del día.',
    example: '9b2f6c1e-0d4a-4c3b-8e5f-1a2b3c4d5e6f',
  })
  operationId: string;

  @ApiProperty({
    description: 'Día de negocio (YYYY-MM-DD).',
    example: '2026-11-03',
  })
  businessDate: string;

  @ApiProperty({
    description:
      'Fondo de propinas registrado (tarjeta + efectivo). Coincide con totalAmount salvo en operaciones anteriores a la selección de participantes, que no tienen reparto.',
    example: 40_000,
  })
  tipFundAmount: number;

  @ApiProperty({
    description: 'Cantidad de participantes del reparto del día.',
    example: 4,
  })
  participantCount: number;

  @ApiProperty({
    description:
      'Estado de pago del día: UNPAID (No pagado), PARTIAL (Parcial) o PAID (Pagado). Un día sin propinas figura UNPAID con total 0.',
    enum: DAILY_TIP_SETTLEMENT_STATUSES,
    example: 'UNPAID',
  })
  status: string;
}

export class DailyTipDaysTotalsDto extends DailyTipAmountsDto {
  @ApiProperty({
    description: 'Cantidad de días con operación diaria en el rango.',
    example: 12,
  })
  dayCount: number;
}

export class DailyTipDaysResponseDto {
  @ApiProperty({ description: 'Local consultado.', type: DailyTipStoreDto })
  store: DailyTipStoreDto;

  @ApiProperty({ description: 'Desde (inclusive).', example: '2026-11-01' })
  from: string;

  @ApiProperty({ description: 'Hasta (inclusive).', example: '2026-11-15' })
  to: string;

  @ApiProperty({
    description:
      'Un elemento por día con operación diaria registrada, en orden de fecha. Los días sin operación no aparecen.',
    type: [DailyTipDaySummaryDto],
  })
  days: DailyTipDaySummaryDto[];

  @ApiProperty({
    description: 'Totales del rango: cuadran con la suma de los días.',
    type: DailyTipDaysTotalsDto,
  })
  totals: DailyTipDaysTotalsDto;
}

export class DailyTipAllocationDetailDto {
  @ApiProperty({
    description: 'ID de la propina diaria del trabajador.',
    example: 'c1a2b3d4-e5f6-4789-a012-b3c4d5e6f7a8',
  })
  id: string;

  @ApiProperty({
    description: 'Trabajador o supervisor que recibe la propina.',
    type: DailyTipPersonDto,
  })
  worker: DailyTipPersonDto;

  @ApiProperty({
    description: 'Monto de la propina del día en CLP.',
    example: 10_000,
  })
  amount: number;

  @ApiProperty({
    description: 'Estado de pago: UNPAID (No pagada) o PAID (Pagada).',
    enum: TIP_ALLOCATION_STATUSES,
    example: 'UNPAID',
  })
  status: string;

  @ApiProperty({
    description: 'Lote de pago que la marcó Pagada; null si está pendiente.',
    example: null,
    nullable: true,
    type: String,
  })
  paymentBatchId: string | null;

  @ApiProperty({
    description: 'Fecha y hora del pago (del lote); null si está pendiente.',
    example: null,
    nullable: true,
    type: Date,
  })
  paidAt: Date | null;
}

export class DailyTipDayDetailResponseDto extends DailyTipDaySummaryDto {
  @ApiProperty({ description: 'Local consultado.', type: DailyTipStoreDto })
  store: DailyTipStoreDto;

  @ApiProperty({
    description:
      'Propina de cada participante del día, ordenadas por nombre (ej. $10.000 a cada uno de 4). Suman totalAmount.',
    type: [DailyTipAllocationDetailDto],
  })
  allocations: DailyTipAllocationDetailDto[];
}

export class DailyTipWorkerSummaryDto extends DailyTipAmountsDto {
  @ApiProperty({
    description: 'Trabajador o supervisor.',
    type: DailyTipPersonDto,
  })
  worker: DailyTipPersonDto;

  @ApiProperty({
    description: 'Cantidad de días del período con propina para la persona.',
    example: 9,
  })
  dayCount: number;
}

export class DailyTipSummaryTotalsDto extends DailyTipAmountsDto {
  @ApiProperty({
    description: 'Cantidad de personas con propina en el período.',
    example: 5,
  })
  workerCount: number;

  @ApiProperty({
    description: 'Cantidad de días distintos con propina en el período.',
    example: 12,
  })
  dayCount: number;
}

export class DailyTipSummaryResponseDto {
  @ApiProperty({ description: 'Local consultado.', type: DailyTipStoreDto })
  store: DailyTipStoreDto;

  @ApiProperty({ description: 'Desde (inclusive).', example: '2026-11-01' })
  from: string;

  @ApiProperty({ description: 'Hasta (inclusive).', example: '2026-11-15' })
  to: string;

  @ApiProperty({
    description: 'Filtro de estado aplicado; null si incluye ambos.',
    enum: TIP_ALLOCATION_STATUSES,
    example: null,
    nullable: true,
  })
  status: string | null;

  @ApiProperty({
    description:
      'Totales por trabajador, ordenados por nombre: días, total, pendiente y pagado.',
    type: [DailyTipWorkerSummaryDto],
  })
  workers: DailyTipWorkerSummaryDto[];

  @ApiProperty({
    description:
      'Total general del período: cuadra con la suma de los trabajadores.',
    type: DailyTipSummaryTotalsDto,
  })
  totals: DailyTipSummaryTotalsDto;
}
