import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
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
import { StoreScoped } from '../auth/decorators/store-scoped.decorator.js';
import type { AuthUser } from '../auth/types/auth.types.js';
import { ListTipEntriesQueryDto } from './dto/list-tip-entries-query.dto.js';
import { TipEntryResponseDto } from './dto/tip-entry-response.dto.js';
import type { TipEntryResponse } from './types/tips.types.js';
import { TipsService } from './tips.service.js';

// Registro diario histórico de propinas por medio de pago. Desde
// SPRINT-4R-T01 la operación diaria (daily_operations) es la fuente de ambos
// montos de propina y los endpoints de escritura de este flujo (alta, edición
// y eliminación) se retiraron para no operar en paralelo; los registros
// existentes se conservan y siguen consultables por estos endpoints de
// lectura.
@ApiTags('tips')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Token ausente, inválido o expirado.' })
@Controller('tips')
export class TipsController {
  constructor(private readonly tipsService: TipsService) {}

  @Get()
  @Roles(ROLE.ADMINISTRADOR, ROLE.SUPERVISOR, ROLE.CONTADOR)
  @StoreScoped({ source: 'query' })
  @ApiOperation({
    summary:
      'Consulta las propinas históricas por medio de pago de un local y fecha',
    description:
      'Lectura del registro diario previo a SPRINT-4R-T01; el registro nuevo va por POST /daily-operations.',
  })
  @ApiOkResponse({
    description: 'Registros ordenados por medio de pago.',
    type: TipEntryResponseDto,
    isArray: true,
  })
  @ApiBadRequestResponse({ description: 'Local o fecha inválidos.' })
  @ApiForbiddenResponse({
    description: 'El rol o el local asignado no permite consultar propinas.',
  })
  findAll(
    @Query() query: ListTipEntriesQueryDto,
    @CurrentUser() currentUser: AuthUser,
  ): Promise<TipEntryResponse[]> {
    return this.tipsService.findAll(query, currentUser);
  }

  @Get(':id')
  @Roles(ROLE.ADMINISTRADOR, ROLE.SUPERVISOR, ROLE.CONTADOR)
  @ApiOperation({
    summary: 'Obtiene un registro histórico de propinas por su ID',
    description:
      'Lectura del registro diario previo a SPRINT-4R-T01; el registro nuevo va por POST /daily-operations.',
  })
  @ApiOkResponse({
    description: 'Registro encontrado.',
    type: TipEntryResponseDto,
  })
  @ApiBadRequestResponse({ description: 'El ID no es un UUID válido.' })
  @ApiForbiddenResponse({ description: 'No tienes acceso a este local.' })
  @ApiNotFoundResponse({ description: 'Registro no encontrado.' })
  findOne(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() currentUser: AuthUser,
  ): Promise<TipEntryResponse> {
    return this.tipsService.findOne(id, currentUser);
  }
}
