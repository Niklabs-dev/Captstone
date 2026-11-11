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
  @ApiOperation({
    summary: 'Lista los locales y permite filtrar por estado',
    description:
      'Disponible para cualquier rol autenticado. Cada local incluye su ID ' +
      'Subway (o null si no está configurado), con el que se identifica el ' +
      'Excel diario de ventas de MrComanda. Sin filtro incluye los inactivos.',
  })
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
  @ApiOperation({
    summary: 'Crea un local activo, con su ID Subway opcional',
    description:
      'Solo ADMINISTRADOR. Recorta y colapsa espacios; el nombre es único ' +
      'ignorando mayúsculas, tildes y espacios repetidos. El ID Subway (solo ' +
      'dígitos, único) es el que trae el informe de MrComanda tras el número ' +
      'interno, ej. «208 - 72597» → 72597; sin él, el Excel del local no se ' +
      'identifica solo al importar.',
  })
  @ApiCreatedResponse({ description: 'Local creado.', type: StoreResponseDto })
  @ApiBadRequestResponse({
    description:
      'Datos obligatorios inválidos o ID Subway con formato inválido (solo dígitos, de 1 a 10).',
  })
  @ApiForbiddenResponse({
    description: 'Solo ADMINISTRADOR puede crear locales.',
  })
  @ApiConflictResponse({
    description: 'Ya existe un local con ese nombre o con ese ID Subway.',
  })
  async create(
    @Body() dto: CreateStoreDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StoreResponse> {
    const store = await this.storesService.create(dto);
    const detail: Record<string, string> = {
      name: store.name,
      city: store.city,
      address: store.address,
    };
    if (store.subwayStoreId !== null) {
      detail.subwayStoreId = store.subwayStoreId;
    }
    setAuditContext(res, { storeId: store.id, detail });
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
    description:
      'Solo ADMINISTRADOR. Un local inactivo no admite asignaciones ni cargas ' +
      'nuevas (su Excel de ventas queda como no importable) y conserva su ' +
      'historial consultable. Idempotente: sin cambio de estado no se audita.',
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
    const result = await this.storesService.deactivate(id);
    setAuditContext(res, {
      storeId: result.store.id,
      skipAudit: !result.changed,
    });
    return result.store;
  }

  @Patch(':id/reactivate')
  @Roles(ROLE.ADMINISTRADOR)
  @Audited({
    action: AUDIT_ACTION.STORE_REACTIVATED,
    entityType: 'stores',
    entityIdFrom: 'params.id',
  })
  @ApiOperation({
    summary: 'Reactiva un local previamente desactivado',
    description:
      'Solo ADMINISTRADOR. Vuelve a permitir asignaciones y operaciones ' +
      'nuevas. Idempotente: sin cambio de estado no se audita.',
  })
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
    const result = await this.storesService.reactivate(id);
    setAuditContext(res, {
      storeId: result.store.id,
      skipAudit: !result.changed,
    });
    return result.store;
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
    summary:
      'Edita el nombre, la ciudad, la dirección o el ID Subway de un local',
    description:
      'Solo ADMINISTRADOR. Corrige solo los campos enviados con las mismas ' +
      'validaciones del alta; subwayStoreId en null quita el ID Subway. El ' +
      'cambio de ID Subway se audita con el valor anterior y el nuevo y ' +
      'aplica a las próximas importaciones; las ya confirmadas no cambian.',
  })
  @ApiOkResponse({ description: 'Local actualizado.', type: StoreResponseDto })
  @ApiBadRequestResponse({
    description:
      'ID, campos o cuerpo de la actualización inválidos, o ID Subway con formato inválido (solo dígitos, de 1 a 10).',
  })
  @ApiForbiddenResponse({
    description: 'Solo ADMINISTRADOR puede editar locales.',
  })
  @ApiNotFoundResponse({ description: 'Local no encontrado.' })
  @ApiConflictResponse({
    description: 'Ya existe un local con ese nombre o con ese ID Subway.',
  })
  async update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateStoreDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StoreResponse> {
    const { store, previous } = await this.storesService.update(id, dto);
    const detail: Record<string, string | null> = {};
    if (dto.name !== undefined) detail.name = store.name;
    if (dto.city !== undefined) detail.city = store.city;
    if (dto.address !== undefined) detail.address = store.address;
    // El cambio de ID Subway se audita con el valor anterior y el nuevo
    // (null cuando no estaba configurado o se quitó).
    if (dto.subwayStoreId !== undefined) {
      detail.previousSubwayStoreId = previous.subwayStoreId;
      detail.subwayStoreId = store.subwayStoreId;
    }
    setAuditContext(res, { storeId: store.id, detail });
    return store;
  }
}
