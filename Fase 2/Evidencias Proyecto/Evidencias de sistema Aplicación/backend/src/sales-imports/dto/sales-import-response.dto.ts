import { ApiProperty } from '@nestjs/swagger';

// DTOs de respuesta de la importación diaria de ventas MrComanda
// (SPRINT-4R-T10). Montos en CLP enteros; el archivo se entrega solo como
// metadatos (la descarga es GET /sales-imports/:id/file).

const STATUSES = ['PENDING', 'ACTIVE', 'SUPERSEDED'] as const;
const RESOLUTIONS = ['AUTOMATIC', 'MANUAL'] as const;

export class SalesImportStoreDto {
  @ApiProperty({
    description: 'ID del local.',
    example: '1010021e-9bab-42d5-851c-417e9e2503bf',
  })
  id: string;

  @ApiProperty({ description: 'Nombre del local.', example: 'Santa María' })
  name: string;
}

export class SalesImportPersonDto {
  @ApiProperty({
    description: 'ID del usuario.',
    example: 'b2c3d4e5-f6a7-4890-b1c2-d3e4f5a6b7c8',
  })
  id: string;

  @ApiProperty({
    description: 'Nombre del usuario.',
    example: 'Administrador Moi-food',
  })
  name: string;
}

export class SalesImportPaymentMethodDto {
  @ApiProperty({
    description: 'ID del medio de pago del catálogo.',
    example: 'b9000000-0000-4000-8000-000000000002',
  })
  id: string;

  @ApiProperty({
    description: 'Código estable del medio de pago.',
    example: 'DEBIT_CARD',
  })
  code: string;

  @ApiProperty({
    description: 'Nombre del medio de pago.',
    example: 'Tarjeta de débito',
  })
  name: string;
}

export class SalesImportLineDto {
  @ApiProperty({
    description: 'Posición de la línea en la sección «Medios de pago».',
    example: 1,
  })
  lineNumber: number;

  @ApiProperty({
    description: 'Etiqueta tal como viene en el reporte.',
    example: 'T. DEBITO',
  })
  originalLabel: string;

  @ApiProperty({
    description: 'Monto en CLP enteros (con signo).',
    example: 633670,
  })
  amount: number;

  @ApiProperty({
    description: 'Porcentaje del total según el reporte.',
    example: 72.6,
    type: Number,
    nullable: true,
  })
  percentage: number | null;

  @ApiProperty({
    description:
      'Medio del catálogo resuelto por alias o elegido a mano (ver resolution).',
    type: SalesImportPaymentMethodDto,
  })
  paymentMethod: SalesImportPaymentMethodDto;

  @ApiProperty({
    description:
      'AUTOMATIC si el medio salió de un alias; MANUAL si lo eligió el administrador al importar.',
    enum: RESOLUTIONS,
    example: 'AUTOMATIC',
  })
  resolution: string;
}

export class SalesImportSkippedLineDto {
  @ApiProperty({ description: 'Posición de la línea omitida.', example: 4 })
  lineNumber: number;

  @ApiProperty({
    description: 'Etiqueta tal como viene en el reporte.',
    example: 'N.de Créd.',
  })
  originalLabel: string;

  @ApiProperty({
    description: 'Monto en CLP (siempre 0: solo se omiten líneas en 0).',
    example: 0,
  })
  amount: number;

  @ApiProperty({
    description: 'Porcentaje del total según el reporte.',
    example: 0,
    type: Number,
    nullable: true,
  })
  percentage: number | null;
}

export class SalesImportVersionDto {
  @ApiProperty({
    description: 'ID de la importación.',
    example: '4f6b7c8d-9e0a-4b1c-8d2e-3f4a5b6c7d8e',
  })
  id: string;

  @ApiProperty({ description: 'Número de versión.', example: 1 })
  version: number;

  @ApiProperty({
    description: 'Estado de la versión.',
    enum: STATUSES,
    example: 'ACTIVE',
  })
  status: string;

  @ApiProperty({
    description: 'Fecha y hora de carga.',
    example: '2026-11-06T14:20:00.000Z',
  })
  createdAt: Date;

  @ApiProperty({
    description: 'Fecha y hora de confirmación.',
    example: '2026-11-06T14:21:00.000Z',
    type: Date,
    nullable: true,
  })
  confirmedAt: Date | null;

  @ApiProperty({
    description: 'Fecha y hora en que fue reemplazada por otra versión.',
    example: null,
    type: Date,
    nullable: true,
  })
  supersededAt: Date | null;
}

