import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';
import { IsCalendarDate } from '../../tips/validators/calendar-date.validator.js';

// Filtro de la consulta de la operación diaria de un local y día (SPRINT-4R-T01).
// Devuelve un arreglo de 0 o 1 elementos: existe a lo más una operación por
// local y fecha de negocio.
export class ListDailyOperationsQueryDto {
  @ApiProperty({
    description: 'Local consultado.',
    example: '1010021e-9bab-42d5-851c-417e9e2503bf',
  })
  @IsUUID(undefined, { message: 'storeId debe ser un UUID válido' })
  storeId: string;

  @ApiProperty({
    description: 'Día de negocio en Chile, en formato YYYY-MM-DD.',
    example: '2026-03-10',
  })
  @IsCalendarDate()
  businessDate: string;
}
