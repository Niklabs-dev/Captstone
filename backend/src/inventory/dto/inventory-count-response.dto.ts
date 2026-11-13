import { ApiProperty } from '@nestjs/swagger';
import {
  InventoryCountStatus,
  UnitOfMeasure,
} from '../../generated/prisma/client.js';
import { ProductResponseDto } from './product-response.dto.js';

// Respuestas de la API de tomas de inventario (SPRINT-5-T05).

export class InventoryCountPersonDto {
  @ApiProperty({
    description: 'ID del usuario.',
    example: '2f0c3a1b-7d6e-4f5a-9b8c-1d2e3f4a5b6c',
  })
  id: string;

  @ApiProperty({ description: 'Nombre.', example: 'Sofía' })
  firstName: string;

  @ApiProperty({ description: 'Apellido.', example: 'Rojas' })
  lastName: string;
}

export class InventoryCountStoreDto {
  @ApiProperty({
    description: 'ID del local.',
    example: '0b6f7d1e-3c2a-4b5d-8e9f-1a2b3c4d5e6f',
  })
  id: string;

  @ApiProperty({
    description: 'Nombre del local.',
    example: 'Melipilla Centro',
  })
  name: string;
}

export class InventoryCountSummaryDto {
  @ApiProperty({
    description: 'ID de la toma.',
    example: '9c8b7a6f-5e4d-4c3b-8a29-1f0e9d8c7b6a',
  })
  id: string;

  @ApiProperty({
    description: 'OPEN es «En curso» y CONFIRMED es «Finalizado».',
    enum: InventoryCountStatus,
    example: InventoryCountStatus.OPEN,
  })
  status: InventoryCountStatus;

  @ApiProperty({
    description:
      'Fecha de la toma (AAAA-MM-DD), fijada al iniciarla en hora de Chile.',
    example: '2026-11-10',
  })
  countDate: string;

  @ApiProperty({
    description: 'Fecha-hora en que se inició la toma.',
    example: '2026-11-11T00:15:00.000Z',
  })
  startedAt: Date;

  @ApiProperty({
    description: 'ID del local de la toma.',
    example: '0b6f7d1e-3c2a-4b5d-8e9f-1a2b3c4d5e6f',
  })
  storeId: string;

  @ApiProperty({
    description: 'Local de la toma.',
    type: InventoryCountStoreDto,
  })
  store: InventoryCountStoreDto;

  @ApiProperty({
    description: 'Supervisor que inició la toma.',
    type: InventoryCountPersonDto,
  })
  startedBy: InventoryCountPersonDto;

  @ApiProperty({
    description: 'Fecha-hora de finalización; null mientras está En curso.',
    example: null,
    nullable: true,
    type: Date,
  })
  finalizedAt: Date | null;

  @ApiProperty({
    description: 'Quién la finalizó; null mientras está En curso.',
    type: InventoryCountPersonDto,
    nullable: true,
  })
  finalizedBy: InventoryCountPersonDto | null;

  @ApiProperty({
    description: 'Productos con cantidades guardadas.',
    example: 12,
  })
  countedProducts: number;
}

export class InventoryCountLineDto {
  @ApiProperty({
    description: 'ID de la línea.',
    example: '4d3c2b1a-0f9e-4d8c-b7a6-5f4e3d2c1b0a',
  })
  id: string;

  @ApiProperty({
    description: 'ID del producto.',
    example: '1010021e-9bab-42d5-851c-417e9e2503bf',
  })
  productId: string;

  @ApiProperty({
    description: 'Cajas contadas; null si no se informaron.',
    example: 1,
    nullable: true,
    type: 'integer',
  })
  boxes: number | null;

  @ApiProperty({
    description:
      'Paquetes contados; null si no se informaron. Pueden superar los de una caja.',
    example: 2,
    nullable: true,
    type: 'integer',
  })
  packages: number | null;

  @ApiProperty({
    description:
      'Cantidad suelta como texto decimal exacto: entera en UNIT y con 3 decimales en KG y L.',
    example: '0.300',
    nullable: true,
    type: String,
  })
  looseQuantity: string | null;

