import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import type {
  PaymentMethodAliasMethodRef,
  PaymentMethodAliasResponse,
} from './payment-method-aliases.types.js';

// DTOs de los alias de medios de pago (SPRINT-4A-T20).

export const ALIAS_LABEL_MAX_LENGTH = 100;

// La etiqueta se guarda sin los espacios de relleno del informe; la
// normalización (mayúsculas, sin tildes) la hace el servicio.
function trimLabel({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : value;
}

export class CreatePaymentMethodAliasDto {
  @ApiProperty({
    description:
      'Etiqueta tal como aparece en «Medios de pago» del informe de MrComanda. Se compara sin tildes, en mayúsculas y con espacios colapsados (la puntuación cuenta).',
    example: 'N.de Créd.',
    maxLength: ALIAS_LABEL_MAX_LENGTH,
  })
  @Transform(trimLabel)
  @IsString({ message: 'label debe ser un texto' })
  @MinLength(1, { message: 'label no puede estar vacío' })
  @MaxLength(ALIAS_LABEL_MAX_LENGTH, {
    message: `label admite a lo más ${ALIAS_LABEL_MAX_LENGTH} caracteres`,
  })
  label: string;

  @ApiProperty({
    description: 'Medio activo del catálogo al que resuelve la etiqueta.',
    example: 'b9000000-0000-4000-8000-000000000004',
    format: 'uuid',
  })
  @IsUUID(undefined, { message: 'paymentMethodId debe ser un UUID válido' })
  paymentMethodId: string;
}

export class PaymentMethodAliasMethodDto implements PaymentMethodAliasMethodRef {
  @ApiProperty({
    description: 'ID del medio de pago.',
    example: 'b9000000-0000-4000-8000-000000000004',
  })
  id: string;

  @ApiProperty({
    description: 'Código estable del medio.',
    example: 'TRANSFER',
  })
  code: string;

  @ApiProperty({
    description: 'Nombre del medio.',
    example: 'Transferencia',
  })
  name: string;

  @ApiProperty({
    description: 'Si el medio está activo en el catálogo.',
    example: true,
  })
  isActive: boolean;
}

export class PaymentMethodAliasResponseDto implements PaymentMethodAliasResponse {
  @ApiProperty({
    description: 'ID del alias.',
    example: 'ba000000-0000-4000-8000-000000000001',
  })
  id: string;

  @ApiProperty({
    description: 'Sistema externo del informe (hoy solo MRCOMANDA).',
    enum: ['MRCOMANDA'],
    example: 'MRCOMANDA',
  })
  system: 'MRCOMANDA';

  @ApiProperty({
    description: 'Etiqueta tal como se registró.',
    example: 'N.de Créd.',
  })
  label: string;

  @ApiProperty({
    description: 'Etiqueta normalizada con la que se compara al importar.',
    example: 'N.DE CRED.',
  })
  normalizedLabel: string;

  @ApiProperty({
    description: 'Medio del catálogo al que resuelve.',
    type: PaymentMethodAliasMethodDto,
  })
  paymentMethod: PaymentMethodAliasMethodDto;

  @ApiProperty({
    description: 'Fecha y hora de creación.',
    example: '2026-11-10T22:00:00.000Z',
  })
  createdAt: Date;
}
