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
  ApiUnprocessableEntityResponse,
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
import { PreviewTipPoolDto } from './dto/preview-tip-pool.dto.js';
import {
  TipPoolResponseDto,
  TipPoolValidationErrorDto,
} from './dto/tip-pool-response.dto.js';
import { TipPoolsService } from './tip-pools.service.js';
import type { TipPoolResponse } from './types/tip-pools.types.js';

@ApiTags('tip-pools')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Token ausente, inválido o expirado.' })
@Controller('tip-pools')
export class TipPoolsController {
  constructor(private readonly tipPoolsService: TipPoolsService) {}

  @Post('preview')
  @Roles(ROLE.CONTADOR)
  @StoreScoped({ source: 'body' })
  @Audited({
    // El primer cálculo del período y los siguientes se distinguen en la
    // auditoría; el controller marca el recálculo con setAuditContext.
    action: (info) =>
      info.context?.detail?.recalculated === true
        ? AUDIT_ACTION.TIP_POOL_RECALCULATED
        : AUDIT_ACTION.TIP_POOL_CALCULATED,
    entityType: 'tip_pools',
    entityIdFrom: 'response.id',
    detailFromResponse: {
      storeId: 'store.id',
      periodStart: 'periodStart',
      periodEnd: 'periodEnd',
      agreementId: 'agreement.id',
      totalAmount: 'totalAmount',
      totalHours: 'totalHours',
    },
  })
  @ApiOperation({
    summary: 'Calcula y guarda la vista previa (DRAFT) del reparto de propinas',
    description:
      'Usa el pacto vigente, los registros diarios del período y las horas del período exacto. Si ya existe un borrador del mismo local y período, lo reemplaza conservando su ID.',
  })
  @ApiCreatedResponse({
    description: 'Primer cálculo del período: borrador creado.',
    type: TipPoolResponseDto,
  })
  @ApiOkResponse({
    description: 'Recálculo: el borrador existente se reemplazó.',
    type: TipPoolResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'Datos inválidos (UUID, fechas o período invertido) o local inactivo.',
  })
  @ApiForbiddenResponse({
    description: 'Solo el contador puede generar o recalcular repartos.',
  })
  @ApiNotFoundResponse({ description: 'Local no encontrado.' })
  @ApiConflictResponse({
    description:
      'El reparto del período ya está confirmado o pagado, o hubo un cálculo simultáneo.',
  })
  @ApiUnprocessableEntityResponse({
    description:
      'Faltan datos o son inconsistentes; se informan todas las causas y no se guarda nada.',
    type: TipPoolValidationErrorDto,
  })
  async preview(
    @Body() dto: PreviewTipPoolDto,
    @CurrentUser() currentUser: AuthUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<TipPoolResponse> {
    const result = await this.tipPoolsService.preview(dto, currentUser);
    res.status(result.created ? 201 : 200);
    setAuditContext(res, {
      storeId: result.pool.store.id,
      detail: {
        recalculated: !result.created,
        workers: result.pool.lines.length,
        sources: result.pool.sources.length,
      },
    });
    return result.pool;
  }

  @Get(':id')
  @Roles(ROLE.CONTADOR, ROLE.ADMINISTRADOR)
  @ApiOperation({
    summary: 'Obtiene la foto guardada de un reparto sin recalcularlo',
  })
  @ApiOkResponse({
    description: 'Reparto con el pacto, las líneas y las fuentes guardadas.',
    type: TipPoolResponseDto,
  })
  @ApiBadRequestResponse({ description: 'El ID no es un UUID válido.' })
  @ApiForbiddenResponse({
    description: 'El rol no permite consultar repartos.',
  })
  @ApiNotFoundResponse({
    description: 'Reparto no encontrado o sin acceso a su local.',
  })
  findOne(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() currentUser: AuthUser,
  ): Promise<TipPoolResponse> {
    return this.tipPoolsService.findOne(id, currentUser);
  }
}
