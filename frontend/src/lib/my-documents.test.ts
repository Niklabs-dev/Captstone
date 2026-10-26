import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  canReadOwnDocuments,
  ownDocumentPath,
  parseOwnDocuments,
  parseOwnDocumentHistory,
} from './my-documents';
import {
  loadDocuments,
  loadDocumentVersions,
  checkDocumentIntegrity,
  downloadDocument,
} from './documents-client';
import { documentHash } from './documents';

const workerId = '11000000-0000-4000-8000-000000000001';
const id = '11000000-0000-4000-8000-000000000002';
const versionId = '11000000-0000-4000-8000-000000000003';
const version = {
  id: versionId,
  number: 1,
  fileName: 'contrato.pdf',
  mime: 'application/pdf' as const,
  size: 10,
  sha256: 'a'.repeat(64),
  createdAt: '2026-10-26T12:00:00Z',
  uploadedBy: 'Administración',
};
const document = {
  id,
  workerId,
  type: 'CONTRATO' as const,
  title: 'Contrato propio',
  retainUntil: null,
  deletionBlocked: false,
  deletionReason: null,
  latestVersion: version,
};
const folder = {
  items: [document],
  policy: {
    maxBytes: 26214400,
    allowedMimes: ['application/pdf'],
    canUpload: false,
  },
};

test('Consulta propia exclusiva de trabajador y supervisor sin parámetros editables', () => {
  assert.equal(canReadOwnDocuments('TRABAJADOR'), true);
  assert.equal(canReadOwnDocuments('SUPERVISOR'), true);
  assert.equal(canReadOwnDocuments('ADMINISTRADOR'), false);
  assert.equal(canReadOwnDocuments('CONTADOR'), false);
  assert.equal(ownDocumentPath([], new URLSearchParams()), '/documents');
  assert.equal(
    ownDocumentPath([id, 'versions'], new URLSearchParams()),
    `/documents/${id}/versions`,
  );
  assert.equal(
    ownDocumentPath(['versions', versionId, 'download'], new URLSearchParams()),
    `/documents/versions/${versionId}/download`,
  );
  for (const query of [
    'workerId=' + workerId,
    'storeId=' + id,
    'documentTypeCode=CONTRATO',
    'workerId=x&workerId=y',
  ])
    assert.equal(ownDocumentPath([], new URLSearchParams(query)), null);
  for (const path of [
    ['..'],
    [id, 'delete'],
    ['versions', 'bad', 'download'],
    ['versions', versionId, 'upload'],
  ])
    assert.equal(ownDocumentPath(path, new URLSearchParams()), null);
});
test('No expone carpetas ajenas, liquidaciones, permisos de carga ni campos privados', () => {
  assert.deepEqual(
    parseOwnDocuments({ ...folder, secret: 'private' }, workerId),
    folder,
  );
  for (const candidate of [
    { ...folder, items: [{ ...document, workerId: id }] },
    { ...folder, items: [{ ...document, type: 'LIQUIDACION' }] },
    { ...folder, policy: { ...folder.policy, canUpload: true } },
  ])
    assert.equal(parseOwnDocuments(candidate, workerId), null);
  const history = { documentId: id, workerId, versions: [version] };
  assert.deepEqual(
    parseOwnDocumentHistory({ ...history, token: 'private' }, workerId, id),
    history,
  );
  assert.equal(
    parseOwnDocumentHistory({ ...history, workerId: id }, workerId, id),
    null,
  );
  assert.equal(
    parseOwnDocumentHistory({ ...history, documentId: workerId }, workerId, id),
    null,
  );
  assert.equal(
    parseOwnDocumentHistory(
      { ...history, versions: [version, version] },
      workerId,
      id,
    ),
    null,
  );
});
test('El lector propio usa el BFF sin workerId y conserva validación e historial', async () => {
  const fetcher: typeof fetch = async (url, init) => {
    assert.equal(init?.cache, 'no-store');
    assert.equal(new Headers(init?.headers).has('Authorization'), false);
    assert.equal(String(url).includes('workerId'), false);
    if (url === '/api/my-documents') return Response.json(folder);
    assert.equal(url, `/api/my-documents/${id}/versions`);
    return Response.json({ documentId: id, workerId, versions: [version] });
  };
  assert.deepEqual(
    await loadDocuments(workerId, undefined, fetcher, 'own'),
    folder,
  );
  assert.deepEqual(
    (await loadDocumentVersions(document, undefined, fetcher, 'own')).versions,
    [version],
  );
});
test('Descarga propia verifica bytes SHA-256 y nombre del backend; MISSING y ALTERED bloquean', async () => {
  const bytes = new TextEncoder().encode('%PDF-1.7\npropio\n%%EOF').buffer;
  const ownVersion = {
    ...version,
    size: bytes.byteLength,
    sha256: await documentHash(bytes),
  };
  const fetcher: typeof fetch = async (url) => {
    if (String(url).endsWith('/integrity'))
      return Response.json({
        versionId,
        valid: true,
        status: 'VALID',
        expectedHash: ownVersion.sha256,
        actualHash: ownVersion.sha256,
        checkedAt: version.createdAt,
      });
    assert.equal(url, `/api/my-documents/versions/${versionId}/download`);
    return new Response(bytes, {
      headers: {
        'Content-Type': version.mime,
        'Content-Length': String(bytes.byteLength),
        'Content-Disposition':
          "attachment; filename*=UTF-8''CONTRATO_propio_v1.pdf",
      },
    });
  };
  const result = await downloadDocument(ownVersion, fetcher, 'own');
  assert.equal(result.fileName, 'CONTRATO_propio_v1.pdf');
  assert.equal(
    await documentHash(await result.blob.arrayBuffer()),
    ownVersion.sha256,
  );
  const missing: typeof fetch = async () =>
    Response.json({
      versionId,
      valid: false,
      status: 'MISSING',
      expectedHash: version.sha256,
      actualHash: null,
      checkedAt: version.createdAt,
    });
  await assert.rejects(
    checkDocumentIntegrity(version, missing, 'own'),
    /El archivo no está disponible; informa al administrador/,
  );
  const altered: typeof fetch = async (url) => {
    assert.ok(String(url).endsWith('/integrity'));
    return Response.json({
      versionId,
      valid: false,
      status: 'ALTERED',
      expectedHash: version.sha256,
      actualHash: 'b'.repeat(64),
      checkedAt: version.createdAt,
    });
  };
  await assert.rejects(
    downloadDocument(version, altered, 'own'),
    /Se bloqueó la descarga/,
  );
});
