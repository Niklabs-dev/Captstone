import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { normalizeStoreText } from '../utils/store-name.util.js';

const LETTER_PATTERN = /\p{L}/u;
const LETTER_OR_NUMBER_PATTERN = /[\p{L}\p{N}]/u;

function normalize({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? normalizeStoreText(value) : value;
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
}
