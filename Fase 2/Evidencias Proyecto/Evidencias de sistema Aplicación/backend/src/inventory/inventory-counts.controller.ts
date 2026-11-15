import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Res,
  StreamableFile,
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
  ApiProduces,
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
import type { AuthUser } from '../auth/types/auth.types.js';
import {
  InventoryCountDetailQueryDto,
  ListInventoryCountsQueryDto,
  SaveInventoryCountLineDto,
  StartInventoryCountDto,
} from './dto/inventory-count-request.dto.js';
import {
  InventoryCountConflictDto,
  InventoryCountDetailDto,
  InventoryCountFinalizationDto,
  InventoryCountItemDto,
  InventoryCountSummaryDto,
} from './dto/inventory-count-response.dto.js';
import { ProductFieldErrorsDto } from './dto/product-response.dto.js';
import { XLSX_MIME_TYPE } from '../tips/export/daily-tips-workbook.js';
import { InventoryCountExportService } from './inventory-count-export.service.js';
import { InventoryCountsService } from './inventory-counts.service.js';
import type {
  InventoryCountDetail,
  InventoryCountFinalization,
  InventoryCountItem,
  InventoryCountSummary,
} from './types/inventory-counts.types.js';

// Tomas de inventario (SPRINT-5-T05). Iniciar, guardar líneas y finalizar
// (SPRINT-5-T06) son del SUPERVISOR, solo en su local; el ADMINISTRADOR
// consulta todas en solo lectura; CONTADOR y TRABAJADOR reciben 403. La
// descarga en Excel de una toma finalizada (SPRINT-5-T08) es del
// ADMINISTRADOR (cualquier local) y del SUPERVISOR (su local).
@ApiTags('inventory-counts')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Token ausente, inválido o expirado.' })
@Controller('inventory-counts')
export class InventoryCountsController {
  constructor(
    private readonly counts: InventoryCountsService,
    private readonly countExport: InventoryCountExportService,
  ) {}

