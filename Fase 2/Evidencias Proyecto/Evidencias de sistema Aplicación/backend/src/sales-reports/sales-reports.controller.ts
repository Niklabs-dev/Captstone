import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ROLE } from '../auth/constants/roles.constants.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { SalesReportQueryDto } from './dto/sales-reports-query.dto.js';
import {
  LegacySalesReportDto,
  SalesReportDto,
} from './dto/sales-reports-response.dto.js';
import { SalesReportsService } from './sales-reports.service.js';
import type {
  LegacySalesReport,
  SalesReport,
} from './types/sales-reports.types.js';

// Reportes de ventas y diferencias por período y local (SPRINT-4R-T13):
// exclusivos del ADMINISTRADOR.
@ApiTags('sales-reports')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Token ausente, inválido o expirado.' })
@ApiForbiddenResponse({
  description: 'Solo el ADMINISTRADOR puede consultar los reportes.',
})
@Roles(ROLE.ADMINISTRADOR)
@Controller('sales-reports')
export class SalesReportsController {
  constructor(private readonly salesReports: SalesReportsService) {}

  @Get()
  @ApiOperation({
    summary: 'Reporte de ventas importadas y diferencias por período y local',
    description:
      'Rango de días de negocio en hora de Chile (America/Santiago), de un local o de todos. Las ventas salen exclusivamente de la versión vigente del Excel MrComanda (importación ACTIVE), con columnas dinámicas por medio de pago del catálogo (activos más inactivos con historial en el período). Las propinas de tarjeta y de efectivo y la diferencia de efectivo salen de la operación diaria y se informan como conceptos separados: nunca se suman a las ventas ni se infiere un descuadre del Excel. Sobrantes y faltantes se totalizan por separado, sin compensar, y cada diferencia distinta de cero se lista con signo y motivo. Un día sin Excel vigente o sin operación diaria se informa con null (ausencia de datos), no con cero.',
  })
  @ApiOkResponse({
    description: 'Reporte por local, por día y totales por concepto.',
    type: SalesReportDto,
  })
  @ApiBadRequestResponse({
    description:
      'Fechas con formato inválido, from posterior a to, to posterior a hoy, rango mayor a 366 días o storeId no es UUID.',
  })
  @ApiNotFoundResponse({ description: 'El local indicado no existe.' })
  report(@Query() query: SalesReportQueryDto): Promise<SalesReport> {
    return this.salesReports.report(query);
  }

  @Get('legacy')
  @ApiOperation({
    summary: 'Consulta histórica de cierres por turno y ventas anteriores',
    description:
      'Legado de solo lectura previo a SPRINT-4R-T01: cierres de caja por turno con bruto Mercado Pago, neto MrComanda conciliado y descuadre de vouchers, más las ventas de la tabla sales. Se consulta aparte y no se mezcla con el reporte vigente ni con la diferencia de efectivo de la operación diaria. Mismos filtros y validaciones que GET /sales-reports.',
  })
  @ApiOkResponse({
    description: 'Históricos del período.',
    type: LegacySalesReportDto,
  })
  @ApiBadRequestResponse({
    description:
      'Fechas con formato inválido, from posterior a to, to posterior a hoy, rango mayor a 366 días o storeId no es UUID.',
  })
  @ApiNotFoundResponse({ description: 'El local indicado no existe.' })
  legacy(@Query() query: SalesReportQueryDto): Promise<LegacySalesReport> {
    return this.salesReports.legacy(query);
  }
}
