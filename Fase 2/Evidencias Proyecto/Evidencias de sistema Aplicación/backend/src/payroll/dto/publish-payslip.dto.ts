import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

// Confirmación de la publicación de una liquidación por el contador
// (SPRINT-2-T14). No es una firma electrónica: deja constancia de que el
// contador validó la liquidación firmada y la publica.
export class PublishPayslipDto {
  @ApiProperty({
    description:
      'Revisión de la liquidación tal como se consultó; si cambió desde entonces responde 409.',
    example: '2026-10-19T15:00:00.000Z',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  revision: string;

  @ApiPropertyOptional({
    description:
      'Fecha de firma (YYYY-MM-DD). Entre el día de carga y hoy (hora de Chile); si se omite, se usa la fecha de hoy.',
    example: '2026-10-19',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'signedAt debe tener el formato YYYY-MM-DD',
  })
  signedAt?: string;
}
