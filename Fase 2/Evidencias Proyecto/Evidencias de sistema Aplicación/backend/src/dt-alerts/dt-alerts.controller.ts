import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AUDIT_ACTION } from '../audit/constants/audit-actions.constants.js';
import { Audited } from '../audit/decorators/audited.decorator.js';
import { ROLE } from '../auth/constants/roles.constants.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import type { AuthUser } from '../auth/types/auth.types.js';
import { DtAlertsService } from './dt-alerts.service.js';
import {
  DtAlertCollectionDto,
  DtRegistrationResponseDto,
} from './dto/dt-alert-response.dto.js';
import { RegisterDtDto } from './dto/register-dt.dto.js';
import type {
  DtAlertCollection,
  DtRegistrationResponse,
} from './types/dt-alerts.types.js';

// Alertas del plazo de registro en la Dirección del Trabajo (SPRINT-2-T08),
// solo para el administrador: es quien carga los documentos laborales.
@ApiTags('dt-alerts')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Token ausente, inválido o expirado.' })
@Roles(ROLE.ADMINISTRADOR)
@Controller('dt-alerts')
export class DtAlertsController {
  constructor(private readonly dtAlertsService: DtAlertsService) {}

  @Get()
  @ApiOperation({
    summary:
      'Lista los documentos pendientes de registrar en la DT, vencidos y próximos a vencer',
    description:
      'Contratos, anexos y finiquitos sin registro en la Dirección del Trabajo, con su fecha límite (15 días corridos desde la celebración o la carga), días restantes en hora de Chile y estado UPCOMING u OVERDUE. Primero los vencidos y luego los más próximos a vencer.',
  })
  @ApiOkResponse({
    description: 'Alertas pendientes.',
    type: DtAlertCollectionDto,
  })
  list(@CurrentUser() currentUser: AuthUser): Promise<DtAlertCollection> {
    return this.dtAlertsService.list(currentUser);
  }

  @Post(':alertId/registration')
  @HttpCode(200)
  @Audited({
    action: AUDIT_ACTION.DOCUMENT_DT_REGISTERED,
    entityType: 'documents',
    entityIdFrom: 'params.alertId',
    detailFromResponse: { registeredAt: 'registeredAt' },
  })
  @ApiOperation({
    summary: 'Marca un documento como registrado en la DT',
    description:
      'Deja constancia de quién confirmó el registro y cuándo; el registro en sí se hace en el sitio de la Dirección del Trabajo. La alerta deja de listarse.',
  })
  @ApiOkResponse({
    description: 'Registro confirmado.',
    type: DtRegistrationResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'El ID no es un UUID, el cuerpo no es válido o documentId no coincide con la alerta.',
  })
  @ApiNotFoundResponse({
    description:
      'No existe una alerta de registro en la DT para ese documento.',
  })
  @ApiConflictResponse({
    description:
      'El documento ya fue registrado o cambió desde que se consultó la alerta (revision distinta).',
  })
  register(
    @Param('alertId', new ParseUUIDPipe()) alertId: string,
    @Body() dto: RegisterDtDto,
    @CurrentUser() currentUser: AuthUser,
  ): Promise<DtRegistrationResponse> {
    return this.dtAlertsService.register(alertId, dto, currentUser);
  }
}
