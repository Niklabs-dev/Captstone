import type { Role } from './auth';
import { isObject, isUuid } from './users';
import {
  parseDocumentCollection,
  parseDocumentVersion,
  type DocumentCollection,
  type VersionHistory,
} from './documents';

export function canReadOwnDocuments(role: Role): boolean {
  return role === 'TRABAJADOR' || role === 'SUPERVISOR';
}
// No se admite workerId, local ni tipo en la URL: el propietario lo fija la sesión.
export function ownDocumentPath(
  path: string[],
  query: URLSearchParams,
): string | null {
  if ([...query.keys()].length) return null;
  if (!path.length) return '/documents';
  if (path.length === 2 && isUuid(path[0]) && path[1] === 'versions')
    return `/documents/${path[0]}/versions`;
  if (
    path.length === 3 &&
    path[0] === 'versions' &&
    isUuid(path[1]) &&
    ['integrity', 'download'].includes(path[2])
  )
    return `/documents/versions/${path[1]}/${path[2]}`;
  return null;
}
export function parseOwnDocuments(
  value: unknown,
  workerId: string,
): DocumentCollection | null {
  const result = parseDocumentCollection(value, workerId);
  // El parser común también excluye LIQUIDACION y rechaza cualquier propietario ajeno.
  return result && !result.policy.canUpload ? result : null;
}
export function parseOwnDocumentHistory(
  value: unknown,
  workerId: string,
  documentId: string,
): VersionHistory | null {
  if (
    !isUuid(workerId) ||
    !isUuid(documentId) ||
    !isObject(value) ||
    value.workerId !== workerId ||
    value.documentId !== documentId ||
    !Array.isArray(value.versions)
  )
    return null;
  const versions = value.versions.map(parseDocumentVersion);
  if (
    !versions.length ||
    !versions.every((version) => version !== null) ||
    new Set(versions.map((version) => version.id)).size !== versions.length ||
    new Set(versions.map((version) => version.number)).size !== versions.length
  )
    return null;
  return {
    documentId,
    workerId,
    versions: versions.sort((a, b) => b.number - a.number),
  };
}
