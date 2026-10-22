import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  documentDownloadName,
  documentHash,
  documentDate,
  parseDocumentVersion,
  MAX_DOCUMENT_BYTES,
  parseDocumentCollection,
  parseIntegrity,
  parseVersionHistory,
  validateDocumentUpload,
  type DocumentVersion,
  type WorkerDocument,
} from './documents';
import {
  checkDocumentIntegrity,
  downloadDocument,
  loadDocuments,
  loadDocumentVersions,
  uploadDocument,
} from './documents-client';

const workerId = '10000000-0000-4000-8000-000000000210';
const documentId = '20000000-0000-4000-8000-000000000210';
const versionId = '30000000-0000-4000-8000-000000000210';
const pdf = new TextEncoder().encode('%PDF-1.7\nDocumento de prueba\n%%EOF');
const hash = 'a'.repeat(64);
const version: DocumentVersion = {
  id: versionId,
  number: 2,
  fileName: 'contrato.pdf',
  mime: 'application/pdf',
  size: pdf.length,
  sha256: hash,
  createdAt: '2026-10-14T12:00:00Z',
  uploadedBy: 'Administrador de prueba',
};
const document: WorkerDocument = {
  id: documentId,
  workerId,
  type: 'CONTRATO',
  title: 'Contrato laboral',
  retainUntil: '2031-10-14',
  deletionBlocked: true,
  deletionReason: 'Plazo de conservación vigente.',
  latestVersion: version,
};
const policy = {
  maxBytes: 1024 * 1024,
  allowedMimes: ['application/pdf'] as 'application/pdf'[],
  canUpload: true,
};
const integrity = (valid = true) => ({
  versionId,
  valid,
  status: valid ? 'VALID' : 'ALTERED',
  expectedHash: hash,
  actualHash: valid ? hash : 'b'.repeat(64),
  checkedAt: '2026-10-14T13:00:00Z',
});
const jsonResponse = (data: unknown, status = 200): Response =>
  Response.json(data, { status });

test('Alinea fecha de conservación y nombre largo con el DTO real', () => {
  assert.ok(documentDate('2031-10-14').includes('14'));
  assert.ok(
    parseDocumentVersion({ ...version, fileName: 'á'.repeat(251) + '.pdf' }),
  );
  assert.equal(
    parseDocumentVersion({ ...version, fileName: 'x'.repeat(256) }),
    null,
  );
});

test('Un archivo ausente muestra el mensaje público y bloquea la descarga', async () => {
  const missing = {
    ...integrity(),
    status: 'MISSING',
    actualHash: null,
    valid: false,
  };
  assert.equal(parseIntegrity(missing, version)?.status, 'MISSING');
  await assert.rejects(
    downloadDocument(version, async () => Response.json(missing)),
    /El archivo no está disponible/,
  );
});

