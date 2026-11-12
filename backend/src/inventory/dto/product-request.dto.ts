import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { UnitOfMeasure } from '../../generated/prisma/client.js';
import { PRODUCT_CONTENT_PATTERN } from '../utils/product-format.util.js';

// Cuerpos y filtros de la API de productos de inventario (SPRINT-5-T03).

function trimmed({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? value.trim().replace(/\s+/gu, ' ') : value;
}

function trimmedOrNull({ value }: { value: unknown }): unknown {
  if (typeof value !== 'string') return value;
  const text = value.trim().replace(/\s+/gu, ' ');
  return text === '' ? null : text;
}

function booleanQuery({ value }: { value: unknown }): unknown {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
}

const CONTENT_MESSAGE =
  'debe ser un número mayor que 0 con hasta 3 decimales, con punto (2.5)';

export class CreateProductDto {
  @ApiProperty({
    description: 'Nombre del producto; no se puede repetir.',
    example: 'Carne Fajita (Beef Steak Saborizado)',
    maxLength: 120,
  })
  @Transform(trimmed)
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name: string;

  @ApiProperty({
    description:
      'Sección de la plantilla de inventario (GET /products/sections). El producto ocupa una fila «<Vacío>» libre de la sección o, si no queda ninguna, una fila nueva al final de ella.',
    example: 'COSTO PROTEÍNAS, QUESO SALSAS (SUBTOTAL)',
  })
  @Transform(trimmed)
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  section: string;

  @ApiProperty({
    description: 'Unidad en que se cuenta el producto.',
    enum: UnitOfMeasure,
    example: UnitOfMeasure.KG,
  })
  @IsEnum(UnitOfMeasure)
  unit: UnitOfMeasure;

  @ApiPropertyOptional({
    description:
      'SKU que entrega el proveedor; opcional y único cuando existe.',
    example: 'SUB-123456',
    maxLength: 40,
    nullable: true,
  })
  @IsOptional()
  @Transform(trimmedOrNull)
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(40)
  sku?: string | null;

  @ApiPropertyOptional({
    description: 'Otros nombres del mismo producto, para buscarlo.',
    example: ['Beef Steak', 'Carne Queso'],
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(120, { each: true })
  alternativeNames?: string[];

  @ApiPropertyOptional({
    description: 'Nombre del paquete (bolsa, paquete, botella o pack).',
    example: 'bolsa',
    maxLength: 30,
    nullable: true,
  })
  @IsOptional()
  @Transform(trimmedOrNull)
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(30)
  packageName?: string | null;

  @ApiPropertyOptional({
    description: 'Paquetes que trae una caja (entero mayor o igual a 1).',
    example: 2,
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  packagesPerBox?: number | null;

  @ApiPropertyOptional({
    description:
      'Contenido de un paquete en la unidad del producto, como texto decimal.',
    example: '2.5',
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @Matches(PRODUCT_CONTENT_PATTERN, {
    message: `packageContent ${CONTENT_MESSAGE}`,
  })
  packageContent?: string | null;

  @ApiPropertyOptional({
    description:
      'Contenido de una caja. Si se informan packagesPerBox y packageContent se calcula, y un valor distinto se rechaza (400).',
    example: '5',
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @Matches(PRODUCT_CONTENT_PATTERN, {
    message: `boxContent ${CONTENT_MESSAGE}`,
  })
  boxContent?: string | null;

  @ApiPropertyOptional({
    description:
      'Se cuenta solo como cantidad suelta, sin cajas ni paquetes (Atún Preparado).',
    example: false,
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  looseOnly?: boolean;
}

export class UpdateProductDto extends PartialType(CreateProductDto) {}

export class ListProductsQueryDto {
  @ApiPropertyOptional({
    description: 'Filtra por sección de la plantilla.',
    example: 'COSTO DE BEBIDAS',
  })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(120)
  section?: string;

  @ApiPropertyOptional({
    description:
      'Filtra por estado. El SUPERVISOR solo recibe productos activos.',
    example: true,
  })
  @IsOptional()
  @Transform(booleanQuery)
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    description: 'true lista solo los productos «Sin formato».',
    example: true,
  })
  @IsOptional()
  @Transform(booleanQuery)
  @IsBoolean()
  missingFormat?: boolean;

  @ApiPropertyOptional({
    description: 'Busca por nombre o por nombre alternativo.',
    example: 'fanta',
  })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(120)
  search?: string;
}
