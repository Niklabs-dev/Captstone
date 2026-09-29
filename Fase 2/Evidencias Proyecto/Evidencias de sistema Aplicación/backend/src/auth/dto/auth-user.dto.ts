import { ApiProperty } from '@nestjs/swagger';
import type { AuthUser } from '../types/auth.types.js';

// Usuario autenticado devuelto por GET /auth/me (extraído del JWT).
export class AuthUserResponseDto implements AuthUser {
  @ApiProperty({
    description: 'ID del usuario (UUID).',
    example: '3f8c2c1e-4a5b-4c6d-8e9f-0a1b2c3d4e5f',
  })
  id: string;

  @ApiProperty({
    description: 'Correo electrónico del usuario.',
    example: 'admin@moi-food.cl',
  })
  email: string;

  @ApiProperty({
    description: 'Código del rol asignado.',
    example: 'ADMINISTRADOR',
  })
  role: string;

  @ApiProperty({
    description: 'ID del local asignado (UUID); null si el usuario no tiene.',
    example: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
    nullable: true,
    type: String,
  })
  storeId: string | null;
}