test('El contrato proyecta solo metadatos de la carpeta seleccionada y rechaza mezclas de trabajadores', () => {
  const parsed = parseDocumentCollection(
    {
      items: [
        {
          ...document,
          secret: 'no',
          latestVersion: { ...version, physicalPath: '/private' },
        },
      ],
      policy,
    },
    workerId,
  );
  assert.deepEqual(parsed, { items: [document], policy });
  assert.equal(
    parseDocumentCollection(
      { items: [{ ...document, workerId: documentId }], policy },
      workerId,
    ),
    null,
  );
  assert.equal(
    parseDocumentCollection({ items: [document, document], policy }, workerId),
    null,
  );
  assert.equal(
    parseDocumentCollection(
      {
        items: [document],
        policy: { ...policy, maxBytes: MAX_DOCUMENT_BYTES + 1 },
      },
      workerId,
    ),
    null,
  );
  assert.equal(
    parseDocumentCollection(
      { items: [{ ...document, deletionReason: null }], policy },
      workerId,
    ),
    null,
  );
});
test('Rechaza formatos peligrosos, hashes truncados y metadatos de versión inválidos', () => {
  for (const invalid of [
    { mime: 'text/html' },
    { sha256: 'a3f2…9c41' },
    { size: 0 },
    { size: 2.5 },
    { number: -1 },
    { createdAt: 'fecha' },
    { uploadedBy: '' },
  ])
    assert.equal(
      parseDocumentCollection(
        {
          items: [{ ...document, latestVersion: { ...version, ...invalid } }],
          policy,
        },
        workerId,
      ),
      null,
    );
  assert.equal(
    parseDocumentCollection(
      { items: [], policy: { ...policy, allowedMimes: ['text/html'] } },
      workerId,
    ),
    null,
  );
  assert.deepEqual(parseDocumentCollection({ items: [], policy }, workerId), {
    items: [],
    policy,
  });
});
test('Historial vinculado al documento, sin versiones duplicadas y ordenado de más reciente a anterior', () => {
  const old = {
    ...version,
    id: '40000000-0000-4000-8000-000000000210',
    number: 1,
  };
  const data = { documentId, workerId, versions: [old, version] };
  assert.deepEqual(
    parseVersionHistory(data, document)?.versions.map((item) => item.number),
    [2, 1],
  );
  assert.equal(
    parseVersionHistory({ ...data, workerId: documentId }, document),
    null,
  );
  assert.equal(
    parseVersionHistory({ ...data, versions: [version, version] }, document),
    null,
  );
  assert.equal(
    parseVersionHistory({ ...data, versions: [old] }, document),
    null,
  );
});
test('Integridad exige que el resultado corresponda al hash y versión solicitados', () => {
  assert.deepEqual(parseIntegrity(integrity(), version), integrity());
  assert.equal(parseIntegrity({ ...integrity(), valid: false }, version), null);
  assert.equal(
    parseIntegrity({ ...integrity(), expectedHash: 'b'.repeat(64) }, version),
    null,
  );
  assert.equal(
    parseIntegrity({ ...integrity(), versionId: documentId }, version),
    null,
  );
  assert.equal(parseIntegrity(integrity(false), version)?.valid, false);
});
test('Valida archivo, nombre, extensión y límites recibidos; no presume que toda carpeta permite carga', () => {
  const input = {
    workerId,
    title: 'Contrato',
    type: 'CONTRATO',
    file: { name: 'contrato.pdf', type: 'application/pdf', size: 100 },
  };
  assert.equal(validateDocumentUpload(input, policy), null);
  for (const invalid of [
    { title: '  ' },
    { title: 'x'.repeat(161) },
    { workerId: 'otro' },
    { type: 'LIQUIDACION' },
    { file: null },
    { file: { ...input.file, size: 0 } },
    { file: { ...input.file, size: policy.maxBytes + 1 } },
    { file: { ...input.file, name: 'contrato.exe' } },
    { file: { ...input.file, type: 'text/html' } },
  ])
    assert.ok(validateDocumentUpload({ ...input, ...invalid }, policy));
  assert.ok(validateDocumentUpload(input, { ...policy, canUpload: false }));
});
test('Calcula SHA-256 real y sanea el nombre de descarga sin rutas ni controles', async () => {
  assert.equal(
    await documentHash(new TextEncoder().encode('abc').buffer),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  );
  assert.equal(
    documentDownloadName('../carpeta/contrato\n.pdf'),
    '_carpeta_contrato_.pdf',
  );
  assert.equal(documentDownloadName(''), 'documento');
});
test('El adaptador solo llama rutas internas sin tokens ni URLs de almacenamiento del backend', async () => {
  const paths: string[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    paths.push(String(input));
    assert.equal(init?.credentials, 'same-origin');
    assert.equal(init?.redirect, 'error');
    assert.equal(init?.cache, 'no-store');
    assert.equal(new Headers(init?.headers).get('authorization'), null);
    return String(input).includes('/versions')
      ? jsonResponse({ workerId, documentId, versions: [version] })
      : jsonResponse({ items: [document], policy });
  };
  await loadDocuments(workerId, undefined, fetcher);
  await loadDocumentVersions(document, undefined, fetcher);
  assert.deepEqual(paths, [
    '/api/documents?workerId=' + workerId,
    '/api/documents/' + documentId + '/versions',
  ]);
});
test('No refleja errores del servidor ni acepta respuestas malformadas y conserva abortos', async () => {
  await assert.rejects(
    () =>
      loadDocuments(workerId, undefined, async () =>
        jsonResponse({ message: 'private-secret' }, 503),
      ),
    /aún no está disponible/,
  );
  await assert.rejects(
    () =>
      loadDocuments(workerId, undefined, async () =>
        jsonResponse({ items: 'no' }),
      ),
    /no pudo verificarse/,
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () =>
      loadDocuments(workerId, controller.signal, async () => {
        throw new DOMException('cancelado', 'AbortError');
      }),
    { name: 'AbortError' },
  );
});
test('Carga multipart sin imponer Content-Type y confirma hash, trabajador y nueva versión', async () => {
  const form = new FormData();
  form.set('title', document.title);
  form.set('documentTypeCode', document.type);
  form.set('workerId', workerId);
  form.set(
    'file',
    new Blob([pdf], { type: 'application/pdf' }),
    'contrato.pdf',
  );
  const fresh = {
    ...document,
    latestVersion: {
      ...version,
      id: '50000000-0000-4000-8000-000000000210',
      number: 3,
    },
  };
  const fetcher: typeof fetch = async (_input, init) => {
    assert.equal(init?.method, 'POST');
    assert.equal(init?.body, form);
    assert.equal(new Headers(init?.headers).get('content-type'), null);
    return jsonResponse(fresh);
  };
  assert.equal(
    (await uploadDocument(form, workerId, hash, document, fetcher))
      .latestVersion.number,
    3,
  );
  await assert.rejects(
    () =>
      uploadDocument(form, workerId, hash, document, async () =>
        jsonResponse(document),
      ),
    /no pudo verificarse/,
  );
  await assert.rejects(
    () => uploadDocument(form, workerId, 'f'.repeat(64), null, fetcher),
    /no pudo verificarse/,
  );
});
test('La descarga verifica el hash del servicio y vuelve a calcular los bytes recibidos', async () => {
  const realHash = await documentHash(pdf.buffer);
  const actual = { ...version, sha256: realHash };
  let calls = 0;
  const fetcher: typeof fetch = async (input) => {
    calls++;
    return String(input).endsWith('/integrity')
      ? jsonResponse({
          ...integrity(),
          expectedHash: realHash,
          actualHash: realHash,
        })
      : new Response(pdf, {
          headers: {
            'Content-Type': 'application/pdf',
            'Content-Length': String(pdf.length),
          },
        });
  };
  assert.deepEqual(
    new Uint8Array(
      await (await downloadDocument(actual, fetcher)).arrayBuffer(),
    ),
    pdf,
  );
  assert.equal(calls, 2);
});
test('Bloquea archivo alterado, discrepancia del servicio, tipo incorrecto y tamaño inesperado', async () => {
  let downloads = 0;
  await assert.rejects(
    () =>
      downloadDocument(version, async (input) => {
        if (String(input).endsWith('/integrity'))
          return jsonResponse(integrity(false));
        downloads++;
        return new Response(pdf);
      }),
    /integridad no coincide/,
  );
  assert.equal(downloads, 0);
  await assert.rejects(
    () =>
      downloadDocument(version, async (input) =>
        String(input).endsWith('/integrity')
          ? jsonResponse(integrity())
          : new Response(pdf, {
              headers: { 'Content-Type': 'application/pdf' },
            }),
      ),
    /integridad no coincide/,
  );
  await assert.rejects(
    () =>
      downloadDocument(version, async (input) =>
        String(input).endsWith('/integrity')
          ? jsonResponse(integrity())
          : new Response(pdf, { headers: { 'Content-Type': 'text/html' } }),
      ),
    /no pudo verificarse/,
  );
  await assert.rejects(
    () =>
      checkDocumentIntegrity(version, async () =>
        jsonResponse({ ...integrity(), actualHash: 'b'.repeat(64) }),
      ),
    /no pudo verificarse/,
  );
});
