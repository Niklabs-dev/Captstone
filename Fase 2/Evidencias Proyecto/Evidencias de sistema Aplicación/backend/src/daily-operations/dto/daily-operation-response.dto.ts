import { ApiProperty } from '@nestjs/swagger';
import { TIP_ALLOCATION_STATUSES } from '../../tips/types/daily-tips.types.js';
import { VOUCHER_MIME_TYPES } from '../types/daily-operations.types.js';

// DTO de respuesta de la operación diaria (SPRINT-4R-T01). Los montos son
// enteros CLP; el voucher se entrega solo como metadatos (la descarga del
// archivo es el endpoint privado /daily-operations/:id/voucher).

export class DailyOperationVoucherResponseDto {
  @ApiProperty({
    description: 'ID del voucher.',
    example: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  })
  id: string;

  @ApiProperty({
    description: 'Nombre original del archivo al cargarlo.',
    example: 'voucher-terminal-1.jpg',
  })
  fileName: string;

  @ApiProperty({
    description: 'Tipo real detectado por el contenido del archivo.',
    enum: VOUCHER_MIME_TYPES,
    example: 'image/jpeg',
  })
  mimeType: string;

  @ApiProperty({
    description: 'Tamaño del archivo en bytes.',
    example: 183_492,
  })
  sizeBytes: number;

  @ApiProperty({
    description:
      'Hash SHA-256 del contenido (64 caracteres hexadecimales); verifica la integridad del archivo.',
    example: '3a6eb0790f39ac87c94f3856b2dd2c5d110e6811602261a9a923d3bb23adc8b7',
  })
  sha256Hash: string;

  @ApiProperty({
    description: 'Fecha y hora de carga del voucher.',
    example: '2026-03-10T20:15:00.000Z',
  })
  createdAt: Date;
}

export class DailyOperationStoreDto {
  @ApiProperty({ example: '1010021e-9bab-42d5-851c-417e9e2503bf' })
  id: string;

  @ApiProperty({ example: 'Subway Melipilla Centro' })
  name: string;
}

export class DailyOperationPersonDto {
  @ApiProperty({ example: 'b2c3d4e5-f6a7-4890-b1c2-d3e4f5a6b7c8' })
  id: string;

  @ApiProperty({ example: 'María Contreras' })
  name: string;
}

// Propina del día de un trabajador (SPRINT-4A-T03).
export class DailyTipAllocationResponseDto {
  @ApiProperty({
    description: 'ID de la asignación diaria de propina.',
    example: 'c1a2b3d4-e5f6-4789-a012-b3c4d5e6f7a8',
  })
  id: string;

  @ApiProperty({
    description: 'Trabajador o supervisor que recibe la propina (id y nombre).',
    type: DailyOperationPersonDto,
  })
  worker: DailyOperationPersonDto;

  @ApiProperty({
    description:
      'Monto en CLP entero: el fondo del día dividido en partes iguales; los pesos de residuo van de a $1 según el orden estable documentado.',
    example: 10_000,
  })
  amount: number;

  @ApiProperty({
    description:
      'Estado de pago: UNPAID (No pagada) al registrarse; PAID (Pagada) cuando entra en un lote de pago.',
    enum: TIP_ALLOCATION_STATUSES,
    example: 'UNPAID',
  })
  status: string;
}

export class DailyOperationResponseDto {
  @ApiProperty({
    description: 'ID de la operación diaria.',
    example: '9b2f...e1',
  })
  id: string;

  @ApiProperty({ description: 'Local de la operación.' })
  store: DailyOperationStoreDto;

  @ApiProperty({
    description: 'Día de negocio en Chile (YYYY-MM-DD).',
    example: '2026-03-10',
  })
  businessDate: string;

  @ApiProperty({
    description: 'Propina de tarjeta del día en CLP.',
    example: 31602,
  })
  cardTipAmount: number;

  @ApiProperty({
    description: 'Propina en efectivo del día en CLP.',
    example: 4500,
  })
  cashTipAmount: number;

  @ApiProperty({
    description:
      'Fondo de propinas del día (cardTipAmount + cashTipAmount): es la fuente del reparto.',
    example: 36102,
  })
  tipFundAmount: number;

  @ApiProperty({
    description:
      'Diferencia de efectivo declarada, con signo (positiva sobrante, negativa faltante).',
    example: -1000,
  })
  cashDifference: number;

  @ApiProperty({
    description: 'Motivo de la diferencia; null cuando la caja cuadra.',
    example: 'Faltante por vuelto no registrado al cierre.',
    nullable: true,
  })
  differenceReason: string | null;

  @ApiProperty({
    description:
      'Metadatos del voucher fotográfico; null cuando no hubo propina de tarjeta.',
    type: DailyOperationVoucherResponseDto,
    nullable: true,
  })
  voucher: DailyOperationVoucherResponseDto | null;

  @ApiProperty({ description: 'Supervisor responsable de la captura.' })
  responsible: DailyOperationPersonDto;

  @ApiProperty({
    description:
      'Trabajadores seleccionados para el reparto del día (compartidos por la ' +
      'propina de tarjeta y la de efectivo); solo id y nombre.',
    type: [DailyOperationPersonDto],
  })
  participants: DailyOperationPersonDto[];

  @ApiProperty({
    description:
      'Reparto automático del fondo del día (SPRINT-4A-T03): una propina por ' +
      'participante, ordenadas por nombre, que suman exactamente ' +
      'tipFundAmount. Vacío cuando el fondo es 0.',
    type: [DailyTipAllocationResponseDto],
  })
  tipAllocations: DailyTipAllocationResponseDto[];

  @ApiProperty({
    description: 'Fecha y hora de creación.',
    example: '2026-03-10T20:14:30.000Z',
  })
  createdAt: Date;

  @ApiProperty({
    description: 'Fecha y hora de la última modificación.',
    example: '2026-03-10T20:14:30.000Z',
  })
  updatedAt: Date;
}
