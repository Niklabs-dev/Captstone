import { ApiProperty } from '@nestjs/swagger';
import type {
  DocumentResponse,
  DocumentVersionResponse,
} from '../types/documents.types.js';

export class DocumentVersionResponseDto implements DocumentVersionResponse {
  @ApiProperty({
    description: 'ID de la versión (UUID).',
    example: '0b6a1c52-9a3e-4a8f-b1d4-2f6e8c9d7a10',
  })
  id: string;

  @ApiProperty({
    description: 'Número de versión, correlativo desde 1.',
    example: 2,
  })
  number: number;

  @ApiProperty({
    description: 'Nombre original del archivo subido.',
    example: 'contrato-firmado.pdf',
  })
  fileName: string;

  @ApiProperty({
    description: 'Tipo real del archivo, detectado por su contenido.',
    example: 'application/pdf',
    enum: ['application/pdf', 'image/png', 'image/jpeg'],
  })
  mime: string;

  @ApiProperty({ description: 'Tamaño en bytes.', example: 184320 })
  size: number;

  @ApiProperty({
    description:
      'Hash SHA-256 del archivo en hexadecimal; permite verificar su integridad.',
    example: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
  })
  sha256: string;

  @ApiProperty({
    description: 'Motivo del cambio; null si no se indicó.',
    example: 'Versión firmada por ambas partes',
    nullable: true,
    type: String,
  })
  changeNote: string | null;

  @ApiProperty({
    description: 'Fecha y hora de carga (ISO 8601).',
    example: '2026-10-17T15:00:00.000Z',
  })
  createdAt: Date;

  @ApiProperty({
    description: 'Nombre de quien subió la versión.',
    example: 'Administrador Moi-food',
  })
  uploadedBy: string;
}

// Documento laboral con su versión vigente (la recién cargada).
export class DocumentResponseDto implements DocumentResponse {
  @ApiProperty({
    description:
      'ID del documento (UUID); se usa como documentId para cargar nuevas versiones.',
    example: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  })
  id: string;

  @ApiProperty({
    description: 'ID del trabajador dueño del documento (UUID).',
    example: '3f8c2c1e-4a5b-4c6d-8e9f-0a1b2c3d4e5f',
  })
  workerId: string;

  @ApiProperty({
    description: 'ID del local del trabajador al que queda asociado (UUID).',
    example: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
  })
  storeId: string;

  @ApiProperty({
    description: 'Código del tipo de documento.',
    example: 'CONTRATO',
  })
  type: string;

  @ApiProperty({
    description: 'Título del documento.',
    example: 'Contrato indefinido 2026',
  })
  title: string;

  @ApiProperty({
    description: 'Fecha de celebración (YYYY-MM-DD); null si no se indicó.',
    example: '2026-10-01',
    nullable: true,
    type: String,
  })
  issuedAt: string | null;

  @ApiProperty({
    description:
      'Fecha hasta la que debe conservarse (YYYY-MM-DD, art. 9 bis CT).',
    example: '2031-10-01',
  })
  retainUntil: string;

  @ApiProperty({
    description:
      'Vencimiento del plazo de 15 días para registrar en la Dirección del Trabajo (YYYY-MM-DD); null si el tipo no lo exige.',
    example: '2026-10-16',
    nullable: true,
    type: String,
  })
  dtRegistrationDueAt: string | null;

  @ApiProperty({
    description: 'Fecha de creación del documento (ISO 8601).',
    example: '2026-10-17T15:00:00.000Z',
  })
  createdAt: Date;

  @ApiProperty({
    description: 'Versión vigente del documento.',
    type: DocumentVersionResponseDto,
  })
  latestVersion: DocumentVersionResponseDto;
}
