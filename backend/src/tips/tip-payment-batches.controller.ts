import { Body, Controller, Get, Post, Query } from '@nestjs/common';
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
import { AUDIT_ACTION } from '../audit/constants/audit-actions.constants.js';
import { Audited } from '../audit/decorators/audited.decorator.js';
import { ROLE } from '../auth/constants/roles.constants.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import type { AuthUser } from '../auth/types/auth.types.js';
import {
  TipPaymentBatchListResponseDto,
  TipPaymentBatchResponseDto,
  TipPaymentConflictDto,
  TipPaymentPeriodDto,
} from './dto/tip-payment-batch.dto.js';
import { TipPaymentBatchesService } from './tip-payment-batches.service.js';
import {
  MAX_DAILY_TIPS_RANGE_DAYS,
  type TipPaymentBatchListResponse,
  type TipPaymentBatchResponse,
} from './types/daily-tips.types.js';

const RANGE_ERRORS =
  'storeId no es UUID, fechas con formato inválido, from posterior a to o ' +
  `rango mayor a ${MAX_DAILY_TIPS_RANGE_DAYS} días.`;

// Pago por período de las propinas diarias (SPRINT-4A-T06): registrar el
// pago de un local y período (un lote que marca como Pagadas sus propinas No
// pagadas) y consultar el historial de pagos. Solo ADMINISTRADOR y CONTADOR;
// SUPERVISOR y TRABAJADOR reciben 403.
@ApiTags('daily-tips')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Token ausente, inválido o expirado.' })
@ApiForbiddenResponse({
  description:
    'Solo ADMINISTRADOR y CONTADOR; SUPERVISOR y TRABAJADOR reciben 403.',
})
@Roles(ROLE.ADMINISTRADOR, ROLE.CONTADOR)
@Controller('daily-tips/payment-batches')
export class TipPaymentBatchesController {
  constructor(private readonly payments: TipPaymentBatchesService) {}

  @Post()
  @Audited({
    action: AUDIT_ACTION.DAILY_TIPS_PAID,
    entityType: 'tip_payment_batches',
    entityIdFrom: 'response.id',
    detailFromResponse: {
      storeId: 'store.id',
      periodStart: 'periodStart',
      periodEnd: 'periodEnd',
      totalAmount: 'totalAmount',
      allocationCount: 'allocationCount',
      workerCount: 'workerCount',
      paidAt: 'paidAt',
    },
  })
  @ApiOperation({
    summary: 'Marca como pagadas las propinas No pagadas de un período',
    description:
      'Crea un lote de pago del local y período (desde y hasta, inclusive) y marca en él, en una sola transacción con bloqueo, todas las propinas diarias No pagadas del período; responde con el total y la cantidad. Las ya pagadas no se modifican. Dos solicitudes simultáneas o un doble clic no duplican el pago: la segunda responde 409. Desde el pago, la operación diaria de esos días ya no admite corregir montos ni participantes. El pago queda auditado (quién, cuándo, local, período y total). No se puede revertir.',
  })
  @ApiCreatedResponse({
    description:
      'Lote creado con el total, la cantidad de propinas y de trabajadores.',
    type: TipPaymentBatchResponseDto,
  })
  @ApiBadRequestResponse({
    description: `${RANGE_ERRORS} También campos desconocidos en el cuerpo.`,
  })
  @ApiNotFoundResponse({ description: 'El local indicado no existe.' })
  @ApiConflictResponse({
    description:
      'No hay propinas No pagadas en el período (o una solicitud simultánea ya las pagó): no se crea el lote.',
    type: TipPaymentConflictDto,
  })
  pay(
    @Body() dto: TipPaymentPeriodDto,
    @CurrentUser() currentUser: AuthUser,
  ): Promise<TipPaymentBatchResponse> {
    return this.payments.pay(dto, currentUser);
  }

  @Get()
  @ApiOperation({
    summary: 'Historial de pagos de propinas del local',
    description:
      'Lotes de pago del local cuyo período se cruza con el rango consultado, ordenados por fecha de pago descendente, con el mismo formato que la respuesta del pago. Incluye los lotes históricos migrados de los repartos por período ya pagados.',
  })
  @ApiOkResponse({
    description: 'Lotes de pago del rango, del más reciente al más antiguo.',
    type: TipPaymentBatchListResponseDto,
  })
  @ApiBadRequestResponse({ description: RANGE_ERRORS })
  @ApiNotFoundResponse({ description: 'El local indicado no existe.' })
  list(
    @Query() query: TipPaymentPeriodDto,
  ): Promise<TipPaymentBatchListResponse> {
    return this.payments.list(query);
  }
}
