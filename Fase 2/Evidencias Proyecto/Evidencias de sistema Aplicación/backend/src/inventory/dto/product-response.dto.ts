import { ApiProperty } from '@nestjs/swagger';
import {
  InventoryTemplateRowKind,
  UnitOfMeasure,
} from '../../generated/prisma/client.js';

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
    description: 'Fila de la plantilla que ocupa, o null sin fila.',
    example: '6f1a3c1e-2b4d-4c8e-9a7f-0d1e2f3a4b5c',
    nullable: true,
    type: String,
  })
  templateRowId: string | null;

  @ApiProperty({
    description: 'Sección de la plantilla, o null sin fila.',
    example: 'COSTO DE BEBIDAS',
    nullable: true,
    type: String,
  })
  section: string | null;

  @ApiProperty({
    description: 'Número de fila de la plantilla (2 a 183), o null sin fila.',
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
    description:
      'Filas de artículo sin producto (artículos pendientes y «<Vacío>») de la sección.',
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
      name: 'Ya existe un producto llamado «Lata Coca Cola»',
    },
  })
  errors: Record<string, string>;
}

export class TemplateRowSummaryDto {
  @ApiProperty({
    description: 'ID de la fila.',
    example: '6f1a3c1e-2b4d-4c8e-9a7f-0d1e2f3a4b5c',
  })
  id: string;

  @ApiProperty({
    description: 'Número de fila en la hoja (fijo).',
    example: 4,
  })
  position: number;

  @ApiProperty({
    description: 'Tipo de fila: artículo, sin texto o sección.',
    enum: InventoryTemplateRowKind,
    example: InventoryTemplateRowKind.ITEM,
  })
  kind: InventoryTemplateRowKind;

  @ApiProperty({
    description: 'Texto de la columna ARTÍCULO; null en las filas sin texto.',
    example: 'Carne Fajita (Beef Steak Saborizado)',
    nullable: true,
    type: String,
  })
  printedText: string | null;

  @ApiProperty({
    description: 'Sección que cierra el grupo de la fila.',
    example: 'COSTO PROTEÍNAS, QUESO SALSAS (SUBTOTAL)',
  })
  section: string;

  @ApiProperty({
    description: 'true en las filas de artículo «<Vacío>».',
    example: false,
  })
  isEmptyRow: boolean;
}

export class TemplateRowResponseDto extends TemplateRowSummaryDto {
  @ApiProperty({
    description:
      'Producto que ocupa la fila, o null. Al SUPERVISOR solo se le informan los activos.',
    type: ProductResponseDto,
    nullable: true,
  })
  product: ProductResponseDto | null;
}

export class PlacementSuggestionDto {
  @ApiProperty({
    description: 'Fila sugerida, o null si no queda ninguna libre.',
    type: TemplateRowSummaryDto,
    nullable: true,
  })
  row: TemplateRowSummaryDto | null;

  @ApiProperty({
    description:
      'MATCH: coincide con el nombre o un nombre alternativo; EMPTY: fila «<Vacío>» libre; null: sin fila libre.',
    enum: ['MATCH', 'EMPTY'],
    nullable: true,
    type: String,
    example: 'MATCH',
  })
  reason: 'MATCH' | 'EMPTY' | null;
}
