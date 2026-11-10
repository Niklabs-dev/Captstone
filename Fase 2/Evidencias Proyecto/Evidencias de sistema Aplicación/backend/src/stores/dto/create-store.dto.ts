import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { normalizeStoreText } from '../utils/store-name.util.js';
import {
  SUBWAY_STORE_ID_MAX_LENGTH,
  SUBWAY_STORE_ID_PATTERN,
} from '../utils/subway-store-id.util.js';

const LETTER_PATTERN = /\p{L}/u;
const LETTER_OR_NUMBER_PATTERN = /[\p{L}\p{N}]/u;

function normalize({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? normalizeStoreText(value) : value;
}

// Solo se recortan los espacios de los extremos: un espacio interno o un
// guion («208 - 72597») sigue siendo un formato inválido.
export function trimSubwayStoreId({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class CreateStoreDto {
  @ApiProperty({
    description: 'Nombre único del local; debe incluir al menos una letra.',
    example: 'Santa María',
    maxLength: 100,
  })
  @Transform(normalize)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  @Matches(LETTER_PATTERN, {
    message: 'name debe incluir al menos una letra',
  })
  name: string;

  @ApiProperty({
    description: 'Ciudad del local; debe incluir al menos una letra.',
    example: 'Melipilla',
    maxLength: 100,
  })
  @Transform(normalize)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  @Matches(LETTER_PATTERN, {
    message: 'city debe incluir al menos una letra',
  })
  city: string;

  @ApiProperty({
    description:
      'Dirección del local; debe incluir al menos una letra o número.',
    example: 'Av. Santa María 1250',
    maxLength: 200,
  })
  @Transform(normalize)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  @Matches(LETTER_OR_NUMBER_PATTERN, {
    message: 'address debe incluir al menos una letra o número',
  })
  address: string;

  @ApiPropertyOptional({
    description:
      'ID del local asignado por Subway: solo dígitos (1 a 10) y único entre los locales. Omitido o null deja el local sin ID Subway. No corresponde al número interno de MrComanda.',
    example: '72597',
    type: String,
    nullable: true,
    pattern: '^[0-9]{1,10}$',
    maxLength: SUBWAY_STORE_ID_MAX_LENGTH,
  })
  @Transform(trimSubwayStoreId)
  @IsOptional()
  @IsString()
  @Matches(SUBWAY_STORE_ID_PATTERN, {
    message: 'subwayStoreId debe tener solo dígitos (de 1 a 10)',
  })
  subwayStoreId?: string | null;
}
