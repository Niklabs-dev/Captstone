import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsUUID } from 'class-validator';
import {
  MAX_DAILY_TIPS_RANGE_DAYS,
  TIP_ALLOCATION_STATUSES,
  type TipAllocationStatusCode,
} from '../types/daily-tips.types.js';
import { IsCalendarDate } from '../validators/calendar-date.validator.js';

// Filtros de la consulta de propinas diarias por trabajador (SPRINT-4A-T04).

export class DailyTipsRangeQueryDto {
  @ApiProperty({
    description:
      'Local consultado (UUID). El supervisor solo puede consultar el suyo.',
    example: '1010021e-9bab-42d5-851c-417e9e2503bf',
  })
  @IsUUID(undefined, { message: 'storeId debe ser un UUID válido' })
  storeId: string;

  @ApiProperty({
    description: `Desde (YYYY-MM-DD, inclusive), día de negocio. El rango máximo es de ${MAX_DAILY_TIPS_RANGE_DAYS} días.`,
    example: '2026-11-01',
  })
  @IsCalendarDate()
  from: string;

  @ApiProperty({
    description:
      'Hasta (YYYY-MM-DD, inclusive), día de negocio. No puede ser anterior a «from».',
    example: '2026-11-15',
  })
  @IsCalendarDate()
  to: string;
}

export class DailyTipsSummaryQueryDto extends DailyTipsRangeQueryDto {
  @ApiPropertyOptional({
    description:
      'Filtra por estado de la propina: UNPAID (solo lo pendiente) o PAID (solo lo pagado). Si se omite, incluye ambos.',
    enum: TIP_ALLOCATION_STATUSES,
    example: 'UNPAID',
  })
  @IsOptional()
  @IsIn(TIP_ALLOCATION_STATUSES, {
    message: `status debe ser uno de: ${TIP_ALLOCATION_STATUSES.join(', ')}`,
  })
  status?: TipAllocationStatusCode;
}

export class DailyTipDayQueryDto {
  @ApiProperty({
    description:
      'Local consultado (UUID). El supervisor solo puede consultar el suyo.',
    example: '1010021e-9bab-42d5-851c-417e9e2503bf',
  })
  @IsUUID(undefined, { message: 'storeId debe ser un UUID válido' })
  storeId: string;

  @ApiProperty({
    description: 'Día de negocio consultado (YYYY-MM-DD).',
    example: '2026-11-03',
  })
  @IsCalendarDate()
  businessDate: string;
}
