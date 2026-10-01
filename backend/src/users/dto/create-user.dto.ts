import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  Validate,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from 'class-validator';
import { ROLE, type RoleCode } from '../../auth/constants/roles.constants.js';
import { isValidRut, normalizeRut } from '../utils/rut.util.js';

@ValidatorConstraint({ name: 'isRut' })
class IsRutConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return typeof value === 'string' && isValidRut(value);
  }

  defaultMessage(): string {
    return 'rut debe ser un RUT chileno válido (ej. 12345678-5)';
  }
}

function trim({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

// Alta de usuario por el administrador (SPRINT-1-T08): define rol, local y
// credenciales iniciales.
export class CreateUserDto {
  @ApiProperty({
    description: 'Correo electrónico; se usa como usuario de inicio de sesión.',
    example: 'juan.perez@moi-food.cl',
    maxLength: 160,
  })
  @Transform(trim)
  @IsEmail()
  @MaxLength(160)
  email: string;

  @ApiProperty({
    description:
      'Contraseña inicial (mínimo 8 caracteres); se guarda solo su hash bcrypt.',
    example: 'ClaveInicial123',
    minLength: 8,
    maxLength: 72,
  })
  @IsString()
  @MinLength(8)
  // bcrypt solo considera los primeros 72 bytes.
  @MaxLength(72)
  password: string;

  @ApiProperty({ description: 'Nombre del usuario.', example: 'Juan' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  firstName: string;

  @ApiProperty({ description: 'Apellido del usuario.', example: 'Pérez' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  lastName: string;

  @ApiProperty({
    description:
      'Código del rol. SUPERVISOR y TRABAJADOR requieren local; ADMINISTRADOR y CONTADOR son globales y no llevan local.',
    example: ROLE.TRABAJADOR,
    enum: Object.values(ROLE),
  })
  @IsIn(Object.values(ROLE))
  roleCode: RoleCode;

  @ApiPropertyOptional({
    description:
      'ID del local asignado (UUID). Obligatorio para roles de local; debe omitirse para roles globales.',
    example: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
  })
  @IsOptional()
  @IsUUID()
  storeId?: string;

  @ApiPropertyOptional({
    description: 'RUT chileno, con o sin puntos; se guarda como 12345678-K.',
    example: '12.345.678-5',
  })
  @IsOptional()
  @IsString()
  @Validate(IsRutConstraint)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? normalizeRut(value) : value,
  )
  rut?: string;

  @ApiPropertyOptional({
    description: 'Teléfono de contacto.',
    example: '+56912345678',
    maxLength: 20,
  })
  @IsOptional()
  @Transform(trim)
  @Matches(/^\+?[\d\s-]{8,20}$/, {
    message: 'phone debe ser un teléfono válido (ej. +56912345678)',
  })
  @MaxLength(20)
  phone?: string;

  @ApiPropertyOptional({
    description: 'Fecha de contratación (YYYY-MM-DD).',
    example: '2026-03-01',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'hiredAt debe tener el formato YYYY-MM-DD',
  })
  hiredAt?: string;
}
