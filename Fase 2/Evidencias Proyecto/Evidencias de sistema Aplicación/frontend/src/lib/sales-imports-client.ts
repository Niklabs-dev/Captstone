import { isRecord } from './auth';
import {
  parseSalesImportDetail,
  parseSalesImportList,
  parseSalesImportPreview,
  salesImportError,
  type SalesImportDetail,
  type SalesImportPreview,
  type SalesImportSummary,
} from './sales-imports';

// Cliente del BFF de importación de ventas (SPRINT-4R-T11).
export class SalesImportRequestError extends Error {
  constructor(
    public readonly status: number,
    message?: string,
  ) {
    super(message ?? salesImportError(status));
    this.name = 'SalesImportRequestError';
  }
}

async function request<T>(
  path: string,
  init: RequestInit,
  parse: (value: unknown) => T | null,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch('/api/sales-imports' + path, init);
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError')
      throw cause;
    throw new SalesImportRequestError(503);
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok)
    throw new SalesImportRequestError(
      response.status,
      isRecord(body) && typeof body.message === 'string'
        ? body.message
        : undefined,
    );
  const parsed = parse(body);
  if (parsed === null) throw new SalesImportRequestError(502);
  return parsed;
}

export function loadSalesImports(
  signal: AbortSignal,
): Promise<SalesImportSummary[]> {
  return request('', { signal }, parseSalesImportList);
}
export function loadSalesImport(
  id: string,
  signal?: AbortSignal,
): Promise<SalesImportDetail> {
  return request('/' + id, { signal }, parseSalesImportDetail);
}
export function previewSalesImport(file: File): Promise<SalesImportPreview> {
  const payload = new FormData();
  payload.set('file', file);
  return request(
    '/preview',
    { method: 'POST', body: payload },
    parseSalesImportPreview,
  );
}
export function confirmSalesImport(
  id: string,
  expectedActiveImportId: string | null,
): Promise<SalesImportDetail> {
  return request(
    `/${id}/confirm`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedActiveImportId }),
    },
    parseSalesImportDetail,
  );
}
// Descarga autenticada: expone la integridad que informa el servidor, que un
// enlace directo perdería.
export async function downloadSalesImportFile(
  id: string,
): Promise<{ blob: Blob; altered: boolean }> {
  let response: Response;
  try {
    response = await fetch(`/api/sales-imports/${id}/file`);
  } catch {
    throw new SalesImportRequestError(503);
  }
  if (!response.ok) throw new SalesImportRequestError(response.status);
  return {
    blob: await response.blob(),
    altered: response.headers.get('X-File-Integrity') === 'ALTERED',
  };
}
export function discardSalesImport(id: string): Promise<true> {
  return request('/' + id, { method: 'DELETE' }, () => true as const);
}
