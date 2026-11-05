import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ROLE } from '../auth/constants/roles.constants.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import type { AuthUser } from '../auth/types/auth.types.js';
import { SalesDashboardQueryDto } from './dto/sales-dashboard-query.dto.js';
import { SalesDashboardDto } from './dto/sales-dashboard-response.dto.js';
import { SalesDashboardService } from './sales-dashboard.service.js';
import type { SalesDashboard } from './types/sales-dashboard.types.js';

@ApiTags('sales-dashboard')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Token ausente, inválido o expirado.' })
@Roles(ROLE.ADMINISTRADOR)
@Controller('sales-dashboard')
export class SalesDashboardController {
  constructor(private readonly salesDashboard: SalesDashboardService) {}

  @Get()
  @ApiOperation({
    summary:
      'Consulta consolidada de ventas, alertas y diferencias de caja por local',
    description:
      'Agrupa por local las ventas netas del día en hora de Chile (sin propina), la propina con tarjeta como concepto separado, las cifras de los cierres de caja del día, los cierres con diferencias pendientes y las alertas vigentes de registro en la DT y de entrega de propinas.',
  })
  @ApiOkResponse({
    description: 'Resumen por local y totales generales del día.',
    type: SalesDashboardDto,
  })
  @ApiBadRequestResponse({
    description: 'La fecha no es válida o no tiene el formato YYYY-MM-DD.',
  })
  @ApiForbiddenResponse({
    description: 'Solo el administrador puede consultar el consolidado.',
  })
  get(
    @Query() query: SalesDashboardQueryDto,
    @CurrentUser() currentUser: AuthUser,
  ): Promise<SalesDashboard> {
    return this.salesDashboard.get(query, currentUser);
  }
}
