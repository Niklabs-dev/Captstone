import { Body, Controller, Post, Res } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
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
import { StoreScoped } from '../auth/decorators/store-scoped.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { AuthUser } from '../auth/types/auth.types.js';
import { CreateMrComandaSalesDto } from './dto/create-mrcomanda-sales.dto.js';
import { MrComandaSalesResponseDto } from './dto/mrcomanda-sales-response.dto.js';
import { SalesService } from './sales.service.js';
import type { MrComandaSalesResponse } from './types/sales.types.js';

@ApiTags('sales')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Token ausente, inválido o expirado.' })
@Controller('sales')
export class SalesController {
  constructor(private readonly salesService: SalesService) {}

  @Post('mrcomanda')
  @Roles(ROLE.ADMINISTRADOR, ROLE.SUPERVISOR)
  @StoreScoped({ field: 'storeId', source: 'body' })
  @Audited({
    action: AUDIT_ACTION.MRCOMANDA_SALES_IMPORTED,
    entityType: 'sales',
    detailFromBody: ['storeId', 'periodStart', 'periodEnd'],
    detailFromResponse: {
      created: 'created',
      totalNetAmount: 'totalNetAmount',
    },
  })
  @ApiOperation({
    summary:
      'Ingresa totales netos de ventas MrComanda por local, período y medio de pago',
    description:
      'Los totales MrComanda agregan el corte por medio y no deben mezclarse con ventas manuales del mismo período: el cierre las tomaría dos veces (como total agregado y como venta manual).',
  })
  @ApiCreatedResponse({
    description:
      'Totales registrados; en un reintento idéntico no duplica y devuelve created = false.',
    type: MrComandaSalesResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'Período inválido o fuera de un día de negocio en Chile, medios duplicados, inexistentes o inactivos.',
  })
  @ApiForbiddenResponse({
    description: 'Requiere ADMINISTRADOR o SUPERVISOR del local indicado.',
  })
  @ApiNotFoundResponse({ description: 'Local no encontrado.' })
  @ApiConflictResponse({
    description:
      'El período se solapa con un ingreso previo, con ventas ya conciliadas en un cierre cerrado, o el contenido difiere de lo registrado.',
  })
  async importMrComandaSales(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateMrComandaSalesDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<MrComandaSalesResponse> {
    const result = await this.salesService.importMrComandaSales(user, dto);
    setAuditContext(res, {
      storeId: result.storeId,
      skipAudit: !result.created,
    });
    return result;
  }
}
