import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsUUID, Matches } from 'class-validator';
import {
  PAYSLIP_STATUSES,
  type PayslipStatusCode,
} from '../types/payroll.types.js';

// Filtros opcionales del listado de liquidaciones (SPRINT-2-T13).
export class ListPayslipsQueryDto {
  @ApiPropertyOptional({
    description:
      'Filtra por local (UUID): el local de la liquidación y, en el selector, el de los trabajadores.',
    example: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
  })
  @IsOptional()
  @IsUUID()
  storeId?: string;

  @ApiPropertyOptional({
    description: 'Filtra por período (YYYY-MM).',
    example: '2026-09',
  })
  @IsOptional()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, {
    message: 'period debe tener el formato YYYY-MM',
  })
  period?: string;

  @ApiPropertyOptional({
    description: 'Filtra por estado.',
    example: 'PENDING_SIGNATURE',
    enum: PAYSLIP_STATUSES,
  })
  @IsOptional()
  @IsIn(PAYSLIP_STATUSES)
  status?: PayslipStatusCode;
}
