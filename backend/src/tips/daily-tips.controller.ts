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
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { StoreScoped } from '../auth/decorators/store-scoped.decorator.js';
import type { AuthUser } from '../auth/types/auth.types.js';
import { DailyTipsService } from './daily-tips.service.js';
import {
  DailyTipDayQueryDto,
  DailyTipsRangeQueryDto,
  DailyTipsSummaryQueryDto,
} from './dto/daily-tips-query.dto.js';
import {
  DailyTipDayDetailResponseDto,
  DailyTipDaysResponseDto,
  DailyTipSummaryResponseDto,
} from './dto/daily-tips-response.dto.js';
import {
  MAX_DAILY_TIPS_RANGE_DAYS,
  type DailyTipDayDetailResponse,
  type DailyTipDaysResponse,
  type DailyTipSummaryResponse,
} from './types/daily-tips.types.js';

const RANGE_ERRORS =
  'storeId no es UUID, fechas con formato inválido, from posterior a to o ' +
  `rango mayor a ${MAX_DAILY_TIPS_RANGE_DAYS} días.`;

// Consulta de propinas diarias por trabajador (SPRINT-4A-T04): la propina de
// cada trabajador se guarda al registrar la operación diaria (SPRINT-4A-T03)
// y aquí se consulta por día, por trabajador y por período. ADMINISTRADOR y
// CONTADOR consultan todos los locales; el SUPERVISOR solo lee el suyo
// (StoreScoped); TRABAJADOR no accede (su portal es SPRINT-4A-T09). Solo
// lectura: el pago por período es SPRINT-4A-T06.
@ApiTags('daily-tips')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Token ausente, inválido o expirado.' })
@ApiForbiddenResponse({
  description:
    'Solo ADMINISTRADOR y CONTADOR (todos los locales) o el SUPERVISOR de su propio local; TRABAJADOR no accede.',
})
@Roles(ROLE.ADMINISTRADOR, ROLE.CONTADOR, ROLE.SUPERVISOR)
@Controller('daily-tips')
export class DailyTipsController {
  constructor(private readonly dailyTips: DailyTipsService) {}

  @Get('days')
  @StoreScoped({ source: 'query' })
  @ApiOperation({
    summary: 'Total diario de propinas del local en un rango de días',
    description:
      'Un elemento por día con operación diaria registrada (aunque su fondo sea 0), en orden de fecha: total repartido, pagado, pendiente, cantidad de participantes y estado del día (UNPAID No pagado, PARTIAL Parcial o PAID Pagado). Los totales del rango cuadran con la suma de los días y con las propinas guardadas.',
  })
  @ApiOkResponse({
    description: 'Días del rango con sus totales.',
    type: DailyTipDaysResponseDto,
  })
  @ApiBadRequestResponse({ description: RANGE_ERRORS })
  @ApiNotFoundResponse({ description: 'El local indicado no existe.' })
  listDays(
    @Query() query: DailyTipsRangeQueryDto,
    @CurrentUser() currentUser: AuthUser,
  ): Promise<DailyTipDaysResponse> {
    return this.dailyTips.listDays(query, currentUser);
  }

  @Get('day')
  @StoreScoped({ source: 'query' })
  @ApiOperation({
    summary: 'Detalle por trabajador de las propinas de un día del local',
    description:
      'Monto y estado de la propina de cada participante del día (ej. $40.000 entre 4: $10.000 No pagada a cada uno), con el lote y la fecha de pago si ya está pagada. Solo id y nombre de cada persona.',
  })
  @ApiOkResponse({
    description: 'Día con la propina de cada trabajador.',
    type: DailyTipDayDetailResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'storeId no es UUID o businessDate con formato inválido.',
  })
  @ApiNotFoundResponse({
    description:
      'El local no existe o no tiene operación diaria registrada ese día.',
  })
  findDay(
    @Query() query: DailyTipDayQueryDto,
    @CurrentUser() currentUser: AuthUser,
  ): Promise<DailyTipDayDetailResponse> {
    return this.dailyTips.findDay(query, currentUser);
  }

  @Get('summary')
  @StoreScoped({ source: 'query' })
  @ApiOperation({
    summary: 'Resumen de propinas del período por trabajador',
    description:
      'Por trabajador: cantidad de días con propina, total, pendiente (UNPAID) y pagado (PAID), más el total general del período, que cuadra con la suma de los trabajadores y con las propinas guardadas. Con status solo se consideran las propinas de ese estado (ej. UNPAID para ver lo que falta pagar).',
  })
  @ApiOkResponse({
    description: 'Totales del período por trabajador y total general.',
    type: DailyTipSummaryResponseDto,
  })
  @ApiBadRequestResponse({
    description: `${RANGE_ERRORS} status distinto de UNPAID o PAID.`,
  })
  @ApiNotFoundResponse({ description: 'El local indicado no existe.' })
  summarize(
    @Query() query: DailyTipsSummaryQueryDto,
    @CurrentUser() currentUser: AuthUser,
  ): Promise<DailyTipSummaryResponse> {
    return this.dailyTips.summarize(query, currentUser);
  }
}
