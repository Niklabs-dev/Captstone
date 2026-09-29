import { ApiProperty } from '@nestjs/swagger';
import type { AuthTokensResponse } from '../types/auth.types.js';

// Datos mínimos del usuario incluidos en la respuesta de login/refresh.
export class AuthTokensUserDto {
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

  @ApiProperty({ description: 'Nombre del usuario.', example: 'Nicolás' })
  firstName: string;

  @ApiProperty({ description: 'Apellido del usuario.', example: 'Jiménez' })
  lastName: string;

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

// Respuesta de login/refresh: par de tokens y datos mínimos del usuario.
export class AuthTokensResponseDto implements AuthTokensResponse {
  @ApiProperty({
    description: 'Access token JWT firmado por el servidor.',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  accessToken: string;

  @ApiProperty({
    description: 'Refresh token opaco para renovar la sesión.',
    example: 'dGhpcy1lcy11bi1yZWZyZXNoLXRva2VuLWRlLWVqZW1wbG8',
  })
  refreshToken: string;

  @ApiProperty({
    description: 'Tipo del token para el encabezado Authorization.',
    example: 'Bearer',
  })
  tokenType = 'Bearer' as const;

  @ApiProperty({
    description: 'Segundos de vida del access token.',
    example: 86400,
  })
  expiresIn: number;

  @ApiProperty({
    description: 'Datos mínimos del usuario autenticado.',
    type: AuthTokensUserDto,
  })
  user: AuthTokensUserDto;
}
