import { ROLE, type RoleCode } from '../../auth/constants/roles.constants.js';

// Tipos y constantes de las liquidaciones de sueldo (SPRINT-2-T13). Siguen el
// contrato que consume la vista del contador (SPRINT-2-T16, PR #24,
// frontend/src/lib/payroll.ts).

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
