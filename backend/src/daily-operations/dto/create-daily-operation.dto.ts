import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
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
import { MAX_DAILY_OPERATION_AMOUNT } from '../types/daily-operations.types.js';

function toNumber({ value }: { value: unknown }): unknown {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '') return Number(value);
  return value;
}

function trim({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

// Campos del formulario multipart de la operación diaria (SPRINT-4R-T01). El
// voucher llega aparte (campo "voucher"), lo procesa Multer; los montos
// llegan como texto y se transforman a entero.
export class CreateDailyOperationDto {
  @ApiProperty({
    description:
      'Local de la operación; debe coincidir con el local del supervisor.',
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

  @ApiProperty({
    description:
      'Propina de tarjeta del día en CLP (entero, sin centavos). Si es mayor ' +
      'que 0, el campo voucher del formulario es obligatorio.',
    example: 31602,
    minimum: 0,
    maximum: MAX_DAILY_OPERATION_AMOUNT,
  })
  @Transform(toNumber)
  @IsInt({ message: 'cardTipAmount debe ser un entero en CLP' })
  @Min(0, { message: 'cardTipAmount no puede ser negativo' })
  @Max(MAX_DAILY_OPERATION_AMOUNT, {
    message: 'cardTipAmount excede el límite CLP',
  })
  cardTipAmount: number;

  @ApiProperty({
    description: 'Propina en efectivo del día en CLP (entero, sin centavos).',
    example: 4500,
    minimum: 0,
    maximum: MAX_DAILY_OPERATION_AMOUNT,
  })
  @Transform(toNumber)
  @IsInt({ message: 'cashTipAmount debe ser un entero en CLP' })
  @Min(0, { message: 'cashTipAmount no puede ser negativo' })
  @Max(MAX_DAILY_OPERATION_AMOUNT, {
    message: 'cashTipAmount excede el límite CLP',
  })
  cashTipAmount: number;

  @ApiProperty({
    description:
      'Diferencia de efectivo declarada por el supervisor en CLP, con signo: ' +
      'positiva sobrante, negativa faltante. Si no es 0, differenceReason es obligatorio.',
    example: -1000,
    minimum: -MAX_DAILY_OPERATION_AMOUNT,
    maximum: MAX_DAILY_OPERATION_AMOUNT,
  })
  @Transform(toNumber)
  @IsInt({ message: 'cashDifference debe ser un entero en CLP' })
  @Min(-MAX_DAILY_OPERATION_AMOUNT, {
    message: 'cashDifference excede el límite CLP',
  })
  @Max(MAX_DAILY_OPERATION_AMOUNT, {
    message: 'cashDifference excede el límite CLP',
  })
  cashDifference: number;

  @ApiPropertyOptional({
    description:
      'Motivo de la diferencia de efectivo. Obligatorio cuando cashDifference ' +
      'no es 0; se conserva vacío cuando la caja cuadra.',
    example: 'Faltante por vuelto no registrado al cierre.',
    maxLength: 500,
  })
  @IsOptional()
  @Transform(trim)
  @IsString({ message: 'differenceReason debe ser un texto' })
  @IsNotEmpty({ message: 'differenceReason no puede estar vacío' })
  @MaxLength(500, {
    message: 'differenceReason no puede superar 500 caracteres',
  })
  differenceReason?: string;
}

// Solo para Swagger: el formulario completo, con el voucher, para que
// /api/docs muestre el selector de archivo.
export class CreateDailyOperationFormDto extends CreateDailyOperationDto {
  @ApiProperty({
    description:
      'Foto del voucher de propinas de tarjeta: JPEG, PNG o WebP, máximo 5 MiB. ' +
      'Obligatoria cuando cardTipAmount es mayor que 0; el tipo se valida por ' +
      'el contenido, no por la extensión. Se almacena en el volumen privado y ' +
      'solo se descarga autenticado con GET /daily-operations/{id}/voucher.',
    example: 'voucher.jpg',
    type: 'string',
    format: 'binary',
  })
  voucher: string;
}
