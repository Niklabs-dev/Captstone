import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { normalizeStoreText } from '../utils/store-name.util.js';
import {
  SUBWAY_STORE_ID_MAX_LENGTH,
  SUBWAY_STORE_ID_PATTERN,
} from '../utils/subway-store-id.util.js';
import { trimSubwayStoreId } from './create-store.dto.js';

const LETTER_PATTERN = /\p{L}/u;
const LETTER_OR_NUMBER_PATTERN = /[\p{L}\p{N}]/u;

function normalize({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? normalizeStoreText(value) : value;
}

function isPresent(_object: object, value: unknown): boolean {
  return value !== undefined;
}

export class UpdateStoreDto {
  @ApiPropertyOptional({
    description: 'Nombre único del local; debe incluir al menos una letra.',
    example: 'Santa María',
    maxLength: 100,
  })
  @Transform(normalize)
  @ValidateIf(isPresent)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  @Matches(LETTER_PATTERN, {
    message: 'name debe incluir al menos una letra',
  })
  name?: string;

  @ApiPropertyOptional({
    description: 'Ciudad del local; debe incluir al menos una letra.',
    example: 'Melipilla',
    maxLength: 100,
  })
  @Transform(normalize)
  @ValidateIf(isPresent)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  @Matches(LETTER_PATTERN, {
    message: 'city debe incluir al menos una letra',
  })
  city?: string;

  @ApiPropertyOptional({
    description:
      'Dirección del local; debe incluir al menos una letra o número.',
    example: 'Av. Santa María 1250',
    maxLength: 200,
  })
  @Transform(normalize)
  @ValidateIf(isPresent)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  @Matches(LETTER_OR_NUMBER_PATTERN, {
    message: 'address debe incluir al menos una letra o número',
  })
  address?: string;

  @ApiPropertyOptional({
    description:
      'Nuevo ID Subway del local: solo dígitos (1 a 10) y único entre los locales; null lo quita. El cambio se audita con el valor anterior y el nuevo.',
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
