import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
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
import { CreateTipEntryDto } from './dto/create-tip-entry.dto.js';
import { ListTipEntriesQueryDto } from './dto/list-tip-entries-query.dto.js';
import { TipEntryResponseDto } from './dto/tip-entry-response.dto.js';
import { UpdateTipEntryDto } from './dto/update-tip-entry.dto.js';
import type {
  TipEntryCreateResult,
  TipEntryResponse,
} from './types/tips.types.js';
import { TipsService } from './tips.service.js';

@ApiTags('tips')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Token ausente, inválido o expirado.' })
@Controller('tips')
export class TipsController {
  constructor(private readonly tipsService: TipsService) {}

  @Post()
  @Roles(ROLE.ADMINISTRADOR, ROLE.SUPERVISOR)
  @StoreScoped({ source: 'body' })
  @Audited({
    action: AUDIT_ACTION.TIP_ENTRY_CREATED,
    entityType: 'tip_entries',
    entityIdFrom: 'response.id',
    detailFromResponse: {
      storeId: 'store.id',
      responsibleId: 'responsible.id',
      businessDate: 'businessDate',
      paymentMethod: 'paymentMethod',
      amount: 'amount',
    },
  })
  @ApiOperation({ summary: 'Registra las propinas diarias por medio de pago' })
  @ApiCreatedResponse({
    description: 'Registro creado con el responsable obtenido del JWT.',
    type: TipEntryResponseDto,
  })
  @ApiOkResponse({
    description: 'Reintento idéntico: devuelve el registro ya existente.',
    type: TipEntryResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Local, fecha, medio o monto inválido.',
  })
  @ApiForbiddenResponse({
    description: 'El rol o el local asignado no permite registrar propinas.',
  })
  @ApiConflictResponse({
    description: 'Ya existe un registro distinto para la misma clave diaria.',
  })
  async create(
    @Body() dto: CreateTipEntryDto,
    @CurrentUser() currentUser: AuthUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<TipEntryResponse> {
    const result: TipEntryCreateResult = await this.tipsService.create(
      dto,
      currentUser,
    );
    res.status(result.created ? 201 : 200);
    setAuditContext(res, {
      storeId: result.entry.store.id,
      skipAudit: !result.created,
    });
    return result.entry;
  }

  @Get()
  @Roles(ROLE.ADMINISTRADOR, ROLE.SUPERVISOR, ROLE.CONTADOR)
  @StoreScoped({ source: 'query' })
  @ApiOperation({ summary: 'Consulta las propinas de un local y fecha' })
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
  @ApiOperation({ summary: 'Obtiene un registro diario de propinas por su ID' })
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

  @Patch(':id')
  @Roles(ROLE.ADMINISTRADOR, ROLE.SUPERVISOR)
  @Audited({
    action: AUDIT_ACTION.TIP_ENTRY_UPDATED,
    entityType: 'tip_entries',
    entityIdFrom: 'params.id',
    detailFromResponse: {
      storeId: 'store.id',
      responsibleId: 'responsible.id',
      businessDate: 'businessDate',
      paymentMethod: 'paymentMethod',
      amount: 'amount',
    },
  })
  @ApiOperation({
    summary: 'Corrige el monto de un registro diario no vinculado',
  })
  @ApiOkResponse({
    description: 'Monto actualizado; la clave y el responsable se conservan.',
    type: TipEntryResponseDto,
  })
  @ApiBadRequestResponse({ description: 'ID o monto inválido.' })
  @ApiForbiddenResponse({
    description: 'El rol o el local asignado no permite editar propinas.',
  })
  @ApiNotFoundResponse({ description: 'Registro no encontrado.' })
  @ApiConflictResponse({
    description: 'El registro ya está vinculado a una venta o reparto.',
  })
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateTipEntryDto,
    @CurrentUser() currentUser: AuthUser,
  ): Promise<TipEntryResponse> {
    return this.tipsService.update(id, dto, currentUser);
  }

  @Delete(':id')
  @HttpCode(204)
  @Roles(ROLE.ADMINISTRADOR, ROLE.SUPERVISOR)
  @Audited({
    action: AUDIT_ACTION.TIP_ENTRY_DELETED,
    entityType: 'tip_entries',
    entityIdFrom: 'params.id',
  })
  @ApiOperation({ summary: 'Elimina un registro diario no vinculado' })
  @ApiNoContentResponse({ description: 'Registro eliminado.' })
  @ApiBadRequestResponse({ description: 'El ID no es un UUID válido.' })
  @ApiForbiddenResponse({
    description: 'El rol o el local asignado no permite eliminar propinas.',
  })
  @ApiNotFoundResponse({ description: 'Registro no encontrado.' })
  @ApiConflictResponse({
    description: 'El registro ya está vinculado a una venta o reparto.',
  })
  async remove(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() currentUser: AuthUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<TipEntryResponse> {
    const entry = await this.tipsService.remove(id, currentUser);
    setAuditContext(res, {
      storeId: entry.store.id,
      detail: {
        storeId: entry.store.id,
        responsibleId: entry.responsible.id,
        businessDate: entry.businessDate,
        paymentMethod: entry.paymentMethod,
        amount: entry.amount,
      },
    });
    return entry;
  }
}
