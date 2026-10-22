import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canReadOwnPayslips,
  parseOwnPayslip,
  parseOwnPayslips,
  parseOwnPayslipCollection,
  parsePayslipIntegrity,
  payslipHash,
  payslipDownloadName,
  payslipPeriodLabel,
  MAX_PAYSLIP_BYTES,
  type OwnPayslip,
} from './my-payslips';
import {
  loadOwnPayslips,
  downloadOwnPayslip,
  PayslipError,
} from './my-payslips-client';
const workerId = '30000000-0000-4000-8000-000000000217';
const otherWorker = '31000000-0000-4000-8000-000000000217';
const bytes = new TextEncoder().encode('%PDF-1.7\narchivo sintetico\n%%EOF');
const published: OwnPayslip = {
  id: '10000000-0000-4000-8000-000000000217',
  versionId: '20000000-0000-4000-8000-000000000217',
  workerId,
  period: '2026-09',
  fileName: 'liquidacion.pdf',
  mime: 'application/pdf',
  size: bytes.length,
  sha256: 'a'.repeat(64),
  status: 'PUBLISHED',
  publishedAt: '2026-10-15T12:00:00Z',
  signedAt: '2026-10-14',
};
const integrity = (item: OwnPayslip) => ({
  payslipId: item.id,
  versionId: item.versionId,
  workerId: item.workerId,
  valid: true,
  status: 'VALID',
  expectedHash: item.sha256,
  actualHash: item.sha256,
  checkedAt: '2026-10-15T13:00:00Z',
});
const errorStatus = (status: number) => (error: unknown) =>
  error instanceof PayslipError && error.status === status;
test('Trabajador y supervisor acceden a sus liquidaciones personales', () => {
  assert.equal(canReadOwnPayslips('TRABAJADOR'), true);
  assert.equal(canReadOwnPayslips('SUPERVISOR'), true);
  for (const role of ['ADMINISTRADOR', 'CONTADOR'] as const)
    assert.equal(canReadOwnPayslips(role), false);
});

test('MISSING acepta hash nulo, explica la ausencia y no solicita el binario', async () => {
  const missing = {
    ...integrity(published),
    status: 'MISSING',
    valid: false,
    actualHash: null,
  };
  assert.equal(parsePayslipIntegrity(missing, published)?.status, 'MISSING');
  assert.equal(
    parsePayslipIntegrity({ ...missing, valid: true }, published),
    null,
  );
  let calls = 0;
  await assert.rejects(
    downloadOwnPayslip(published, undefined, async () => {
      calls++;
      return Response.json(missing);
    }),
    (error: unknown) =>
      error instanceof PayslipError &&
      error.status === 404 &&
      error.message.includes('informa al administrador'),
  );
  assert.equal(calls, 1);
});