export class SalesImportSummaryDto {
  @ApiProperty({
    description: 'ID de la importación.',
    example: '4f6b7c8d-9e0a-4b1c-8d2e-3f4a5b6c7d8e',
  })
  id: string;

  @ApiProperty({
    description:
      'PENDING (previsualizada, se puede confirmar o descartar), ACTIVE (vigente) o SUPERSEDED (reemplazada).',
    enum: STATUSES,
    example: 'PENDING',
  })
  status: string;

  @ApiProperty({
    description: 'Versión para el mismo local y fecha.',
    example: 1,
  })
  version: number;

  @ApiProperty({ description: 'Local resuelto.', type: SalesImportStoreDto })
  store: SalesImportStoreDto;

  @ApiProperty({
    description: 'Fecha de negocio (YYYY-MM-DD) tomada del «Período».',
    example: '2026-11-05',
  })
  businessDate: string;

  @ApiProperty({
    description: 'Inicio del horario del reporte.',
    example: '2026-11-05T03:00:00.000Z',
  })
  periodStart: Date;

  @ApiProperty({
    description: 'Término del horario del reporte.',
    example: '2026-11-06T02:59:59.000Z',
  })
  periodEnd: Date;

  @ApiProperty({
    description: 'Fecha de emisión del reporte (informativa).',
    example: '2026-11-06T14:14:55.000Z',
    type: Date,
    nullable: true,
  })
  issuedAt: Date | null;

  @ApiProperty({
    description:
      'Texto original del local en el encabezado del reporte; el número interno de MrComanda (208) no identifica al local.',
    example: '208 - 72597',
  })
  externalStoreCode: string;

  @ApiProperty({
    description:
      'ID Subway con que se identificó el local; null solo en importaciones anteriores a la identificación por ID Subway.',
    example: '72597',
    type: String,
    nullable: true,
  })
  subwayStoreId: string | null;

  @ApiProperty({
    description: 'Total de «Medios de pago» en CLP enteros.',
    example: 873260,
  })
  totalAmount: number;

  @ApiProperty({
    description: 'Nombre original del archivo cargado.',
    example: 'ventas-06-11-2026.xlsx',
  })
  fileName: string;

  @ApiProperty({ description: 'Tamaño del archivo en bytes.', example: 10721 })
  sizeBytes: number;

  @ApiProperty({
    description: 'Hash SHA-256 del archivo (64 caracteres hexadecimales).',
    example: 'ddbb86cbaf6d9f988a2db8ff5302257015d260735afc71871ef3ce094d201bca',
  })
  sha256Hash: string;

  @ApiProperty({
    description: 'Quién cargó el archivo.',
    type: SalesImportPersonDto,
  })
  uploadedBy: SalesImportPersonDto;

  @ApiProperty({
    description: 'Fecha y hora de carga.',
    example: '2026-11-06T14:20:00.000Z',
  })
  createdAt: Date;

  @ApiProperty({
    description: 'Quién confirmó la importación.',
    type: SalesImportPersonDto,
    nullable: true,
  })
  confirmedBy: SalesImportPersonDto | null;

  @ApiProperty({
    description: 'Fecha y hora de confirmación.',
    example: null,
    type: Date,
    nullable: true,
  })
  confirmedAt: Date | null;

  @ApiProperty({
    description: 'Fecha y hora en que fue reemplazada.',
    example: null,
    type: Date,
    nullable: true,
  })
  supersededAt: Date | null;

  @ApiProperty({
    description:
      'AUTOMATIC si el local se identificó por su ID Subway; MANUAL si lo eligió el administrador al importar.',
    enum: RESOLUTIONS,
    example: 'AUTOMATIC',
  })
  storeResolution: string;

  @ApiProperty({
    description:
      'Quién resolvió a mano algún dato (local o medios); null si todo se identificó por equivalencias.',
    type: SalesImportPersonDto,
    nullable: true,
  })
  resolvedBy: SalesImportPersonDto | null;

  @ApiProperty({
    description: 'Fecha y hora de la resolución manual.',
    example: null,
    type: Date,
    nullable: true,
  })
  resolvedAt: Date | null;
}

export class SalesImportDetailDto extends SalesImportSummaryDto {
  @ApiProperty({
    description: 'Totales por medio de pago.',
    type: SalesImportLineDto,
    isArray: true,
  })
  lines: SalesImportLineDto[];

  @ApiProperty({
    description:
      'Líneas omitidas a mano al importar (monto 0); vacío si no se omitió ninguna.',
    type: SalesImportSkippedLineDto,
    isArray: true,
  })
  skippedLines: SalesImportSkippedLineDto[];

