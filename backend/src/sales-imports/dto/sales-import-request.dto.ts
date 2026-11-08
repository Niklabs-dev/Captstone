import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDefined,
  IsIn,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
  ValidateIf,
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
