import {
  Controller,
  Get,
  Header,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
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
import { StoreScoped } from '../auth/decorators/store-scoped.decorator.js';
import type { AuthUser } from '../auth/types/auth.types.js';
import { DailyTipsExportService } from './daily-tips-export.service.js';
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
import { XLSX_MIME_TYPE } from './export/daily-tips-workbook.js';
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
// lectura: el pago por período es SPRINT-4A-T06. La exportación a Excel
// (SPRINT-4A-T05) es solo de ADMINISTRADOR y CONTADOR.
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
  constructor(
    private readonly dailyTips: DailyTipsService,
    private readonly dailyTipsExport: DailyTipsExportService,
  ) {}

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

  @Get('export')
  @Roles(ROLE.ADMINISTRADOR, ROLE.CONTADOR)
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  @Audited({
    action: AUDIT_ACTION.DAILY_TIPS_EXPORTED,
    entityType: 'daily_tip_allocations',
    entityIdFrom: 'context.entityId',
  })
  @ApiProduces(XLSX_MIME_TYPE)
  @ApiOperation({
    summary: 'Exporta a Excel las propinas del período por trabajador y día',
    description:
      'Planilla .xlsx con dos hojas. «Resumen»: una fila por trabajador (nombre y RUT), una columna por día corrido del período, el total por trabajador y una fila final con el total por día y el total general. «Detalle»: fecha, trabajador, monto, estado (No pagada/Pagada) y lote de pago. Los montos son celdas numéricas con formato CLP y cuadran con GET /daily-tips/summary. Solo ADMINISTRADOR y CONTADOR; la descarga queda auditada sin montos ni datos personales.',
  })
  @ApiOkResponse({
    description:
      'Archivo .xlsx con nombre propinas_<local>_<desde>_<hasta>.xlsx en Content-Disposition (local en slug sin tildes ni espacios, fechas YYYY-MM-DD).',
    content: {
      [XLSX_MIME_TYPE]: { schema: { type: 'string', format: 'binary' } },
    },
    headers: {
      'Content-Disposition': {
        description: 'attachment con el nombre del archivo.',
        schema: {
          type: 'string',
          example:
            'attachment; filename="propinas_subway-melipilla-centro_2026-11-01_2026-11-15.xlsx"',
        },
      },
      'Cache-Control': {
        description: 'La planilla trae RUT y montos: no se guarda en caché.',
        schema: { type: 'string', example: 'private, no-store' },
      },
      'X-Content-Type-Options': {
        description: 'Siempre nosniff.',
        schema: { type: 'string', example: 'nosniff' },
      },
    },
  })
  @ApiBadRequestResponse({ description: RANGE_ERRORS })
  @ApiForbiddenResponse({
    description:
      'Solo ADMINISTRADOR y CONTADOR exportan; SUPERVISOR y TRABAJADOR reciben 403.',
  })
  @ApiNotFoundResponse({ description: 'El local indicado no existe.' })
  async exportPeriod(
    @Query() query: DailyTipsRangeQueryDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const file = await this.dailyTipsExport.exportPeriod(query);
    // La respuesta es el archivo: el local, el rango y las cantidades van a
    // la auditoría; nunca montos ni datos personales.
    setAuditContext(res, {
      entityId: file.store.id,
      storeId: file.store.id,
      detail: {
        storeId: file.store.id,
        from: file.from,
        to: file.to,
        workerCount: file.workerCount,
        allocationCount: file.allocationCount,
      },
    });
    return new StreamableFile(file.content, {
      type: XLSX_MIME_TYPE,
      disposition: `attachment; filename="${file.fileName}"`,
      length: file.content.length,
    });
  }
}
