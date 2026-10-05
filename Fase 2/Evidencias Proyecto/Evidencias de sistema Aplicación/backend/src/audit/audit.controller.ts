import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ROLE } from '../auth/constants/roles.constants.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { AuditService } from './audit.service.js';
import { AuditLogPageResponseDto } from './dto/audit-log-response.dto.js';
import { ListAuditLogsQueryDto } from './dto/list-audit-logs-query.dto.js';
import type { AuditLogPage } from './types/audit.types.js';

// Consulta del registro de auditoría (SPRINT-1-T14): solo el administrador.
// Es de solo lectura; el registro no se modifica ni elimina por la API.
@ApiTags('audit')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Token ausente, inválido o expirado.' })
@Roles(ROLE.ADMINISTRADOR)
@Controller('audit-logs')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  @ApiOperation({
    summary:
      'Consulta el registro de auditoría, con filtros por local y rango de fechas',
  })
  @ApiOkResponse({
    description:
      'Operaciones con usuario responsable, fecha/hora, local y tipo, de la más reciente a la más antigua.',
    type: AuditLogPageResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'Filtro inválido: local que no es UUID, fecha inexistente o con formato distinto de YYYY-MM-DD, from posterior a to, o paginación fuera de rango.',
  })
  findAll(@Query() query: ListAuditLogsQueryDto): Promise<AuditLogPage> {
    return this.auditService.findAll(query);
  }
}
