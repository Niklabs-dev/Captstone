import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({
    description: 'Correo electrónico del usuario.',
    example: 'admin@moi-food.cl',
  })
  @IsEmail()
  email: string;

  @ApiProperty({
    description: 'Contraseña del usuario (mínimo 8 caracteres).',
    example: 'admin-cambiar-en-produccion',
    minLength: 8,
  })
  @IsString()
  @MinLength(8)
  password: string;
}
