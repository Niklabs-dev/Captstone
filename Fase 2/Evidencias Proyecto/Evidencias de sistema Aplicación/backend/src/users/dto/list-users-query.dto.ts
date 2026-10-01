import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsUUID } from 'class-validator';
import { ROLE, type RoleCode } from '../../auth/constants/roles.constants.js';

// Filtros opcionales del listado de usuarios (SPRINT-1-T08).
export class ListUsersQueryDto {
  @ApiPropertyOptional({
    description: 'Filtra por local (UUID).',
    example: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
  })
  @IsOptional()
  @IsUUID()
  storeId?: string;

  @ApiPropertyOptional({
    description: 'Filtra por código de rol.',
    example: ROLE.TRABAJADOR,
    enum: Object.values(ROLE),
  })
  @IsOptional()
  @IsIn(Object.values(ROLE))
  roleCode?: RoleCode;

  @ApiPropertyOptional({
    description: 'Filtra por estado: true (activos) o false (desactivados).',
    example: true,
    type: Boolean,
  })
  @IsOptional()
  // En la query llega como texto: solo se aceptan "true" y "false".
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  isActive?: boolean;
}
