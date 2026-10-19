import { ApiProperty } from '@nestjs/swagger';
import {
  PAYSLIP_STATUSES,
  type PayslipCollection,
  type PayslipResponse,
  type PayslipStatusCode,
  type PayslipStore,
  type PayslipUploadPolicy,
  type PayslipWorker,
} from '../types/payroll.types.js';

export class PayslipStoreDto implements PayslipStore {
  @ApiProperty({
    description: 'ID del local (UUID).',
    example: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
  })
  id: string;

  @ApiProperty({
    description: 'Nombre del local.',
    example: 'Subway Melipilla Centro',
  })
  name: string;
}

export class PayslipWorkerDto implements PayslipWorker {
  @ApiProperty({
    description: 'ID del trabajador (UUID).',
    example: '3f8c2c1e-4a5b-4c6d-8e9f-0a1b2c3d4e5f',
  })
  id: string;

  @ApiProperty({
    description: 'Nombre y apellido del trabajador.',
    example: 'Ana Pérez',
  })
  name: string;

  @ApiProperty({
    description:
      'Local del trabajador; en una liquidación, el local al que pertenecía al cargarla.',
    type: PayslipStoreDto,
  })
  store: PayslipStoreDto;

  @ApiProperty({
    description: 'true si la cuenta del trabajador está activa.',
    example: true,
  })
  isActive: boolean;
}

// Liquidación con los metadatos de su archivo (SPRINT-2-T13).
export class PayslipResponseDto implements PayslipResponse {
  @ApiProperty({
    description: 'ID de la liquidación (UUID).',
    example: '6a2f1c3e-8b4d-4e5f-9a0b-1c2d3e4f5a6b',
  })
  id: string;

  @ApiProperty({
    description: 'Trabajador de la liquidación.',
    type: PayslipWorkerDto,
  })
  worker: PayslipWorkerDto;

  @ApiProperty({
    description: 'Mes de la remuneración (YYYY-MM).',
    example: '2026-09',
  })
  period: string;

  @ApiProperty({
    description: 'Nombre original del archivo subido.',
    example: 'liquidacion-2026-09.pdf',
  })
  fileName: string;

  @ApiProperty({ description: 'Tamaño en bytes.', example: 184320 })
  size: number;

  @ApiProperty({
    description:
      'Hash SHA-256 del archivo en hexadecimal, registrado al cargarlo.',
    example: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
  })
  sha256: string;

  @ApiProperty({
    description: 'Fecha y hora de carga (ISO 8601).',
    example: '2026-10-19T15:00:00.000Z',
  })
  createdAt: Date;

  @ApiProperty({
    description:
      'PENDING_SIGNATURE: cargada, no visible para el trabajador. PUBLISHED: publicada en su portal.',
    example: 'PENDING_SIGNATURE',
    enum: PAYSLIP_STATUSES,
  })
  status: PayslipStatusCode;

  @ApiProperty({
    description: 'Fecha de firma (YYYY-MM-DD); null mientras está pendiente.',
    example: null,
    nullable: true,
    type: String,
  })
  signedAt: string | null;

  @ApiProperty({
    description:
      'Fecha y hora de publicación (ISO 8601); null mientras está pendiente.',
    example: null,
    nullable: true,
    type: Date,
  })
  publishedAt: Date | null;

  @ApiProperty({
    description:
      'Revisión opaca de la liquidación; cambia con cada modificación.',
    example: '2026-10-19T15:00:00.000Z',
  })
  revision: string;

  @ApiProperty({
    description: 'true si el usuario actual puede publicarla.',
    example: true,
  })
  canPublish: boolean;
}

export class PayslipUploadPolicyDto implements PayslipUploadPolicy {
  @ApiProperty({
    description: 'Tamaño máximo por archivo, en bytes.',
    example: 26214400,
  })
  maxBytes: number;

  @ApiProperty({
    description: 'Tipos de archivo aceptados: solo PDF.',
    example: ['application/pdf'],
    type: [String],
  })
  allowedMimes: string[];

  @ApiProperty({
    description: 'true si el usuario actual puede cargar liquidaciones.',
    example: true,
  })
  canUpload: boolean;
}

// Gestión de liquidaciones del contador (SPRINT-2-T13).
export class PayslipCollectionDto implements PayslipCollection {
  @ApiProperty({
    description:
      'Liquidaciones, del período más reciente al más antiguo y por nombre del trabajador.',
    type: [PayslipResponseDto],
  })
  items: PayslipResponseDto[];

  @ApiProperty({
    description:
      'Selector de carga: trabajadores y supervisores activos con local asignado.',
    type: [PayslipWorkerDto],
  })
  workers: PayslipWorkerDto[];

  @ApiProperty({
    description: 'Reglas de carga para el usuario actual.',
    type: PayslipUploadPolicyDto,
  })
  policy: PayslipUploadPolicyDto;
}
