import { ApiProperty } from '@nestjs/swagger';
import { SALES_DAY_STATUSES } from '../types/operating-days.types.js';

// DTOs de respuesta del calendario de operación y del estado diario de
// ventas (SPRINT-4R-T12).

export class OperatingStoreDto {
  @ApiProperty({
    description: 'ID del local.',
    example: '1010021e-9bab-42d5-851c-417e9e2503bf',
  })
  id: string;

  @ApiProperty({ description: 'Nombre del local.', example: 'Santa María' })
  name: string;
}

export class OperatingPersonDto {
  @ApiProperty({
    description: 'ID del usuario.',
    example: 'b2c3d4e5-f6a7-4890-b1c2-d3e4f5a6b7c8',
  })
  id: string;

  @ApiProperty({
    description: 'Nombre del usuario.',
    example: 'Administrador Moi-food',
  })
  name: string;
}

export class StoreClosureDto {
  @ApiProperty({
    description: 'ID de la excepción de cierre.',
    example: '5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d',
  })
  id: string;

  @ApiProperty({
    description: 'Día de negocio cerrado (YYYY-MM-DD).',
    example: '2026-12-25',
  })
  date: string;

  @ApiProperty({
    description: 'Motivo del cierre.',
    example: 'Feriado de Navidad',
  })
  reason: string;

  @ApiProperty({
    description: 'Fecha y hora de registro.',
    example: '2026-11-08T14:00:00.000Z',
  })
  createdAt: Date;

  @ApiProperty({
    description: 'Quién registró el cierre.',
    type: OperatingPersonDto,
  })
  createdBy: OperatingPersonDto;
}

export class OperatingCalendarDto {
  @ApiProperty({ description: 'Local.', type: OperatingStoreDto })
  store: OperatingStoreDto;

  @ApiProperty({
    description:
      'false mientras no se configure: el local no genera alertas de ventas faltantes.',
    example: true,
  })
  configured: boolean;

  @ApiProperty({
    description: 'Días en que abre (ISO: 1 = lunes … 7 = domingo).',
    example: [1, 2, 3, 4, 5, 6],
    type: Number,
    isArray: true,
  })
  weekdays: number[];

  @ApiProperty({
    description: 'Primer día en que se exigen ventas (YYYY-MM-DD).',
    example: '2026-11-01',
    type: String,
    nullable: true,
  })
  trackingStartDate: string | null;

  @ApiProperty({
    description: 'Última modificación del calendario.',
    example: '2026-11-08T14:00:00.000Z',
    type: Date,
    nullable: true,
  })
  updatedAt: Date | null;

  @ApiProperty({
    description: 'Quién modificó el calendario por última vez.',
    type: OperatingPersonDto,
    nullable: true,
  })
  updatedBy: OperatingPersonDto | null;

  @ApiProperty({
    description: 'Excepciones de cierre, de la más reciente a la más antigua.',
    type: StoreClosureDto,
    isArray: true,
  })
  closures: StoreClosureDto[];
}

export class SalesDayClosureDto {
  @ApiProperty({
    description: 'ID de la excepción de cierre.',
    example: '5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d',
  })
  id: string;

  @ApiProperty({ description: 'Motivo del cierre.', example: 'Mantención' })
  reason: string;
}

export class SalesDayDto {
  @ApiProperty({ description: 'Local.', type: OperatingStoreDto })
  store: OperatingStoreDto;

  @ApiProperty({
    description: 'Día de negocio (YYYY-MM-DD, hora de Chile).',
    example: '2026-11-05',
  })
  businessDate: string;

  @ApiProperty({
    description:
      'IMPORTADO (hay importación vigente), PENDIENTE (hoy, sin archivo; informativo), ATRASADO (día abierto pasado sin importación; alerta) o CERRADO (no abre o cierre por excepción).',
    enum: SALES_DAY_STATUSES,
    example: 'ATRASADO',
  })
  status: string;

  @ApiProperty({
    description: 'Importación vigente del día.',
    example: null,
    type: String,
    format: 'uuid',
    nullable: true,
  })
  activeImportId: string | null;

  @ApiProperty({
    description:
      'Importación cargada pero sin confirmar (no cuenta como importada).',
    example: null,
    type: String,
    format: 'uuid',
    nullable: true,
  })
  pendingImportId: string | null;

  @ApiProperty({
    description: 'Excepción de cierre del día, si la hay.',
    type: SalesDayClosureDto,
    nullable: true,
  })
  closure: SalesDayClosureDto | null;
}

export class SalesDaysSummaryDto {
  @ApiProperty({ description: 'Días importados.', example: 24 })
  IMPORTADO: number;

  @ApiProperty({ description: 'Días pendientes (hoy).', example: 1 })
  PENDIENTE: number;

  @ApiProperty({ description: 'Días atrasados (alertas).', example: 2 })
  ATRASADO: number;

  @ApiProperty({ description: 'Días cerrados.', example: 4 })
  CERRADO: number;
}

export class SalesDaysDto {
  @ApiProperty({
    description: 'Día de negocio actual en Chile (YYYY-MM-DD).',
    example: '2026-11-08',
  })
  today: string;

  @ApiProperty({ description: 'Desde (inclusive).', example: '2026-10-09' })
  from: string;

  @ApiProperty({
    description: 'Hasta (inclusive; nunca después de hoy).',
    example: '2026-11-08',
  })
  to: string;

  @ApiProperty({
    description: 'Cantidad de días por estado (después de filtrar).',
    type: SalesDaysSummaryDto,
  })
  summary: SalesDaysSummaryDto;

  @ApiProperty({
    description:
      'Un elemento por local y fecha, del día más reciente al más antiguo.',
    type: SalesDayDto,
    isArray: true,
  })
  items: SalesDayDto[];
}
