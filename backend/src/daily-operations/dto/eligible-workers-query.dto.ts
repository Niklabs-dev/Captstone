import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

// Filtro del catálogo acotado de trabajadores elegibles para el reparto
// (SPRINT-4R-T03). Devuelve solo id y nombre de los TRABAJADOR activos del
// local, ordenados alfabéticamente; nunca RUT, correo, teléfono ni
// credenciales (Ley N°21.719).
export class EligibleWorkersQueryDto {
  @ApiProperty({
    description:
      'Local consultado; el supervisor solo puede listar el suyo y el ' +
      'ADMINISTRADOR (rol global) cualquier local dentro de su alcance.',
    example: '1010021e-9bab-42d5-851c-417e9e2503bf',
  })
  @IsUUID(undefined, { message: 'storeId debe ser un UUID válido' })
  storeId: string;
}
