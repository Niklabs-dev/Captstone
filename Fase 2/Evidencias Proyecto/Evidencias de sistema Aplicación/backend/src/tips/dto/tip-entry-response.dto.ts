import { ApiProperty } from '@nestjs/swagger';
import {
  PAYMENT_METHODS,
  type PaymentMethodCode,
  type TipEntryResponse,
} from '../types/tips.types.js';

class TipStoreResponseDto {
  @ApiProperty({
    description: 'ID del local.',
    example: '1010021e-9bab-42d5-851c-417e9e2503bf',
  })
  id: string;

  @ApiProperty({ description: 'Nombre del local.', example: 'Santa María' })
  name: string;
}

class TipResponsibleResponseDto {
  @ApiProperty({
    description: 'ID del usuario que registró las propinas.',
    example: 'a9000000-0000-4000-8000-000000000001',
  })
  id: string;

  @ApiProperty({
    description: 'Nombre visible del responsable.',
    example: 'Supervisor Demo',
  })
  name: string;
}

export class TipEntryResponseDto implements TipEntryResponse {
  @ApiProperty({
    description: 'ID del registro diario.',
    example: 'a9000000-0000-4000-8000-000000000005',
  })
  id: string;

  @ApiProperty({
    description: 'Día de negocio en formato YYYY-MM-DD.',
    example: '2026-10-26',
  })
  businessDate: string;

  @ApiProperty({
    description: 'Medio de pago.',
    enum: PAYMENT_METHODS,
    example: 'DEBIT_CARD',
  })
  paymentMethod: PaymentMethodCode;

  @ApiProperty({ description: 'Monto en CLP.', example: 12500 })
  amount: number;

  @ApiProperty({
    description: 'Local del registro.',
    type: TipStoreResponseDto,
  })
  store: TipStoreResponseDto;

  @ApiProperty({
    description: 'Usuario autenticado que creó el registro.',
    type: TipResponsibleResponseDto,
  })
  responsible: TipResponsibleResponseDto;

  @ApiProperty({
    description: 'Fecha de creación del registro.',
    example: '2026-10-26T12:00:00.000Z',
  })
  createdAt: Date;

  @ApiProperty({
    description: 'Fecha de la última modificación.',
    example: '2026-10-26T12:00:00.000Z',
  })
  updatedAt: Date;
}
