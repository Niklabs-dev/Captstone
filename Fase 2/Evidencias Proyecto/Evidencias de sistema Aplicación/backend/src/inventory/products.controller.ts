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
  MoveProductDto,
  UpdateProductDto,
} from './dto/product-request.dto.js';
import {
  ProductFieldErrorsDto,
  ProductResponseDto,
} from './dto/product-response.dto.js';
import { productSnapshot } from './inventory-catalog.js';
import { ProductsService } from './products.service.js';
import type { ProductChange, ProductResponse } from './types/products.types.js';

// Productos de inventario (SPRINT-5-T03). Crear, editar, mover, desactivar y
// reactivar son del ADMINISTRADOR; el SUPERVISOR consulta el catálogo activo
// para sus tomas; CONTADOR y TRABAJADOR reciben 403. Cada cambio queda en
// auditoría con el valor anterior y el nuevo.
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
      'Roles: ADMINISTRADOR y SUPERVISOR. Filtra por sección, estado, formato o SKU faltante y busca por nombre, nombre alternativo o SKU, sin distinguir mayúsculas ni tildes. El SUPERVISOR solo recibe productos activos.',
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

  @Post()
  @Roles(ROLE.ADMINISTRADOR)
  @Audited({
    action: AUDIT_ACTION.PRODUCT_CREATED,
    entityType: 'products',
    entityIdFrom: 'response.id',
  })
  @ApiOperation({
    summary: 'Crea un producto y lo ubica en una fila de la plantilla',
    description:
      'Rol: ADMINISTRADOR. Ocupa la fila elegida (templateRowId) o la sugerida: la fila de artículo sin producto que coincide con su nombre o un nombre alternativo; si no, una fila «<Vacío>» libre de la sección. Si no queda ninguna responde 409: nunca se insertan, borran ni reordenan filas. El SKU es opcional: lo entrega el proveedor.',
  })
  @ApiCreatedResponse({ type: ProductResponseDto })
  @ApiBadRequestResponse({
    description:
      'Datos inválidos, sección inexistente, fila de otra sección o formato inválido (errores por campo).',
    type: ProductFieldErrorsDto,
  })
  @ApiForbiddenResponse({ description: 'Solo ADMINISTRADOR crea productos.' })
  @ApiConflictResponse({
    description:
      'Nombre, nombre alternativo o SKU repetidos, fila ocupada o sin filas libres en la sección (errores por campo).',
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
    summary:
      'Edita el nombre, los nombres alternativos, la unidad, el SKU o el formato',
    description:
      'Rol: ADMINISTRADOR. Renombrar conserva la fila del producto en la plantilla (Lata Coca Cola pasa a Lata Pepsi). Las líneas de tomas guardan su propia copia y no cambian. Una edición sin cambios no se audita. Para cambiar de fila se usa PATCH /products/{id}/move.',
  })
  @ApiOkResponse({ type: ProductResponseDto })
  @ApiBadRequestResponse({
    description:
      'ID inválido, datos inválidos o un campo obligatorio en null (errores por campo).',
    type: ProductFieldErrorsDto,
  })
  @ApiForbiddenResponse({ description: 'Solo ADMINISTRADOR edita productos.' })
  @ApiNotFoundResponse({ description: 'Producto no encontrado.' })
  @ApiConflictResponse({
    description: 'Nombre, nombre alternativo o SKU repetidos.',
    type: ProductFieldErrorsDto,
  })
  async update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateProductDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ProductResponse> {
    return this.audited(res, await this.products.update(id, dto));
  }

  @Patch(':id/move')
  @Roles(ROLE.ADMINISTRADOR)
  @Audited({
    action: AUDIT_ACTION.PRODUCT_MOVED,
    entityType: 'products',
    entityIdFrom: 'params.id',
  })
  @ApiOperation({
    summary: 'Mueve un producto a otra fila libre de la plantilla',
    description:
      'Rol: ADMINISTRADOR. La fila destino es una fila de artículo sin producto, de cualquier sección; la anterior queda libre. No cambia la posición de ninguna fila. Moverlo a su misma fila no cambia nada.',
  })
  @ApiOkResponse({ type: ProductResponseDto })
  @ApiBadRequestResponse({
    description: 'ID inválido o la fila destino no es de artículo.',
    type: ProductFieldErrorsDto,
  })
  @ApiForbiddenResponse({ description: 'Solo ADMINISTRADOR mueve productos.' })
  @ApiNotFoundResponse({ description: 'Producto no encontrado.' })
  @ApiConflictResponse({
    description: 'La fila destino ya tiene un producto.',
    type: ProductFieldErrorsDto,
  })
  async move(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: MoveProductDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ProductResponse> {
    return this.audited(res, await this.products.move(id, dto));
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
      'Rol: ADMINISTRADOR. Deja de aparecer en tomas nuevas y conserva su fila y las tomas finalizadas. Repetir la acción no cambia nada.',
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
  @ApiOperation({
    summary: 'Reactiva un producto desactivado',
    description:
      'Rol: ADMINISTRADOR. Si su fila se liberó, queda sin fila hasta moverlo a una libre.',
  })
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

  // Auditoría con el valor anterior y el nuevo; una solicitud que no cambió
  // nada no se registra.
  private audited(res: Response, change: ProductChange): ProductResponse {
    setAuditContext(res, {
      skipAudit: !change.changed,
      detail: { before: change.before, after: productSnapshot(change.product) },
    });
    return change.product;
  }
}
