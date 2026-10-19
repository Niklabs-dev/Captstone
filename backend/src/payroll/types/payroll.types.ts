import { ROLE, type RoleCode } from '../../auth/constants/roles.constants.js';
import {
  DOCUMENT_SUBJECT_ROLES,
  type IntegrityStatus,
} from '../../documents/types/documents.types.js';

// Tipos y constantes de las liquidaciones de sueldo (SPRINT-2-T13). Siguen el
// contrato que consume la vista del contador (SPRINT-2-T16, PR #24,
// frontend/src/lib/payroll.ts) y, en el portal del trabajador (SPRINT-2-T15),
// el de Mis liquidaciones (SPRINT-2-T17, PR #25, frontend/src/lib/my-payslips.ts).

// Código del tipo de documento con que se guarda cada liquidación en el
// gestor documental.
export const PAYSLIP_DOCUMENT_TYPE = 'LIQUIDACION';

// Las liquidaciones solo se aceptan en PDF.
export const PAYSLIP_MIME_TYPE = 'application/pdf';

export const PAYSLIP_STATUSES = ['PENDING_SIGNATURE', 'PUBLISHED'] as const;
export type PayslipStatusCode = (typeof PAYSLIP_STATUSES)[number];

// Roles que consultan la gestión de liquidaciones: el contador la opera y el
// administrador solo consulta.
export const PAYROLL_READER_ROLES: readonly RoleCode[] = [
  ROLE.CONTADOR,
  ROLE.ADMINISTRADOR,
];

// Roles con liquidaciones propias en el portal del trabajador (SPRINT-2-T15):
// los mismos que tienen carpeta digital.
export const OWN_PAYSLIP_READER_ROLES: readonly RoleCode[] =
  DOCUMENT_SUBJECT_ROLES;

// Campos del archivo que entrega Multer (memoria) y que usa el servicio.
export interface UploadedPayslipFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

export interface PayslipStore {
  id: string;
  name: string;
}

// Trabajador de una liquidación o del selector de carga. Solo los datos
// mínimos: sin RUT, remuneraciones ni datos bancarios (Ley N°21.719).
export interface PayslipWorker {
  id: string;
  // Nombre y apellido.
  name: string;
  // En una liquidación, el local al que pertenecía al cargarla.
  store: PayslipStore;
  isActive: boolean;
}

// Liquidación tal como la devuelve la API.
export interface PayslipResponse {
  id: string;
  worker: PayslipWorker;
  // Mes de la remuneración, YYYY-MM.
  period: string;
  fileName: string;
  size: number;
  sha256: string;
  createdAt: Date;
  status: PayslipStatusCode;
  // Fecha de firma (YYYY-MM-DD) y de publicación; null mientras está pendiente.
  signedAt: string | null;
  publishedAt: Date | null;
  // Revisión opaca: cambia con cada modificación de la liquidación.
  revision: string;
  // true si el usuario actual puede publicarla.
  canPublish: boolean;
}

// Reglas de carga para el usuario actual (las muestra el frontend).
export interface PayslipUploadPolicy {
  maxBytes: number;
  allowedMimes: string[];
  canUpload: boolean;
}

// Listado de la gestión de liquidaciones: las liquidaciones, el selector de
// trabajadores para la carga y las reglas de carga.
export interface PayslipCollection {
  items: PayslipResponse[];
  workers: PayslipWorker[];
  policy: PayslipUploadPolicy;
}

// Liquidación publicada del trabajador autenticado (SPRINT-2-T15).
export interface OwnPayslip {
  id: string;
  // Versión del archivo publicado (la vigente del documento).
  versionId: string;
  workerId: string;
  // Mes de la remuneración, YYYY-MM.
  period: string;
  status: 'PUBLISHED';
  fileName: string;
  mime: string;
  size: number;
  sha256: string;
  // Fecha de firma, YYYY-MM-DD.
  signedAt: string;
  publishedAt: Date;
}

export interface OwnPayslipList {
  items: OwnPayslip[];
}

// Verificación de integridad de una liquidación propia: recalcula el SHA-256
// del archivo guardado y lo compara con el registrado al cargarla.
export interface OwnPayslipIntegrity {
  payslipId: string;
  versionId: string;
  workerId: string;
  status: IntegrityStatus;
  valid: boolean;
  expectedHash: string;
  // Hash recalculado; null si el archivo no está en el almacenamiento.
  actualHash: string | null;
  checkedAt: Date;
}

// Archivo de una liquidación propia listo para descargar.
export interface OwnPayslipDownload {
  content: Buffer;
  fileName: string;
  mimeType: string;
  // VALID o ALTERED: si falta el archivo la descarga responde 404.
  integrity: Exclude<IntegrityStatus, 'MISSING'>;
  // Datos para la auditoría de la descarga.
  versionId: string;
  storeId: string;
}
