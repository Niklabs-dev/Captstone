import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateUserDto } from './create-user.dto.js';

// Edición de usuario por el administrador (SPRINT-3-T03): todos los campos
// del alta son opcionales y conservan sus validaciones (incluida la del RUT y
// su normalización). La contraseña se cambia en un flujo propio (SPRINT-3-T04).
// Ojo: @IsOptional también deja pasar null; el servicio solo lo acepta en los
// campos que se pueden borrar (rut, phone, hiredAt y storeId).
export class UpdateUserDto extends PartialType(
  OmitType(CreateUserDto, ['password'] as const),
) {}
