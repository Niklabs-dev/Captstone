import {
  ApiProperty,
  ApiPropertyOptional,
  OmitType,
  PartialType,
} from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { UnitOfMeasure } from '../../generated/prisma/client.js';
import { PACKAGE_NAMES } from '../types/products.types.js';
import { PRODUCT_CONTENT_PATTERN } from '../utils/product-format.util.js';

// Cuerpos y filtros de la API de productos de inventario (SPRINT-5-T03).
// Los mensajes van en español y sin nombres internos: la vista los muestra.

function trimmed({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? value.trim().replace(/\s+/gu, ' ') : value;
}

function trimmedOrNull({ value }: { value: unknown }): unknown {
  if (typeof value !== 'string') return value;
  const text = value.trim().replace(/\s+/gu, ' ');
  return text === '' ? null : text;
}

// Recorta cada nombre alternativo; los vacíos se rechazan en el servicio.
function trimmedList({ value }: { value: unknown }): unknown {
  return Array.isArray(value)
    ? value.map((item: unknown) =>
        typeof item === 'string' ? item.trim().replace(/\s+/gu, ' ') : item,
      )
    : value;
}

function booleanQuery({ value }: { value: unknown }): unknown {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
}

function listQuery({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? [value] : value;
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
  @IsString({ message: 'El nombre debe ser texto' })
  @MinLength(1, { message: 'El nombre es obligatorio' })
  @MaxLength(120, { message: 'El nombre tiene hasta 120 caracteres' })
  name: string;

  @ApiProperty({
    description:
      'Sección de la plantilla de inventario (GET /products/sections).',
    example: 'COSTO PROTEÍNAS, QUESO SALSAS (SUBTOTAL)',
  })
  @Transform(trimmed)
  @IsString({ message: 'La sección debe ser texto' })
  @MinLength(1, { message: 'La sección es obligatoria' })
  @MaxLength(120, { message: 'La sección tiene hasta 120 caracteres' })
  section: string;

  @ApiPropertyOptional({
    description:
      'Fila de la plantilla donde se ubica el producto: una fila de artículo sin producto de la misma sección. Si se omite, se usa la sugerida (GET /products/template/suggestion).',
    example: '6f1a3c1e-2b4d-4c8e-9a7f-0d1e2f3a4b5c',
    type: String,
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID('4', { message: 'La fila de la plantilla no es válida' })
  templateRowId?: string;

  @ApiProperty({
    description: 'Unidad en que se cuenta el producto.',
    enum: UnitOfMeasure,
    example: UnitOfMeasure.KG,
  })
  @IsEnum(UnitOfMeasure, { message: 'La unidad debe ser KG, L o UNIT' })
  unit: UnitOfMeasure;

  @ApiPropertyOptional({
    description:
      'SKU que entrega el proveedor; opcional y único cuando existe.',
    example: 'SUB-123456',
    maxLength: 40,
    nullable: true,
    type: String,
  })
  @IsOptional()
  @Transform(trimmedOrNull)
  @ValidateIf((_, value) => value !== null)
  @IsString({ message: 'El SKU debe ser texto' })
  @MaxLength(40, { message: 'El SKU tiene hasta 40 caracteres' })
  sku?: string | null;

  @ApiPropertyOptional({
    description:
      'Otros nombres del mismo producto, para buscarlo; no se repiten entre productos.',
    example: ['Beef Steak', 'Carne Queso'],
    type: [String],
  })
  @IsOptional()
  @Transform(trimmedList)
  @IsArray({ message: 'Los nombres alternativos deben ser una lista' })
  @ArrayMaxSize(10, { message: 'Hasta 10 nombres alternativos' })
  @IsString({ each: true, message: 'Cada nombre alternativo debe ser texto' })
  alternativeNames?: string[];

  @ApiPropertyOptional({
    description: 'Nombre del paquete.',
    enum: PACKAGE_NAMES,
    example: 'bolsa',
    nullable: true,
    type: String,
  })
  @IsOptional()
  @Transform(trimmedOrNull)
  @ValidateIf((_, value) => value !== null)
  @IsIn(PACKAGE_NAMES, {
    message: `El nombre del paquete debe ser ${PACKAGE_NAMES.join(', ')}`,
  })
  packageName?: string | null;

  @ApiPropertyOptional({
    description:
      'Paquetes que trae una caja (entero mayor o igual a 1). Solo informativo: no se usa para calcular la caja.',
    example: 2,
    nullable: true,
    type: Number,
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Type(() => Number)
  @IsInt({ message: 'Los paquetes por caja deben ser un número entero' })
  @Min(1, { message: 'Los paquetes por caja deben ser 1 o más' })
  packagesPerBox?: number | null;

  @ApiPropertyOptional({
    description:
      'Contenido de un paquete en la unidad del producto, como texto decimal (entero en UNIT).',
    example: '2.5',
    nullable: true,
    type: String,
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString({ message: 'El contenido por paquete debe ser texto' })
  @Matches(PRODUCT_CONTENT_PATTERN, {
    message: `El contenido por paquete ${CONTENT_MESSAGE}`,
  })
  packageContent?: string | null;

  @ApiPropertyOptional({
    description:
      'Contenido de una caja, independiente del paquete: no se exige que sea paquetes × contenido por paquete (Pepperoni: 7.3 y 0.93).',
    example: '5',
    nullable: true,
    type: String,
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString({ message: 'El contenido por caja debe ser texto' })
  @Matches(PRODUCT_CONTENT_PATTERN, {
    message: `El contenido por caja ${CONTENT_MESSAGE}`,
  })
  boxContent?: string | null;

  @ApiPropertyOptional({
    description:
      'Se cuenta solo como cantidad suelta, sin cajas ni paquetes (Atún Preparado).',
    example: false,
    default: false,
  })
  @IsOptional()
  @IsBoolean({ message: '«Solo cantidad suelta» debe ser verdadero o falso' })
  looseOnly?: boolean;
}

// Editar no cambia la fila: para moverlo se usa PATCH /products/:id/move.
export class UpdateProductDto extends PartialType(
  OmitType(CreateProductDto, ['section', 'templateRowId'] as const),
) {}

export class MoveProductDto {
  @ApiProperty({
    description:
      'Fila de artículo sin producto a la que se mueve (de cualquier sección).',
    example: '6f1a3c1e-2b4d-4c8e-9a7f-0d1e2f3a4b5c',
    format: 'uuid',
  })
  @IsUUID('4', { message: 'La fila de la plantilla no es válida' })
  templateRowId: string;
}

export class UpdateTemplateRowDto {
  @ApiProperty({
    description:
      'Texto de la columna ARTÍCULO de una fila de artículo sin producto. Puede ser «<Vacío>».',
    example: 'Lata Pepsi',
    maxLength: 120,
  })
  @Transform(trimmed)
  @IsString({ message: 'El texto debe ser texto' })
  @MinLength(1, { message: 'El texto es obligatorio' })
  @MaxLength(120, { message: 'El texto tiene hasta 120 caracteres' })
  printedText: string;
}

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
    description: 'true lista solo los productos sin SKU.',
    example: true,
  })
  @IsOptional()
  @Transform(booleanQuery)
  @IsBoolean()
  missingSku?: boolean;

  @ApiPropertyOptional({
    description:
      'Busca por nombre, nombre alternativo o SKU, sin distinguir mayúsculas ni tildes.',
    example: 'fanta',
  })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(120)
  search?: string;
}

export class PlacementQueryDto {
  @ApiProperty({
    description: 'Sección de la plantilla.',
    example: 'COSTO PROTEÍNAS, QUESO SALSAS (SUBTOTAL)',
  })
  @Transform(trimmed)
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  section: string;

  @ApiProperty({
    description: 'Nombre del producto.',
    example: 'Carne Fajita (Beef Steak Saborizado)',
  })
  @Transform(trimmed)
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name: string;

  @ApiPropertyOptional({
    description: 'Nombres alternativos (se repite el parámetro).',
    example: ['Beef Steak'],
    type: [String],
  })
  @IsOptional()
  @Transform(listQuery)
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  alternativeNames?: string[];
}
