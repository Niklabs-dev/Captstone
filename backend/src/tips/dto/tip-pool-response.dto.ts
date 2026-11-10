import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  TIP_POOL_RETIRED_MESSAGE,
  TIP_POOL_RULES,
  TIP_POOL_STATUSES,
  type TipAgreementSnapshot,
  type TipPoolDailySourceResponse,
  type TipPoolLineResponse,
  type TipPoolReceiptDetail,
  type TipPoolReceiptResponse,
  type TipPoolResponse,
  type TipPoolRetiredActionBody,
  type TipPoolRule,
  type TipPoolSourceResponse,
  type TipPoolStatusCode,
} from '../types/tip-pools.types.js';

class TipPoolStoreResponseDto {
  @ApiProperty({
    description: 'ID del local.',
    example: '1010021e-9bab-42d5-851c-417e9e2503bf',
  })
  id: string;

  @ApiProperty({ description: 'Nombre del local.', example: 'Santa María' })
  name: string;
}

class TipPoolUserResponseDto {
  @ApiProperty({
    description: 'ID del usuario (quien calculó, confirmó o pagó).',
    example: 'a9000000-0000-4000-8000-000000000001',
  })
  id: string;

  @ApiProperty({
    description: 'Nombre visible del usuario.',
    example: 'Lucas Contador',
  })
  name: string;
}

class TipAgreementSnapshotDto implements TipAgreementSnapshot {
  @ApiProperty({
    description: 'ID del pacto aplicado.',
    example: 'a9000000-0000-4000-8000-000000000004',
  })
  id: string;

  @ApiProperty({
    description: 'Nombre del pacto al momento del cálculo.',
    example: 'Pacto de reparto proporcional a horas',
  })
  name: string;

  @ApiProperty({
    description: 'Regla del pacto al momento del cálculo.',
    example: 'PROPORTIONAL_TO_HOURS',
  })
  rule: string;

  @ApiProperty({
    description: 'Inicio de vigencia del pacto (YYYY-MM-DD).',
    example: '2026-01-01',
  })
  validFrom: string;

  @ApiProperty({
    description: 'Fin de vigencia del pacto (YYYY-MM-DD); null si es abierto.',
    example: null,
    nullable: true,
    type: String,
  })
  validTo: string | null;

  @ApiPropertyOptional({
    description: 'Instante en que se tomó la copia del pacto.',
    example: '2026-10-26T15:00:00.000Z',
  })
  capturedAt?: string;
}

class TipPoolLineResponseDto implements TipPoolLineResponse {
  @ApiProperty({
    description: 'ID del trabajador.',
    example: 'a9000000-0000-4000-8000-000000000002',
  })
  userId: string;

  @ApiProperty({
    description: 'Nombre visible del trabajador.',
    example: 'Ana Pérez',
  })
  workerName: string;

  @ApiProperty({
    description:
      'Horas usadas en un reparto proporcional histórico, con 2 decimales (copia); null en el reparto equitativo, que no usa horas.',
    example: null,
    nullable: true,
    type: String,
  })
  hoursWorked: string | null;

  @ApiProperty({
    description:
      'Monto a pagar en CLP enteros: en el reparto equitativo, la suma de las asignaciones diarias del trabajador en el período.',
    example: 16000,
  })
  amount: number;
}

class TipPoolDailySourceResponseDto implements TipPoolDailySourceResponse {
  @ApiProperty({
    description: 'ID de la operación diaria usada como fuente.',
    example: 'c4a1b2d3-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
  })
  operationId: string;

  @ApiProperty({
    description: 'Día de negocio de la operación (YYYY-MM-DD).',
    example: '2026-10-02',
  })
  businessDate: string;

  @ApiProperty({
    description: 'Propina con tarjeta de la operación en CLP.',
    example: 31602,
  })
  cardTipAmount: number;

  @ApiProperty({
    description: 'Propina en efectivo de la operación en CLP.',
    example: 4500,
  })
  cashTipAmount: number;

  @ApiProperty({
    description:
      'Fondo del día aplicado al reparto (tarjeta + efectivo, copia); se divide una sola vez entre los participantes de ese día.',
    example: 36102,
  })
  amount: number;
}

class TipPoolSourceResponseDto implements TipPoolSourceResponse {
  @ApiProperty({
    description: 'ID del registro diario usado.',
    example: 'a9000000-0000-4000-8000-000000000005',
  })
  tipEntryId: string;

  @ApiProperty({
    description: 'Día de negocio del registro (YYYY-MM-DD).',
    example: '2026-10-02',
  })
  businessDate: string;

  @ApiProperty({
    description: 'Código del medio de pago del registro.',
    example: 'CASH',
  })
  paymentMethod: string;

  @ApiProperty({
    description:
      'Nombre del medio de pago según el catálogo; se conserva aunque el medio se desactive después.',
    example: 'Efectivo',
  })
  paymentMethodName: string;

