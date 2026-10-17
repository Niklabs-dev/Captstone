import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  UPLOADABLE_DOCUMENT_TYPES,
  type UploadableDocumentType,
} from '../types/documents.types.js';

function trim({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

// Campos de texto del formulario multipart de carga (SPRINT-2-T05). El
// archivo llega aparte (campo "file"), lo procesa Multer.
export class UploadDocumentDto {
  @ApiProperty({
    description:
      'ID (UUID) del trabajador dueño del documento. Debe ser un TRABAJADOR o SUPERVISOR con local asignado; el documento queda asociado a ese local.',
    example: '3f8c2c1e-4a5b-4c6d-8e9f-0a1b2c3d4e5f',
  })
  @IsUUID()
  workerId: string;

  @ApiProperty({
    description: 'Código del tipo de documento laboral.',
    example: 'CONTRATO',
    enum: UPLOADABLE_DOCUMENT_TYPES,
  })
  @IsIn(UPLOADABLE_DOCUMENT_TYPES)
  documentTypeCode: UploadableDocumentType;

  @ApiPropertyOptional({
    description:
      'Título del documento. Obligatorio al crear un documento nuevo; en una nueva versión se ignora (se mantiene el título original).',
    example: 'Contrato indefinido 2026',
    maxLength: 160,
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  title?: string;

  @ApiPropertyOptional({
    description:
      'Fecha de celebración (firma) en formato YYYY-MM-DD. Base de los plazos de conservación (5 años) y de registro en la DT (15 días); si se omite, se usa la fecha de carga. Solo se usa al crear un documento nuevo.',
    example: '2026-10-01',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'issuedAt debe tener el formato YYYY-MM-DD',
  })
  issuedAt?: string;

  @ApiPropertyOptional({
    description:
      'ID (UUID) de un documento existente del mismo trabajador y tipo. Si se envía, la carga crea una nueva versión y las anteriores quedan inmutables.',
    example: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  })
  @IsOptional()
  @IsUUID()
  documentId?: string;

  @ApiPropertyOptional({
    description: 'Motivo del cambio de la versión (opcional).',
    example: 'Versión firmada por ambas partes',
    maxLength: 255,
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  changeNote?: string;
}

// Solo para Swagger: el formulario completo, con el archivo, para que
// /api/docs muestre el selector de archivo.
export class UploadDocumentFormDto extends UploadDocumentDto {
  @ApiProperty({
    description:
      'Archivo del documento: PDF, PNG o JPEG, hasta DOCUMENTS_MAX_SIZE_MB (25 MB por defecto). El tipo se valida por el contenido, no por la extensión.',
    example: 'contrato.pdf',
    type: 'string',
    format: 'binary',
  })
  file: string;
}
