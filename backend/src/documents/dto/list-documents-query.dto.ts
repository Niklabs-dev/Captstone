import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsUUID } from 'class-validator';
import {
  UPLOADABLE_DOCUMENT_TYPES,
  type UploadableDocumentType,
} from '../types/documents.types.js';

// Filtros opcionales del listado de documentos (SPRINT-2-T06). Para un
// trabajador o supervisor el listado siempre se limita a sus propios
// documentos.
export class ListDocumentsQueryDto {
  @ApiPropertyOptional({
    description:
      'Filtra por trabajador (UUID). Un trabajador o supervisor solo puede indicar su propio ID.',
    example: '3f8c2c1e-4a5b-4c6d-8e9f-0a1b2c3d4e5f',
  })
  @IsOptional()
  @IsUUID()
  workerId?: string;

  @ApiPropertyOptional({
    description: 'Filtra por local (UUID).',
    example: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
  })
  @IsOptional()
  @IsUUID()
  storeId?: string;

  @ApiPropertyOptional({
    description: 'Filtra por tipo de documento.',
    example: 'CONTRATO',
    enum: UPLOADABLE_DOCUMENT_TYPES,
  })
  @IsOptional()
  @IsIn(UPLOADABLE_DOCUMENT_TYPES)
  documentTypeCode?: UploadableDocumentType;
}
