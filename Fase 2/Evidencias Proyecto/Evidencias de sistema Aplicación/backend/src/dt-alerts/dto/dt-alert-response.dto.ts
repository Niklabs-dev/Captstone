import { ApiProperty } from '@nestjs/swagger';
import {
  DT_ALERT_STATUSES,
  type DtAlert,
  type DtAlertCollection,
  type DtAlertStatus,
  type DtAlertStore,
  type DtAlertWorker,
  type DtRegistrationResponse,
} from '../types/dt-alerts.types.js';

export class DtAlertWorkerDto implements DtAlertWorker {
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
}

export class DtAlertStoreDto implements DtAlertStore {
  @ApiProperty({
    description: 'ID del local (UUID).',
    example: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
  })
  id: string;

  @ApiProperty({
    description: 'Nombre del local.',
    example: 'Subway Melipilla',
  })
  name: string;
}

export class DtAlertDto implements DtAlert {
  @ApiProperty({
    description:
      'ID de la alerta (UUID); coincide con el del documento, del que se deriva.',
    example: '5c1f3a7e-2b4d-4e8a-9f60-1d2c3b4a5e6f',
  })
  id: string;

  @ApiProperty({
    description: 'ID del documento pendiente de registrar (UUID).',
    example: '5c1f3a7e-2b4d-4e8a-9f60-1d2c3b4a5e6f',
  })
  documentId: string;

  @ApiProperty({
    description: 'Tipo del documento que exige registro en la DT.',
    example: 'CONTRATO',
  })
  documentType: string;

  @ApiProperty({
    description: 'Título del documento.',
    example: 'Contrato indefinido 2026',
  })
  contractTitle: string;

  @ApiProperty({ description: 'Trabajador titular.', type: DtAlertWorkerDto })
  worker: DtAlertWorkerDto;

  @ApiProperty({ description: 'Local del documento.', type: DtAlertStoreDto })
  store: DtAlertStoreDto;

  @ApiProperty({
    description:
      'Último día del plazo de 15 días para registrarlo (YYYY-MM-DD).',
    example: '2026-10-16',
  })
  deadline: string;

  @ApiProperty({
    description:
      'Días corridos hasta el vencimiento, en hora de Chile: 0 el último día y negativo si ya venció.',
    example: 3,
  })
  daysRemaining: number;

  @ApiProperty({
    description: 'UPCOMING si el plazo no ha vencido; OVERDUE si venció.',
    enum: DT_ALERT_STATUSES,
    example: 'UPCOMING',
  })
  status: DtAlertStatus;

  @ApiProperty({
    description:
      'Revisión opaca del documento; se envía al confirmar el registro.',
    example: '2026-10-17T15:00:00.000Z',
  })
  revision: string;

  @ApiProperty({
    description: 'true si el usuario puede confirmar el registro.',
    example: true,
  })
  canRegister: boolean;
}

export class DtAlertCollectionDto implements DtAlertCollection {
  @ApiProperty({
    description:
      'Documentos pendientes de registro, primero los vencidos y luego los más próximos a vencer.',
    type: [DtAlertDto],
  })
  items: DtAlertDto[];

  @ApiProperty({
    description: 'Fecha y hora del cálculo de los días restantes (ISO 8601).',
    example: '2026-10-17T15:00:00.000Z',
  })
  calculatedAt: Date;
}

export class DtRegistrationResponseDto implements DtRegistrationResponse {
  @ApiProperty({
    description: 'ID de la alerta resuelta (UUID).',
    example: '5c1f3a7e-2b4d-4e8a-9f60-1d2c3b4a5e6f',
  })
  alertId: string;

  @ApiProperty({
    description: 'ID del documento registrado (UUID).',
    example: '5c1f3a7e-2b4d-4e8a-9f60-1d2c3b4a5e6f',
  })
  documentId: string;

  @ApiProperty({
    description: 'ID del local del documento (UUID).',
    example: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
  })
  storeId: string;

  @ApiProperty({
    description: 'Siempre REGISTERED.',
    enum: ['REGISTERED'],
    example: 'REGISTERED',
  })
  status: 'REGISTERED';

  @ApiProperty({
    description: 'Fecha y hora en que se marcó el registro (ISO 8601).',
    example: '2026-10-17T16:00:00.000Z',
  })
  registeredAt: Date;
}
