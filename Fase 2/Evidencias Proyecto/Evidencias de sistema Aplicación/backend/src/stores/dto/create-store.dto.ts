import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { normalizeStoreText } from '../utils/store-name.util.js';

function normalize({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? normalizeStoreText(value) : value;
}

export class CreateStoreDto {
  @ApiProperty({
    description: 'Nombre único del local, sin espacios innecesarios.',
    example: 'Santa María',
    maxLength: 100,
  })
  @Transform(normalize)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;

  @ApiProperty({
    description: 'Ciudad donde opera el local.',
    example: 'Melipilla',
    maxLength: 100,
  })
  @Transform(normalize)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  city: string;

  @ApiProperty({
    description: 'Dirección física del local.',
    example: 'Av. Santa María 1250',
    maxLength: 200,
  })
  @Transform(normalize)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  address: string;
}
