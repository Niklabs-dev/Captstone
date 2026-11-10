import { Controller, Get, Header, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ROLE } from '../auth/constants/roles.constants.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import type { AuthUser } from '../auth/types/auth.types.js';
import { MyTipsQueryDto, MyTipsResponseDto } from './dto/my-tips.dto.js';
import { MyTipsService } from './my-tips.service.js';
import { MAX_DAILY_TIPS_RANGE_DAYS } from './types/daily-tips.types.js';
import type { MyTipsResponse } from './types/my-tips.types.js';

// Portal del trabajador (SPRINT-4A-T09): propinas diarias propias con su
// estado de pago. Exclusivo de TRABAJADOR y SUPERVISOR (que también recibe
// propina); ADMINISTRADOR y CONTADOR usan /daily-tips. Las constancias PDF
// históricas siguen en /my-tip-receipts.
@ApiTags('my-tips')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Sesión ausente, inválida o vencida.' })
@Roles(ROLE.TRABAJADOR, ROLE.SUPERVISOR)
@Controller('my-tips')
export class MyTipsController {
  constructor(private readonly myTips: MyTipsService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'Lista las propinas propias por día con su estado de pago',
    description:
      'Exclusivo de TRABAJADOR y SUPERVISOR. La identidad procede del JWT: no admite userId ni storeId. Por día: fecha, local, monto, estado (UNPAID No pagada o PAID Pagada), lote y fecha de pago; más los totales pendiente y pagado del rango. La propina aparece como No pagada apenas el supervisor guarda la operación diaria. Sin from ni to se consulta el mes en curso (hora de Chile).',
  })
  @ApiOkResponse({
    description: 'Propinas propias del rango y sus totales.',
    type: MyTipsResponseDto,
  })
  @ApiBadRequestResponse({
    description: `Fechas con formato inválido, solo una de from y to, from posterior a to, rango mayor a ${MAX_DAILY_TIPS_RANGE_DAYS} días o parámetros no admitidos (ej. userId).`,
  })
  list(
    @Query() query: MyTipsQueryDto,
    @CurrentUser() currentUser: AuthUser,
  ): Promise<MyTipsResponse> {
    return this.myTips.list(query, currentUser);
  }
}
