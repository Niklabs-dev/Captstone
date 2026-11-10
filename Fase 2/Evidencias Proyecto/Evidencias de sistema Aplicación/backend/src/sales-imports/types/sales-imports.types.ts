// Tipos de la API de importación diaria de ventas MrComanda (SPRINT-4R-T10).
// Los montos son enteros CLP (number: el Excel diario está muy por debajo de
// Number.MAX_SAFE_INTEGER) y las fechas de negocio van como YYYY-MM-DD.

import type {
  SalesImportResolution,
  SalesImportStatus,
} from '../../generated/prisma/client.js';
import type { SalesImportIssue } from '../sales-import-resolver.service.js';

export interface SalesImportStoreRef {
  id: string;
  name: string;
}

export interface SalesImportPersonRef {
  id: string;
  name: string;
}

export interface SalesImportPaymentMethodRef {
  id: string;
  code: string;
  name: string;
}

export interface SalesImportLineResponse {
  lineNumber: number;
  originalLabel: string;
  amount: number;
  percentage: number | null;
  paymentMethod: SalesImportPaymentMethodRef;
  // AUTOMATIC si el medio salió de un alias; MANUAL si lo eligió el
  // administrador al importar (SPRINT-4A-T18).
  resolution: SalesImportResolution;
}

// Línea del reporte omitida a mano (SPRINT-4A-T18): siempre con monto 0.
export interface SalesImportSkippedLineResponse {
  lineNumber: number;
  originalLabel: string;
  amount: number;
  percentage: number | null;
}

// Datos de la importación sin sus líneas (listado).
export interface SalesImportSummary {
  id: string;
  status: SalesImportStatus;
  version: number;
  store: SalesImportStoreRef;
  businessDate: string;
  periodStart: Date;
  periodEnd: Date;
  issuedAt: Date | null;
  externalStoreCode: string;
  // ID Subway con que se identificó el local (SPRINT-4A-T17); null solo en
  // importaciones anteriores a ese cambio.
  subwayStoreId: string | null;
  totalAmount: number;
  fileName: string;
  sizeBytes: number;
  sha256Hash: string;
  uploadedBy: SalesImportPersonRef;
  createdAt: Date;
  confirmedBy: SalesImportPersonRef | null;
  confirmedAt: Date | null;
  supersededAt: Date | null;
  // SPRINT-4A-T18: cómo se identificó el local y quién resolvió a mano algún
  // dato (local o medios); null si todo salió de equivalencias configuradas.
  storeResolution: SalesImportResolution;
  resolvedBy: SalesImportPersonRef | null;
  resolvedAt: Date | null;
}

// Otra versión del mismo local y fecha (trazabilidad de correcciones).
export interface SalesImportVersionRef {
  id: string;
  version: number;
  status: SalesImportStatus;
  createdAt: Date;
  confirmedAt: Date | null;
  supersededAt: Date | null;
}

export interface SalesImportDetail extends SalesImportSummary {
  lines: SalesImportLineResponse[];
  // Líneas omitidas a mano (monto 0); vacío si no se omitió ninguna.
  skippedLines: SalesImportSkippedLineResponse[];
  // Todas las versiones del mismo local y fecha (incluida esta), de la más
  // nueva a la más antigua.
  versions: SalesImportVersionRef[];
}

// Resultado de la vista previa:
// - CREATED: archivo nuevo guardado como PENDING, listo para confirmar.
// - EXISTING: el mismo archivo (hash) ya estaba importado para ese local y
//   fecha; se devuelve la importación existente sin duplicarla.
// - UNRESOLVED: el Excel es válido, pero el local o algún medio no tiene
//   equivalencia configurada; no se guardó nada. Desde SPRINT-4A-T18 el
//   administrador puede elegirlos a mano (resolutionOptions) y confirmar con
//   POST /sales-imports/confirm-with-resolution.
export type SalesImportPreviewOutcome = 'CREATED' | 'EXISTING' | 'UNRESOLVED';

export interface SalesImportPreviewLine {
  lineNumber: number;
  originalLabel: string;
  amount: number;
  percentage: number | null;
  paymentMethod: SalesImportPaymentMethodRef | null;
}

// Local activo que el administrador puede elegir a mano (SPRINT-4A-T18),
// con la versión vigente que la confirmación reemplazaría en ese local.
export interface SalesImportStoreOption {
  id: string;
  name: string;
  // ID Subway configurado; «recordar» solo asigna el del archivo si es null.
  subwayStoreId: string | null;
  activeImport: SalesImportVersionRef | null;
}

// Opciones para resolver a mano lo que no se identificó (SPRINT-4A-T18):
// locales activos (vacío si el local se identificó) y medios activos del
// catálogo (vacío si todas las líneas se identificaron).
export interface SalesImportResolutionOptions {
  stores: SalesImportStoreOption[];
  paymentMethods: SalesImportPaymentMethodRef[];
}

export interface SalesImportPreview {
  outcome: SalesImportPreviewOutcome;
  // true solo si existe una importación PENDING que se puede confirmar.
  canConfirm: boolean;
  issues: SalesImportIssue[];
  businessDate: string;
  periodStart: Date;
  periodEnd: Date;
  issuedAt: Date | null;
  externalStoreCode: string;
  // ID Subway extraído del encabezado; null si no trae uno reconocible.
  subwayStoreId: string | null;
  store: SalesImportStoreRef | null;
  totalAmount: number;
  lines: SalesImportPreviewLine[];
  // Importación guardada (CREATED/EXISTING); null si UNRESOLVED.
  import: SalesImportDetail | null;
  // Versión vigente del mismo local y fecha que esta carga reemplazaría al
  // confirmarse; null si no hay o si esta misma es la vigente.
  activeImport: SalesImportVersionRef | null;
  // Solo en UNRESOLVED: opciones para elegir a mano lo pendiente.
  resolutionOptions: SalesImportResolutionOptions | null;
}

export interface SalesImportPreviewResult {
  preview: SalesImportPreview;
  created: boolean;
}

export interface SalesImportConfirmResult {
  import: SalesImportDetail;
  // false si ya estaba confirmada (reintento idempotente).
  confirmed: boolean;
  superseded: SalesImportVersionRef | null;
}

// Resumen de una resolución manual aplicada al confirmar (SPRINT-4A-T18),
// para la auditoría: identificadores y etiquetas, nunca el archivo.
export interface SalesImportManualResolutionSummary {
  store: {
    storeId: string;
    subwayStoreId: string | null;
    remembered: boolean;
  } | null;
  lines: {
    lineNumber: number;
    originalLabel: string;
    action: 'ASSIGN' | 'SKIP';
    paymentMethodId: string | null;
    remembered: boolean;
  }[];
}

export interface SalesImportResolvedConfirmResult extends SalesImportConfirmResult {
  manualResolution: SalesImportManualResolutionSummary;
}

// Origen HTTP de la solicitud, para auditar dentro de la transacción lo que
// «recordar» cambia en locales y alias (SPRINT-4A-T18).
export interface SalesImportAuditOrigin {
  ipAddress: string | null;
  userAgent: string | null;
}

export interface SalesImportFileDownload {
  importId: string;
  storeId: string;
  fileName: string;
  mimeType: string;
  content: Buffer;
  integrity: 'VALID' | 'ALTERED';
}

// Archivo recibido por Multer (memoria).
export interface SalesImportUploadedFile {
  buffer: Buffer;
  originalname: string;
  size: number;
}
