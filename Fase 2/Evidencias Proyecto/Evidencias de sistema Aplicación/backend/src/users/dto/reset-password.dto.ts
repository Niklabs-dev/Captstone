import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from '../constants/password-policy.constants.js';

// Restablecimiento de contraseña por el administrador (SPRINT-3-T04): misma
// política que la contraseña inicial del alta.
export class ResetPasswordDto {
  @ApiProperty({
    description:
      'Nueva contraseña (mínimo 8 caracteres); se guarda solo su hash bcrypt.',
    example: 'ClaveNueva456',
    minLength: PASSWORD_MIN_LENGTH,
    maxLength: PASSWORD_MAX_LENGTH,
  })
  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  @MaxLength(PASSWORD_MAX_LENGTH)
  newPassword: string;
}
