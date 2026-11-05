import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CashClosingConflictDto {
  @ApiProperty({ description: 'Código HTTP del conflicto.', example: 409 })
  statusCode: number;

  @ApiProperty({
    description: 'Explicación del duplicado o de la venta ya conciliada.',
    example: 'Ya existe un cierre para ese local, fecha y turno',
  })
  message: string;

  @ApiProperty({ description: 'Tipo de error HTTP.', example: 'Conflict' })
  error: string;

  @ApiPropertyOptional({
    description:
      'ID del cierre ya existente; se puede consultar con GET /cash-closings/:id sin modificarlo.',
    example: 'a9000000-0000-4000-8000-000000000040',
  })
  existingClosingId?: string;
}
