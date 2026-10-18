import { ROLE, type RoleCode } from '../../auth/constants/roles.constants.js';

// Tipos y constantes del gestor documental (SPRINT-2-T05).

// Tipos de documento laboral que el administrador carga en la carpeta de un
// trabajador (criterio 1 de E1-H3). LIQUIDACION la carga el contador (T13) y
// PERMISO_SANITARIO es un documento del local, sin trabajador titular.
export const UPLOADABLE_DOCUMENT_TYPES = [
  'CONTRATO',
  'ANEXO',
  'PACTO',
  'FINIQUITO',
] as const;
export type UploadableDocumentType = (typeof UPLOADABLE_DOCUMENT_TYPES)[number];

// Roles que consultan documentos (SPRINT-2-T06): el administrador ve todos;
// trabajadores y supervisores, solo los propios (ver document-access.policy).
export const DOCUMENT_READER_ROLES: readonly RoleCode[] = [
  ROLE.ADMINISTRADOR,
  ROLE.SUPERVISOR,
  ROLE.TRABAJADOR,
];

// Roles que tienen carpeta digital: los trabajadores de local. Los roles
// globales (administrador, contador) no tienen local al que asociar el documento.
export const DOCUMENT_SUBJECT_ROLES: readonly RoleCode[] = [
  ROLE.TRABAJADOR,
  ROLE.SUPERVISOR,
];

// Días corridos para registrar el documento en la Dirección del Trabajo.
export const DT_REGISTRATION_DAYS = 15;

// Campos del archivo que entrega Multer (memoria) y que usa el servicio.
export interface UploadedDocumentFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

// Versión de un documento tal como la devuelve la API.
export interface DocumentVersionResponse {
  id: string;
  number: number;
  fileName: string;
  // Tipo real detectado del contenido (application/pdf, image/png o image/jpeg).
  mime: string;
  size: number;
  sha256: string;
  changeNote: string | null;
  createdAt: Date;
  // Nombre y apellido de quien subió la versión.
  uploadedBy: string;
}

// Documento laboral con su versión vigente.
export interface DocumentResponse {
  id: string;
  workerId: string;
  storeId: string;
  type: string;
  title: string;
  // Fechas de negocio en formato YYYY-MM-DD.
  issuedAt: string | null;
  retainUntil: string;
  dtRegistrationDueAt: string | null;
  // true mientras no venza el plazo de conservación (SPRINT-2-T07).
  deletionBlocked: boolean;
  // Motivo del bloqueo; null si el documento ya puede eliminarse.
  deletionReason: string | null;
  createdAt: Date;
  latestVersion: DocumentVersionResponse;
}

// Reglas de carga para el usuario actual (las muestra el frontend).
export interface UploadPolicy {
  maxBytes: number;
  allowedMimes: string[];
  canUpload: boolean;
}

// Listado de documentos (SPRINT-2-T06).
export interface DocumentListResponse {
  items: DocumentResponse[];
  policy: UploadPolicy;
}

// Historial de versiones de un documento, de la más nueva a la más antigua.
export interface DocumentVersionHistory {
  documentId: string;
  workerId: string;
  versions: DocumentVersionResponse[];
}

// Resultado de comparar el archivo guardado con el hash registrado:
// VALID coincide, ALTERED no coincide, MISSING no está en disco.
export const INTEGRITY_STATUSES = ['VALID', 'ALTERED', 'MISSING'] as const;
export type IntegrityStatus = (typeof INTEGRITY_STATUSES)[number];

export interface IntegrityCheckResponse {
  versionId: string;
  status: IntegrityStatus;
  valid: boolean;
  expectedHash: string;
  // Hash recalculado; null si el archivo no está en disco.
  actualHash: string | null;
  checkedAt: Date;
}

// Archivo listo para descargar.
export interface DocumentDownload {
  content: Buffer;
  fileName: string;
  mimeType: string;
  // VALID o ALTERED: si falta el archivo la descarga responde 404.
  integrity: Exclude<IntegrityStatus, 'MISSING'>;
}

// Resultado de eliminar un documento con el plazo de conservación vencido
// (SPRINT-2-T07).
export interface DocumentDeletionResponse {
  id: string;
  // Fecha YYYY-MM-DD hasta la que debía conservarse.
  retainUntil: string;
  // Versiones eliminadas junto con el documento.
  deletedVersions: number;
}
