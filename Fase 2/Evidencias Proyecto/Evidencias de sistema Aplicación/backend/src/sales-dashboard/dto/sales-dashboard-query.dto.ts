import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional } from 'class-validator';
import { IsCalendarDate } from '../../tips/validators/calendar-date.validator.js';

// Filtro de la consulta consolidada (SPRINT-4-T13): un día de negocio en la
// hora de Chile (America/Santiago).
export class SalesDashboardQueryDto {
  @ApiPropertyOptional({
    description:
      'Día de negocio a consultar (YYYY-MM-DD) en hora de Chile. Si se omite, se usa el día actual en Chile.',
    example: '2026-03-10',
  })
  @IsOptional()
  @IsCalendarDate()
  date?: string;
}
