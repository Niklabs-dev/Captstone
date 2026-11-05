import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsInt,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { MAX_TIP_AMOUNT } from '../types/tips.types.js';
import { IsCalendarDate } from '../validators/calendar-date.validator.js';

function toNumber({ value }: { value: unknown }): unknown {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '') return Number(value);
  return value;
}

// El código se normaliza a mayúsculas: el catálogo define los códigos en ese
// formato y la validación de existencia/estado ocurre en el servicio contra
// la base de datos (sin listas fijas).
function toMethodCode({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? value.trim().toUpperCase() : value;
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
    description:
      'Código del medio de pago del catálogo; debe estar activo y admitir propinas.',
    example: 'DEBIT_CARD',
  })
  @Transform(toMethodCode)
  @IsString({ message: 'paymentMethod debe ser un código de medio de pago' })
  @MaxLength(50, {
    message: 'paymentMethod no puede superar 50 caracteres',
  })
  @Matches(/^[A-Z0-9_]+$/, {
    message:
      'paymentMethod debe ser un código alfanumérico en mayúsculas (ej.: DEBIT_CARD)',
  })
  paymentMethod: string;

  @ApiProperty({
    description: 'Monto entero de propinas en CLP, sin centavos ni negativos.',
    example: 12500,
    minimum: 0,
    maximum: MAX_TIP_AMOUNT,
  })
  @Transform(toNumber)
  @IsInt({ message: 'amount debe ser un número entero en CLP, sin centavos' })
  @Min(0, { message: 'amount no puede ser negativo' })
  @Max(MAX_TIP_AMOUNT, {
    message: `amount no puede superar ${MAX_TIP_AMOUNT}`,
  })
  amount: number;
}
