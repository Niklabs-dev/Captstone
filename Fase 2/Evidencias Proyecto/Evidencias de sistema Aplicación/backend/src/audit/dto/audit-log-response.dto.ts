import { ApiProperty } from '@nestjs/swagger';
import type {
  AuditLogPage,
  AuditLogResponse,
  AuditLogStoreSummary,
  AuditLogUserSummary,
} from '../types/audit.types.js';

export class AuditLogUserSummaryDto implements AuditLogUserSummary {
  @ApiProperty({
    description: 'ID del usuario responsable (UUID).',
    example: '3f8c2c1e-4a5b-4c6d-8e9f-0a1b2c3d4e5f',
  })
  id: string;

  @ApiProperty({
    description: 'Correo del usuario responsable.',
    example: 'admin@moi-food.cl',
  })
  email: string;

  @ApiProperty({ description: 'Nombre del usuario.', example: 'Nicolás' })
  firstName: string;

  @ApiProperty({ description: 'Apellido del usuario.', example: 'Jiménez' })
  lastName: string;
}

export class AuditLogStoreSummaryDto implements AuditLogStoreSummary {
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

// Operación registrada en la auditoría (SPRINT-1-T14).
export class AuditLogResponseDto implements AuditLogResponse {
  @ApiProperty({
    description: 'ID correlativo del registro (entero serializado como texto).',
    example: '1024',
  })
  id: string;

  @ApiProperty({
    description: 'Tipo de operación.',
    example: 'USER_CREATED',
  })
  action: string;

  @ApiProperty({
    description: 'Tipo de entidad afectada (tabla o módulo).',
    example: 'users',
  })
  entityType: string;

  @ApiProperty({
    description: 'ID de la entidad afectada; null si no aplica.',
    example: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
    nullable: true,
    type: String,
  })
  entityId: string | null;

  @ApiProperty({
    description:
      'Detalle de la operación (sin datos sensibles como contraseñas); null si no tiene.',
    example: { email: 'juan.perez@moi-food.cl', roleCode: 'TRABAJADOR' },
    nullable: true,
    type: 'object',
    additionalProperties: true,
  })
  detail: Record<string, unknown> | null;

  @ApiProperty({
    description: 'Dirección IP de origen; null si no se registró.',
    example: '190.20.30.40',
    nullable: true,
    type: String,
  })
  ipAddress: string | null;

  @ApiProperty({
    description: 'User-agent del cliente; null si no se registró.',
    example: 'Mozilla/5.0 (X11; Linux x86_64)',
    nullable: true,
    type: String,
  })
  userAgent: string | null;

  @ApiProperty({
    description: 'Fecha y hora de la operación (ISO 8601, UTC).',
    example: '2026-10-05T14:30:00.000Z',
  })
  createdAt: Date;

  @ApiProperty({
    description:
      'Usuario responsable; null si no se identificó (ej. login fallido).',
    type: AuditLogUserSummaryDto,
    nullable: true,
  })
  user: AuditLogUserSummaryDto | null;

  @ApiProperty({
    description: 'Local de la operación; null en operaciones globales.',
    type: AuditLogStoreSummaryDto,
    nullable: true,
  })
  store: AuditLogStoreSummaryDto | null;
}

// Página de resultados: registros más recientes primero.
export class AuditLogPageResponseDto implements AuditLogPage {
  @ApiProperty({
    description: 'Registros de la página, del más reciente al más antiguo.',
    type: AuditLogResponseDto,
    isArray: true,
  })
  items: AuditLogResponseDto[];

  @ApiProperty({
    description: 'Total de registros que cumplen los filtros.',
    example: 137,
  })
  total: number;

  @ApiProperty({ description: 'Límite aplicado a la página.', example: 50 })
  limit: number;

  @ApiProperty({ description: 'Registros omitidos.', example: 0 })
  offset: number;
}
