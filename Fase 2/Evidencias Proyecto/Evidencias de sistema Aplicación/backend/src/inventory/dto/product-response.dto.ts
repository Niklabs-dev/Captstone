import { ApiProperty } from '@nestjs/swagger';
import { UnitOfMeasure } from '../../generated/prisma/client.js';

// Respuestas de la API de productos de inventario (SPRINT-5-T03).

export class ProductResponseDto {
  @ApiProperty({
    description: 'ID del producto.',
    example: '1010021e-9bab-42d5-851c-417e9e2503bf',
  })
  id: string;

  @ApiProperty({
    description: 'SKU del proveedor, o null si aún no se informa.',
    example: 'SUB-123456',
    nullable: true,
    type: String,
  })
  sku: string | null;

  @ApiProperty({
    description: 'Nombre del producto.',
    example: 'Lata Coca Cola',
  })
  name: string;

  @ApiProperty({
    description: 'Otros nombres del mismo producto.',
    example: ['Coca Cola lata'],
    type: [String],
  })
  alternativeNames: string[];

  @ApiProperty({
    description: 'Unidad en que se cuenta.',
    enum: UnitOfMeasure,
    example: UnitOfMeasure.UNIT,
  })
  unit: UnitOfMeasure;

  @ApiProperty({
    description: 'Nombre del paquete.',
    example: 'bolsa',
    nullable: true,
    type: String,
  })
  packageName: string | null;

  @ApiProperty({
    description: 'Paquetes por caja.',
    example: 2,
    nullable: true,
    type: Number,
  })
  packagesPerBox: number | null;

  @ApiProperty({
    description: 'Contenido de un paquete, con 3 decimales.',
    example: '2.500',
    nullable: true,
    type: String,
  })
  packageContent: string | null;

  @ApiProperty({
    description: 'Contenido de una caja, con 3 decimales.',
    example: '5.000',
    nullable: true,
    type: String,
  })
  boxContent: string | null;

  @ApiProperty({ description: 'Se cuenta solo suelto.', example: false })
  looseOnly: boolean;

  @ApiProperty({
    description: 'false si el producto está «Sin formato».',
    example: true,
  })
  hasFormat: boolean;

  @ApiProperty({ description: 'Disponible para tomas nuevas.', example: true })
  isActive: boolean;

  @ApiProperty({
    description: 'Sección de la plantilla, o null sin fila.',
    example: 'COSTO DE BEBIDAS',
    nullable: true,
    type: String,
  })
  section: string | null;

  @ApiProperty({
    description:
      'Fila de la plantilla (2 a 183) o de las agregadas por la API (desde 1000).',
    example: 99,
    nullable: true,
    type: Number,
  })
  templatePosition: number | null;

  @ApiProperty({
    description: 'Creación.',
    example: '2026-11-12T13:00:00.000Z',
  })
  createdAt: Date;

  @ApiProperty({
    description: 'Última modificación.',
    example: '2026-11-12T13:30:00.000Z',
  })
  updatedAt: Date;
}

export class ProductSectionDto {
  @ApiProperty({
    description: 'Rótulo de la sección.',
    example: 'COSTO DE BEBIDAS',
  })
  name: string;

  @ApiProperty({
    description: 'Fila de cierre de la sección en la plantilla.',
    example: 141,
  })
  position: number;

  @ApiProperty({
    description: 'Filas «<Vacío>» libres que quedan en la sección.',
    example: 3,
  })
  freeRows: number;
}

export class ProductFieldErrorsDto {
  @ApiProperty({ description: 'Código HTTP.', example: 400 })
  statusCode: number;

  @ApiProperty({
    description: 'Resumen del error.',
    example: 'El formato del producto no es válido',
  })
  message: string;

  @ApiProperty({
    description: 'Mensaje por campo, para mostrarlo junto a cada uno.',
    example: {
      boxContent: 'boxContent 6.000 no coincide con 2 × 2.500 = 5.000',
    },
  })
  errors: Record<string, string>;
}
