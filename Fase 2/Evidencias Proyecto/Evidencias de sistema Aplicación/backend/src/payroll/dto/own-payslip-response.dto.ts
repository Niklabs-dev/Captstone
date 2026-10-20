import { ApiProperty } from '@nestjs/swagger';
import {
  INTEGRITY_STATUSES,
  type IntegrityStatus,
} from '../../documents/types/documents.types.js';
import type {
  OwnPayslip,
  OwnPayslipIntegrity,
  OwnPayslipList,
} from '../types/payroll.types.js';

// Liquidación publicada del trabajador autenticado (SPRINT-2-T15).
export class OwnPayslipDto implements OwnPayslip {
  @ApiProperty({
    description: 'ID de la liquidación (UUID).',
    example: '6a2f1c3e-8b4d-4e5f-9a0b-1c2d3e4f5a6b',
  })
  id: string;

  @ApiProperty({
    description: 'ID de la versión publicada del archivo (UUID).',
    example: '0b6a1c52-9a3e-4a8f-b1d4-2f6e8c9d7a10',
  })
  versionId: string;

  @ApiProperty({
    description: 'ID del trabajador autenticado (UUID).',
    example: '3f8c2c1e-4a5b-4c6d-8e9f-0a1b2c3d4e5f',
  })
  workerId: string;

  @ApiProperty({
    description: 'Mes de la remuneración (YYYY-MM).',
    example: '2026-09',
  })
  period: string;

  @ApiProperty({
    description: 'Siempre PUBLISHED: las pendientes de firma no se muestran.',
    example: 'PUBLISHED',
    enum: ['PUBLISHED'],
  })
  status: 'PUBLISHED';

  @ApiProperty({
    description: 'Nombre original del archivo.',
    example: 'liquidacion-2026-09.pdf',
  })
  fileName: string;

  @ApiProperty({
    description: 'Tipo del archivo.',
    example: 'application/pdf',
  })
  mime: string;

  @ApiProperty({ description: 'Tamaño en bytes.', example: 184320 })
  size: number;

  @ApiProperty({
    description:
      'Hash SHA-256 registrado al cargar la liquidación, en hexadecimal.',
    example: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
  })
  sha256: string;

  @ApiProperty({
    description: 'Fecha de firma (YYYY-MM-DD).',
    example: '2026-10-19',
  })
  signedAt: string;

  @ApiProperty({
    description: 'Fecha y hora de publicación (ISO 8601).',
    example: '2026-10-19T16:00:00.000Z',
  })
  publishedAt: Date;
}

export class OwnPayslipListDto implements OwnPayslipList {
  @ApiProperty({
    description:
      'Liquidaciones publicadas del trabajador, del período más reciente al más antiguo.',
    type: [OwnPayslipDto],
  })
  items: OwnPayslipDto[];
}

// Resultado de la verificación de integridad de una liquidación propia.
export class OwnPayslipIntegrityDto implements OwnPayslipIntegrity {
  @ApiProperty({
    description: 'ID de la liquidación verificada (UUID).',
    example: '6a2f1c3e-8b4d-4e5f-9a0b-1c2d3e4f5a6b',
  })
  payslipId: string;

  @ApiProperty({
    description: 'ID de la versión verificada (UUID).',
    example: '0b6a1c52-9a3e-4a8f-b1d4-2f6e8c9d7a10',
  })
  versionId: string;

  @ApiProperty({
    description: 'ID del trabajador dueño de la liquidación (UUID).',
    example: '3f8c2c1e-4a5b-4c6d-8e9f-0a1b2c3d4e5f',
  })
  workerId: string;

  @ApiProperty({
    description:
      'VALID: el archivo coincide con el hash registrado; ALTERED: fue modificado; MISSING: no está en el almacenamiento.',
    example: 'VALID',
    enum: INTEGRITY_STATUSES,
  })
  status: IntegrityStatus;

  @ApiProperty({
    description: 'true solo si status es VALID.',
    example: true,
  })
  valid: boolean;

  @ApiProperty({
    description: 'Hash SHA-256 registrado al cargar la liquidación.',
    example: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
  })
  expectedHash: string;

  @ApiProperty({
    description:
      'Hash SHA-256 recalculado del archivo guardado; null si no está en el almacenamiento.',
    example: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
    nullable: true,
    type: String,
  })
  actualHash: string | null;

  @ApiProperty({
    description: 'Fecha y hora de la verificación (ISO 8601).',
    example: '2026-10-19T17:00:00.000Z',
  })
  checkedAt: Date;
}
