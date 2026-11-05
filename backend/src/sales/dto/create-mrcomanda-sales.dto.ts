import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsUUID,
  Matches,
  ValidateNested,
} from 'class-validator';
import { MrComandaTotalDto } from './mrcomanda-total.dto.js';

// Exige fecha y hora completas con zona horaria explícita: el período de un
// corte MrComanda solo tiene sentido con su offset (mismo patrón que los
// vouchers de cierre).
const TIMESTAMP_WITH_ZONE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export class CreateMrComandaSalesDto {
  @ApiProperty({
    description: 'ID del local al que pertenecen los totales.',
    example: '1010021e-9bab-42d5-851c-417e9e2503bf',
  })
  @IsUUID(undefined, { message: 'storeId debe ser un UUID válido' })
  storeId: string;

  @ApiProperty({
    description:
      'Inicio del período del corte, con fecha, hora y zona horaria; debe caer en un único día de negocio en Chile.',
    example: '2026-03-10T08:00:00-03:00',
  })
  @IsDateString(
    {},
    { message: 'periodStart debe ser una fecha-hora válida (ISO 8601)' },
  )
  @Matches(TIMESTAMP_WITH_ZONE, {
    message: 'periodStart debe incluir hora y zona horaria explícita',
  })
  periodStart: string;

  @ApiProperty({
    description:
      'Fin del período del corte (exclusivo), posterior al inicio y dentro del mismo día de negocio en Chile.',
    example: '2026-03-10T14:00:00-03:00',
  })
  @IsDateString(
    {},
    { message: 'periodEnd debe ser una fecha-hora válida (ISO 8601)' },
  )
  @Matches(TIMESTAMP_WITH_ZONE, {
    message: 'periodEnd debe incluir hora y zona horaria explícita',
  })
  periodEnd: string;

  @ApiProperty({
    description:
      'Totales netos por medio de pago del período; un medio por entrada y sin montos negativos.',
    type: [MrComandaTotalDto],
    minItems: 1,
    maxItems: 50,
  })
  @IsArray()
  @ArrayMinSize(1, { message: 'totals debe incluir al menos un medio de pago' })
  @ArrayMaxSize(50, { message: 'totals admite como máximo 50 medios por lote' })
  @ValidateNested({ each: true })
  @Type(() => MrComandaTotalDto)
  totals: MrComandaTotalDto[];
}
