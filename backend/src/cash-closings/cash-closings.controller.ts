import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { AUDIT_ACTION } from '../audit/constants/audit-actions.constants.js';
import { Audited } from '../audit/decorators/audited.decorator.js';
import { setAuditContext } from '../audit/utils/audit-context.util.js';
import { ROLE } from '../auth/constants/roles.constants.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { StoreScoped } from '../auth/decorators/store-scoped.decorator.js';
import type { AuthUser } from '../auth/types/auth.types.js';
import { CashClosingsService } from './cash-closings.service.js';
import { CashClosingResponseDto } from './dto/cash-closing-response.dto.js';
import { CreateCashClosingDto } from './dto/create-cash-closing.dto.js';
import type { CashClosingResponse } from './types/cash-closings.types.js';

@ApiTags('cash-closings')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Token ausente, inválido o expirado.' })
@Controller('cash-closings')
export class CashClosingsController {
  constructor(private readonly cashClosings: CashClosingsService) {}

  @Post()
  @Roles(ROLE.SUPERVISOR)
  @StoreScoped({ source: 'body' })
  @Audited({
    action: AUDIT_ACTION.CASH_CLOSING_CREATED,
    entityType: 'cash_closings',
    entityIdFrom: 'response.id',
    detailFromResponse: {
      storeId: 'store.id',
      businessDate: 'businessDate',
      shift: 'shift',
      responsibleId: 'responsible.id',
      closedAt: 'closedAt',
      totalDifference: 'totalDifference',
      reconciliationDifference: 'reconciliationDifference',
      tipFundAmount: 'tipFundAmount',
      differenceReason: 'differenceReason',
    },
  })
  @ApiOperation({
    summary: 'Confirma un cierre de caja y calcula sus diferencias',
  })
  @ApiCreatedResponse({
    description:
      'Cierre confirmado con ventas, vouchers y propinas existentes conciliados.',
    type: CashClosingResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'Montos, fechas, períodos, motivo o vínculo de propinas inválidos.',
  })
  @ApiForbiddenResponse({
    description:
      'Solo un supervisor del mismo local puede confirmar el cierre.',
  })
  @ApiNotFoundResponse({ description: 'El local indicado no existe.' })
  @ApiConflictResponse({
    description:
      'Ya existe el cierre o alguna venta del período ya fue conciliada.',
  })
  async create(
    @Body() dto: CreateCashClosingDto,
    @CurrentUser() currentUser: AuthUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CashClosingResponse> {
    const closing = await this.cashClosings.create(dto, currentUser);
    setAuditContext(res, { storeId: closing.store.id });
    return closing;
  }

  @Get(':id')
  @Roles(ROLE.ADMINISTRADOR, ROLE.SUPERVISOR, ROLE.CONTADOR)
  @ApiOperation({
    summary: 'Consulta el detalle inmutable de un cierre de caja',
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
