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
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import type { AuthUser } from '../auth/types/auth.types.js';
import {
  CreateProductDto,
  ListProductsQueryDto,
  UpdateProductDto,
} from './dto/product-request.dto.js';
import {
  ProductFieldErrorsDto,
  ProductResponseDto,
  ProductSectionDto,
} from './dto/product-response.dto.js';
import { productSnapshot, ProductsService } from './products.service.js';
import type { ProductChange, ProductResponse } from './types/products.types.js';

// Productos de inventario (SPRINT-5-T03). Crear, editar, desactivar y
// reactivar son del ADMINISTRADOR; el SUPERVISOR consulta el catálogo activo
// para sus tomas. Cada cambio queda en auditoría con el valor anterior y el
// nuevo.
@ApiTags('products')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Token ausente, inválido o expirado.' })
@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  @Roles(ROLE.ADMINISTRADOR, ROLE.SUPERVISOR)
  @ApiOperation({
    summary: 'Lista los productos de inventario en el orden de la plantilla',
    description:
      'Filtra por sección, estado, formato faltante y nombre (también los alternativos, sin distinguir mayúsculas ni tildes). El SUPERVISOR solo recibe productos activos.',
  })
  @ApiOkResponse({ type: ProductResponseDto, isArray: true })
  @ApiBadRequestResponse({ description: 'Filtros con formato inválido.' })
  @ApiForbiddenResponse({
    description: 'Solo ADMINISTRADOR y SUPERVISOR consultan el catálogo.',
  })
  findAll(
    @Query() query: ListProductsQueryDto,
    @CurrentUser() user: AuthUser,
  ): Promise<ProductResponse[]> {
    return this.products.findAll(query, user);
  }

  @Get('sections')
  @Roles(ROLE.ADMINISTRADOR, ROLE.SUPERVISOR)
  @ApiOperation({
    summary: 'Lista las secciones de la plantilla y sus filas libres',
  })
  @ApiOkResponse({ type: ProductSectionDto, isArray: true })
  @ApiForbiddenResponse({
    description: 'Solo ADMINISTRADOR y SUPERVISOR consultan el catálogo.',
  })
  sections(): Promise<ProductSectionDto[]> {
    return this.products.sections();
  }

  @Post()
  @Roles(ROLE.ADMINISTRADOR)
  @Audited({
    action: AUDIT_ACTION.PRODUCT_CREATED,
    entityType: 'products',
    entityIdFrom: 'response.id',
  })
  @ApiOperation({
    summary: 'Crea un producto y lo ubica en su sección de la plantilla',
    description:
      'Ocupa la primera fila «<Vacío>» libre de la sección o, si no queda ninguna, una fila nueva al final de la sección (posición desde 1000). El SKU es opcional: lo entrega el proveedor.',
  })
  @ApiCreatedResponse({ type: ProductResponseDto })
  @ApiBadRequestResponse({
    description:
      'Datos inválidos, sección inexistente o formato inconsistente (errores por campo).',
    type: ProductFieldErrorsDto,
  })
  @ApiForbiddenResponse({ description: 'Solo ADMINISTRADOR crea productos.' })
  @ApiConflictResponse({
    description: 'El nombre o el SKU ya existen (errores por campo).',
    type: ProductFieldErrorsDto,
  })
  async create(
    @Body() dto: CreateProductDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ProductResponse> {
    const product = await this.products.create(dto);
    setAuditContext(res, {
      detail: { before: null, after: productSnapshot(product) },
    });
    return product;
  }

  @Patch(':id')
  @Roles(ROLE.ADMINISTRADOR)
  @Audited({
    action: AUDIT_ACTION.PRODUCT_UPDATED,
    entityType: 'products',
    entityIdFrom: 'params.id',
  })
  @ApiOperation({
    summary: 'Edita el nombre, la sección, la unidad, el SKU o el formato',
    description:
      'Renombrar conserva la fila (posición) del producto en la plantilla. Las líneas de tomas guardan su propia copia y no cambian. Un artículo impreso en la plantilla no se puede mover de sección.',
  })
  @ApiOkResponse({ type: ProductResponseDto })
  @ApiBadRequestResponse({
    description:
      'ID inválido, datos inválidos, sección inexistente o formato inconsistente.',
    type: ProductFieldErrorsDto,
  })
  @ApiForbiddenResponse({ description: 'Solo ADMINISTRADOR edita productos.' })
  @ApiNotFoundResponse({ description: 'Producto no encontrado.' })
  @ApiConflictResponse({
    description:
      'Nombre o SKU repetidos, o un artículo de la plantilla que se intenta mover de sección.',
    type: ProductFieldErrorsDto,
  })
  async update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateProductDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ProductResponse> {
    return this.audited(res, await this.products.update(id, dto));
  }

  @Patch(':id/deactivate')
  @Roles(ROLE.ADMINISTRADOR)
  @Audited({
    action: AUDIT_ACTION.PRODUCT_DEACTIVATED,
    entityType: 'products',
    entityIdFrom: 'params.id',
  })
  @ApiOperation({
    summary: 'Desactiva un producto sin borrarlo',
    description:
      'Deja de aparecer en tomas nuevas y conserva su fila y las tomas finalizadas. Repetir la acción no cambia nada.',
  })
  @ApiOkResponse({ type: ProductResponseDto })
  @ApiBadRequestResponse({ description: 'El ID no es un UUID válido.' })
  @ApiForbiddenResponse({
    description: 'Solo ADMINISTRADOR desactiva productos.',
  })
  @ApiNotFoundResponse({ description: 'Producto no encontrado.' })
  async deactivate(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ProductResponse> {
    return this.audited(res, await this.products.setActive(id, false));
  }

  @Patch(':id/reactivate')
  @Roles(ROLE.ADMINISTRADOR)
  @Audited({
    action: AUDIT_ACTION.PRODUCT_REACTIVATED,
    entityType: 'products',
    entityIdFrom: 'params.id',
  })
  @ApiOperation({ summary: 'Reactiva un producto desactivado' })
  @ApiOkResponse({ type: ProductResponseDto })
  @ApiBadRequestResponse({ description: 'El ID no es un UUID válido.' })
  @ApiForbiddenResponse({
    description: 'Solo ADMINISTRADOR reactiva productos.',
  })
  @ApiNotFoundResponse({ description: 'Producto no encontrado.' })
  async reactivate(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ProductResponse> {
    return this.audited(res, await this.products.setActive(id, true));
  }

  // Auditoría con el valor anterior y el nuevo; un cambio de estado que no
  // hizo nada no se registra.
  private audited(res: Response, change: ProductChange): ProductResponse {
    setAuditContext(res, {
      skipAudit: !change.changed,
      detail: { before: change.before, after: productSnapshot(change.product) },
    });
    return change.product;
  }
}
