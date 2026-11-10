import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';
import { MAX_DAILY_TIPS_RANGE_DAYS } from '../types/daily-tips.types.js';
import { IsCalendarDate } from '../validators/calendar-date.validator.js';
import {
  DailyTipPersonDto,
  DailyTipStoreDto,
} from './daily-tips-response.dto.js';

// Pago por período de las propinas diarias (SPRINT-4A-T06): el cuerpo del
// POST y los filtros del historial usan el mismo local y rango que la
// consulta (SPRINT-4A-T04). Montos en CLP entero; las personas solo con id y
// nombre (Ley N°21.719).

export class TipPaymentPeriodDto {
  @ApiProperty({
    description: 'Local cuyas propinas se pagan o consultan (UUID).',
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

export class TipPaymentBatchResponseDto {
  @ApiProperty({
    description: 'ID del lote de pago.',
    example: '5d1c2b3a-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
  })
  id: string;

  @ApiProperty({ description: 'Local pagado.', type: DailyTipStoreDto })
  store: DailyTipStoreDto;

  @ApiProperty({
    description: 'Inicio del período pagado (YYYY-MM-DD, inclusive).',
    example: '2026-11-01',
  })
  periodStart: string;

  @ApiProperty({
    description: 'Término del período pagado (YYYY-MM-DD, inclusive).',
    example: '2026-11-15',
  })
  periodEnd: string;

  @ApiProperty({
    description:
      'Total pagado en CLP: suma de las propinas que el lote marcó como Pagadas.',
    example: 412_500,
  })
  totalAmount: number;

  @ApiProperty({
    description: 'Cantidad de propinas diarias (trabajador × día) del lote.',
    example: 48,
  })
  allocationCount: number;

  @ApiProperty({
    description: 'Cantidad de trabajadores distintos pagados en el lote.',
    example: 6,
  })
  workerCount: number;

  @ApiProperty({
    description: 'Usuario que registró el pago.',
    type: DailyTipPersonDto,
  })
  paidBy: DailyTipPersonDto;

  @ApiProperty({
    description: 'Fecha y hora en que se registró el pago.',
    example: '2026-11-16T15:30:00.000Z',
    type: Date,
  })
  paidAt: Date;
}

export class TipPaymentBatchListResponseDto {
  @ApiProperty({
    description:
      'Lotes de pago del local cuyo período se cruza con el rango consultado, del más reciente al más antiguo (paidAt descendente).',
    type: [TipPaymentBatchResponseDto],
  })
  batches: TipPaymentBatchResponseDto[];
}

export class TipPaymentConflictDto {
  @ApiProperty({ description: 'Código HTTP.', example: 409 })
  statusCode: number;

  @ApiProperty({
    description:
      'Motivo del conflicto: no quedan propinas No pagadas en el período (también si otra solicitud simultánea ya las pagó).',
    example: 'No hay propinas pendientes de pago en el período',
  })
  message: string;

  @ApiProperty({ description: 'Nombre del error HTTP.', example: 'Conflict' })
  error: string;
}
