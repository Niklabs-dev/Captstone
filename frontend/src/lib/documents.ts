import { isObject, isUuid } from './users';

// Contrato interno del frontend propuesto; no representa un Swagger de NestJS.
export const DOCUMENT_TYPES = [
  'CONTRATO',
  'ANEXO',
  'PACTO',
  'FINIQUITO',
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];
export const DOCUMENT_LABELS: Record<DocumentType, string> = {
  CONTRATO: 'Contrato',
  ANEXO: 'Anexo',
  PACTO: 'Pacto',
  FINIQUITO: 'Finiquito',
};
export const DOCUMENT_MIMES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
] as const;
export type DocumentMime = (typeof DOCUMENT_MIMES)[number];
// Límite de memoria provisional del cliente, no una regla del backend pendiente.
export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;
export interface DocumentVersion {
  id: string;
  number: number;
  fileName: string;
  mime: DocumentMime;
  size: number;
  sha256: string;
  createdAt: string;
  uploadedBy: string;
}
export interface WorkerDocument {
  id: string;
  workerId: string;
  type: DocumentType;
  title: string;
  retainUntil: string | null;
  deletionBlocked: boolean;
  deletionReason: string | null;
  latestVersion: DocumentVersion;
}
export interface UploadPolicy {
  maxBytes: number;
  allowedMimes: DocumentMime[];
  canUpload: boolean;
}
export interface DocumentCollection {
  items: WorkerDocument[];
  policy: UploadPolicy;
}
export interface VersionHistory {
  documentId: string;
  workerId: string;
  versions: DocumentVersion[];
}
export interface IntegrityResult {
  versionId: string;
  valid: boolean;
  expectedHash: string;
  actualHash: string;
  checkedAt: string;
}
export interface UploadMetadata {
  title: string;
  type: string;
  workerId: string;
  file: { name: string; type: string; size: number } | null;
}
export function isDocumentType(value: unknown): value is DocumentType {
  return DOCUMENT_TYPES.some((type) => type === value);
}
function isMime(value: unknown): value is DocumentMime {
  return DOCUMENT_MIMES.some((type) => type === value);
}
function isHash(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}
function isDate(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}
function isLabel(value: unknown, max = 200): value is string {
  return (
    typeof value === 'string' && value.trim().length > 0 && value.length <= max
  );
}
export function parseDocumentVersion(value: unknown): DocumentVersion | null {
  if (
    !isObject(value) ||
    !isUuid(value.id) ||
    !Number.isSafeInteger(value.number) ||
    typeof value.number !== 'number' ||
    value.number < 1 ||
    !isLabel(value.fileName) ||
    !isMime(value.mime) ||
    typeof value.size !== 'number' ||
    !Number.isSafeInteger(value.size) ||
    value.size < 1 ||
    value.size > MAX_DOCUMENT_BYTES ||
    !isHash(value.sha256) ||
    !isDate(value.createdAt) ||
    !isLabel(value.uploadedBy)
  )
    return null;
  return {
    id: value.id,
    number: value.number,
    fileName: value.fileName,
    mime: value.mime,
    size: value.size,
    sha256: value.sha256,
    createdAt: value.createdAt,
    uploadedBy: value.uploadedBy,
  };
}
export function parseDocument(
  value: unknown,
  workerId: string,
): WorkerDocument | null {
  if (
    !isObject(value) ||
    !isUuid(value.id) ||
    value.workerId !== workerId ||
    !isDocumentType(value.type) ||
    !isLabel(value.title, 160) ||
    typeof value.deletionBlocked !== 'boolean' ||
    (value.retainUntil !== null && !isDate(value.retainUntil)) ||
    (value.deletionReason !== null && !isLabel(value.deletionReason, 500)) ||
    (value.deletionBlocked && !isLabel(value.deletionReason, 500))
  )
    return null;
  const version = parseDocumentVersion(value.latestVersion);
  if (!version) return null;
  return {
    id: value.id,
    workerId,
    type: value.type,
    title: value.title,
    retainUntil: value.retainUntil as string | null,
    deletionBlocked: value.deletionBlocked,
    deletionReason: value.deletionReason as string | null,
    latestVersion: version,
  };
}
export function parseDocumentCollection(
  value: unknown,
  workerId: string,
): DocumentCollection | null {
  if (
    !isUuid(workerId) ||
    !isObject(value) ||
    !Array.isArray(value.items) ||
    !isObject(value.policy) ||
    typeof value.policy.maxBytes !== 'number' ||
    !Number.isSafeInteger(value.policy.maxBytes) ||
    value.policy.maxBytes < 1 ||
    value.policy.maxBytes > MAX_DOCUMENT_BYTES ||
    typeof value.policy.canUpload !== 'boolean' ||
    !Array.isArray(value.policy.allowedMimes) ||
    value.policy.allowedMimes.length === 0 ||
    !value.policy.allowedMimes.every(isMime)
  )
    return null;
  const items = value.items.map((item: unknown) =>
    parseDocument(item, workerId),
  );
  if (
    !items.every((item) => item !== null) ||
    new Set(items.map((item) => item.id)).size !== items.length
  )
    return null;
  return {
    items,
    policy: {
      maxBytes: value.policy.maxBytes,
      allowedMimes: [...new Set(value.policy.allowedMimes)],
      canUpload: value.policy.canUpload,
    },
  };
}
export function parseVersionHistory(
  value: unknown,
  document: WorkerDocument,
): VersionHistory | null {
  if (
    !isObject(value) ||
    value.documentId !== document.id ||
    value.workerId !== document.workerId ||
    !Array.isArray(value.versions)
  )
    return null;
  const versions = value.versions.map(parseDocumentVersion);
  if (
    versions.length === 0 ||
    !versions.every((version) => version !== null) ||
    new Set(versions.map((version) => version.id)).size !== versions.length ||
    new Set(versions.map((version) => version.number)).size !==
      versions.length ||
    !versions.some(
      (version) =>
        version.id === document.latestVersion.id &&
        version.sha256 === document.latestVersion.sha256 &&
        version.number === document.latestVersion.number,
    )
  )
    return null;
  return {
    documentId: document.id,
    workerId: document.workerId,
    versions: [...versions].sort((a, b) => b.number - a.number),
  };
}
export function parseIntegrity(
  value: unknown,
  version: DocumentVersion,
): IntegrityResult | null {
  if (
    !isObject(value) ||
    value.versionId !== version.id ||
    typeof value.valid !== 'boolean' ||
    value.expectedHash !== version.sha256 ||
    !isHash(value.actualHash) ||
    !isDate(value.checkedAt) ||
    value.valid !== (value.expectedHash === value.actualHash)
  )
    return null;
  return {
    versionId: version.id,
    valid: value.valid,
    expectedHash: version.sha256,
    actualHash: value.actualHash,
    checkedAt: value.checkedAt,
  };
}
export function validateDocumentUpload(
  input: UploadMetadata,
  policy: UploadPolicy,
): string | null {
  if (!isUuid(input.workerId)) return 'Selecciona un trabajador válido.';
  if (!policy.canUpload)
    return 'La carga no está disponible para esta carpeta.';
  if (!isLabel(input.title.trim(), 160))
    return 'Ingresa un nombre de documento de hasta 160 caracteres.';
  if (!isDocumentType(input.type)) return 'Selecciona un tipo de documento.';
  if (!input.file || !input.file.name.trim()) return 'Selecciona un archivo.';
  if (!Number.isSafeInteger(input.file.size) || input.file.size < 1)
    return 'El archivo está vacío.';
  if (input.file.size > Math.min(policy.maxBytes, MAX_DOCUMENT_BYTES))
    return 'El archivo supera el tamaño permitido.';
  if (!policy.allowedMimes.some((mime) => mime === input.file?.type))
    return 'El formato del archivo no está permitido.';
  const extensions: Record<DocumentMime, RegExp> = {
    'application/pdf': /\.pdf$/i,
    'image/png': /\.png$/i,
    'image/jpeg': /\.jpe?g$/i,
  };
  if (
    !isMime(input.file.type) ||
    !extensions[input.file.type].test(input.file.name)
  )
    return 'La extensión no corresponde al formato del archivo.';
  return null;
}
export async function documentHash(data: ArrayBuffer): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
export function documentDownloadName(value: string): string {
  return (
    value
      .replace(/[\u0000-\u001f\u007f/\\]/g, '_')
      .replace(/^\.+/, '')
      .slice(0, 180) || 'documento'
  );
}
export function documentDate(value: string): string {
  return new Intl.DateTimeFormat('es-CL', {
    timeZone: 'America/Santiago',
    dateStyle: 'medium',
  }).format(new Date(value));
}
