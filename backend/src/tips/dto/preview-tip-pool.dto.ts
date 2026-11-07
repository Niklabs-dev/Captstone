import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsUUID, Min } from 'class-validator';
import { IsCalendarDate } from '../validators/calendar-date.validator.js';

// Solicitud de vista previa del reparto (SPRINT-3-T12). Que periodEnd no sea
// anterior a periodStart lo valida el servicio, que ya parsea ambas fechas.
export class PreviewTipPoolDto {
  @ApiProperty({
    description: 'ID del local cuyo reparto se calcula.',
    example: '1010021e-9bab-42d5-851c-417e9e2503bf',
  })
  @IsUUID(undefined, { message: 'storeId debe ser un UUID válido' })
  storeId: string;

  @ApiProperty({
    description: 'Primer día del período en formato YYYY-MM-DD (inclusive).',
    example: '2026-10-01',
  })
  @IsCalendarDate()
  periodStart: string;

  @ApiProperty({
    description:
      'Último día del período en formato YYYY-MM-DD (inclusive); no puede ser anterior a periodStart.',
    example: '2026-10-15',
  })
  @IsCalendarDate()
  periodEnd: string;
}

// Cuerpo del cálculo o recálculo del reparto (SPRINT-4R-T04). expectedVersion
// aplica el bloqueo optimista al recalcular un borrador existente: si el
// reparto cambió desde que se revisó, la API responde 409 con la versión
// actual en vez de reemplazar la foto. En el primer cálculo se ignora.
export class CalculateTipPoolDto extends PreviewTipPoolDto {
  @ApiPropertyOptional({
    description:
      'Versión del borrador que se revisó (campo version de la respuesta). Opcional; si se envía y el borrador cambió, responde 409.',
    example: 2,
    minimum: 1,
  })
  @IsOptional()
  @IsInt({ message: 'expectedVersion debe ser un número entero' })
  @Min(1, { message: 'expectedVersion debe ser mayor o igual a 1' })
  expectedVersion?: number;
}