  @ApiProperty({
    description: 'Monto usado en el reparto, en CLP (copia).',
    example: 8000,
  })
  amount: number;
}

export class TipPoolResponseDto implements TipPoolResponse {
  @ApiProperty({
    description: 'ID del reparto.',
    example: 'a9000000-0000-4000-8000-000000000009',
  })
  id: string;

  @ApiProperty({
    description:
      'Estado en que quedó el reparto: DRAFT (borrador sin efecto: nunca se confirmó ni pagó), CONFIRMED (confirmado sin pago registrado) o PAID (pagado, con constancias). Desde SPRINT-4A-T08 ninguna acción lo cambia.',
    enum: TIP_POOL_STATUSES,
    example: 'PAID',
  })
  status: TipPoolStatusCode;

  @ApiProperty({
    description:
      'Versión que dejó el ciclo de vida del reparto (subía con cada recálculo, observación, confirmación y pago antes de SPRINT-4A-T08).',
    example: 1,
  })
  version: number;

  @ApiProperty({
    description: 'Local del reparto.',
    type: TipPoolStoreResponseDto,
  })
  store: TipPoolStoreResponseDto;

  @ApiProperty({
    description: 'Primer día del período (YYYY-MM-DD).',
    example: '2026-10-01',
  })
  periodStart: string;

  @ApiProperty({
    description: 'Último día del período (YYYY-MM-DD).',
    example: '2026-10-15',
  })
  periodEnd: string;

  @ApiProperty({
    description:
      'Regla aplicada. EQUAL_SHARES: el fondo de cada operación diaria (tarjeta + efectivo) se dividió en partes iguales entre sus participantes y cada trabajador recibió la suma de sus asignaciones diarias. PROPORTIONAL_TO_HOURS: reparto anterior, proporcional a las horas según el pacto.',
    enum: TIP_POOL_RULES,
    example: 'EQUAL_SHARES',
  })
  rule: TipPoolRule;

  @ApiProperty({
    description:
      'Copia del pacto aplicado en los repartos proporcionales históricos; null en los equitativos (no usan pacto) y en los históricos sin copia.',
    type: TipAgreementSnapshotDto,
    nullable: true,
  })
  agreement: TipAgreementSnapshotDto | null;

  @ApiProperty({
    description: 'Fondo del período en CLP (suma de las fuentes).',
    example: 125000,
  })
  totalAmount: number;

  @ApiProperty({
    description:
      'Suma de horas de las líneas en un reparto proporcional histórico, con 2 decimales; null en el reparto equitativo.',
    example: null,
    nullable: true,
    type: String,
  })
  totalHours: string | null;

  @ApiProperty({
    description:
      'Monto a pagar por trabajador, ordenado por userId. En el reparto equitativo solo aparecen los trabajadores que participaron de algún día.',
    type: TipPoolLineResponseDto,
    isArray: true,
  })
  lines: TipPoolLineResponseDto[];

  @ApiProperty({
    description:
      'Registros diarios históricos (tip_entries) usados como fuente de un reparto proporcional; vacío en el reparto equitativo.',
    type: TipPoolSourceResponseDto,
    isArray: true,
  })
  sources: TipPoolSourceResponseDto[];

  @ApiProperty({
    description:
      'Operaciones diarias usadas como fuente del reparto equitativo, ordenadas por fecha; vacío en los repartos históricos.',
    type: TipPoolDailySourceResponseDto,
    isArray: true,
  })
  dailySources: TipPoolDailySourceResponseDto[];

  @ApiProperty({
    description:
      'true si la suma de las líneas y la de las fuentes (registros históricos más operaciones diarias) son iguales al total.',
    example: true,
  })
  reconciled: boolean;

  @ApiProperty({
    description: 'Usuario que hizo el último cálculo del borrador.',
    type: TipPoolUserResponseDto,
  })
  calculatedBy: TipPoolUserResponseDto;

  @ApiProperty({
    description:
      'Instante del último cálculo del borrador; la confirmación y el pago no lo cambiaron.',
    example: '2026-10-26T15:00:00.000Z',
  })
  calculatedAt: Date;

  @ApiProperty({
    description: 'Instante del último cambio del reparto.',
    example: '2026-10-27T13:00:00.000Z',
  })
  updatedAt: Date;

  @ApiProperty({
    description:
      'Última observación del contador sobre el borrador; null si no hay.',
    example: null,
    nullable: true,
    type: String,
  })
  notes: string | null;

  @ApiProperty({
    description: 'Contador que confirmó el reparto; null mientras es DRAFT.',
    type: TipPoolUserResponseDto,
    nullable: true,
  })
  confirmedBy: TipPoolUserResponseDto | null;

  @ApiProperty({
    description: 'Instante de la confirmación; null mientras es DRAFT.',
    example: '2026-10-27T13:00:00.000Z',
    nullable: true,
    type: Date,
  })
  confirmedAt: Date | null;

