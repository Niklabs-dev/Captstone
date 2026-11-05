import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  CashClosingVoucherSource,
  PaymentMethod,
} from '../../generated/prisma/client.js';
import { IsCalendarDate } from '../../tips/validators/calendar-date.validator.js';
import { MAX_CASH_AMOUNT } from '../types/cash-closings.types.js';

const TIMESTAMP_WITH_ZONE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function toNumber({ value }: { value: unknown }): unknown {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '') return Number(value);
  return value;
}

function trim({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class CreateCashClosingLineDto {
  @ApiProperty({
    description: 'Medio de pago cuyo monto físico o registrado se declara.',
    enum: PaymentMethod,
    example: PaymentMethod.CASH,
  })
  @IsEnum(PaymentMethod, { message: 'paymentMethod debe ser un medio válido' })
  paymentMethod: PaymentMethod;

  @ApiProperty({
    description: 'Monto contado por el supervisor en CLP, sin centavos.',
    example: 149000,
    minimum: 0,
    maximum: MAX_CASH_AMOUNT,
  })
  @Transform(toNumber)
  @IsInt({ message: 'countedAmount debe ser un entero en CLP' })
  @Min(0, { message: 'countedAmount no puede ser negativo' })
  @Max(MAX_CASH_AMOUNT, { message: 'countedAmount excede el límite CLP' })
  countedAmount: number;
}

export class CreateCashClosingVoucherDto {
  @ApiProperty({
    description:
      'Fuente del comprobante: venta neta o cobro bruto con propina.',
    enum: CashClosingVoucherSource,
    example: CashClosingVoucherSource.MERCADO_PAGO,
  })
  @IsEnum(CashClosingVoucherSource, { message: 'source debe ser válido' })
  source: CashClosingVoucherSource;

  @ApiProperty({
    description: 'Inicio del corte con fecha, hora y zona horaria.',
    example: '2026-03-10T08:00:00-03:00',
  })
  @IsDateString({}, { message: 'periodStart debe ser una fecha-hora válida' })
  @Matches(TIMESTAMP_WITH_ZONE, {
    message: 'periodStart debe incluir hora y zona horaria',
  })
  periodStart: string;

  @ApiProperty({
    description: 'Fin exclusivo del corte con fecha, hora y zona horaria.',
    example: '2026-03-10T16:00:00-03:00',
  })
  @IsDateString({}, { message: 'periodEnd debe ser una fecha-hora válida' })
  @Matches(TIMESTAMP_WITH_ZONE, {
    message: 'periodEnd debe incluir hora y zona horaria',
  })
  periodEnd: string;

  @ApiProperty({
    description:
      'Monto original del voucher en CLP: neto en MrComanda o bruto en Mercado Pago.',
    example: 588732,
    minimum: 0,
    maximum: MAX_CASH_AMOUNT,
  })
  @Transform(toNumber)
  @IsInt({ message: 'amount debe ser un entero en CLP' })
  @Min(0, { message: 'amount no puede ser negativo' })
  @Max(MAX_CASH_AMOUNT, { message: 'amount excede el límite CLP' })
  amount: number;

  @ApiPropertyOptional({
    description:
      'Propina respaldada por este voucher Mercado Pago; no se infiere por diferencias.',
    example: 31602,
    minimum: 0,
    maximum: MAX_CASH_AMOUNT,
    default: 0,
  })
  @IsOptional()
  @Transform(toNumber)
  @IsInt({ message: 'tipIncludedAmount debe ser un entero en CLP' })
  @Min(0, { message: 'tipIncludedAmount no puede ser negativo' })
  @Max(MAX_CASH_AMOUNT, { message: 'tipIncludedAmount excede el límite CLP' })
  tipIncludedAmount?: number;

  @ApiPropertyOptional({
    description:
      'Referencia visible en el comprobante, sin espacios sobrantes.',
    example: 'RESUMEN DE VENTAS',
    maxLength: 100,
  })
  @IsOptional()
  @Transform(trim)
  @IsString({ message: 'reference debe ser un texto' })
  @IsNotEmpty({ message: 'reference no puede estar vacía' })
  @MaxLength(100, { message: 'reference no puede superar 100 caracteres' })
  reference?: string;
}

export class CreateCashClosingDto {
  @ApiProperty({
    description:
      'Local del cierre; debe coincidir con el local del supervisor.',
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
    description: 'Número de turno del local, comenzando en 1.',
    example: 1,
    minimum: 1,
    maximum: 32767,
  })
  @Transform(toNumber)
  @IsInt({ message: 'shift debe ser un número entero' })
  @Min(1, { message: 'shift debe ser mayor o igual a 1' })
  @Max(32767, { message: 'shift no puede superar 32767' })
  shift: number;

  @ApiProperty({
    description:
      'Fondo inicial de caja en CLP; se suma únicamente a lo esperado en efectivo.',
    example: 50000,
    minimum: 0,
    maximum: MAX_CASH_AMOUNT,
  })
  @Transform(toNumber)
  @IsInt({ message: 'openingCash debe ser un entero en CLP' })
  @Min(0, { message: 'openingCash no puede ser negativo' })
  @Max(MAX_CASH_AMOUNT, { message: 'openingCash excede el límite CLP' })
  openingCash: number;

  @ApiProperty({
    description:
      'Montos contados, uno por cada medio CASH, DEBIT_CARD, CREDIT_CARD y TRANSFER.',
    type: CreateCashClosingLineDto,
    isArray: true,
  })
  @IsArray({ message: 'lines debe ser una lista' })
  @ArrayNotEmpty({ message: 'lines no puede estar vacía' })
  @ValidateNested({ each: true })
  @Type(() => CreateCashClosingLineDto)
  lines: CreateCashClosingLineDto[];

  @ApiProperty({
    description:
      'Vouchers originales de MrComanda y Mercado Pago para el mismo período.',
    type: CreateCashClosingVoucherDto,
    isArray: true,
  })
  @IsArray({ message: 'vouchers debe ser una lista' })
  @ArrayNotEmpty({ message: 'vouchers no puede estar vacía' })
  @ValidateNested({ each: true })
  @Type(() => CreateCashClosingVoucherDto)
  vouchers: CreateCashClosingVoucherDto[];

  @ApiPropertyOptional({
    description:
      'Registros diarios existentes cuya suma debe ser igual a PROPINAS de Mercado Pago.',
    type: String,
    format: 'uuid',
    isArray: true,
  })
  @IsOptional()
  @IsArray({ message: 'tipEntryIds debe ser una lista de UUID' })
  @ArrayUnique({ message: 'tipEntryIds no puede contener duplicados' })
  @IsUUID(undefined, {
    each: true,
    message: 'Cada tipEntryId debe ser un UUID válido',
  })
  tipEntryIds?: string[];

  @ApiPropertyOptional({
    description:
      'Explicación obligatoria si alguna línea o la conciliación tiene diferencia.',
    example: 'Faltante de efectivo y diferencia de período en conciliación.',
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

  @ApiPropertyOptional({
    description: 'Observaciones adicionales del turno.',
    example: 'Cierre verificado con ambos comprobantes.',
    maxLength: 255,
  })
  @IsOptional()
  @Transform(trim)
  @IsString({ message: 'notes debe ser un texto' })
  @IsNotEmpty({ message: 'notes no puede estar vacío' })
  @MaxLength(255, { message: 'notes no puede superar 255 caracteres' })
  notes?: string;
}
