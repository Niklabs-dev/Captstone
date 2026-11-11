import { Controller, Get } from '@nestjs/common';
import {
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
import { TipPaymentAlertCollectionDto } from './dto/tip-payment-alert-response.dto.js';
import { TipPaymentAlertsService } from './tip-payment-alerts.service.js';
import type { TipPaymentAlertCollection } from './types/tip-payment-alerts.types.js';

// Alerta legal de pago de propinas (SPRINT-3-T14; desde SPRINT-4A-T22 sobre
// las propinas diarias y con plazo TIP_LEGAL_PAYMENT_DAYS). Solo CONTADOR y
// ADMINISTRADOR, como antes: el SUPERVISOR no paga propinas.
@ApiTags('tip-payment-alerts')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Token ausente, inválido o expirado.' })
@Roles(ROLE.CONTADOR, ROLE.ADMINISTRADOR)
@Controller('tip-payment-alerts')
export class TipPaymentAlertsController {
  constructor(
    private readonly tipPaymentAlertsService: TipPaymentAlertsService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Lista las propinas diarias no pagadas fuera del plazo legal',
    description:
      'Agrupa por local y trabajador las propinas diarias (daily_tip_allocations) en estado UNPAID cuya fecha de negocio superó el plazo legal de pago: TIP_LEGAL_PAYMENT_DAYS días hábiles (7 por defecto; lunes a viernes sin los feriados de TIP_ALERT_HOLIDAYS), contados desde el día siguiente a la fecha de la propina en hora de Chile. El día límite todavía está en plazo: la alerta aparece desde el día siguiente. Al pagar el período con POST /daily-tips/payment-batches las propinas pasan a PAID y la alerta desaparece. Los registros históricos tip_entries del reparto por período ya no generan alertas.',
  })
  @ApiOkResponse({
    description:
      'Alertas con cantidad de días, monto, fecha más antigua y días de atraso, más el plazo vigente y los totales.',
    type: TipPaymentAlertCollectionDto,
  })
  @ApiForbiddenResponse({
    description:
      'Solo el contador y el administrador pueden consultar alertas.',
  })
  list(
    @CurrentUser() currentUser: AuthUser,
  ): Promise<TipPaymentAlertCollection> {
    return this.tipPaymentAlertsService.list(currentUser);
  }
}
