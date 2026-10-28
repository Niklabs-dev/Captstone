import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { IsCalendarDate } from '../validators/calendar-date.validator.js';

// Cuerpos de las acciones del contador sobre un reparto (SPRINT-3-T13). Todas
// llevan expectedVersion: la versión que el contador revisó (bloqueo
// optimista); si el reparto cambió desde entonces la API responde 409.

function trim({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class ConfirmTipPoolDto {
  @ApiProperty({
    description:
      'Versión del reparto que se revisó (campo version de la respuesta).',
    example: 2,
    minimum: 1,
  })
  @IsInt({ message: 'expectedVersion debe ser un número entero' })
  @Min(1, { message: 'expectedVersion debe ser mayor o igual a 1' })
  expectedVersion: number;
}

export class ObserveTipPoolDto extends ConfirmTipPoolDto {
  @ApiProperty({
    description:
      'Observación del contador sobre el cálculo, sin espacios sobrantes (1 a 255 caracteres).',
    example: 'Faltan las horas de la semana del 8 de octubre de un trabajador.',
    minLength: 1,
    maxLength: 255,
  })
  @Transform(trim)
  @IsString({ message: 'notes debe ser un texto' })
  @MinLength(1, { message: 'notes no puede estar vacío' })
  @MaxLength(255, { message: 'notes no puede superar los 255 caracteres' })
  notes: string;
}

export class PayTipPoolDto extends ConfirmTipPoolDto {
  @ApiPropertyOptional({
    description:
      'Fecha en que se enteró el pago (YYYY-MM-DD). No puede ser futura ni anterior al último día del período; si se omite, se usa el día de hoy en hora de Chile.',
    example: '2026-10-27',
  })
  @IsOptional()
  @IsCalendarDate()
  paymentDate?: string;
}
