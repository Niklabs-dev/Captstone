import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';
import { IsCalendarDate } from '../../tips/validators/calendar-date.validator.js';

// Filtros de los reportes de ventas y diferencias (SPRINT-4R-T13): un rango
// de días de negocio en hora de Chile (America/Santiago) y un local o todos.
export class SalesReportQueryDto {
  @ApiProperty({
    description:
      'Desde (YYYY-MM-DD, inclusive), día de negocio en hora de Chile. El rango máximo es de 366 días.',
    example: '2026-11-01',
  })
  @IsCalendarDate()
  from: string;

  @ApiProperty({
    description:
      'Hasta (YYYY-MM-DD, inclusive), día de negocio en hora de Chile. No puede ser posterior a hoy ni anterior a «from».',
    example: '2026-11-07',
  })
  @IsCalendarDate()
  to: string;

  @ApiPropertyOptional({
    description: 'Filtra por un local (UUID). Si se omite, incluye todos.',
    example: '1010021e-9bab-42d5-851c-417e9e2503bf',
  })
  @IsOptional()
  @IsUUID(undefined, { message: 'storeId debe ser un UUID válido' })
  storeId?: string;
}
