import { ApiProperty } from '@nestjs/swagger';
// Proyección personal: nunca incluye el detalle ni las líneas de otros trabajadores.
export class OwnTipReceiptDto {
  @ApiProperty({ description: 'Estado pagado del reparto.', enum: ['PAID'] })
  status: 'PAID';
  @ApiProperty({ description: 'ID de la constancia propia.', format: 'uuid' })
  id: string;
  @ApiProperty({
    description: 'Propietario de la constancia, obtenido de la sesión.',
    format: 'uuid',
  })
  userId: string;
  @ApiProperty({
    description: 'Nombre del local al momento del pago.',
    example: 'Santa María',
  })
  storeName: string;
  @ApiProperty({ description: 'Inicio del período.', example: '2026-01-05' })
  periodStart: string;
  @ApiProperty({ description: 'Fin del período.', example: '2026-01-11' })
  periodEnd: string;
  @ApiProperty({ description: 'Horas propias consideradas.', example: '40.00' })
  hoursWorked: string;
  @ApiProperty({ description: 'Monto propio enterado en CLP.', example: 15000 })
  amount: number;
  @ApiProperty({ description: 'Fecha de entrega.', example: '2026-01-12' })
  paymentDate: string;
  @ApiProperty({
    description: 'Nombre del responsable que registró el pago.',
    example: 'Persona Contador',
  })
  paidByName: string;
  @ApiProperty({
    description: 'Fecha de emisión de la constancia.',
    type: Date,
  })
  createdAt: Date;
}