  @Post()
  @Roles(ROLE.SUPERVISOR)
  @Audited({
    action: AUDIT_ACTION.INVENTORY_COUNT_STARTED,
    entityType: 'inventory_counts',
    entityIdFrom: 'response.id',
  })
  @ApiOperation({
    summary: 'Inicia la toma de inventario del local del supervisor',
    description:
      'Rol: SUPERVISOR. El local sale de la sesión, nunca del cuerpo. La fecha de la toma es la indicada (de hoy o de hasta 7 días atrás, MAX_COUNT_DATE_AGE_DAYS) o el día en curso en hora de Chile, y queda fija aunque la toma se finalice después de medianoche. Como máximo una toma En curso por local: si ya hay una responde 409 con su id (existingCountId) para retomarla. Queda en auditoría (INVENTORY_COUNT_STARTED).',
  })
  @ApiCreatedResponse({ type: InventoryCountSummaryDto })
  @ApiBadRequestResponse({
    description:
      'Fecha inválida, posterior a hoy o de más de 7 días atrás (errors.countDate), o local inactivo.',
    type: ProductFieldErrorsDto,
  })
  @ApiForbiddenResponse({
    description:
      'Solo el SUPERVISOR inicia tomas, y solo si tiene un local asignado.',
  })
  @ApiConflictResponse({
    description:
      'Ya hay una toma En curso en el local: indica cuál es (existingCountId). Si otro inicio simultáneo chocó y ya no existe, 409 con errors.store para reintentar.',
    type: InventoryCountConflictDto,
  })
  async start(
    @Body() dto: StartInventoryCountDto,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<InventoryCountSummary> {
    const count = await this.counts.start(dto, user);
    setAuditContext(res, { detail: { countDate: count.countDate } });
    return count;
  }

  @Get()
  @Roles(ROLE.ADMINISTRADOR, ROLE.SUPERVISOR)
  @ApiOperation({
    summary: 'Lista las tomas de inventario por local, estado y fechas',
    description:
      'Roles: ADMINISTRADOR (todos los locales, o el de storeId) y SUPERVISOR (solo su local: otro storeId responde 403). Filtra por estado (OPEN «En curso» o CONFIRMED «Finalizado») y por rango de fechas de la toma (from y to inclusive). Ordenadas de la más reciente a la más antigua.',
  })
  @ApiOkResponse({ type: InventoryCountSummaryDto, isArray: true })
  @ApiBadRequestResponse({
    description: 'Filtros con formato inválido o rango de fechas invertido.',
  })
  @ApiForbiddenResponse({
    description:
      'CONTADOR y TRABAJADOR no consultan tomas; un SUPERVISOR no ve otro local.',
  })
  findAll(
    @Query() query: ListInventoryCountsQueryDto,
    @CurrentUser() user: AuthUser,
  ): Promise<InventoryCountSummary[]> {
    return this.counts.findAll(query, user);
  }

  @Get(':id')
  @Roles(ROLE.ADMINISTRADOR, ROLE.SUPERVISOR)
  @ApiOperation({
    summary: 'Consulta una toma con lo contado y lo pendiente',
    description:
      'Roles: ADMINISTRADOR (cualquier local, solo lectura) y SUPERVISOR (solo su local). Devuelve los productos en el orden de la plantilla, con su formato, la línea guardada (cajas, paquetes, cantidad suelta, total, quién y cuándo) o null si está pendiente. En curso incluye los productos activos más los que ya tengan línea; finalizada, solo sus líneas. search filtra por nombre, nombre alternativo o SKU sin distinguir mayúsculas ni tildes; totalProducts, countedProducts y pendingProducts no dependen de la búsqueda.',
  })
  @ApiOkResponse({ type: InventoryCountDetailDto })
  @ApiBadRequestResponse({ description: 'El ID no es un UUID válido.' })
  @ApiForbiddenResponse({
    description:
      'CONTADOR y TRABAJADOR no consultan tomas; un SUPERVISOR no ve otro local.',
  })
  @ApiNotFoundResponse({ description: 'Toma de inventario no encontrada.' })
  findOne(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: InventoryCountDetailQueryDto,
    @CurrentUser() user: AuthUser,
  ): Promise<InventoryCountDetail> {
    return this.counts.findOne(id, query, user);
  }

  @Put(':id/lines/:productId')
  @Roles(ROLE.SUPERVISOR)
  @ApiOperation({
    summary: 'Guarda lo contado de un producto en la toma',
    description:
      'Rol: SUPERVISOR, solo en una toma En curso de su local. Guarda las cajas, los paquetes y la cantidad suelta; guardar de nuevo el mismo producto reemplaza su línea (no la duplica). El total = cajas × contenido por caja + paquetes × contenido por paquete + cantidad suelta se calcula en el backend con aritmética decimal exacta y se guarda con la copia del SKU, el nombre, la unidad y el formato del producto. Registra quién guardó (sesión) y cuándo (la base). Un campo que no aplica al formato se omite o va en null. Un producto desactivado solo se guarda si ya tenía línea en esta toma (para corregirla).',
  })
  @ApiOkResponse({ type: InventoryCountItemDto })
  @ApiBadRequestResponse({
    description:
      'IDs inválidos, o cantidades inválidas para el formato (errores por campo): cajas sin contenido por caja, paquetes sin contenido por paquete, cajas o paquetes en un producto «solo cantidad suelta», negativos, no numéricos, decimales en cajas o paquetes, más de 3 decimales, decimales en UNIT o ningún campo informado.',
    type: ProductFieldErrorsDto,
  })
  @ApiForbiddenResponse({
    description:
      'Solo el SUPERVISOR guarda, y solo en su local (el ADMINISTRADOR consulta en solo lectura).',
  })
  @ApiNotFoundResponse({ description: 'Toma o producto no encontrados.' })
  @ApiConflictResponse({
    description:
      'La toma está finalizada (errors.countId) o el producto está desactivado y no tiene línea en esta toma (errors.productId). Un producto desactivado que ya tenía línea se puede corregir.',
    type: ProductFieldErrorsDto,
  })
  saveLine(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('productId', new ParseUUIDPipe()) productId: string,
    @Body() dto: SaveInventoryCountLineDto,
    @CurrentUser() user: AuthUser,
  ): Promise<InventoryCountItem> {
    return this.counts.saveLine(id, productId, dto, user);
  }

  @Post(':id/finalize')
  @HttpCode(200)
  @Roles(ROLE.SUPERVISOR)
  @Audited({
    action: AUDIT_ACTION.INVENTORY_COUNT_FINALIZED,
    entityType: 'inventory_counts',
    entityIdFrom: 'response.id',
  })
  @ApiOperation({
    summary: 'Finaliza la toma de inventario y bloquea sus cambios',
    description:
      'Rol: SUPERVISOR, solo en una toma En curso de su local, con al menos un producto contado. Registra quién la finalizó (sesión) y cuándo. Los productos activos sin contar quedan con una línea sin cantidades, con la copia de su nombre, SKU y formato, y la toma guarda la copia de la estructura de la plantilla: el Excel de la toma no cambia aunque después se edite el catálogo o la plantilla. La respuesta informa cuántos productos se contaron (countedProducts) y cuántos no (uncountedProducts). Desde ese momento guardar líneas responde 409 (y la base rechaza cualquier escritura sobre la toma o sus líneas) y el local puede iniciar una toma nueva. Finalizar dos veces o en paralelo no duplica líneas: una responde 200 y la otra 409. Queda en auditoría (INVENTORY_COUNT_FINALIZED).',
  })
  @ApiOkResponse({ type: InventoryCountFinalizationDto })
  @ApiBadRequestResponse({
    description:
      'El ID no es un UUID válido, o la toma no tiene ningún producto contado (errors.countId).',
    type: ProductFieldErrorsDto,
  })
  @ApiForbiddenResponse({
    description:
      'Solo el SUPERVISOR finaliza, y solo tomas de su local (el ADMINISTRADOR consulta en solo lectura).',
  })
  @ApiNotFoundResponse({ description: 'Toma de inventario no encontrada.' })
  @ApiConflictResponse({
    description:
      'La toma ya está finalizada (errors.countId), también si otra finalización simultánea ganó la carrera o la base rechazó la escritura; o bien otra solicitud estaba escribiendo la toma en ese momento (deadlock o conflicto de transacción): vuelve a consultarla. Nunca 500.',
    type: ProductFieldErrorsDto,
  })
  async finalize(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<InventoryCountFinalization> {
    const count = await this.counts.finalize(id, user);
    setAuditContext(res, {
      detail: {
        countDate: count.countDate,
        countedProducts: count.countedProducts,
        uncountedProducts: count.uncountedProducts,
      },
    });
    return count;
  }

  @Get(':id/export')
  @Roles(ROLE.ADMINISTRADOR)
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  @Audited({
    action: AUDIT_ACTION.INVENTORY_COUNT_EXPORTED,
    entityType: 'inventory_counts',
    entityIdFrom: 'context.entityId',
  })
  @ApiProduces(XLSX_MIME_TYPE)
  @ApiOperation({
    summary: 'Descarga en Excel una toma de inventario finalizada',
    description:
      'Rol: ADMINISTRADOR (cualquier local). Planilla .xlsx de una sola hoja, «Inventario», que replica la plantilla impresa: encabezado en la fila 1 y cada fila de la copia de la plantilla guardada al finalizar en su misma posición (la fila N del Excel es la posición N), con las columnas A artículo (nombre del producto al contarse, o el texto de la fila si no tiene producto), B cajas, C cajas × contenido por caja, D paquetes, E paquetes × contenido por paquete, F cantidad suelta y G total contado (celdas numéricas; C + E + F = G; kg y l con formato 0,000). Como en la plantilla en blanco, las filas de artículo y <Vacío> sin contar llevan C, E y G en 0 y B, D y F vacías; las filas sin texto y las de sección no llevan números. Los productos contados que ya no tenían fila en la plantilla van al final, antes de la fila «PRODUCTOS SIN FILA EN LA PLANTILLA». Se imprime vertical y ajustada a una hoja de ancho. El archivo usa las copias de la finalización: no cambia aunque después se edite el catálogo o la plantilla. Queda en auditoría (INVENTORY_COUNT_EXPORTED) sin cantidades.',
  })
  @ApiOkResponse({
    description:
      'Archivo .xlsx con nombre inventario-<local>-<fecha de la toma>.xlsx en Content-Disposition (local en slug sin tildes ni espacios, fecha DD-MM-AAAA).',
    content: {
      [XLSX_MIME_TYPE]: { schema: { type: 'string', format: 'binary' } },
    },
    headers: {
      'Content-Disposition': {
        description: 'attachment con el nombre del archivo.',
        schema: {
          type: 'string',
          example:
            'attachment; filename="inventario-subway-melipilla-centro-11-11-2026.xlsx"',
        },
      },
      'Cache-Control': {
        description:
          'El inventario es información interna: no se guarda en caché.',
        schema: { type: 'string', example: 'private, no-store' },
      },
      'X-Content-Type-Options': {
        description: 'Siempre nosniff.',
        schema: { type: 'string', example: 'nosniff' },
      },
    },
  })
  @ApiBadRequestResponse({ description: 'El ID no es un UUID válido.' })
  @ApiForbiddenResponse({
    description:
      'Solo el ADMINISTRADOR descarga tomas en Excel (SUPERVISOR, CONTADOR y TRABAJADOR reciben 403).',
  })
  @ApiNotFoundResponse({ description: 'Toma de inventario no encontrada.' })
  @ApiConflictResponse({
    description:
      'La toma todavía está En curso (errors.countId): solo se descarga una toma finalizada.',
    type: ProductFieldErrorsDto,
  })
  async exportCount(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const file = await this.countExport.exportCount(id);
    // La respuesta es el archivo: a la auditoría van la fecha de la toma y
    // las cantidades de productos, nunca lo contado.
    setAuditContext(res, {
      entityId: file.countId,
      storeId: file.store.id,
      detail: {
        countDate: file.countDate,
        countedProducts: file.countedProducts,
        uncountedProducts: file.uncountedProducts,
      },
    });
    return new StreamableFile(file.content, {
      type: XLSX_MIME_TYPE,
      disposition: `attachment; filename="${file.fileName}"`,
      length: file.content.length,
    });
  }
}
