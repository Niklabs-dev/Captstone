import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';

function toBoolean({ value }: { value: unknown }): unknown {
  return value === 'true' ? true : value === 'false' ? false : value;
}

export class ListPaymentMethodsQueryDto {
  @ApiPropertyOptional({
    description:
      'Filtra por estado: true (solo activos) o false (solo inactivos). ' +
      'Sin filtro se listan todos, incluidos los inactivos con historial.',
    example: true,
    type: Boolean,
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    description:
      'Filtra por disponibilidad para registrar propinas: true (elegibles) o false.',
    example: true,
    type: Boolean,
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  availableForTips?: boolean;
}
