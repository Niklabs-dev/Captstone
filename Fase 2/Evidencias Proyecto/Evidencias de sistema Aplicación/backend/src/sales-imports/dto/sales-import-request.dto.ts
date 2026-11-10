import { ApiProperty } from '@nestjs/swagger';
import { plainToInstance, Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDefined,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsUUID,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { IsCalendarDate } from '../../tips/validators/calendar-date.validator.js';

// DTOs de entrada de la importación diaria de ventas MrComanda
// (SPRINT-4R-T10).

// Solo para Swagger: muestra el selector de archivo del multipart. El archivo
// llega por req.file (Multer), no por el cuerpo validado.
export class PreviewSalesImportFormDto {
  @ApiProperty({
    description:
      '«Informe de Ventas Diario» exportado desde MrComanda (.xlsx, máximo 5 MB). Se valida por su contenido, no por su nombre ni por el tipo declarado.',
    type: 'string',
    format: 'binary',
  })
  file: unknown;
}

export class ConfirmSalesImportDto {
  @ApiProperty({
    description:
      'ID de la versión vigente que esta confirmación reemplaza (activeImport.id de la vista previa), o null si no había ninguna. Si la vigente cambió desde la vista previa, responde 409: así una corrección siempre se confirma de forma explícita.',
    example: null,
    type: String,
    format: 'uuid',
    nullable: true,
  })
  @IsDefined({
    message:
      'expectedActiveImportId es obligatorio: envía el ID de la versión vigente que se reemplaza o null',
  })
  @ValidateIf(
    (dto: ConfirmSalesImportDto) => dto.expectedActiveImportId !== null,
  )
  @IsUUID(undefined, {
    message: 'expectedActiveImportId debe ser un UUID válido o null',
  })
  expectedActiveImportId: string | null;
}

export class ListSalesImportsQueryDto {
  @ApiProperty({
    description: 'Filtra por local.',
    example: '1010021e-9bab-42d5-851c-417e9e2503bf',
    required: false,
  })
  @IsOptional()
  @IsUUID(undefined, { message: 'storeId debe ser un UUID válido' })
  storeId?: string;

  @ApiProperty({
    description: 'Fecha de negocio desde (YYYY-MM-DD, inclusive).',
    example: '2026-11-01',
    required: false,
  })
  @IsOptional()
  @IsCalendarDate()
  from?: string;

  @ApiProperty({
    description: 'Fecha de negocio hasta (YYYY-MM-DD, inclusive).',
    example: '2026-11-30',
    required: false,
  })
  @IsOptional()
  @IsCalendarDate()
  to?: string;

  @ApiProperty({
    description: 'Filtra por estado.',
    enum: ['PENDING', 'ACTIVE', 'SUPERSEDED'],
    required: false,
    example: 'ACTIVE',
  })
  @IsOptional()
  @IsIn(['PENDING', 'ACTIVE', 'SUPERSEDED'], {
    message: 'status debe ser PENDING, ACTIVE o SUPERSEDED',
  })
  status?: 'PENDING' | 'ACTIVE' | 'SUPERSEDED';

  @ApiProperty({
    description: 'Máximo de resultados (1 a 200, por defecto 100).',
    example: 100,
    required: false,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit debe ser un entero' })
  @Min(1, { message: 'limit debe ser al menos 1' })
  @Max(200, { message: 'limit no puede superar 200' })
  limit?: number;
}

// Resolución manual de lo que la vista previa no identificó (SPRINT-4A-T18).
// Nada se adivina: el administrador elige el local y el medio de cada línea
// sin alias, o la omite si su monto es 0. «remember» guarda la elección para
// próximas cargas (ID Subway del local o alias del medio).

export const LINE_RESOLUTION_ACTIONS = ['ASSIGN', 'SKIP'] as const;
export type LineResolutionAction = (typeof LINE_RESOLUTION_ACTIONS)[number];

// Las líneas de «Medios de pago» de un reporte diario son pocas; el límite
// solo acota el cuerpo.
const MAX_LINE_RESOLUTIONS = 50;

export class SalesImportStoreResolutionDto {
  @ApiProperty({
    description:
      'Local activo elegido a mano porque el ID Subway del archivo no identificó uno.',
    example: '1010021e-9bab-42d5-851c-417e9e2503bf',
    format: 'uuid',
  })
  @IsUUID(undefined, { message: 'store.storeId debe ser un UUID válido' })
  storeId: string;

  @ApiProperty({
    description:
      'Recordar para próximas cargas: asigna el ID Subway del archivo al local elegido. Solo si el archivo trae un ID Subway y el local no tiene uno (nunca se sobrescribe).',
    example: true,
  })
  @IsBoolean({ message: 'store.remember debe ser true o false' })
  remember: boolean;
}

export class SalesImportLineResolutionDto {
  @ApiProperty({
    description:
      'Posición de la línea sin alias en «Medios de pago» (lineNumber de la vista previa).',
    example: 4,
  })
  @IsInt({ message: 'lines.lineNumber debe ser un entero' })
  @Min(1, { message: 'lines.lineNumber debe ser al menos 1' })
  lineNumber: number;

  @ApiProperty({
    description:
      'ASSIGN asocia la línea a un medio activo del catálogo; SKIP la omite (solo si su monto es 0).',
    enum: LINE_RESOLUTION_ACTIONS,
    example: 'SKIP',
  })
  @IsIn(LINE_RESOLUTION_ACTIONS, {
    message: 'lines.action debe ser ASSIGN o SKIP',
  })
  action: LineResolutionAction;

  @ApiProperty({
    description:
      'Medio del catálogo para ASSIGN (obligatorio); debe omitirse o ser null en SKIP.',
    example: 'b9000000-0000-4000-8000-000000000004',
    format: 'uuid',
    type: String,
    nullable: true,
    required: false,
  })
  @ValidateIf(
    (line: SalesImportLineResolutionDto) =>
      line.action === 'ASSIGN' ||
      (line.paymentMethodId !== undefined && line.paymentMethodId !== null),
  )
  @IsUUID(undefined, {
    message:
      'lines.paymentMethodId debe ser el UUID de un medio en ASSIGN y omitirse en SKIP',
  })
  paymentMethodId?: string | null;

  @ApiProperty({
    description:
      'Recordar para próximas cargas: crea el alias de la etiqueta hacia el medio elegido. Solo en ASSIGN.',
    example: false,
  })
  @IsBoolean({ message: 'lines.remember debe ser true o false' })
  remember: boolean;
}

export class SalesImportResolutionDto {
  @ApiProperty({
    description:
      'ID de la versión vigente que esta confirmación reemplaza en el local resuelto (activeImport de la vista previa o de la opción de local elegida), o null si no había ninguna. Si cambió, responde 409.',
    example: null,
    type: String,
    format: 'uuid',
    nullable: true,
  })
  @IsDefined({
    message:
      'expectedActiveImportId es obligatorio: envía el ID de la versión vigente que se reemplaza o null',
  })
  @ValidateIf(
    (dto: SalesImportResolutionDto) => dto.expectedActiveImportId !== null,
  )
  @IsUUID(undefined, {
    message: 'expectedActiveImportId debe ser un UUID válido o null',
  })
  expectedActiveImportId: string | null;

  @ApiProperty({
    description:
      'Local elegido a mano; obligatorio solo si la vista previa no identificó el local (omitir o null en otro caso).',
    type: SalesImportStoreResolutionDto,
    nullable: true,
    required: false,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => SalesImportStoreResolutionDto)
  store?: SalesImportStoreResolutionDto | null;

  @ApiProperty({
    description:
      'Una entrada por cada línea sin alias de la vista previa (ni más ni menos).',
    type: SalesImportLineResolutionDto,
    isArray: true,
  })
  @IsArray({ message: 'lines debe ser un arreglo' })
  @ArrayMaxSize(MAX_LINE_RESOLUTIONS, {
    message: `lines admite a lo más ${MAX_LINE_RESOLUTIONS} entradas`,
  })
  @ValidateNested({ each: true })
  @Type(() => SalesImportLineResolutionDto)
  lines: SalesImportLineResolutionDto[];
}

// El multipart solo transporta texto: la resolución llega como JSON en el
// campo resolution y se convierte aquí para validarla como objeto anidado.
// Un JSON inválido queda como texto y falla en @IsObject (400).
function parseResolution({ value }: { value: unknown }): unknown {
  if (typeof value !== 'string') return value;
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === 'object' &&
      parsed !== null &&
      !Array.isArray(parsed)
      ? plainToInstance(SalesImportResolutionDto, parsed)
      : value;
  } catch {
    return value;
  }
}

const RESOLUTION_EXAMPLE =
  '{"expectedActiveImportId":null,"store":{"storeId":"1010021e-9bab-42d5-851c-417e9e2503bf","remember":true},"lines":[{"lineNumber":4,"action":"SKIP","remember":false}]}';

// Solo para Swagger: el formulario multipart de
// POST /sales-imports/confirm-with-resolution. El archivo llega por req.file
// (Multer) y la resolución se valida con ConfirmResolvedSalesImportBodyDto.
export class ConfirmResolvedSalesImportFormDto {
  @ApiProperty({
    description:
      'El mismo «Informe de Ventas Diario» (.xlsx, máximo 5 MB) de la vista previa: se vuelve a leer y validar en el servidor.',
    type: 'string',
    format: 'binary',
  })
  file: unknown;

  @ApiProperty({
    description:
      'Resolución manual en JSON (esquema SalesImportResolutionDto).',
    type: 'string',
    example: RESOLUTION_EXAMPLE,
  })
  resolution: string;
}

// Campos de texto del multipart: la resolución llega como JSON en el campo
// resolution y se valida como objeto anidado.
export class ConfirmResolvedSalesImportBodyDto {
  @ApiProperty({
    description:
      'Resolución manual en JSON (esquema SalesImportResolutionDto).',
    type: 'string',
    example: RESOLUTION_EXAMPLE,
  })
  @Transform(parseResolution)
  @IsObject({
    message: 'resolution debe ser un JSON con la resolución manual',
  })
  @ValidateNested()
  resolution: SalesImportResolutionDto;
}