test('Nombres de 255 caracteres sin extensión y registros inválidos no ocultan los válidos', () => {
  const fileName = 'á'.repeat(255);
  assert.ok(parseOwnPayslip({ ...published, fileName }, workerId));
  assert.equal(
    parseOwnPayslip({ ...published, fileName: fileName + 'x' }, workerId),
    null,
  );
  const result = parseOwnPayslipCollection(
    { items: [published, { ...published, id: 'incorrecto' }] },
    workerId,
  );
  assert.deepEqual(result?.items, [published]);
  assert.equal(result?.invalidCount, 1);
});
test('Proyecta campos seguros y rechaza propietario distinto o estado pendiente', () => {
  assert.deepEqual(
    parseOwnPayslip(
      { ...published, bankAccount: 'secret', salary: 999 },
      workerId,
    ),
    published,
  );
  assert.equal(parseOwnPayslip(published, otherWorker), null);
  assert.equal(
    parseOwnPayslip({ ...published, status: 'PENDING_SIGNATURE' }, workerId),
    null,
  );
  assert.equal(parseOwnPayslip(published, 'bad'), null);
});
test('Valida metadatos, fechas, UUID, hash, PDF y tamaño limitado', () => {
  for (const patch of [
    { id: 'bad' },
    { versionId: 'bad' },
    { period: '2026-13' },
    { publishedAt: '2026-02-30T12:00:00Z' },
    { publishedAt: '2026-10-15T12:00:00' },
    { sha256: 'bad' },
    { size: 0 },
    { size: 1.5 },
    { size: MAX_PAYSLIP_BYTES + 1 },
    { mime: 'text/html' },
    { fileName: '../private.pdf' },
  ])
    assert.equal(parseOwnPayslip({ ...published, ...patch }, workerId), null);
});
test('Lista ordenada: rechaza toda respuesta mezclada y duplicados sin mostrar datos parciales', () => {
  const older = {
    ...published,
    id: '11000000-0000-4000-8000-000000000217',
    versionId: '21000000-0000-4000-8000-000000000217',
    period: '2026-08',
  };
  assert.deepEqual(parseOwnPayslips({ items: [older, published] }, workerId), [
    published,
    older,
  ]);
  for (const item of [
    published,
    { ...older, workerId: otherWorker },
    { ...older, status: 'PENDING_SIGNATURE' },
    { ...older, period: published.period },
    { ...older, versionId: published.versionId },
  ])
    assert.equal(
      parseOwnPayslips({ items: [published, item] }, workerId),
      null,
    );
  assert.equal(parseOwnPayslips({ items: 'bad' }, workerId), null);
  assert.deepEqual(parseOwnPayslips({ items: [] }, workerId), []);
});
test('Integridad vinculada al archivo, versión, propietario y hash esperados', () => {
  assert.deepEqual(
    parsePayslipIntegrity(
      { ...integrity(published), secret: 'ignored' },
      published,
    ),
    integrity(published),
  );
  for (const patch of [
    { payslipId: 'wrong' },
    { versionId: 'wrong' },
    { workerId: otherWorker },
    { expectedHash: 'b'.repeat(64) },
    { valid: false },
    { actualHash: 'bad' },
  ])
    assert.equal(
      parsePayslipIntegrity({ ...integrity(published), ...patch }, published),
      null,
    );
  assert.ok(
    parsePayslipIntegrity(
      {
        ...integrity(published),
        actualHash: 'b'.repeat(64),
        valid: false,
        status: 'ALTERED',
      },
      published,
    ),
  );
});
test('SHA-256 conocido, nombres seguros y período sin cambio por zona horaria', async () => {
  assert.equal(
    await payslipHash(new TextEncoder().encode('abc').buffer),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  );
  assert.equal(
    payslipDownloadName('../liquidacion.pdf', '2026-09'),
    'liquidacion.pdf',
  );
  assert.equal(
    payslipDownloadName('.pdf', '2026-09'),
    'liquidacion-2026-09.pdf',
  );
  assert.ok(!payslipDownloadName('a:b?.pdf', '2026-09').includes(':'));
  assert.equal(payslipPeriodLabel('2026-09'), 'septiembre de 2026');
});
test('Consulta al BFF sin workerId ni bearer; valida la respuesta contra la sesión', async () => {
  const fetcher: typeof fetch = async (url, init) => {
    assert.equal(url, '/api/my-payroll');
    assert.equal(init?.credentials, 'same-origin');
    assert.equal(init?.cache, 'no-store');
    assert.equal(init?.redirect, 'error');
    assert.equal(new Headers(init?.headers).has('Authorization'), false);
    assert.ok(init?.signal);
    return Response.json({ items: [published] });
  };
  assert.deepEqual(await loadOwnPayslips(workerId, undefined, fetcher), [
    published,
  ]);
  await assert.rejects(
    loadOwnPayslips(otherWorker, undefined, fetcher),
    errorStatus(502),
  );
});
test('Errores privados, respuestas inválidas, red y cancelación se controlan', async () => {
  for (const status of [401, 403, 404, 409, 503, 500])
    await assert.rejects(
      loadOwnPayslips(workerId, undefined, async () =>
        Response.json({ message: 'private-secret' }, { status }),
      ),
      (error: unknown) =>
        error instanceof PayslipError &&
        error.status === status &&
        !error.message.includes('private-secret'),
    );
  await assert.rejects(
    loadOwnPayslips(workerId, undefined, async () => new Response('bad-json')),
    errorStatus(502),
  );
  await assert.rejects(
    loadOwnPayslips(workerId, undefined, async () => {
      throw new Error('secret');
    }),
    errorStatus(503),
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    loadOwnPayslips(workerId, controller.signal, async (_url, init) => {
      assert.ok(init?.signal?.aborted);
      throw new DOMException('Cancelled', 'AbortError');
    }),
    (error: unknown) => error instanceof Error && error.name === 'AbortError',
  );
});
test('Descarga binario solo después de verificar integridad y vuelve a calcular el hash', async () => {
  const item = { ...published, sha256: await payslipHash(bytes.buffer) };
  const calls: string[] = [];
  const fetcher: typeof fetch = async (url, init) => {
    calls.push(String(url));
    assert.equal(new URL(String(url), 'http://example.test').search, '');
    assert.equal(init?.credentials, 'same-origin');
    return String(url).endsWith('/integrity')
      ? Response.json(integrity(item))
      : new Response(bytes, {
          headers: {
            'Content-Type': 'application/pdf',
            'Content-Length': String(bytes.length),
          },
        });
  };
  const blob = await downloadOwnPayslip(item, undefined, fetcher);
  assert.equal(await payslipHash(await blob.arrayBuffer()), item.sha256);
  assert.deepEqual(calls, [
    '/api/my-payroll/' + item.id + '/integrity',
    '/api/my-payroll/' + item.id + '/download',
  ]);
});
test('Integridad inválida o incoherente impide pedir el binario', async () => {
  let calls = 0;
  await assert.rejects(
    downloadOwnPayslip(published, undefined, async () => {
      calls++;
      return Response.json({
        ...integrity(published),
        valid: false,
        status: 'ALTERED',
        actualHash: 'b'.repeat(64),
      });
    }),
    errorStatus(409),
  );
  assert.equal(calls, 1);
  await assert.rejects(
    downloadOwnPayslip(published, undefined, async () =>
      Response.json({ ...integrity(published), versionId: 'wrong' }),
    ),
    errorStatus(502),
  );
});
test('Bloquea bytes alterados aunque el servicio diga que son válidos, y MIME incorrecto', async () => {
  const item = { ...published, sha256: await payslipHash(bytes.buffer) };
  for (const response of [
    new Response(new Uint8Array(bytes.length).fill(65), {
      headers: { 'Content-Type': 'application/pdf' },
    }),
    new Response(bytes, { headers: { 'Content-Type': 'text/html' } }),
    new Response(bytes, {
      headers: { 'Content-Type': 'application/pdf', 'Content-Length': '999' },
    }),
  ])
    await assert.rejects(
      downloadOwnPayslip(item, undefined, async (url) =>
        String(url).endsWith('/integrity')
          ? Response.json(integrity(item))
          : response,
      ),
      (error: unknown) =>
        error instanceof PayslipError && [409, 502].includes(error.status),
    );
});
test('Cancela streams mayores al tamaño registrado y rechaza PDFs con cabecera falsa', async () => {
  const item = { ...published, sha256: await payslipHash(bytes.buffer) };
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(item.size + 1));
    },
    cancel() {
      cancelled = true;
    },
  });
  await assert.rejects(
    downloadOwnPayslip(item, undefined, async (url) =>
      String(url).endsWith('/integrity')
        ? Response.json(integrity(item))
        : new Response(stream, {
            headers: { 'Content-Type': 'application/pdf' },
          }),
    ),
    errorStatus(502),
  );
  assert.equal(cancelled, true);
  const invalidBytes = new TextEncoder().encode('not-pdf');
  const bad = {
    ...item,
    size: invalidBytes.length,
    sha256: await payslipHash(invalidBytes.buffer),
  };
  await assert.rejects(
    downloadOwnPayslip(bad, undefined, async (url) =>
      String(url).endsWith('/integrity')
        ? Response.json(integrity(bad))
        : new Response(invalidBytes, {
            headers: { 'Content-Type': 'application/pdf' },
          }),
    ),
    errorStatus(502),
  );
});
