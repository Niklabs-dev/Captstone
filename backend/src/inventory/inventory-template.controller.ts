import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  Res,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
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
  PlacementQueryDto,
  UpdateTemplateRowDto,
} from './dto/product-request.dto.js';
import {
  PlacementSuggestionDto,
  ProductFieldErrorsDto,
  ProductSectionDto,
  TemplateRowResponseDto,
} from './dto/product-response.dto.js';
import { InventoryTemplateService } from './inventory-template.service.js';
import type {
  PlacementSuggestion,
  ProductSectionResponse,
  TemplateRowChange,
  TemplateRowResponse,
} from './types/products.types.js';

// Estructura de la plantilla de inventario (SPRINT-5-T03): la leen
// ADMINISTRADOR y SUPERVISOR; solo el ADMINISTRADOR corrige el texto de una
// fila sin producto o libera la fila de un producto desactivado. CONTADOR y
// TRABAJADOR reciben 403.
@ApiTags('products')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Token ausente, inválido o expirado.' })
@Controller('products')
export class InventoryTemplateController {
  constructor(private readonly template: InventoryTemplateService) {}

  @Get('sections')
  @Roles(ROLE.ADMINISTRADOR, ROLE.SUPERVISOR)
  @ApiOperation({
    summary: 'Lista las secciones de la plantilla y sus filas libres',
    description:
      'Roles: ADMINISTRADOR y SUPERVISOR. Filas libres son las filas de artículo sin producto (artículos pendientes y «<Vacío>»).',
  })
  @ApiOkResponse({ type: ProductSectionDto, isArray: true })
  @ApiForbiddenResponse({
    description: 'Solo ADMINISTRADOR y SUPERVISOR consultan la plantilla.',
  })
  sections(): Promise<ProductSectionResponse[]> {
    return this.template.sections();
  }

  @Get('template')
  @Roles(ROLE.ADMINISTRADOR, ROLE.SUPERVISOR)
  @ApiOperation({
    summary: 'Estructura de la plantilla: las filas en orden con su producto',
    description:
      'Roles: ADMINISTRADOR y SUPERVISOR. Devuelve las 182 filas (artículos, «<Vacío>», sin texto y secciones) en el orden de la hoja. Una fila de artículo sin producto es un artículo pendiente de crear. Al SUPERVISOR solo se le informan los productos activos.',
  })
  @ApiOkResponse({ type: TemplateRowResponseDto, isArray: true })
  @ApiForbiddenResponse({
    description: 'Solo ADMINISTRADOR y SUPERVISOR consultan la plantilla.',
  })
  rows(@CurrentUser() user: AuthUser): Promise<TemplateRowResponse[]> {
    return this.template.rows(user);
  }

  @Get('template/suggestion')
  @Roles(ROLE.ADMINISTRADOR)
  @ApiOperation({
    summary: 'Sugiere la fila de la plantilla para un producto nuevo',
    description:
      'Rol: ADMINISTRADOR. La fila de artículo sin producto que coincide con el nombre o un nombre alternativo (sin mayúsculas ni tildes); si no, la primera fila «<Vacío>» libre de la sección; si no queda ninguna, row null.',
  })
  @ApiOkResponse({ type: PlacementSuggestionDto })
  @ApiBadRequestResponse({
    description: 'Parámetros inválidos o sección inexistente.',
    type: ProductFieldErrorsDto,
  })
  @ApiForbiddenResponse({ description: 'Solo ADMINISTRADOR crea productos.' })
  suggestion(@Query() query: PlacementQueryDto): Promise<PlacementSuggestion> {
    return this.template.suggestion(query);
  }

  @Patch('template/rows/:id')
  @Roles(ROLE.ADMINISTRADOR)
  @Audited({
    action: AUDIT_ACTION.INVENTORY_TEMPLATE_ROW_UPDATED,
    entityType: 'inventory_template_rows',
    entityIdFrom: 'params.id',
  })
  @ApiOperation({
    summary: 'Corrige el texto de una fila de artículo sin producto',
    description:
      'Rol: ADMINISTRADOR. La plantilla tiene artículos desactualizados: se puede cambiar el texto de cualquier fila de artículo sin producto, también a «<Vacío>». La posición de la fila no cambia.',
  })
  @ApiOkResponse({ type: TemplateRowResponseDto })
  @ApiBadRequestResponse({
    description: 'ID o texto inválido.',
    type: ProductFieldErrorsDto,
  })
  @ApiForbiddenResponse({
    description: 'Solo ADMINISTRADOR edita la plantilla.',
  })
  @ApiNotFoundResponse({ description: 'Fila no encontrada.' })
  @ApiConflictResponse({
    description: 'La fila no es de artículo o tiene un producto.',
    type: ProductFieldErrorsDto,
  })
  async updateText(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateTemplateRowDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<TemplateRowResponse> {
    return this.audited(res, await this.template.updateText(id, dto));
  }

  @Patch('template/rows/:id/release')
  @Roles(ROLE.ADMINISTRADOR)
  @Audited({
    action: AUDIT_ACTION.INVENTORY_TEMPLATE_ROW_RELEASED,
    entityType: 'inventory_template_rows',
    entityIdFrom: 'params.id',
  })
  @ApiOperation({
    summary: 'Libera la fila de un producto desactivado',
    description:
      'Rol: ADMINISTRADOR. La fila queda sin producto para asignarla a otro; el producto sigue en el catálogo sin fila y sus tomas finalizadas no cambian. Una fila ya libre no cambia nada.',
  })
  @ApiOkResponse({ type: TemplateRowResponseDto })
  @ApiBadRequestResponse({ description: 'El ID no es un UUID válido.' })
  @ApiForbiddenResponse({
    description: 'Solo ADMINISTRADOR edita la plantilla.',
  })
  @ApiNotFoundResponse({ description: 'Fila no encontrada.' })
  @ApiConflictResponse({
    description: 'El producto de la fila está activo.',
    type: ProductFieldErrorsDto,
  })
  async release(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<TemplateRowResponse> {
    return this.audited(res, await this.template.release(id));
  }

  private audited(
    res: Response,
    change: TemplateRowChange,
  ): TemplateRowResponse {
    setAuditContext(res, {
      skipAudit: !change.changed,
      detail: {
        before: change.before,
        after: {
          ...change.before,
          printedText: change.row.printedText,
          productId: change.row.product?.id ?? null,
          productName: change.row.product?.name ?? null,
        },
      },
    });
    return change.row;
  }
}
