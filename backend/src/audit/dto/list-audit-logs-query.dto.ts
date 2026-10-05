import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Matches, Max, Min } from 'class-validator';

export const AUDIT_LOGS_DEFAULT_LIMIT = 50;
export const AUDIT_LOGS_MAX_LIMIT = 200;

const DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;

// Filtros y paginación de la consulta de auditoría (SPRINT-1-T14). Las fechas
// son días de negocio en la zona horaria de Chile (America/Santiago).
export class ListAuditLogsQueryDto {
  @ApiPropertyOptional({
    description: 'Filtra por local (UUID).',
    example: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
  })
  @IsOptional()
  @IsUUID()
  storeId?: string;

  @ApiPropertyOptional({
    description:
      'Fecha inicial (YYYY-MM-DD, inclusive), interpretada en la hora de Chile.',
    example: '2026-10-01',
  })
  @IsOptional()
  @Matches(DATE_FORMAT, { message: 'from debe tener el formato YYYY-MM-DD' })
  from?: string;

  @ApiPropertyOptional({
    description:
      'Fecha final (YYYY-MM-DD, inclusive), interpretada en la hora de Chile.',
    example: '2026-10-05',
  })
  @IsOptional()
  @Matches(DATE_FORMAT, { message: 'to debe tener el formato YYYY-MM-DD' })
  to?: string;

  @ApiPropertyOptional({
    description: `Cantidad máxima de registros a devolver (1 a ${AUDIT_LOGS_MAX_LIMIT}).`,
    example: AUDIT_LOGS_DEFAULT_LIMIT,
    default: AUDIT_LOGS_DEFAULT_LIMIT,
    minimum: 1,
    maximum: AUDIT_LOGS_MAX_LIMIT,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(AUDIT_LOGS_MAX_LIMIT)
  limit: number = AUDIT_LOGS_DEFAULT_LIMIT;

  @ApiPropertyOptional({
    description: 'Cantidad de registros a omitir (para paginar).',
    example: 0,
    default: 0,
    minimum: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset: number = 0;
}
