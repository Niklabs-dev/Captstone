import {
  documentHash,
  parseDocument,
  parseDocumentCollection,
  parseIntegrity,
  parseVersionHistory,
  type DocumentCollection,
  type DocumentVersion,
  type IntegrityResult,
  type VersionHistory,
  type WorkerDocument,
} from './documents';

export class DocumentServiceError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'DocumentServiceError';
  }
}
type Fetcher = typeof fetch;
async function request(
  path: string,
  init: RequestInit,
  fetcher: Fetcher,
): Promise<Response> {
  try {
    const response = await fetcher('/api/documents' + path, {
      ...init,
      cache: 'no-store',
      credentials: 'same-origin',
      redirect: 'error',
      signal: init.signal ?? AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      const messages: Record<number, string> = {
        401: 'Tu sesión venció. Vuelve a iniciar sesión.',
        403: 'No tienes permiso para consultar esta carpeta.',
        409: 'El documento cambió. Actualiza la carpeta antes de repetir la carga.',
        413: 'El archivo supera el tamaño permitido.',
        422: 'El archivo no cumple los requisitos. Revisa su tipo y tamaño.',
        503: 'El servicio documental aún no está disponible. Intenta más tarde.',
      };
      throw new DocumentServiceError(
        messages[response.status] ??
          'No se pudo completar la operación. Intenta nuevamente.',
        response.status,
      );
    }
    return response;
  } catch (error) {
    if (
      error instanceof DocumentServiceError ||
      (error instanceof Error && error.name === 'AbortError')
    )
      throw error;
    throw new DocumentServiceError(
      'No se pudo conectar con el servicio documental. Intenta nuevamente.',
      503,
    );
  }
}
function invalidContract(): never {
  throw new DocumentServiceError(
    'La respuesta del servicio no pudo verificarse. Actualiza la carpeta.',
    502,
  );
}
async function json(response: Response): Promise<unknown> {
  return response.json().catch(() => invalidContract()) as Promise<unknown>;
}
export async function loadDocuments(
  workerId: string,
  signal?: AbortSignal,
  fetcher: Fetcher = fetch,
): Promise<DocumentCollection> {
  const response = await request(
    '?workerId=' + encodeURIComponent(workerId),
    { signal },
    fetcher,
  );
  return (
    parseDocumentCollection(await json(response), workerId) ?? invalidContract()
  );
}
export async function loadDocumentVersions(
  document: WorkerDocument,
  signal?: AbortSignal,
  fetcher: Fetcher = fetch,
): Promise<VersionHistory> {
  const response = await request(
    '/' + encodeURIComponent(document.id) + '/versions',
    { signal },
    fetcher,
  );
  return (
    parseVersionHistory(await json(response), document) ?? invalidContract()
  );
}
export async function checkDocumentIntegrity(
  version: DocumentVersion,
  fetcher: Fetcher = fetch,
): Promise<IntegrityResult> {
  const response = await request(
    '/versions/' + encodeURIComponent(version.id) + '/integrity',
    {},
    fetcher,
  );
  return parseIntegrity(await json(response), version) ?? invalidContract();
}
export async function uploadDocument(
  form: FormData,
  workerId: string,
  expectedHash: string,
  previous: WorkerDocument | null,
  fetcher: Fetcher = fetch,
): Promise<WorkerDocument> {
  const response = await request('', { method: 'POST', body: form }, fetcher);
  const document = parseDocument(await json(response), workerId);
  if (
    !document ||
    document.latestVersion.sha256 !== expectedHash ||
    document.type !== form.get('type') ||
    document.title !== form.get('title') ||
    (previous &&
      (document.id !== previous.id ||
        document.type !== previous.type ||
        document.latestVersion.number <= previous.latestVersion.number ||
        document.latestVersion.id === previous.latestVersion.id))
  )
    invalidContract();
  return document;
}
export async function downloadDocument(
  version: DocumentVersion,
  fetcher: Fetcher = fetch,
): Promise<Blob> {
  const integrity = await checkDocumentIntegrity(version, fetcher);
  if (!integrity.valid)
    throw new DocumentServiceError(
      'La integridad no coincide: el archivo pudo ser alterado. Se bloqueó la descarga.',
      409,
    );
  const response = await request(
    '/versions/' + encodeURIComponent(version.id) + '/download',
    {},
    fetcher,
  );
  const type = response.headers.get('content-type')?.split(';')[0].trim();
  const length = response.headers.get('content-length');
  if (
    type !== version.mime ||
    (length !== null && Number(length) !== version.size) ||
    !response.body
  )
    invalidContract();
  const reader = response.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > version.size) invalidContract();
      chunks.push(new Uint8Array(chunk.value));
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  const blob = new Blob(chunks, { type: version.mime });
  if (
    size !== version.size ||
    (await documentHash(await blob.arrayBuffer())) !== version.sha256
  )
    throw new DocumentServiceError(
      'La integridad no coincide: el archivo recibido pudo ser alterado. Se bloqueó la descarga.',
      409,
    );
  return blob;
}