  @ApiProperty({
    description: 'Responsable del pago; null mientras no está PAID.',
    type: TipPoolUserResponseDto,
    nullable: true,
  })
  paidBy: TipPoolUserResponseDto | null;

  @ApiProperty({
    description: 'Instante en que se marcó como pagado.',
    example: '2026-10-27T15:00:00.000Z',
    nullable: true,
    type: Date,
  })
  paidAt: Date | null;

  @ApiProperty({
    description: 'Fecha en que se enteró el pago (YYYY-MM-DD).',
    example: '2026-10-27',
    nullable: true,
    type: String,
  })
  paymentDate: string | null;

  @ApiProperty({
    description: 'Constancias emitidas (una por trabajador al pagar).',
    example: 0,
  })
  receiptsCount: number;
}

class TipPoolReceiptDetailDto implements TipPoolReceiptDetail {
  @ApiProperty({
    description:
      'Regla aplicada al reparto pagado; las constancias anteriores a la regla equitativa son PROPORTIONAL_TO_HOURS.',
    enum: TIP_POOL_RULES,
    example: 'EQUAL_SHARES',
  })
  rule: TipPoolRule;

  @ApiProperty({
    description: 'Copia del pacto aplicado al momento del pago.',
    type: TipAgreementSnapshotDto,
    nullable: true,
  })
  agreementSnapshot: TipAgreementSnapshotDto | null;

  @ApiProperty({ description: 'Total del reparto en CLP.', example: 25000 })
  totalAmount: number;

  @ApiProperty({
    description:
      'Horas totales de un reparto proporcional, con 2 decimales; null en el reparto equitativo.',
    example: null,
    nullable: true,
    type: String,
  })
  totalHours: string | null;

  @ApiProperty({
    description: 'Todas las líneas del reparto al momento del pago.',
    type: TipPoolLineResponseDto,
    isArray: true,
  })
  lines: TipPoolLineResponseDto[];
}

export class TipPoolReceiptResponseDto implements TipPoolReceiptResponse {
  @ApiProperty({
    description: 'ID de la constancia.',
    example: '3f1c2b9a-6d4e-4c1a-9b7f-2a8e5d0c4b11',
  })
  id: string;

  @ApiProperty({
    description: 'ID del reparto pagado.',
    example: 'a9000000-0000-4000-8000-000000000009',
  })
  poolId: string;

  @ApiProperty({
    description: 'ID del trabajador.',
    example: 'a9000000-0000-4000-8000-000000000002',
  })
  userId: string;

  @ApiProperty({
    description: 'Nombre del trabajador al momento del pago (copia).',
    example: 'Ana Pérez',
  })
  workerName: string;

  @ApiProperty({
    description: 'Local al momento del pago (copia).',
    type: TipPoolStoreResponseDto,
  })
  store: TipPoolStoreResponseDto;

  @ApiProperty({
    description: 'Primer día del período (YYYY-MM-DD).',
    example: '2026-01-05',
  })
  periodStart: string;

  @ApiProperty({
    description: 'Último día del período (YYYY-MM-DD).',
    example: '2026-01-11',
  })
  periodEnd: string;

  @ApiProperty({
    description:
      'Horas del trabajador en un reparto proporcional, con 2 decimales; null en el reparto equitativo.',
    example: null,
    nullable: true,
    type: String,
  })
  hoursWorked: string | null;

  @ApiProperty({ description: 'Monto pagado en CLP.', example: 10000 })
  amount: number;

  @ApiProperty({
    description: 'Fecha en que se enteró el pago (YYYY-MM-DD).',
    example: '2026-10-27',
  })
  paymentDate: string;

  @ApiProperty({
    description: 'Responsable del pago (nombre copiado al pagar).',
    type: TipPoolUserResponseDto,
  })
  paidBy: TipPoolUserResponseDto;

  @ApiProperty({
    description: 'Foto del reparto al momento del pago.',
    type: TipPoolReceiptDetailDto,
  })
  detail: TipPoolReceiptDetailDto;

  @ApiProperty({
    description:
      'Instante de emisión de la constancia; es la fecha de emisión del PDF, que no cambia entre descargas.',
    example: '2026-10-27T15:00:00.000Z',
  })
  createdAt: Date;
}

// 410 de las acciones del reparto por período retiradas en SPRINT-4A-T08.
export class TipPoolRetiredActionDto implements TipPoolRetiredActionBody {
  @ApiProperty({ description: 'Código HTTP.', example: 410 })
  statusCode: 410;

  @ApiProperty({
    description: 'Motivo y dónde se hace ahora la operación.',
    example: TIP_POOL_RETIRED_MESSAGE,
  })
  message: string;

  @ApiProperty({ description: 'Nombre del estado HTTP.', example: 'Gone' })
  error: 'Gone';
}
