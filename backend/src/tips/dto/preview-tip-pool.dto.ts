import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';
import { IsCalendarDate } from '../validators/calendar-date.validator.js';

// Solicitud de vista previa del reparto (SPRINT-3-T12). Que periodEnd no sea
// anterior a periodStart lo valida el servicio, que ya parsea ambas fechas.
export class PreviewTipPoolDto {
  @ApiProperty({
    description: 'ID del local cuyo reparto se calcula.',
    example: '1010021e-9bab-42d5-851c-417e9e2503bf',
  })
  @IsUUID(undefined, { message: 'storeId debe ser un UUID válido' })
  storeId: string;

  @ApiProperty({
    description: 'Primer día del período en formato YYYY-MM-DD (inclusive).',
    example: '2026-10-01',
  })
  @IsCalendarDate()
  periodStart: string;

  @ApiProperty({
    description:
      'Último día del período en formato YYYY-MM-DD (inclusive); no puede ser anterior a periodStart.',
    example: '2026-10-15',
  })
  @IsCalendarDate()
  periodEnd: string;
}
