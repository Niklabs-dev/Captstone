import {
  Body,
  Controller,
  Get,
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
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CreateStoreDto } from './dto/create-store.dto.js';
import { ListStoresQueryDto } from './dto/list-stores-query.dto.js';
import { StoreResponseDto } from './dto/store-response.dto.js';
import { UpdateStoreDto } from './dto/update-store.dto.js';
import type { StoreResponse } from './types/stores.types.js';
import { StoresService } from './stores.service.js';

@ApiTags('stores')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Token ausente, inválido o expirado.' })
@Controller('stores')
export class StoresController {
  constructor(private readonly storesService: StoresService) {}

  @Get()
  @ApiOperation({ summary: 'Lista los locales y permite filtrar por estado' })
  @ApiOkResponse({
    description: 'Locales ordenados por nombre.',
    type: StoreResponseDto,
    isArray: true,
  })
  @ApiBadRequestResponse({
    description: 'El filtro de estado no supera la validación.',
  })
  findAll(@Query() query: ListStoresQueryDto): Promise<StoreResponse[]> {
    return this.storesService.findAll(query);
  }

  @Post()
  @Roles(ROLE.ADMINISTRADOR)
  @Audited({
    action: AUDIT_ACTION.STORE_CREATED,
    entityType: 'stores',
    entityIdFrom: 'response.id',
    detailFromBody: ['name', 'city', 'address'],
  })
  @ApiOperation({ summary: 'Crea un local activo' })
  @ApiCreatedResponse({ description: 'Local creado.', type: StoreResponseDto })
  @ApiBadRequestResponse({ description: 'Datos obligatorios inválidos.' })
  @ApiForbiddenResponse({
    description: 'Solo ADMINISTRADOR puede crear locales.',
  })
  @ApiConflictResponse({ description: 'Ya existe un local con ese nombre.' })
  async create(
    @Body() dto: CreateStoreDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StoreResponse> {
    const store = await this.storesService.create(dto);
    setAuditContext(res, {
      storeId: store.id,
      detail: {
        name: store.name,
        city: store.city,
        address: store.address,
      },
    });
    return store;
  }

  @Patch(':id/deactivate')
  @Roles(ROLE.ADMINISTRADOR)
  @Audited({
    action: AUDIT_ACTION.STORE_DEACTIVATED,
    entityType: 'stores',
    entityIdFrom: 'params.id',
  })
  @ApiOperation({
    summary: 'Desactiva un local sin eliminar su historial',
  })
  @ApiOkResponse({
    description: 'Local desactivado; idempotente si ya estaba inactivo.',
    type: StoreResponseDto,
  })
  @ApiBadRequestResponse({ description: 'ID no es un UUID.' })
  @ApiForbiddenResponse({
    description: 'Solo ADMINISTRADOR puede desactivar locales.',
  })
  @ApiNotFoundResponse({ description: 'Local no encontrado.' })
  @ApiConflictResponse({
    description: 'El local tiene usuarios activos asignados.',
  })
  async deactivate(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StoreResponse> {
    const store = await this.storesService.deactivate(id);
    setAuditContext(res, { storeId: store.id });
    return store;
  }

  @Patch(':id/reactivate')
  @Roles(ROLE.ADMINISTRADOR)
  @Audited({
    action: AUDIT_ACTION.STORE_REACTIVATED,
    entityType: 'stores',
    entityIdFrom: 'params.id',
  })
  @ApiOperation({ summary: 'Reactiva un local previamente desactivado' })
  @ApiOkResponse({
    description: 'Local reactivado; idempotente si ya estaba activo.',
    type: StoreResponseDto,
  })
  @ApiBadRequestResponse({ description: 'ID no es un UUID.' })
  @ApiForbiddenResponse({
    description: 'Solo ADMINISTRADOR puede reactivar locales.',
  })
  @ApiNotFoundResponse({ description: 'Local no encontrado.' })
  async reactivate(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StoreResponse> {
    const store = await this.storesService.reactivate(id);
    setAuditContext(res, { storeId: store.id });
    return store;
  }

  @Patch(':id')
  @Roles(ROLE.ADMINISTRADOR)
  @Audited({
    action: AUDIT_ACTION.STORE_UPDATED,
    entityType: 'stores',
    entityIdFrom: 'params.id',
    detailFromBody: ['name', 'city', 'address'],
  })
  @ApiOperation({
    summary: 'Edita el nombre, la ciudad o la dirección de un local',
  })
  @ApiOkResponse({ description: 'Local actualizado.', type: StoreResponseDto })
  @ApiBadRequestResponse({
    description: 'ID, campos o cuerpo de la actualización inválidos.',
  })
  @ApiForbiddenResponse({
    description: 'Solo ADMINISTRADOR puede editar locales.',
  })
  @ApiNotFoundResponse({ description: 'Local no encontrado.' })
  @ApiConflictResponse({ description: 'Ya existe un local con ese nombre.' })
  async update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateStoreDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StoreResponse> {
    const store = await this.storesService.update(id, dto);
    const detail: Record<string, string> = {};
    if (dto.name !== undefined) detail.name = store.name;
    if (dto.city !== undefined) detail.city = store.city;
    if (dto.address !== undefined) detail.address = store.address;
    setAuditContext(res, { storeId: store.id, detail });
    return store;
  }
}