  @ApiProperty({
    description:
      'Todas las versiones del mismo local y fecha (incluida esta), de la más nueva a la más antigua.',
    type: SalesImportVersionDto,
    isArray: true,
  })
  versions: SalesImportVersionDto[];
}

export class SalesImportIssueDto {
  @ApiProperty({
    description:
      'Tipo de problema que impide confirmar: STORE_NOT_IDENTIFIED (el encabezado no trae un ID Subway reconocible), STORE_NOT_CONFIGURED (el ID Subway no está asignado a ningún local), STORE_INACTIVE (el ID Subway es de un local inactivo) o PAYMENT_METHOD_NOT_CONFIGURED.',
    enum: [
      'STORE_NOT_IDENTIFIED',
      'STORE_NOT_CONFIGURED',
      'STORE_INACTIVE',
      'PAYMENT_METHOD_NOT_CONFIGURED',
    ],
    example: 'STORE_NOT_CONFIGURED',
  })
  code: string;

  @ApiProperty({
    description: 'Mensaje accionable para el administrador.',
    example:
      'El ID Subway 72597 no está asignado a ningún local. Elige el local para confirmar; si lo recuerdas, el ID queda asignado para próximas cargas.',
  })
  message: string;

  @ApiProperty({
    description:
      'Texto original del local en el encabezado (solo problemas del local: STORE_*).',
    example: '208 - 72597',
    required: false,
  })
  externalStoreCode?: string;

  @ApiProperty({
    description:
      'ID Subway extraído del encabezado (solo problemas del local: STORE_*); null en STORE_NOT_IDENTIFIED.',
    example: '72597',
    type: String,
    nullable: true,
    required: false,
  })
  subwayStoreId?: string | null;

  @ApiProperty({
    description: 'Línea afectada (solo PAYMENT_METHOD_NOT_CONFIGURED).',
    example: 4,
    required: false,
  })
  lineNumber?: number;

  @ApiProperty({
    description: 'Etiqueta afectada (solo PAYMENT_METHOD_NOT_CONFIGURED).',
    example: 'N.de Créd.',
    required: false,
  })
  originalLabel?: string;
}

export class SalesImportPreviewLineDto {
  @ApiProperty({ description: 'Posición de la línea.', example: 4 })
  lineNumber: number;

  @ApiProperty({
    description: 'Etiqueta tal como viene en el reporte.',
    example: 'N.de Créd.',
  })
  originalLabel: string;

  @ApiProperty({ description: 'Monto en CLP enteros.', example: 0 })
  amount: number;

  @ApiProperty({
    description: 'Porcentaje del total según el reporte.',
    example: 0,
    type: Number,
    nullable: true,
  })
  percentage: number | null;

  @ApiProperty({
    description: 'Medio resuelto; null si la etiqueta no tiene alias.',
    type: SalesImportPaymentMethodDto,
    nullable: true,
  })
  paymentMethod: SalesImportPaymentMethodDto | null;
}

export class SalesImportStoreOptionDto {
  @ApiProperty({
    description: 'ID del local activo.',
    example: '1010021e-9bab-42d5-851c-417e9e2503bf',
  })
  id: string;

  @ApiProperty({ description: 'Nombre del local.', example: 'Santa María' })
  name: string;

  @ApiProperty({
    description:
      'ID Subway configurado en el local; «recordar» solo asigna el del archivo si es null.',
    example: null,
    type: String,
    nullable: true,
  })
  subwayStoreId: string | null;

  @ApiProperty({
    description:
      'Versión vigente de ese local en la fecha del archivo (la que se reemplazaría al confirmar); null si no hay.',
    type: SalesImportVersionDto,
    nullable: true,
  })
  activeImport: SalesImportVersionDto | null;
}

export class SalesImportResolutionOptionsDto {
  @ApiProperty({
    description:
      'Locales activos para elegir a mano; vacío si el local se identificó.',
    type: SalesImportStoreOptionDto,
    isArray: true,
  })
  stores: SalesImportStoreOptionDto[];

  @ApiProperty({
    description:
      'Medios activos del catálogo para las líneas sin alias; vacío si todas se identificaron.',
    type: SalesImportPaymentMethodDto,
    isArray: true,
  })
  paymentMethods: SalesImportPaymentMethodDto[];
}

export class SalesImportPreviewDto {
  @ApiProperty({
    description:
      'CREATED: archivo nuevo guardado como PENDING. EXISTING: el mismo archivo ya estaba importado (no se duplica). UNRESOLVED: el local o algún medio no se identificó; no se guardó nada y el administrador puede elegirlos a mano (resolutionOptions).',
    enum: ['CREATED', 'EXISTING', 'UNRESOLVED'],
    example: 'CREATED',
  })
  outcome: string;

