// Tipos de la API de importación diaria de ventas MrComanda (SPRINT-4R-T10).
// Los montos son enteros CLP (number: el Excel diario está muy por debajo de
// Number.MAX_SAFE_INTEGER) y las fechas de negocio van como YYYY-MM-DD.

import type { SalesImportStatus } from '../../generated/prisma/client.js';
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
  totalAmount: number;
  fileName: string;
  sizeBytes: number;
  sha256Hash: string;
  uploadedBy: SalesImportPersonRef;
  createdAt: Date;
  confirmedBy: SalesImportPersonRef | null;
  confirmedAt: Date | null;
  supersededAt: Date | null;
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
  // Todas las versiones del mismo local y fecha (incluida esta), de la más
  // nueva a la más antigua.
  versions: SalesImportVersionRef[];
}

// Resultado de la vista previa:
// - CREATED: archivo nuevo guardado como PENDING, listo para confirmar.
// - EXISTING: el mismo archivo (hash) ya estaba importado para ese local y
//   fecha; se devuelve la importación existente sin duplicarla.
// - UNRESOLVED: el Excel es válido, pero el local o algún medio no tiene
//   equivalencia configurada; no se guardó nada.
export type SalesImportPreviewOutcome = 'CREATED' | 'EXISTING' | 'UNRESOLVED';

export interface SalesImportPreviewLine {
  lineNumber: number;
  originalLabel: string;
  amount: number;
  percentage: number | null;
  paymentMethod: SalesImportPaymentMethodRef | null;
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
  store: SalesImportStoreRef | null;
  totalAmount: number;
  lines: SalesImportPreviewLine[];
  // Importación guardada (CREATED/EXISTING); null si UNRESOLVED.
  import: SalesImportDetail | null;
  // Versión vigente del mismo local y fecha que esta carga reemplazaría al
  // confirmarse; null si no hay o si esta misma es la vigente.
  activeImport: SalesImportVersionRef | null;
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
