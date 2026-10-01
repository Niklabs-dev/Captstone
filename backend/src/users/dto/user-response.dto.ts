import { ApiProperty } from '@nestjs/swagger';
import type {
  UserResponse,
  UserRoleSummary,
  UserStoreSummary,
} from '../types/users.types.js';

export class UserRoleSummaryDto implements UserRoleSummary {
  @ApiProperty({ description: 'Código del rol.', example: 'TRABAJADOR' })
  code: string;

  @ApiProperty({ description: 'Nombre del rol.', example: 'Trabajador' })
  name: string;
}

export class UserStoreSummaryDto implements UserStoreSummary {
  @ApiProperty({
    description: 'ID del local (UUID).',
    example: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
  })
  id: string;

  @ApiProperty({
    description: 'Nombre del local.',
    example: 'Subway Melipilla Centro',
  })
  name: string;
}

// Usuario devuelto por la API: nunca incluye el hash de la contraseña.
export class UserResponseDto implements UserResponse {
  @ApiProperty({
    description: 'ID del usuario (UUID).',
    example: '3f8c2c1e-4a5b-4c6d-8e9f-0a1b2c3d4e5f',
  })
  id: string;

  @ApiProperty({
    description: 'Correo electrónico del usuario.',
    example: 'juan.perez@moi-food.cl',
  })
  email: string;

  @ApiProperty({ description: 'Nombre del usuario.', example: 'Juan' })
  firstName: string;

  @ApiProperty({ description: 'Apellido del usuario.', example: 'Pérez' })
  lastName: string;

  @ApiProperty({
    description: 'RUT normalizado; null si no se registró.',
    example: '12345678-5',
    nullable: true,
    type: String,
  })
  rut: string | null;

  @ApiProperty({
    description: 'Teléfono de contacto; null si no se registró.',
    example: '+56912345678',
    nullable: true,
    type: String,
  })
  phone: string | null;

  @ApiProperty({
    description: 'Fecha de contratación (YYYY-MM-DD); null si no se registró.',
    example: '2026-03-01',
    nullable: true,
    type: String,
  })
  hiredAt: string | null;

  @ApiProperty({
    description: 'false si la cuenta está desactivada (sin acceso).',
    example: true,
  })
  isActive: boolean;

  @ApiProperty({ description: 'Rol asignado.', type: UserRoleSummaryDto })
  role: UserRoleSummaryDto;

  @ApiProperty({
    description: 'Local asignado; null para usuarios globales.',
    type: UserStoreSummaryDto,
    nullable: true,
  })
  store: UserStoreSummaryDto | null;

  @ApiProperty({
    description: 'Fecha de creación (ISO 8601).',
    example: '2026-10-01T12:00:00.000Z',
  })
  createdAt: Date;
}
