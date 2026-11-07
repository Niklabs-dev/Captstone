import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
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

const LETTER_PATTERN = /\p{L}/u;

function normalizeName({ value }: { value: unknown }): unknown {
  return typeof value === 'string'
    ? value
        .replace(/\p{Cf}/gu, '')
        .trim()
        .replace(/\s+/gu, ' ')
    : value;
}

export class UpdatePaymentMethodDto {
  @ApiPropertyOptional({
    description: 'Nombre descriptivo para mostrar.',
    example: 'Tarjeta de débito',
    maxLength: 100,
  })
  @Transform(normalizeName)
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  @Matches(LETTER_PATTERN, {
    message: 'name debe incluir al menos una letra',
  })
  name?: string;

  @ApiPropertyOptional({
    description: 'Orden de presentación (menor primero).',
    example: 20,
    minimum: 0,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiPropertyOptional({
    description: 'Comportamiento ante el cierre de caja.',
    enum: PAYMENT_METHOD_BEHAVIORS,
    example: 'EXTERNAL_OTHER',
  })
  @IsOptional()
  @IsIn(PAYMENT_METHOD_BEHAVIORS, {
    message: `behavior debe ser uno de: ${PAYMENT_METHOD_BEHAVIORS.join(', ')}`,
  })
  behavior?: PaymentMethodBehavior;

  @ApiPropertyOptional({
    description: 'Indica si el medio puede usarse para registrar propinas.',
    example: false,
  })
  @IsOptional()
  availableForTips?: boolean;
}