  @ApiProperty({
    description:
      'Total = cajas × contenido por caja + paquetes × contenido por paquete + cantidad suelta, calculado en el backend con aritmética decimal exacta. Entero en UNIT («54») y con 3 decimales en KG y L («10.300»). null en una línea sin cantidades.',
    example: '10.300',
    nullable: true,
    type: String,
  })
  countedQuantity: string | null;

  @ApiProperty({
    description: 'Copia del SKU al guardar.',
    example: 'SUB-123456',
    nullable: true,
    type: String,
  })
  productSku: string | null;

  @ApiProperty({
    description: 'Copia del nombre al guardar.',
    example: 'Carne Fajita (Beef Steak Saborizado)',
  })
  productName: string;

  @ApiProperty({
    description: 'Copia de la unidad al guardar.',
    enum: UnitOfMeasure,
    example: UnitOfMeasure.KG,
  })
  unit: UnitOfMeasure;

  @ApiProperty({
    description: 'Copia del nombre del paquete.',
    example: 'bolsa',
    nullable: true,
    type: String,
  })
  packageName: string | null;

  @ApiProperty({
    description: 'Copia del contenido por caja, con 3 decimales.',
    example: '5.000',
    nullable: true,
    type: String,
  })
  boxContent: string | null;

  @ApiProperty({
    description: 'Copia de los paquetes por caja (informativo).',
    example: 2,
    nullable: true,
    type: 'integer',
  })
  packagesPerBox: number | null;

  @ApiProperty({
    description: 'Copia del contenido por paquete, con 3 decimales.',
    example: '2.500',
    nullable: true,
    type: String,
  })
  packageContent: string | null;

  @ApiProperty({
    description: 'Copia de «solo cantidad suelta».',
    example: false,
  })
  looseOnly: boolean;

  @ApiProperty({
    description: 'Fecha-hora del último guardado (la asigna la base).',
    example: '2026-11-11T00:20:00.000Z',
  })
  savedAt: Date;

  @ApiProperty({
    description: 'Quién guardó la línea por última vez.',
    type: InventoryCountPersonDto,
  })
  savedBy: InventoryCountPersonDto;
}

export class InventoryCountItemDto {
  @ApiProperty({
    description:
      'Producto como está hoy en el catálogo, con su formato y su fila de la plantilla.',
    type: ProductResponseDto,
  })
  product: ProductResponseDto;

  @ApiProperty({
    description:
      'true si ya tiene cantidades guardadas; false si está pendiente.',
    example: true,
  })
  counted: boolean;

  @ApiProperty({
    description: 'Línea guardada, o null si el producto está pendiente.',
    type: InventoryCountLineDto,
    nullable: true,
  })
  line: InventoryCountLineDto | null;
}

export class InventoryCountDetailDto extends InventoryCountSummaryDto {
  @ApiProperty({
    description: 'Productos de la toma, sin aplicar la búsqueda.',
    example: 120,
  })
  totalProducts: number;

  @ApiProperty({
    description: 'Productos sin cantidades, sin aplicar la búsqueda.',
    example: 108,
  })
  pendingProducts: number;

  @ApiProperty({
    description:
      'Productos en el orden de la plantilla, filtrados por la búsqueda. En curso: los productos activos más los que ya tengan línea en la toma.',
    type: [InventoryCountItemDto],
  })
  items: InventoryCountItemDto[];
}

export class InventoryCountConflictDto {
  @ApiProperty({ description: 'Código HTTP.', example: 409 })
  statusCode: number;

  @ApiProperty({
    description: 'Resumen del error.',
    example: 'Ya hay una toma de inventario en curso en tu local',
  })
  message: string;

  @ApiProperty({
    description: 'Mensaje por campo, para mostrarlo en la vista.',
    example: {
      store:
        'Retoma la toma en curso del 2026-11-10 o finalízala antes de iniciar otra',
    },
  })
  errors: Record<string, string>;

  @ApiProperty({
    description: 'ID de la toma en curso, para retomarla.',
    example: '9c8b7a6f-5e4d-4c3b-8a29-1f0e9d8c7b6a',
  })
  existingCountId: string;

  @ApiProperty({
    description: 'Fecha de la toma en curso (AAAA-MM-DD).',
    example: '2026-11-10',
  })
  existingCountDate: string;
}
