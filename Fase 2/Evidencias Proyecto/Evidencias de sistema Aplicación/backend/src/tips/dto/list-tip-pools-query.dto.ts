import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';
import { IsCalendarDate } from '../validators/calendar-date.validator.js';

// Filtros de la consulta histórica de repartos por período (SPRINT-3-T15;
// solo lectura desde SPRINT-4A-T08). Sin filtros lista todos los repartos;
// periodStart y periodEnd van juntos y buscan el período exacto. Que
// periodEnd no sea anterior a periodStart lo valida el servicio.
export class ListTipPoolsQueryDto {
  @ApiPropertyOptional({
    description: 'ID del local; sin él se listan los repartos de todos.',
    example: '1010021e-9bab-42d5-851c-417e9e2503bf',
  })
  @IsOptional()
  @IsUUID(undefined, { message: 'storeId debe ser un UUID válido' })
  storeId?: string;

  @ApiPropertyOptional({
    description:
      'Primer día del período exacto en formato YYYY-MM-DD; se envía junto con periodEnd.',
    example: '2026-10-01',
  })
  @IsOptional()
  @IsCalendarDate()
  periodStart?: string;

  @ApiPropertyOptional({
    description:
      'Último día del período exacto en formato YYYY-MM-DD; se envía junto con periodStart y no puede ser anterior a él.',
    example: '2026-10-15',
  })
  @IsOptional()
  @IsCalendarDate()
  periodEnd?: string;
}
