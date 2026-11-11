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
      'Panel consolidado de ventas importadas, alertas y diferencias por local',
    description:
      'Un día de negocio en hora de Chile (America/Santiago) agrupado por local: ventas de la versión vigente del Excel MrComanda con desglose dinámico por medio de pago del catálogo (activos más inactivos con historial), estado de la importación diaria (mismo cálculo de GET /sales-days), propinas de tarjeta y de efectivo y diferencia de efectivo declaradas en la operación diaria (con signo y motivo, sin compensar) y alertas legales vigentes hoy de registro en la DT y de propinas diarias No pagadas fuera del plazo legal de pago, con monto, días y atraso por local (tipLegalPaymentDays indica el plazo en días hábiles; alertsAsOf indica su fecha: no son históricas aunque se consulte un día pasado). Cada concepto es independiente: la propina nunca se suma a las ventas y no se infiere descuadre del Excel. Sin Excel vigente o sin operación diaria el dato es null (ausencia de datos). Ya no expone cierres por turno, bruto Mercado Pago, neto conciliable ni descuadre de vouchers: ese histórico se consulta en GET /sales-reports/legacy.',
  })
  @ApiOkResponse({
    description: 'Resumen por local y totales del día por concepto.',
    type: SalesDashboardDto,
  })
  @ApiBadRequestResponse({
    description:
      'La fecha no es válida, no tiene el formato YYYY-MM-DD o es posterior a hoy en Chile.',
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
