import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
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
  CreateStoreClosureDto,
  UpdateOperatingCalendarDto,
} from './dto/operating-days-request.dto.js';
import {
  OperatingCalendarDto,
  StoreClosureDto,
} from './dto/operating-days-response.dto.js';
import { OperatingDaysService } from './operating-days.service.js';
import type {
  OperatingCalendarResponse,
  StoreClosureResponse,
} from './types/operating-days.types.js';

// Calendario de operación de cada local (SPRINT-4R-T12): días semanales en
// que abre, desde cuándo se exigen ventas importadas y cierres por
// excepción con motivo. Solo el ADMINISTRADOR lo consulta y lo cambia; es
// independiente de los horarios de los trabajadores.
@ApiTags('operating-calendar')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Token ausente, inválido o expirado.' })
@ApiForbiddenResponse({
  description: 'Solo el ADMINISTRADOR administra el calendario de los locales.',
})
@Roles(ROLE.ADMINISTRADOR)
@Controller('stores/:storeId')
export class OperatingCalendarController {
  constructor(private readonly operatingDays: OperatingDaysService) {}

  @Get('operating-calendar')
  @ApiOperation({
    summary: 'Obtiene el calendario de operación y los cierres de un local',
    description:
      'configured es false mientras no se configure: ese local no genera ' +
      'alertas de ventas faltantes.',
  })
  @ApiOkResponse({
    description: 'Calendario con sus cierres por excepción.',
    type: OperatingCalendarDto,
  })
  @ApiBadRequestResponse({ description: 'El ID del local no es un UUID.' })
  @ApiNotFoundResponse({ description: 'Local no encontrado.' })
  getCalendar(
    @Param('storeId', new ParseUUIDPipe()) storeId: string,
  ): Promise<OperatingCalendarResponse> {
    return this.operatingDays.getCalendar(storeId);
  }

  @Put('operating-calendar')
  @Audited({
    action: AUDIT_ACTION.STORE_OPERATING_CALENDAR_UPDATED,
    entityType: 'store_operating_schedules',
    entityIdFrom: 'params.storeId',
  })
  @ApiOperation({
    summary:
      'Configura los días en que abre un local y desde cuándo se exigen ventas',
    description:
      'Crea o reemplaza el calendario del local (activo). Los días que no ' +
      'abre quedan CERRADO y nunca generan alerta; los anteriores a ' +
      'trackingStartDate no se informan. Se audita junto con la ' +
      'configuración anterior.',
  })
  @ApiOkResponse({
    description: 'Calendario actualizado.',
    type: OperatingCalendarDto,
  })
  @ApiBadRequestResponse({
    description:
      'Días inválidos (fuera de 1 a 7, repetidos o ninguno), fecha inválida, o el local está inactivo.',
  })
  @ApiNotFoundResponse({ description: 'Local no encontrado.' })
  async updateCalendar(
    @Param('storeId', new ParseUUIDPipe()) storeId: string,
    @Body() dto: UpdateOperatingCalendarDto,
    @CurrentUser() currentUser: AuthUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<OperatingCalendarResponse> {
    const { calendar, previous } = await this.operatingDays.updateCalendar(
      storeId,
      dto,
      currentUser,
    );
    setAuditContext(res, {
      storeId,
      detail: {
        weekdays: calendar.weekdays,
        trackingStartDate: calendar.trackingStartDate,
        previousWeekdays: previous?.weekdays ?? null,
        previousTrackingStartDate: previous?.trackingStartDate ?? null,
      },
    });
    return calendar;
  }

  @Post('closures')
  @Audited({
    action: AUDIT_ACTION.STORE_CLOSURE_CREATED,
    entityType: 'store_closures',
    entityIdFrom: 'response.id',
  })
  @ApiOperation({
    summary: 'Registra un cierre por excepción de un local con su motivo',
    description:
      'Ese día queda CERRADO y nunca genera alerta, salvo que igual tenga ' +
      'ventas importadas (IMPORTADO). Uno por local y fecha.',
  })
  @ApiCreatedResponse({
    description: 'Cierre registrado.',
    type: StoreClosureDto,
  })
  @ApiBadRequestResponse({
    description: 'Fecha o motivo inválidos, o el local está inactivo.',
  })
  @ApiNotFoundResponse({ description: 'Local no encontrado.' })
  @ApiConflictResponse({
    description:
      'Ya existe un cierre para ese local y fecha; incluye existingClosureId.',
  })
  async addClosure(
    @Param('storeId', new ParseUUIDPipe()) storeId: string,
    @Body() dto: CreateStoreClosureDto,
    @CurrentUser() currentUser: AuthUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StoreClosureResponse> {
    const closure = await this.operatingDays.addClosure(
      storeId,
      dto,
      currentUser,
    );
    setAuditContext(res, {
      storeId,
      detail: { date: closure.date, reason: closure.reason },
    });
    return closure;
  }

  @Delete('closures/:closureId')
  @Audited({
    action: AUDIT_ACTION.STORE_CLOSURE_DELETED,
    entityType: 'store_closures',
    entityIdFrom: 'params.closureId',
  })
  @ApiOperation({
    summary: 'Quita un cierre por excepción registrado por error',
    description:
      'El día vuelve a evaluarse con el calendario semanal. La auditoría ' +
      'conserva la fecha y el motivo del cierre retirado.',
  })
  @ApiOkResponse({
    description: 'Datos del cierre retirado.',
    type: StoreClosureDto,
  })
  @ApiBadRequestResponse({ description: 'Algún ID no es un UUID.' })
  @ApiNotFoundResponse({
    description: 'El cierre no existe o no pertenece a ese local.',
  })
  async removeClosure(
    @Param('storeId', new ParseUUIDPipe()) storeId: string,
    @Param('closureId', new ParseUUIDPipe()) closureId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StoreClosureResponse> {
    const closure = await this.operatingDays.removeClosure(storeId, closureId);
    setAuditContext(res, {
      storeId,
      detail: { date: closure.date, reason: closure.reason },
    });
    return closure;
  }
}
