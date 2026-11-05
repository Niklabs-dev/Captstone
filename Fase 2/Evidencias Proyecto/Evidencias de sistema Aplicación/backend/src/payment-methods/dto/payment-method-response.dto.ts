import { ApiProperty } from '@nestjs/swagger';
import {
  PAYMENT_METHOD_BEHAVIORS,
  type PaymentMethodResponse,
} from '../types/payment-methods.types.js';

export class PaymentMethodResponseDto implements PaymentMethodResponse {
  @ApiProperty({
    description: 'ID del medio de pago (UUID).',
    example: '3f6f8cb0-1b8b-4c18-9a3b-2c7d9e5a1111',
  })
  id: string;

  @ApiProperty({
    description:
      'Código estable del medio; identifica los montos en los contratos operativos.',
    example: 'DEBIT_CARD',
  })
  code: string;

  @ApiProperty({
    description: 'Nombre descriptivo para mostrar.',
    example: 'Tarjeta de débito',
  })
  name: string;

  @ApiProperty({
    description: 'Orden de presentación (menor primero).',
    example: 10,
  })
  sortOrder: number;

  @ApiProperty({
    description:
      'Estado administrativo; un medio inactivo conserva su historial y no admite cargas nuevas.',
    example: true,
  })
  isActive: boolean;

  @ApiProperty({
    description:
      'Comportamiento ante el cierre de caja y la conciliación de vouchers.',
    enum: PAYMENT_METHOD_BEHAVIORS,
    example: 'RECONCILABLE_CARD',
  })
  behavior: PaymentMethodResponse['behavior'];

  @ApiProperty({
    description: 'Indica si el medio puede usarse para registrar propinas.',
    example: true,
  })
  availableForTips: boolean;

  @ApiProperty({
    description: 'Fecha de creación (ISO 8601).',
    example: '2026-11-05T12:00:00.000Z',
  })
  createdAt: Date;

  @ApiProperty({
    description: 'Fecha de la última modificación (ISO 8601).',
    example: '2026-11-05T12:00:00.000Z',
  })
  updatedAt: Date;
}
