import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { IsCalendarDate } from '../../tips/validators/calendar-date.validator.js';
import { SALES_DAY_STATUSES } from '../types/operating-days.types.js';

// DTOs de entrada del calendario de operación y del estado diario de ventas
// (SPRINT-4R-T12).

function trim({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class UpdateOperatingCalendarDto {
  @ApiProperty({
    description:
      'Días de la semana en que abre el local (ISO: 1 = lunes … 7 = domingo). Al menos uno y sin repetir.',
    example: [1, 2, 3, 4, 5, 6],
    type: Number,
    isArray: true,
    minItems: 1,
    maxItems: 7,
  })
  @IsArray({ message: 'weekdays debe ser un arreglo de días (1 a 7)' })
  @ArrayMinSize(1, { message: 'weekdays debe tener al menos un día abierto' })
  @ArrayMaxSize(7, { message: 'weekdays no puede tener más de 7 días' })
  @ArrayUnique({ message: 'weekdays no puede repetir días' })
  @IsInt({ each: true, message: 'cada día de weekdays debe ser un entero' })
  @Min(1, { each: true, message: 'los días van de 1 (lunes) a 7 (domingo)' })
  @Max(7, { each: true, message: 'los días van de 1 (lunes) a 7 (domingo)' })
  weekdays: number[];

  @ApiProperty({
    description:
      'Primer día de negocio (YYYY-MM-DD) en que se exigen ventas importadas; los días anteriores no se informan.',
    example: '2026-11-01',
  })
  @IsCalendarDate()
  trackingStartDate: string;
}

export class CreateStoreClosureDto {
  @ApiProperty({
    description: 'Día de negocio (YYYY-MM-DD) en que el local no abre.',
    example: '2026-12-25',
  })
  @IsCalendarDate()
  date: string;

  @ApiProperty({
    description: 'Motivo del cierre (obligatorio, hasta 300 caracteres).',
    example: 'Feriado de Navidad',
    maxLength: 300,
  })
  @Transform(trim)
  @IsString({ message: 'reason debe ser un texto' })
  @IsNotEmpty({ message: 'reason es obligatorio' })
  @MaxLength(300, { message: 'reason no puede superar 300 caracteres' })
  reason: string;
}

export class ListSalesDaysQueryDto {
  @ApiPropertyOptional({
    description:
      'Desde (YYYY-MM-DD, inclusive). Por defecto, 30 días antes de «to». El rango máximo es de 366 días.',
    example: '2026-11-01',
  })
  @IsOptional()
  @IsCalendarDate()
  from?: string;

  @ApiPropertyOptional({
    description:
      'Hasta (YYYY-MM-DD, inclusive). Por defecto hoy; los días futuros no se informan.',
    example: '2026-11-08',
  })
  @IsOptional()
  @IsCalendarDate()
  to?: string;

  @ApiPropertyOptional({
    description: 'Filtra por local.',
    example: '1010021e-9bab-42d5-851c-417e9e2503bf',
  })
  @IsOptional()
  @IsUUID(undefined, { message: 'storeId debe ser un UUID válido' })
  storeId?: string;

  @ApiPropertyOptional({
    description:
      'Filtra por estado (por ejemplo ATRASADO para ver solo las alertas).',
    enum: SALES_DAY_STATUSES,
    example: 'ATRASADO',
  })
  @IsOptional()
  @IsIn(SALES_DAY_STATUSES, {
    message: 'status debe ser IMPORTADO, PENDIENTE, ATRASADO o CERRADO',
  })
  status?: (typeof SALES_DAY_STATUSES)[number];
}
