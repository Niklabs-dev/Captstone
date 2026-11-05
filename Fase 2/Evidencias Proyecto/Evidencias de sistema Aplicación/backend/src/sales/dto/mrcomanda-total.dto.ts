import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';
import { MAX_MRCOMANDA_NET_AMOUNT } from '../types/sales.types.js';
import { normalizePaymentMethodCode } from '../../payment-methods/utils/payment-method-code.util.js';
import { IsPaymentMethodCode } from '../../payment-methods/validators/payment-method-code.validator.js';
import { PAYMENT_METHOD_CODE_MAX_LENGTH } from '../../payment-methods/utils/payment-method-code.util.js';

function toNumber({ value }: { value: unknown }): unknown {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '') return Number(value);
  return value;
}

function normalizeCode({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? normalizePaymentMethodCode(value) : value;
}

export class MrComandaTotalDto {
  @ApiProperty({
    description:
      'Código estable del medio de pago, tal como está en el catálogo (se normaliza a mayúsculas y guion bajo).',
    example: 'DEBIT_CARD',
    maxLength: PAYMENT_METHOD_CODE_MAX_LENGTH,
  })
  @Transform(normalizeCode)
  @IsPaymentMethodCode({
    message:
      'paymentMethod debe ser un código de medio de pago válido (mayúsculas, letras, dígitos y guiones bajos simples)',
  })
  paymentMethod: string;

  @ApiProperty({
    description:
      'Total neto vendido por el medio en el período, en CLP entero y sin negativos.',
    example: 125000,
    minimum: 0,
    maximum: MAX_MRCOMANDA_NET_AMOUNT,
  })
  @Transform(toNumber)
  @IsInt({
    message: 'netAmount debe ser un número entero en CLP, sin centavos',
  })
  @Min(0, { message: 'netAmount no puede ser negativo' })
  @Max(MAX_MRCOMANDA_NET_AMOUNT, {
    message: `netAmount no puede superar ${MAX_MRCOMANDA_NET_AMOUNT}`,
  })
  netAmount: number;
}
