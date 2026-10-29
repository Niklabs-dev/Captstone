import { ApiProperty } from '@nestjs/swagger';
import {
  TIP_PAYMENT_ALERT_STATUSES,
  type TipPaymentAlert,
  type TipPaymentAlertCollection,
  type TipPaymentAlertPool,
  type TipPaymentAlertStatus,
} from '../types/tip-payment-alerts.types.js';
import {
  TIP_POOL_STATUSES,
  type TipPoolStatusCode,
} from '../types/tip-pools.types.js';
import type { PaymentMethodCode } from '../types/tips.types.js';

class TipPaymentAlertStoreDto {
  @ApiProperty({
    description: 'ID del local (UUID).',
    example: '1010021e-9bab-42d5-851c-417e9e2503bf',
  })
  id: string;

  @ApiProperty({ description: 'Nombre del local.', example: 'Santa María' })
  name: string;
}

export class TipPaymentAlertPoolDto implements TipPaymentAlertPool {
  @ApiProperty({
    description: 'ID del reparto asociado (UUID).',
    example: 'a9000000-0000-4000-8000-000000000009',
  })
  id: string;

  @ApiProperty({
    description: 'Estado actual del reparto; si está PAID ya no hay alerta.',
    enum: TIP_POOL_STATUSES,
    example: 'CONFIRMED',
  })
  status: TipPoolStatusCode;

  @ApiProperty({
    description: 'Primer día del período del reparto (YYYY-MM-DD).',
    example: '2026-10-01',
  })
  periodStart: string;

  @ApiProperty({
    description: 'Último día del período del reparto (YYYY-MM-DD).',
    example: '2026-10-15',
  })
  periodEnd: string;
}

export class TipPaymentAlertDto implements TipPaymentAlert {
  @ApiProperty({
    description: 'ID de la alerta; coincide con el registro diario (UUID).',
    example: 'a9000000-0000-4000-8000-000000000005',
  })
  id: string;

  @ApiProperty({
    description: 'ID del registro diario con tarjeta (UUID).',
    example: 'a9000000-0000-4000-8000-000000000005',
  })
  tipEntryId: string;

  @ApiProperty({
    description: 'Local del registro.',
    type: TipPaymentAlertStoreDto,
  })
  store: TipPaymentAlertStoreDto;

  @ApiProperty({
    description: 'Fecha en que se recibió la propina (YYYY-MM-DD).',
    example: '2026-10-02',
  })
  businessDate: string;

  @ApiProperty({
    description: 'Medio de pago con tarjeta.',
    enum: ['DEBIT_CARD', 'CREDIT_CARD'],
    example: 'DEBIT_CARD',
  })
  paymentMethod: PaymentMethodCode;

  @ApiProperty({ description: 'Monto pendiente en CLP.', example: 4000 })
  amount: number;

  @ApiProperty({
    description:
      'Reparto asociado y su período; null si el registro aún no se reparte.',
    type: TipPaymentAlertPoolDto,
    nullable: true,
  })
  pool: TipPaymentAlertPoolDto | null;

  @ApiProperty({
    description:
      'Séptimo día hábil posterior a businessDate, sin sábados, domingos ni feriados configurados (YYYY-MM-DD).',
    example: '2026-10-13',
  })
  deadline: string;

  @ApiProperty({
    description:
      'Días hábiles restantes en hora de Chile: 0 en el día límite y negativo al vencer. Un fin de semana posterior al límite puede tener 0 y estado OVERDUE.',
    example: 3,
  })
  daysRemaining: number;

  @ApiProperty({
    description:
      'UPCOMING hasta el día límite; OVERDUE desde el día siguiente.',
    enum: TIP_PAYMENT_ALERT_STATUSES,
    example: 'UPCOMING',
  })
  status: TipPaymentAlertStatus;
}

export class TipPaymentAlertCollectionDto implements TipPaymentAlertCollection {
  @ApiProperty({
    description:
      'Alertas pendientes, primero vencidas y luego por fecha límite.',
    type: [TipPaymentAlertDto],
  })
  items: TipPaymentAlertDto[];

  @ApiProperty({
    description: 'Instante del cálculo de días restantes (ISO 8601).',
    example: '2026-10-28T15:00:00.000Z',
  })
  calculatedAt: Date;
}
