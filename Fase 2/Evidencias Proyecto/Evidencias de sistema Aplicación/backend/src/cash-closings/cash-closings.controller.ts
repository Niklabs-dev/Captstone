import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ROLE } from '../auth/constants/roles.constants.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import type { AuthUser } from '../auth/types/auth.types.js';
import { CashClosingsService } from './cash-closings.service.js';
import { CashClosingResponseDto } from './dto/cash-closing-response.dto.js';
import type { CashClosingResponse } from './types/cash-closings.types.js';

// Cierres de caja por turno con conciliación: flujo histórico. Desde
// SPRINT-4R-T01 la operación diaria (daily_operations) reemplaza la
// confirmación de cierres y la captura de propinas; el endpoint de
// confirmación (POST) se retiró para no operar en paralelo. Los cierres ya
// registrados se conservan y siguen consultables por su ID.
@ApiTags('cash-closings')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Token ausente, inválido o expirado.' })
@Controller('cash-closings')
export class CashClosingsController {
  constructor(private readonly cashClosings: CashClosingsService) {}

  @Get(':id')
  @Roles(ROLE.ADMINISTRADOR, ROLE.SUPERVISOR, ROLE.CONTADOR)
  @ApiOperation({
    summary: 'Consulta el detalle inmutable de un cierre de caja histórico',
    description:
      'Lectura del flujo previo a SPRINT-4R-T01; el registro operativo nuevo va por POST /daily-operations.',
  })
  @ApiOkResponse({
    description: 'Cierre con líneas, vouchers y fondo de propinas vinculado.',
    type: CashClosingResponseDto,
  })
  @ApiBadRequestResponse({ description: 'El ID no es un UUID válido.' })
  @ApiForbiddenResponse({ description: 'No tienes acceso a este local.' })
  @ApiNotFoundResponse({ description: 'Cierre de caja no encontrado.' })
  findOne(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() currentUser: AuthUser,
  ): Promise<CashClosingResponse> {
    return this.cashClosings.findOne(id, currentUser);
  }
}
