import { ApiProperty } from '@nestjs/swagger';
import type {
  TipPaymentAlert,
  TipPaymentAlertCollection,
  TipPaymentAlertRef,
  TipPaymentAlertSummary,
} from '../types/tip-payment-alerts.types.js';

// Respuesta de GET /tip-payment-alerts (SPRINT-4A-T22): propinas diarias No
// pagadas fuera del plazo legal, por local y trabajador.

class TipPaymentAlertStoreDto implements TipPaymentAlertRef {
  @ApiProperty({
    description: 'ID del local (UUID).',
    example: '1010021e-9bab-42d5-851c-417e9e2503bf',
  })
  id: string;

  @ApiProperty({ description: 'Nombre del local.', example: 'Santa María' })
  name: string;
}

class TipPaymentAlertWorkerDto implements TipPaymentAlertRef {
  @ApiProperty({
    description: 'ID del trabajador que recibe la propina (UUID).',
    example: '6b1f7a8e-2c41-4f0e-9d7a-3c5e2b1a0f99',
  })
  id: string;

  @ApiProperty({
    description: 'Nombre y apellido del trabajador.',
    example: 'Ana Pérez',
  })
  name: string;
}

export class TipPaymentAlertDto implements TipPaymentAlert {
  @ApiProperty({
    description: 'Local de las propinas vencidas.',
    type: TipPaymentAlertStoreDto,
  })
  store: TipPaymentAlertStoreDto;

  @ApiProperty({
    description: 'Trabajador al que se le deben las propinas.',
    type: TipPaymentAlertWorkerDto,
  })
  worker: TipPaymentAlertWorkerDto;

  @ApiProperty({
    description:
      'Cantidad de propinas diarias No pagadas y vencidas del trabajador en el local (una por día trabajado).',
    example: 3,
  })
  allocationCount: number;

  @ApiProperty({
    description: 'Suma pendiente de esas propinas en CLP.',
    example: 15000,
  })
  amount: number;

  @ApiProperty({
    description:
      'Fecha de negocio de la propina vencida más antigua (YYYY-MM-DD).',
    example: '2026-10-20',
  })
  oldestBusinessDate: string;

  @ApiProperty({
    description:
      'Fecha de negocio de la propina vencida más reciente (YYYY-MM-DD); nunca posterior a overdueThrough.',
    example: '2026-10-29',
  })
  newestBusinessDate: string;

  @ApiProperty({
    description:
      'Fecha límite de pago de la propina más antigua: el último de los legalPaymentDays días hábiles posteriores a oldestBusinessDate, sin sábados, domingos ni feriados de TIP_ALERT_HOLIDAYS (YYYY-MM-DD).',
    example: '2026-10-29',
  })
  deadline: string;

  @ApiProperty({
    description:
      'Días corridos de atraso de la propina más antigua: desde deadline hasta hoy en hora de Chile (1 el día siguiente al límite).',
    example: 12,
  })
  daysOverdue: number;
}

export class TipPaymentAlertSummaryDto implements TipPaymentAlertSummary {
  @ApiProperty({
    description: 'Cantidad de alertas (pares local y trabajador).',
    example: 2,
  })
  alertCount: number;

  @ApiProperty({
    description: 'Cantidad de propinas diarias vencidas sin pagar.',
    example: 5,
  })
  allocationCount: number;

  @ApiProperty({ description: 'Monto total vencido en CLP.', example: 25000 })
  amount: number;

  @ApiProperty({
    description:
      'Fecha de negocio vencida más antigua (YYYY-MM-DD); null sin alertas.',
    example: '2026-10-20',
    nullable: true,
    type: String,
  })
  oldestBusinessDate: string | null;

  @ApiProperty({
    description:
      'Fecha de negocio vencida más reciente (YYYY-MM-DD); null sin alertas.',
    example: '2026-10-29',
    nullable: true,
    type: String,
  })
  newestBusinessDate: string | null;

  @ApiProperty({
    description: 'Mayor atraso en días corridos; 0 sin alertas.',
    example: 12,
  })
  maxDaysOverdue: number;
}

export class TipPaymentAlertCollectionDto implements TipPaymentAlertCollection {
  @ApiProperty({
    description:
      'Plazo legal de pago vigente en días hábiles (TIP_LEGAL_PAYMENT_DAYS; 7 por defecto, ampliable por convenio).',
    example: 7,
  })
  legalPaymentDays: number;

  @ApiProperty({
    description: 'Día de negocio actual en Chile del cálculo (YYYY-MM-DD).',
    example: '2026-11-10',
  })
  asOf: string;

  @ApiProperty({
    description:
      'Última fecha de negocio cuyas propinas No pagadas ya están vencidas (YYYY-MM-DD): las de fechas posteriores siguen en plazo.',
    example: '2026-10-29',
  })
  overdueThrough: string;

  @ApiProperty({
    description:
      'Alertas por local y trabajador, primero las de mayor atraso y luego por local y trabajador.',
    type: [TipPaymentAlertDto],
  })
  items: TipPaymentAlertDto[];

  @ApiProperty({
    description: 'Totales de todas las alertas de la respuesta.',
    type: TipPaymentAlertSummaryDto,
  })
  totals: TipPaymentAlertSummaryDto;

  @ApiProperty({
    description: 'Instante del cálculo (ISO 8601).',
    example: '2026-11-10T15:00:00.000Z',
  })
  calculatedAt: Date;
}
