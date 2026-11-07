import { ApiProperty } from '@nestjs/swagger';

// Cuerpo del 409 de creación de la operación diaria (SPRINT-4R-T01): ya
// existe una operación distinta para el mismo local y fecha; el ID permite
// consultarla en GET /daily-operations/:id antes de decidir.
export class DailyOperationConflictDto {
  @ApiProperty({ example: 409 })
  statusCode: number;

  @ApiProperty({
    example:
      'Ya existe una operación diaria distinta para ese local y fecha; consulta la existente antes de continuar',
  })
  message: string;

  @ApiProperty({ example: 'Conflict' })
  error: string;

  @ApiProperty({
    description: 'ID de la operación existente para el mismo local y fecha.',
    example: '9b2f3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
  })
  existingOperationId: string;
}
