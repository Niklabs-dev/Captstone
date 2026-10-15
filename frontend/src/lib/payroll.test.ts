import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canReadPayroll,
  canManagePayroll,
  isPayrollPeriod,
  parsePayroll,
  parsePayrollCollection,
  validatePayrollUpload,
  payrollFileHash,
  filterPayroll,
  payrollPeriodLabel,
  type Payroll,
  type PayrollCollection,
} from './payroll';
import {
  loadPayroll,
  uploadPayroll,
  publishPayroll,
  PayrollError,
} from './payroll-client';
const person = {
  id: '30000000-0000-4000-8000-000000000216',
  name: 'Camila Prueba',
  isActive: true,
  store: {
    id: '40000000-0000-4000-8000-000000000216',
    name: 'Local de prueba Centro',
  },
};
const pdf = new File(['%PDF-1.7\nprueba\n%%EOF'], 'liquidacion.pdf', {
  type: 'application/pdf',
});
const pending: Payroll = {
  id: '10000000-0000-4000-8000-000000000216',
  worker: person,
  period: '2026-09',
  fileName: pdf.name,
  size: pdf.size,
  sha256: 'a'.repeat(64),
  createdAt: '2026-10-14T12:00:00Z',
  publishedAt: null,
  status: 'PENDING_SIGNATURE',
  revision: 'revision-1',
  canPublish: true,
};
const published: Payroll = {
  ...pending,
  status: 'PUBLISHED',
  publishedAt: '2026-10-14T13:00:00Z',
  revision: 'revision-2',
  canPublish: false,
};
const collection: PayrollCollection = {
  items: [pending],
  workers: [person],
  policy: {
    maxBytes: 1048576,
    allowedMimes: ['application/pdf'],
    canUpload: true,
  },
};
test('Permisos: contador gestiona, administrador consulta y los otros roles no acceden', () => {
  assert.equal(canManagePayroll('CONTADOR'), true);
  assert.equal(canReadPayroll('CONTADOR'), true);
  assert.equal(canReadPayroll('ADMINISTRADOR'), true);
  assert.equal(canManagePayroll('ADMINISTRADOR'), false);
  for (const role of ['SUPERVISOR', 'TRABAJADOR'] as const) {
    assert.equal(canReadPayroll(role), false);
    assert.equal(canManagePayroll(role), false);
  }
});
test('Períodos válidos y presentación sin desplazamiento de mes', () => {
  for (const value of ['2026-01', '2026-12'])
    assert.equal(isPayrollPeriod(value), true);
  for (const value of ['', '2026-00', '2026-13', '2026-9', '2026-09-01', null])
    assert.equal(isPayrollPeriod(value), false);
  assert.equal(payrollPeriodLabel('2026-09'), 'septiembre de 2026');
});
test('Proyecta solo metadatos necesarios y valida estados inmutables', () => {
  assert.deepEqual(
    parsePayroll({
      ...pending,
      secret: 'ignored',
      worker: { ...person, rut: 'ignored' },
    }),
    pending,
  );
  assert.deepEqual(parsePayroll(published), published);
  for (const patch of [
    { id: 'wrong' },
    { period: '2026-13' },
    { size: 0 },
    { size: 1.5 },
    { sha256: 'short' },
    { createdAt: '2026-02-30T12:00:00Z' },
    { revision: '' },
    { fileName: 'file.exe' },
    { publishedAt: '2026-10-14T12:00:00Z' },
    { status: 'UNKNOWN' },
  ])
    assert.equal(parsePayroll({ ...pending, ...patch }), null);
  assert.equal(parsePayroll({ ...published, canPublish: true }), null);
  assert.equal(parsePayroll({ ...published, publishedAt: null }), null);
});
test('Lista, política de carga y duplicados se validan en ejecución', () => {
  assert.deepEqual(
    parsePayrollCollection({ ...collection, secret: 'ignored' }),
    collection,
  );
  for (const value of [
    null,
    { ...collection, workers: [person, person] },
    { ...collection, items: [pending, pending] },
    {
      ...collection,
      items: [
        pending,
        { ...pending, id: '11000000-0000-4000-8000-000000000216' },
      ],
    },
    { ...collection, policy: { ...collection.policy, maxBytes: Infinity } },
    {
      ...collection,
      policy: { ...collection.policy, allowedMimes: ['text/html'] },
    },
  ])
    assert.equal(parsePayrollCollection(value), null);
  assert.ok(parsePayrollCollection({ ...collection, workers: [] }));
});
test('Carga exige trabajador activo, período no duplicado, PDF y límites del servicio', () => {
  const empty = { ...collection, items: [] };
  assert.equal(validatePayrollUpload(person.id, '2026-10', pdf, empty), null);
  for (const [workerId, period, file] of [
    ['wrong', '2026-10', pdf],
    [person.id, 'bad', pdf],
    [person.id, pending.period, pdf],
    [person.id, '2026-10', null],
    [
      person.id,
      '2026-10',
      { ...pdf, name: 'bad.exe', type: 'application/pdf', size: 1 },
    ],
    [person.id, '2026-10', { name: 'a.pdf', type: 'text/html', size: 1 }],
    [
      person.id,
      '2026-10',
      { name: 'a.pdf', type: 'application/pdf', size: 1048577 },
    ],
  ] as const)
    assert.ok(validatePayrollUpload(workerId, period, file, collection));
  assert.ok(
    validatePayrollUpload(person.id, '2026-10', pdf, {
      ...empty,
      workers: [{ ...person, isActive: false }],
    }),
  );
  assert.ok(
    validatePayrollUpload(person.id, '2026-10', pdf, {
      ...empty,
      policy: { ...empty.policy, canUpload: false },
    }),
  );
});
test('Calcula SHA-256 real y rechaza archivos con cabecera PDF falsa', async () => {
  const expected = Array.from(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', await pdf.arrayBuffer()),
    ),
    (value) => value.toString(16).padStart(2, '0'),
  ).join('');
  assert.equal(await payrollFileHash(pdf), expected);
  await assert.rejects(
    payrollFileHash(
      new File(['not a pdf'], 'a.pdf', { type: 'application/pdf' }),
    ),
    /cabecera PDF/,
  );
});
test('Filtra y ordena períodos sin mutar el listado', () => {
  const older: Payroll = {
    ...pending,
    id: '11000000-0000-4000-8000-000000000216',
    period: '2026-08',
    status: 'PUBLISHED',
    publishedAt: published.publishedAt,
    canPublish: false,
  };
  const items = [older, pending];
  assert.deepEqual(filterPayroll(items, '', '', ''), [pending, older]);
  assert.deepEqual(items, [older, pending]);
  assert.deepEqual(
    filterPayroll(items, person.store.id, '2026-09', 'PENDING_SIGNATURE'),
    [pending],
  );
  assert.deepEqual(filterPayroll(items, 'other', '', ''), []);
});
test('Consulta solo al BFF mismo origen sin bearer en el navegador', async () => {
  const fetcher: typeof fetch = async (url, init) => {
    assert.equal(url, '/api/payroll');
    assert.equal(init?.credentials, 'same-origin');
    assert.equal(init?.cache, 'no-store');
    assert.equal(init?.redirect, 'error');
    assert.ok(init?.signal);
    assert.equal(new Headers(init?.headers).has('Authorization'), false);
    return Response.json(collection);
  };
  assert.deepEqual(await loadPayroll(undefined, fetcher), collection);
});
test('Carga multipart vincula trabajador, período, archivo, tamaño y hash de la respuesta', async () => {
  const form = new FormData();
  form.set('workerId', person.id);
  form.set('period', pending.period);
  form.set('file', pdf);
  const fetcher: typeof fetch = async (url, init) => {
    assert.equal(url, '/api/payroll');
    assert.equal(init?.method, 'POST');
    assert.equal(init?.body, form);
    return Response.json(pending);
  };
  assert.deepEqual(await uploadPayroll(form, pending.sha256, fetcher), pending);
  for (const patch of [
    { sha256: 'b'.repeat(64) },
    { period: '2026-10' },
    { worker: { ...person, id: '31000000-0000-4000-8000-000000000216' } },
    { size: pdf.size + 1 },
    { fileName: 'other.pdf' },
    { ...published },
  ])
    await assert.rejects(
      uploadPayroll(form, pending.sha256, async () =>
        Response.json({ ...pending, ...patch }),
      ),
      (error: unknown) => error instanceof PayrollError && error.status === 502,
    );
});
test('Solo publica pendientes habilitadas y exige mismo contenido, trabajador y período', async () => {
  const fetcher: typeof fetch = async (url, init) => {
    assert.equal(url, '/api/payroll/' + pending.id + '/publish');
    assert.deepEqual(JSON.parse(String(init?.body)), {
      revision: pending.revision,
    });
    return Response.json(published);
  };
  assert.deepEqual(await publishPayroll(pending, fetcher), published);
  let calls = 0;
  await assert.rejects(
    publishPayroll(published, async () => {
      calls++;
      return Response.json(published);
    }),
    (error: unknown) => error instanceof PayrollError && error.status === 403,
  );
  assert.equal(calls, 0);
  for (const patch of [
    { id: '11000000-0000-4000-8000-000000000216' },
    { sha256: 'b'.repeat(64) },
    { period: '2026-10' },
    { ...pending },
  ])
    await assert.rejects(
      publishPayroll(pending, async () =>
        Response.json({ ...published, ...patch }),
      ),
      (error: unknown) => error instanceof PayrollError && error.status === 502,
    );
});
test('Errores del servicio no filtran mensajes privados y son recuperables', async () => {
  for (const status of [401, 403, 409, 413, 422, 503, 500])
    await assert.rejects(
      loadPayroll(undefined, async () =>
        Response.json({ message: 'private-secret' }, { status }),
      ),
      (error: unknown) =>
        error instanceof PayrollError &&
        error.status === status &&
        !error.message.includes('private-secret'),
    );
  for (const response of [
    Response.json({ items: 'bad' }),
    new Response('not-json'),
  ])
    await assert.rejects(
      loadPayroll(undefined, async () => response),
      (error: unknown) => error instanceof PayrollError && error.status === 502,
    );
});
test('Controla fallo de red y cancelación de la consulta', async () => {
  await assert.rejects(
    loadPayroll(undefined, async () => {
      throw new Error('secret');
    }),
    (error: unknown) =>
      error instanceof PayrollError &&
      error.status === 503 &&
      !error.message.includes('secret'),
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    loadPayroll(controller.signal, async (_url, init) => {
      assert.ok(init?.signal?.aborted);
      throw new DOMException('Cancelled', 'AbortError');
    }),
    (error: unknown) => error instanceof Error && error.name === 'AbortError',
  );
});
