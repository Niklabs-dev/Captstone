import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { MAX_DAILY_OPERATION_AMOUNT } from '../types/daily-operations.types.js';

function toOptionalNumber({ value }: { value: unknown }): unknown {
  if (value === undefined || value === null) return value;
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '') return Number(value);
  return value;
}

function trim({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

// Multipart repite el campo para enviar varios IDs; Multer entrega un solo
// valor como string y varios como arreglo: se normaliza siempre a arreglo.
function toIdArray({ value }: { value: unknown }): unknown {
  if (value === undefined || value === null) return value;
  return Array.isArray(value) ? value : [value];
}

// Campos corregibles de la operación diaria (SPRINT-4R-T03). Todos son
// opcionales: PATCH corrige solo lo enviado y conserva el resto. El local y
// la fecha de negocio no se corregen por API (son la clave natural del
// registro); el responsable original tampoco cambia. Los montos llegan como
// texto y se transforman a entero; participantIds se repite por cada ID.
export class UpdateDailyOperationDto {
  @ApiPropertyOptional({
    description:
      'Propina de tarjeta corregida en CLP. Si queda en 0 y no se envía un ' +
      'voucher de reemplazo, el voucher existente se retira junto a sus ' +
      'metadatos; si queda mayor que 0 debe existir voucher (el enviado o el ' +
      'registrado).',
    example: 31602,
    minimum: 0,
    maximum: MAX_DAILY_OPERATION_AMOUNT,
  })
  @IsOptional()
  @Transform(toOptionalNumber)
  @IsInt({ message: 'cardTipAmount debe ser un entero en CLP' })
  @Min(0, { message: 'cardTipAmount no puede ser negativo' })
  @Max(MAX_DAILY_OPERATION_AMOUNT, {
    message: 'cardTipAmount excede el límite CLP',
  })
  cardTipAmount?: number;

  @ApiPropertyOptional({
    description: 'Propina en efectivo corregida del día en CLP.',
    example: 4500,
    minimum: 0,
    maximum: MAX_DAILY_OPERATION_AMOUNT,
  })
  @IsOptional()
  @Transform(toOptionalNumber)
  @IsInt({ message: 'cashTipAmount debe ser un entero en CLP' })
  @Min(0, { message: 'cashTipAmount no puede ser negativo' })
  @Max(MAX_DAILY_OPERATION_AMOUNT, {
    message: 'cashTipAmount excede el límite CLP',
  })
  cashTipAmount?: number;

  @ApiPropertyOptional({
    description:
      'Diferencia de efectivo corregida en CLP, con signo. Si el valor ' +
      'resultante no es 0, differenceReason es obligatorio (se usa el enviado ' +
      'o el ya registrado); si la caja queda cuadrada el motivo se deja vacío.',
    example: -1000,
    minimum: -MAX_DAILY_OPERATION_AMOUNT,
    maximum: MAX_DAILY_OPERATION_AMOUNT,
  })
  @IsOptional()
  @Transform(toOptionalNumber)
  @IsInt({ message: 'cashDifference debe ser un entero en CLP' })
  @Min(-MAX_DAILY_OPERATION_AMOUNT, {
    message: 'cashDifference excede el límite CLP',
  })
  @Max(MAX_DAILY_OPERATION_AMOUNT, {
    message: 'cashDifference excede el límite CLP',
  })
  cashDifference?: number;

  @ApiPropertyOptional({
    description:
      'Motivo corregido de la diferencia de efectivo (máximo 500 caracteres).',
    example: 'Faltante por vuelto no registrado al cierre.',
    maxLength: 500,
  })
  @IsOptional()
  @Transform(trim)
  @IsString({ message: 'differenceReason debe ser un texto' })
  @IsNotEmpty({ message: 'differenceReason no puede estar vacío' })
  @MaxLength(500, {
    message: 'differenceReason no puede superar 500 caracteres',
  })
  differenceReason?: string;

  @ApiPropertyOptional({
    description:
      'Selección corregida de trabajadores que participan del reparto. Se ' +
      'repite el campo (FormData.append por cada ID) y cada valor debe ser el ' +
      'UUID de un trabajador activo del local (rol TRABAJADOR), tal como ' +
      'entrega GET /daily-operations/eligible-workers. Reemplaza la selección ' +
      'completa (sin orden); si el fondo resultante es 0 la selección queda ' +
      'vacía. Omitir el campo conserva la selección actual.',
    example: ['b2c3d4e5-f6a7-4890-b1c2-d3e4f5a6b7c8'],
    type: [String],
  })
  @IsOptional()
  @Transform(toIdArray)
  @IsUUID(undefined, {
    each: true,
    message: 'cada participantIds debe ser el UUID de un trabajador',
  })
  participantIds?: string[];
}

// Solo para Swagger: el formulario de corrección completo, con el voucher de
// reemplazo, para que /api/docs muestre el selector de archivo.
export class UpdateDailyOperationFormDto extends UpdateDailyOperationDto {
  @ApiProperty({
    description:
      'Foto de reemplazo del voucher de propinas con tarjeta: JPEG, PNG o ' +
      'WebP, máximo 5 MiB. Solo se acepta cuando la propina de tarjeta ' +
      'resultante es mayor que 0 y reemplaza al voucher anterior (archivo y ' +
      'metadatos). Si no se envía, se conserva el voucher registrado.',
    example: 'voucher-corregido.jpg',
    type: 'string',
    format: 'binary',
  })
  voucher: string;
}
