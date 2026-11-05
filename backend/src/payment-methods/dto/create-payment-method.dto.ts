import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  PAYMENT_METHOD_BEHAVIORS,
  type PaymentMethodBehavior,
} from '../types/payment-methods.types.js';
import {
  PAYMENT_METHOD_CODE_MAX_LENGTH,
  normalizePaymentMethodCode,
} from '../utils/payment-method-code.util.js';
import { IsPaymentMethodCode } from '../validators/payment-method-code.validator.js';

const LETTER_PATTERN = /\p{L}/u;

function normalizeCode({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? normalizePaymentMethodCode(value) : value;
}

function normalizeName({ value }: { value: unknown }): unknown {
  return typeof value === 'string'
    ? value
        .replace(/\p{Cf}/gu, '')
        .trim()
        .replace(/\s+/gu, ' ')
    : value;
}

export class CreatePaymentMethodDto {
  @ApiProperty({
    description:
      'Código estable del medio (se normaliza a mayúsculas y guion bajo; ' +
      'letras, dígitos y "_", con al menos una letra). No se puede editar después.',
    example: 'DEBIT_CARD',
    maxLength: PAYMENT_METHOD_CODE_MAX_LENGTH,
  })
  @Transform(normalizeCode)
  @IsString()
  @MinLength(2)
  @MaxLength(PAYMENT_METHOD_CODE_MAX_LENGTH)
  @IsPaymentMethodCode()
  code: string;

  @ApiProperty({
    description:
      'Nombre descriptivo para mostrar; debe incluir al menos una letra.',
    example: 'Tarjeta de débito',
    maxLength: 100,
  })
  @Transform(normalizeName)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  @Matches(LETTER_PATTERN, {
    message: 'name debe incluir al menos una letra',
  })
  name: string;

  @ApiProperty({
    description:
      'Orden de presentación del medio en formularios y cierres (menor primero).',
    example: 10,
    minimum: 0,
  })
  @IsInt()
  @Min(0)
  sortOrder: number;

  @ApiProperty({
    description:
      'Comportamiento ante el cierre de caja: CASH recibe el fondo de caja, ' +
      'RECONCILABLE_CARD alimenta la conciliación de vouchers y EXTERNAL_OTHER queda fuera de ella.',
    enum: PAYMENT_METHOD_BEHAVIORS,
    example: 'RECONCILABLE_CARD',
  })
  @IsIn(PAYMENT_METHOD_BEHAVIORS, {
    message: `behavior debe ser uno de: ${PAYMENT_METHOD_BEHAVIORS.join(', ')}`,
  })
  behavior: PaymentMethodBehavior;

  @ApiProperty({
    description: 'Indica si el medio puede usarse para registrar propinas.',
    example: true,
  })
  @IsBoolean()
  availableForTips: boolean;
}
