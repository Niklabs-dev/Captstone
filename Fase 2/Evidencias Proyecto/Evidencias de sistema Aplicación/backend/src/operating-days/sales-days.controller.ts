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
import { ListSalesDaysQueryDto } from './dto/operating-days-request.dto.js';
import { SalesDaysDto } from './dto/operating-days-response.dto.js';
import { OperatingDaysService } from './operating-days.service.js';
import type { SalesDaysResponse } from './types/operating-days.types.js';

// Estado diario de ventas por local (SPRINT-4R-T12): el aviso de ventas sin
// importar vive en el panel administrativo (sin correos ni push).
@ApiTags('sales-days')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Token ausente, inválido o expirado.' })
@ApiForbiddenResponse({
  description: 'Solo el ADMINISTRADOR consulta el estado de ventas diario.',
})
@Roles(ROLE.ADMINISTRADOR)
@Controller('sales-days')
export class SalesDaysController {
  constructor(private readonly operatingDays: OperatingDaysService) {}

  @Get()
  @ApiOperation({
    summary: 'Lista el estado de ventas por local y día en un rango de fechas',
    description:
      'Un elemento por local y fecha de negocio (hora de Chile), calculado ' +
      'al consultar: IMPORTADO si hay importación vigente; si no, CERRADO ' +
      'cuando el local no abre ese día o tiene un cierre por excepción; ' +
      'PENDIENTE si es hoy (informativo) y ATRASADO si es un día pasado ' +
      '(alerta). Una importación tardía lo resuelve sola. No informa días ' +
      'futuros, días anteriores a la fecha de inicio del calendario, locales ' +
      'sin calendario (salvo días importados) ni locales inactivos. Por ' +
      'defecto los últimos 30 días hasta hoy; máximo 366 días.',
  })
  @ApiOkResponse({
    description: 'Estados del rango con su resumen por estado.',
    type: SalesDaysDto,
  })
  @ApiBadRequestResponse({
    description:
      'Fechas, local o estado con formato inválido, from posterior a to o rango mayor a 366 días.',
  })
  @ApiNotFoundResponse({ description: 'El local indicado no existe.' })
  list(@Query() query: ListSalesDaysQueryDto): Promise<SalesDaysResponse> {
    return this.operatingDays.listSalesDays(query);
  }
}
