import { ApiProperty } from '@nestjs/swagger';

// Confirmación del cierre de sesión (logout es idempotente).
export class LogoutResponseDto {
  @ApiProperty({
    description: 'Mensaje de confirmación del cierre de sesión.',
    example: 'Sesión cerrada',
  })
  message: string;
}
