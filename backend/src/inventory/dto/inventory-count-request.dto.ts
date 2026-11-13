import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  Allow,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import { InventoryCountStatus } from '../../generated/prisma/client.js';
import { MAX_COUNT_DATE_AGE_DAYS } from '../types/inventory-counts.types.js';

// Cuerpos y filtros de la API de tomas de inventario (SPRINT-5-T05). Los
// mensajes van en español: la vista los muestra.

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DATE_MESSAGE = 'debe ser una fecha con formato AAAA-MM-DD';

function trimmed({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? value.trim().replace(/\s+/gu, ' ') : value;
}

export class StartInventoryCountDto {
  @ApiPropertyOptional({
    description: `Fecha de la toma (AAAA-MM-DD): de hoy o de hasta ${MAX_COUNT_DATE_AGE_DAYS} días atrás, en hora de Chile (America/Santiago). Por defecto, el día en curso. Queda fija: no cambia aunque la toma se finalice después de medianoche. El local sale de la sesión, nunca del cuerpo.`,
    example: '2026-11-10',
  })
  @IsOptional()
  @IsString({ message: `La fecha ${DATE_MESSAGE}` })
  @Matches(DATE_PATTERN, { message: `La fecha ${DATE_MESSAGE}` })
  countDate?: string;
}

// Los valores se validan en el servicio contra el formato del producto, para
// responder siempre errores por campo ({ statusCode, message, errors }).
// @Allow() solo los admite en el cuerpo: forbidNonWhitelisted sigue
// rechazando cualquier otro campo.
export class SaveInventoryCountLineDto {
  @ApiPropertyOptional({
    description:
      'Cajas contadas: entero mayor o igual a 0. Solo si el producto tiene contenido por caja y no es «solo cantidad suelta»; si no, se omite o se envía null.',
    example: 1,
    type: 'integer',
    minimum: 0,
    nullable: true,
  })
  @Allow()
  boxes?: unknown;

  @ApiPropertyOptional({
    description:
      'Paquetes (bolsas, botellas…) contados: entero mayor o igual a 0, sin límite por los paquetes que trae una caja. Solo si el producto tiene contenido por paquete y no es «solo cantidad suelta».',
    example: 2,
    type: 'integer',
    minimum: 0,
    nullable: true,
  })
  @Allow()
  packages?: unknown;

  @ApiPropertyOptional({
    description:
      'Cantidad suelta en la unidad del producto: mayor o igual a 0, con hasta 3 decimales y punto en KG y L, y entera en UNIT. Se recomienda enviarla como texto.',
    example: '0.300',
    type: String,
    nullable: true,
  })
  @Allow()
  looseQuantity?: unknown;
}

export class ListInventoryCountsQueryDto {
  @ApiPropertyOptional({
    description:
      'Local. El ADMINISTRADOR puede omitirlo para ver todos; el SUPERVISOR solo ve el suyo (otro local responde 403).',
    example: '0b6f7d1e-3c2a-4b5d-8e9f-1a2b3c4d5e6f',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID('4', { message: 'El local no es válido' })
  storeId?: string;

  @ApiPropertyOptional({
    description: 'Estado: OPEN («En curso») o CONFIRMED («Finalizado»).',
    enum: InventoryCountStatus,
    example: InventoryCountStatus.OPEN,
  })
  @IsOptional()
  @IsEnum(InventoryCountStatus, {
    message: 'El estado debe ser OPEN o CONFIRMED',
  })
  status?: InventoryCountStatus;

  @ApiPropertyOptional({
    description: 'Desde esta fecha de la toma, inclusive (AAAA-MM-DD).',
    example: '2026-11-01',
  })
  @IsOptional()
  @Matches(DATE_PATTERN, { message: `from ${DATE_MESSAGE}` })
  from?: string;

  @ApiPropertyOptional({
    description: 'Hasta esta fecha de la toma, inclusive (AAAA-MM-DD).',
    example: '2026-11-30',
  })
  @IsOptional()
  @Matches(DATE_PATTERN, { message: `to ${DATE_MESSAGE}` })
  to?: string;
}

export class InventoryCountDetailQueryDto {
  @ApiPropertyOptional({
    description:
      'Busca por nombre, nombre alternativo o SKU, sin distinguir mayúsculas ni tildes.',
    example: 'beef steak',
  })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(120)
  search?: string;
}
