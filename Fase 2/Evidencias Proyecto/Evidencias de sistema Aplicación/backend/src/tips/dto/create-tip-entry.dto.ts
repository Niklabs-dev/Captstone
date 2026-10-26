import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsNumber, IsUUID, Max, Min } from 'class-validator';
import {
  MAX_TIP_AMOUNT,
  PAYMENT_METHODS,
  type PaymentMethodCode,
} from '../types/tips.types.js';
import { IsCalendarDate } from '../validators/calendar-date.validator.js';

function toNumber({ value }: { value: unknown }): unknown {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '') return Number(value);
  return value;
}

export class CreateTipEntryDto {
  @ApiProperty({
    description: 'ID del local al que pertenecen las propinas.',
    example: '1010021e-9bab-42d5-851c-417e9e2503bf',
  })
  @IsUUID(undefined, { message: 'storeId debe ser un UUID válido' })
  storeId: string;

  @ApiProperty({
    description: 'Día de negocio en formato YYYY-MM-DD.',
    example: '2026-10-26',
  })
  @IsCalendarDate()
  businessDate: string;

  @ApiProperty({
    description: 'Medio de pago por el que se recibieron las propinas.',
    enum: PAYMENT_METHODS,
    example: 'DEBIT_CARD',
  })
  @IsIn(PAYMENT_METHODS, {
    message: `paymentMethod debe ser uno de: ${PAYMENT_METHODS.join(', ')}`,
  })
  paymentMethod: PaymentMethodCode;

  @ApiProperty({
    description: 'Monto de propinas en CLP, sin valores negativos.',
    example: 12500,
    minimum: 0,
    maximum: MAX_TIP_AMOUNT,
  })
  @Transform(toNumber)
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'amount debe ser un número con a lo más 2 decimales' },
  )
  @Min(0, { message: 'amount no puede ser negativo' })
  @Max(MAX_TIP_AMOUNT, {
    message: `amount no puede superar ${MAX_TIP_AMOUNT}`,
  })
  amount: number;
}
