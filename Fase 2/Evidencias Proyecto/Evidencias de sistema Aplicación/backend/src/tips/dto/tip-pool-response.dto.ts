import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  TIP_POOL_ISSUE_CODE,
  TIP_POOL_STATUSES,
  type TipAgreementSnapshot,
  type TipPoolIssue,
  type TipPoolIssueCode,
  type TipPoolLineResponse,
  type TipPoolResponse,
  type TipPoolSourceResponse,
  type TipPoolStatusCode,
  type TipPoolValidationErrorBody,
} from '../types/tip-pools.types.js';
import {
  PAYMENT_METHODS,
  type PaymentMethodCode,
} from '../types/tips.types.js';

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
    description: 'ID del usuario que calculó el reparto.',
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
    description: 'Horas usadas en el cálculo, con 2 decimales (copia).',
    example: '40.00',
  })
  hoursWorked: string;

  @ApiProperty({
    description: 'Monto asignado en CLP enteros.',
    example: 16000,
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
    description: 'Medio de pago del registro.',
    enum: PAYMENT_METHODS,
    example: 'CASH',
  })
  paymentMethod: PaymentMethodCode;

  @ApiProperty({
    description: 'Monto usado en el reparto, en CLP (copia).',
    example: 8000,
  })
  amount: number;
}

export class TipPoolResponseDto implements TipPoolResponse {
  @ApiProperty({
    description: 'ID del reparto; se conserva al recalcular un borrador.',
    example: 'a9000000-0000-4000-8000-000000000009',
  })
  id: string;

  @ApiProperty({
    description: 'Estado del reparto.',
    enum: TIP_POOL_STATUSES,
    example: 'DRAFT',
  })
  status: TipPoolStatusCode;

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
      'Copia del pacto aplicado; null solo en repartos históricos sin copia.',
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
    description: 'Suma de horas de las líneas, con 2 decimales.',
    example: '312.50',
  })
  totalHours: string;

  @ApiProperty({
    description: 'Monto por trabajador, ordenado por userId.',
    type: TipPoolLineResponseDto,
    isArray: true,
  })
  lines: TipPoolLineResponseDto[];

  @ApiProperty({
    description: 'Registros diarios usados como fuente del fondo.',
    type: TipPoolSourceResponseDto,
    isArray: true,
  })
  sources: TipPoolSourceResponseDto[];

  @ApiProperty({
    description:
      'true si la suma de las líneas y la de las fuentes son iguales al total.',
    example: true,
  })
  reconciled: boolean;

  @ApiProperty({
    description: 'Usuario que hizo el último cálculo.',
    type: TipPoolUserResponseDto,
  })
  calculatedBy: TipPoolUserResponseDto;

  @ApiProperty({
    description: 'Instante del último cálculo.',
    example: '2026-10-26T15:00:00.000Z',
  })
  calculatedAt: Date;
}

class TipPoolIssueDto implements TipPoolIssue {
  @ApiProperty({
    description: 'Código estable de la causa.',
    enum: Object.values(TIP_POOL_ISSUE_CODE),
    example: TIP_POOL_ISSUE_CODE.AGREEMENT_MISSING,
  })
  code: TipPoolIssueCode;

  @ApiProperty({
    description: 'Explicación para el contador.',
    example:
      'No hay un pacto de reparto vigente para el local entre el 2026-10-01 y el 2026-10-15.',
  })
  message: string;

  @ApiPropertyOptional({
    description: 'Datos que identifican los registros involucrados.',
    example: {
      tipEntries: [
        {
          tipEntryId: 'a9000000-0000-4000-8000-000000000005',
          businessDate: '2026-10-02',
          paymentMethod: 'CASH',
          poolId: 'a9000000-0000-4000-8000-000000000009',
        },
      ],
    },
  })
  details?: Record<string, unknown>;
}

export class TipPoolValidationErrorDto implements TipPoolValidationErrorBody {
  @ApiProperty({ description: 'Código HTTP.', example: 422 })
  statusCode: 422;

  @ApiProperty({
    description: 'Resumen del error.',
    example: 'No se puede calcular el reparto del período',
  })
  message: string;

  @ApiProperty({
    description: 'Todas las causas encontradas.',
    type: TipPoolIssueDto,
    isArray: true,
  })
  issues: TipPoolIssueDto[];
}
