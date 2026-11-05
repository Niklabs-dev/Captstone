import { ApiProperty } from '@nestjs/swagger';
import type {
  MrComandaSalesResponse,
  MrComandaSaleTotalResponse,
} from '../types/sales.types.js';

export class MrComandaSaleTotalResponseDto implements MrComandaSaleTotalResponse {
  @ApiProperty({
    description: 'ID de la venta agregada (UUID).',
    example: '2f5d9c3a-2f5d-4a0b-9c6e-8b7a1c4d9e20',
  })
  saleId: string;

  @ApiProperty({
    description: 'Código estable del medio de pago.',
    example: 'DEBIT_CARD',
  })
  paymentMethod: string;

  @ApiProperty({
    description: 'Nombre del medio de pago según el catálogo.',
    example: 'Tarjeta de débito',
  })
  paymentMethodName: string;

  @ApiProperty({
    description: 'Total neto vendido por el medio en el período (CLP entero).',
    example: 125000,
  })
  netAmount: number;
}

export class MrComandaSalesResponseDto implements MrComandaSalesResponse {
  @ApiProperty({
    description: 'ID del local de los totales.',
    example: '1010021e-9bab-42d5-851c-417e9e2503bf',
  })
  storeId: string;

  @ApiProperty({
    description: 'Inicio del período del corte (ISO 8601).',
    example: '2026-03-10T08:00:00-03:00',
  })
  periodStart: Date;

  @ApiProperty({
    description: 'Fin del período del corte (ISO 8601).',
    example: '2026-03-10T14:00:00-03:00',
  })
  periodEnd: Date;

  @ApiProperty({
    description:
      'true cuando el lote insertó ventas; false cuando fue un reintento idéntico que no duplicó.',
    example: true,
  })
  created: boolean;

  @ApiProperty({
    description: 'Suma de los netos del lote (CLP entero).',
    example: 175000,
  })
  totalNetAmount: number;

  @ApiProperty({
    description: 'Totales por medio de pago, ordenados por código.',
    type: [MrComandaSaleTotalResponseDto],
  })
  totals: MrComandaSaleTotalResponseDto[];
}
