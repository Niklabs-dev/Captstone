import { ApiProperty } from '@nestjs/swagger';
import { IsUUID, Matches } from 'class-validator';

// Campos de texto del formulario multipart de carga de una liquidación
// (SPRINT-2-T13). El archivo llega aparte (campo "file"), lo procesa Multer.
export class UploadPayslipDto {
  @ApiProperty({
    description:
      'ID (UUID) del trabajador. Debe ser un TRABAJADOR o SUPERVISOR activo con local asignado; la liquidación queda asociada a ese local.',
    example: '3f8c2c1e-4a5b-4c6d-8e9f-0a1b2c3d4e5f',
  })
  @IsUUID()
  workerId: string;

  @ApiProperty({
    description:
      'Mes de la remuneración en formato YYYY-MM. No puede ser posterior al mes en curso (hora de Chile).',
    example: '2026-09',
  })
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, {
    message: 'period debe tener el formato YYYY-MM',
  })
  period: string;
}

// Solo para Swagger: el formulario completo, con el archivo, para que
// /api/docs muestre el selector de archivo.
export class UploadPayslipFormDto extends UploadPayslipDto {
  @ApiProperty({
    description:
      'Liquidación en PDF, hasta DOCUMENTS_MAX_SIZE_MB (25 MB por defecto). El tipo se valida por el contenido, no por la extensión.',
    example: 'liquidacion-2026-09.pdf',
    type: 'string',
    format: 'binary',
  })
  file: string;
}
