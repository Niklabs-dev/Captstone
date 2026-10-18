import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsUUID, MaxLength } from 'class-validator';

// Confirmación de que el documento ya se registró en la Dirección del
// Trabajo (SPRINT-2-T08). El registro se hace fuera del sistema; aquí solo
// se deja constancia de quién lo confirmó y cuándo.
export class RegisterDtDto {
  @ApiProperty({
    description:
      'ID del documento de la alerta (UUID); debe coincidir con el de la ruta.',
    example: '5c1f3a7e-2b4d-4e8a-9f60-1d2c3b4a5e6f',
  })
  @IsUUID()
  documentId: string;

  @ApiProperty({
    description:
      'Revisión de la alerta tal como se consultó; si el documento cambió desde entonces responde 409.',
    example: '2026-10-17T15:00:00.000Z',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  revision: string;
}
