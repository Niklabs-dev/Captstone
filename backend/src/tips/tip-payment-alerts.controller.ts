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
    summary: 'Lista las propinas con tarjeta pendientes de entrega',
    description:
      'Calcula el séptimo día hábil desde cada registro con débito o crédito, excluyendo sábados, domingos y los feriados de TIP_ALERT_HOLIDAYS. Incluye registros sin reparto y repartos DRAFT o CONFIRMED; los PAID desaparecen. Primero las vencidas y luego las más próximas.',
  })
  @ApiOkResponse({
    description:
      'Alertas con fecha límite, días hábiles restantes y estado, calculadas en hora de Chile.',
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
