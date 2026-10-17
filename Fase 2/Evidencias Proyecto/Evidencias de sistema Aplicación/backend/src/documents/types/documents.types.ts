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
  createdAt: Date;
  latestVersion: DocumentVersionResponse;
}
