import { ApiProperty } from '@nestjs/swagger';
import type { StoreResponse } from '../types/stores.types.js';

export class StoreResponseDto implements StoreResponse {
  @ApiProperty({
    description: 'ID del local (UUID).',
    example: '1010021e-9bab-42d5-851c-417e9e2503bf',
  })
  id: string;

  @ApiProperty({ description: 'Nombre del local.', example: 'Santa María' })
  name: string;

  @ApiProperty({ description: 'Ciudad del local.', example: 'Melipilla' })
  city: string;

  @ApiProperty({
    description: 'Dirección física del local.',
    example: 'Av. Santa María 1250',
  })
  address: string;

  @ApiProperty({
    description:
      'Indica si el local puede recibir asignaciones y operaciones nuevas.',
    example: true,
  })
  isActive: boolean;

  @ApiProperty({
    description: 'Fecha de creación (ISO 8601).',
    example: '2026-10-24T12:00:00.000Z',
  })
  createdAt: Date;

  @ApiProperty({
    description: 'Fecha de la última modificación (ISO 8601).',
    example: '2026-10-24T12:00:00.000Z',
  })
  updatedAt: Date;
}