  @ApiProperty({
    description:
      'true si hay una importación PENDING lista para confirmar con POST /sales-imports/{id}/confirm.',
    example: true,
  })
  canConfirm: boolean;

  @ApiProperty({
    description:
      'Datos que no se identificaron y hay que elegir a mano (vacío si no hay).',
    type: SalesImportIssueDto,
    isArray: true,
  })
  issues: SalesImportIssueDto[];

  @ApiProperty({
    description: 'Fecha de negocio (YYYY-MM-DD) leída del «Período».',
    example: '2026-11-05',
  })
  businessDate: string;

  @ApiProperty({
    description: 'Inicio del horario del reporte.',
    example: '2026-11-05T03:00:00.000Z',
  })
  periodStart: Date;

  @ApiProperty({
    description: 'Término del horario del reporte.',
    example: '2026-11-06T02:59:59.000Z',
  })
  periodEnd: Date;

  @ApiProperty({
    description: 'Fecha de emisión del reporte (informativa).',
    example: '2026-11-06T14:14:55.000Z',
    type: Date,
    nullable: true,
  })
  issuedAt: Date | null;

  @ApiProperty({
    description:
      'Texto original del local en el encabezado del reporte; el número interno de MrComanda (208) no identifica al local.',
    example: '208 - 72597',
  })
  externalStoreCode: string;

  @ApiProperty({
    description:
      'ID Subway extraído del encabezado; null si no trae uno reconocible.',
    example: '72597',
    type: String,
    nullable: true,
  })
  subwayStoreId: string | null;

  @ApiProperty({
    description:
      'Local activo con ese ID Subway; null si no se pudo identificar (ver issues).',
    type: SalesImportStoreDto,
    nullable: true,
  })
  store: SalesImportStoreDto | null;

  @ApiProperty({
    description: 'Total de «Medios de pago» en CLP enteros.',
    example: 873260,
  })
  totalAmount: number;

  @ApiProperty({
    description: 'Líneas leídas con su medio resuelto (o null).',
    type: SalesImportPreviewLineDto,
    isArray: true,
  })
  lines: SalesImportPreviewLineDto[];

  @ApiProperty({
    description: 'Importación guardada (null si UNRESOLVED).',
    type: SalesImportDetailDto,
    nullable: true,
  })
  import: SalesImportDetailDto | null;

  @ApiProperty({
    description:
      'Versión vigente del mismo local y fecha que esta carga reemplazaría al confirmarse.',
    type: SalesImportVersionDto,
    nullable: true,
  })
  activeImport: SalesImportVersionDto | null;

  @ApiProperty({
    description:
      'Solo en UNRESOLVED: locales y medios para elegir a mano lo que no se identificó y confirmar con POST /sales-imports/confirm-with-resolution; null en CREATED y EXISTING.',
    type: SalesImportResolutionOptionsDto,
    nullable: true,
  })
  resolutionOptions: SalesImportResolutionOptionsDto | null;
}

export class SalesImportReportErrorDto {
  @ApiProperty({ description: 'Código HTTP.', example: 422 })
  statusCode: number;

  @ApiProperty({
    description: 'Mensaje accionable en español.',
    example:
      'El reporte cubre del 05/11/2026 al 06/11/2026. Exporta un informe por día: el período debe empezar y terminar el mismo día.',
  })
  message: string;

  @ApiProperty({
    description: 'Nombre del error HTTP.',
    example: 'Unprocessable Entity',
  })
  error: string;

  @ApiProperty({
    description: 'Código del problema del archivo (MrComandaReportError).',
    example: 'PERIOD_MULTIPLE_DAYS',
  })
  code: string;

  @ApiProperty({
    description: 'Fila de la planilla afectada, si aplica.',
    example: 6,
    type: Number,
    nullable: true,
  })
  row: number | null;
}

export class SalesImportConflictDto {
  @ApiProperty({ description: 'Código HTTP.', example: 409 })
  statusCode: number;

  @ApiProperty({
    description: 'Motivo del conflicto.',
    example:
      'La versión vigente cambió: vuelve a revisar la vista previa antes de confirmar',
  })
  message: string;

  @ApiProperty({ description: 'Nombre del error HTTP.', example: 'Conflict' })
  error: string;

  @ApiProperty({
    description: 'Versión vigente actual para ese local y fecha (si existe).',
    type: SalesImportVersionDto,
    nullable: true,
  })
  activeImport: SalesImportVersionDto | null;
}
