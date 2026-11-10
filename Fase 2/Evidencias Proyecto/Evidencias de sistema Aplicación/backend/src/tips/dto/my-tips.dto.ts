import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional } from 'class-validator';
import {
  MAX_DAILY_TIPS_RANGE_DAYS,
  TIP_ALLOCATION_STATUSES,
} from '../types/daily-tips.types.js';
import { IsCalendarDate } from '../validators/calendar-date.validator.js';
import {
  DailyTipAmountsDto,
  DailyTipStoreDto,
} from './daily-tips-response.dto.js';

// Consulta personal de propinas del portal del trabajador (SPRINT-4A-T09).
// No existe filtro de trabajador ni de local: la identidad sale del JWT y la
// validación global rechaza cualquier otro parámetro (userId incluido).

export class MyTipsQueryDto {
  @ApiPropertyOptional({
    description: `Desde (YYYY-MM-DD, inclusive), día de negocio. Se envía junto con «to»; sin ambos se consulta el mes en curso (hora de Chile). El rango máximo es de ${MAX_DAILY_TIPS_RANGE_DAYS} días.`,
    example: '2026-11-01',
  })
  @IsOptional()
  @IsCalendarDate()
  from?: string;

  @ApiPropertyOptional({
    description:
      'Hasta (YYYY-MM-DD, inclusive), día de negocio. Se envía junto con «from» y no puede ser anterior a él.',
    example: '2026-11-30',
  })
  @IsOptional()
  @IsCalendarDate()
  to?: string;
}

export class MyTipDayDto {
  @ApiProperty({
    description: 'ID de la propina diaria.',
    example: 'c1a2b3d4-e5f6-4789-a012-b3c4d5e6f7a8',
  })
  id: string;

  @ApiProperty({
    description: 'Día de negocio de la propina (YYYY-MM-DD).',
    example: '2026-11-09',
  })
  businessDate: string;

  @ApiProperty({
    description: 'Local donde se registró la operación diaria.',
    type: DailyTipStoreDto,
  })
  store: DailyTipStoreDto;

  @ApiProperty({
    description: 'Monto de la propina del día en CLP.',
    example: 7_500,
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

export class MyTipsTotalsDto extends DailyTipAmountsDto {
  @ApiProperty({
    description: 'Cantidad de días distintos con propina en el rango.',
    example: 9,
  })
  dayCount: number;
}

export class MyTipsResponseDto {
  @ApiProperty({
    description: 'Desde (inclusive) efectivamente consultado.',
    example: '2026-11-01',
  })
  from: string;

  @ApiProperty({
    description: 'Hasta (inclusive) efectivamente consultado.',
    example: '2026-11-30',
  })
  to: string;

  @ApiProperty({
    description:
      'Propinas propias del rango, de la más reciente a la más antigua. Los días sin propina no aparecen.',
    type: [MyTipDayDto],
  })
  days: MyTipDayDto[];

  @ApiProperty({
    description:
      'Totales pendiente (unpaidAmount), pagado (paidAmount) y total del rango: cuadran con la suma de los días.',
    type: MyTipsTotalsDto,
  })
  totals: MyTipsTotalsDto;
}
