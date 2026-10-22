import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseDtAlert,
  parseDtAlerts,
  parseDtRegistration,
  filterDtAlerts,
  dtDate,
  dtRemainingLabel,
  type DtAlert,
} from './dt-alerts';
import {
  DtAlertError,
  loadDtAlerts,
  registerDtAlert,
} from './dt-alerts-client';

const alert: DtAlert = {
  id: '10000000-0000-4000-8000-000000000211',
  documentId: '20000000-0000-4000-8000-000000000211',
  documentType: 'CONTRATO',
  contractTitle: 'Documento de prueba',
  worker: { id: '30000000-0000-4000-8000-000000000211', name: 'Camila Prueba' },
  store: {
    id: '40000000-0000-4000-8000-000000000211',
    name: 'Local de prueba Centro',
  },
  deadline: '2026-10-13',
  daysRemaining: -1,
  status: 'OVERDUE',
  revision: 'revision-1',
  canRegister: true,
};
const calculatedAt = '2026-10-14T15:00:00Z';
test('Conserva el tipo de documento de Swagger y rechaza alertas sin tipo', () => {
  for (const documentType of ['CONTRATO', 'ANEXO', 'FINIQUITO'])
    assert.equal(
      parseDtAlert({ ...alert, documentType })?.documentType,
      documentType,
    );
  assert.equal(parseDtAlert({ ...alert, documentType: undefined }), null);
});
const confirmation = {
  alertId: alert.id,
  documentId: alert.documentId,
  status: 'REGISTERED',
  registeredAt: calculatedAt,
};

test('Proyecta solo datos necesarios y no admite identificadores o fechas inválidas', () => {
  assert.deepEqual(
    parseDtAlert({
      ...alert,
      secret: 'ignored',
      worker: { ...alert.worker, rut: 'ignored' },
    }),
    alert,
  );
  for (const patch of [
    { id: 'bad' },
    { documentId: '' },
    { deadline: '2026-02-30' },
    { deadline: '2026-10-13T00:00:00Z' },
    { worker: null },
    { store: {} },
    { contractTitle: ' ' },
    { revision: '' },
    { canRegister: 'true' },
  ])
    assert.equal(parseDtAlert({ ...alert, ...patch }), null);
});
test('Valida la coherencia del estado recibido sin calcular plazos legales', () => {
  for (const daysRemaining of [NaN, Infinity, 0.5, 100001])
    assert.equal(parseDtAlert({ ...alert, daysRemaining }), null);
  assert.equal(parseDtAlert({ ...alert, daysRemaining: 0 }), null);
  assert.equal(parseDtAlert({ ...alert, status: 'UPCOMING' }), null);
  assert.ok(parseDtAlert({ ...alert, status: 'UPCOMING', daysRemaining: 0 }));
  assert.ok(parseDtAlert({ ...alert, status: 'UPCOMING', daysRemaining: 2 }));
});
test('Rechaza listas malformadas, identificadores repetidos y fechas sin zona', () => {
  assert.deepEqual(
    parseDtAlerts({ items: [alert], calculatedAt, secret: 'ignored' }),
    { items: [alert], calculatedAt },
  );
  for (const value of [
    null,
    { items: [], calculatedAt: '2026-10-14T15:00:00' },
    { items: 'bad', calculatedAt },
    { items: [alert, alert], calculatedAt },
    {
      items: [alert, { ...alert, id: '11000000-0000-4000-8000-000000000211' }],
      calculatedAt,
    },
  ])
    assert.equal(parseDtAlerts(value), null);
  assert.deepEqual(parseDtAlerts({ items: [], calculatedAt }), {
    items: [],
    calculatedAt,
  });
});
test('Vincula la confirmación al documento y alerta exactos', () => {
  assert.deepEqual(
    parseDtRegistration({ ...confirmation, secret: 'ignored' }, alert),
    confirmation,
  );
  for (const patch of [
    { alertId: 'wrong' },
    { documentId: 'wrong' },
    { status: 'PENDING' },
    { registeredAt: 'bad' },
  ])
    assert.equal(
      parseDtRegistration({ ...confirmation, ...patch }, alert),
      null,
    );
});
test('Filtra por trabajador, documento, local y estado, priorizando vencidos sin mutar la lista', () => {
  const upcoming: DtAlert = {
    ...alert,
    id: '11000000-0000-4000-8000-000000000211',
    documentId: '21000000-0000-4000-8000-000000000211',
    worker: { ...alert.worker, name: 'Diego Prueba' },
    daysRemaining: 2,
    status: 'UPCOMING',
  };
  const items = [upcoming, alert];
  assert.deepEqual(filterDtAlerts(items, '', '', ''), [alert, upcoming]);
  assert.deepEqual(items, [upcoming, alert]);
  assert.deepEqual(
    filterDtAlerts(items, ' CAMILA ', alert.store.id, 'OVERDUE'),
    [alert],
  );
  assert.deepEqual(filterDtAlerts(items, 'Documento', '', 'UPCOMING'), [
    upcoming,
  ]);
  assert.deepEqual(filterDtAlerts(items, '', 'other', ''), []);
});
test('Explica días negativos, cero y positivos y conserva la fecha de calendario', () => {
  assert.equal(dtRemainingLabel(-1), 'Vencido hace 1 día');
  assert.equal(dtRemainingLabel(-3), 'Vencido hace 3 días');
  assert.equal(dtRemainingLabel(0), 'Vence hoy');
  assert.equal(dtRemainingLabel(1), 'Queda 1 día');
  assert.equal(dtRemainingLabel(4), 'Quedan 4 días');
  assert.equal(dtDate('2026-10-13'), '13-10-2026');
});
test('Consulta solo al BFF mismo origen con cookies, sin exponer token', async () => {
  const fetcher: typeof fetch = async (url, init) => {
    assert.equal(url, '/api/dt-alerts');
    assert.equal(init?.credentials, 'same-origin');
    assert.equal(init?.cache, 'no-store');
    assert.equal(init?.redirect, 'error');
    assert.equal(new Headers(init?.headers).has('Authorization'), false);
    assert.ok(init?.signal);
    return Response.json({ items: [alert], calculatedAt });
  };
  assert.deepEqual(await loadDtAlerts(undefined, fetcher), {
    items: [alert],
    calculatedAt,
  });
});
test('Envía revisión del documento y no confirma respuestas de otra alerta', async () => {
  const fetcher: typeof fetch = async (url, init) => {
    assert.equal(url, '/api/dt-alerts/' + alert.id + '/registration');
    assert.equal(init?.method, 'POST');
    assert.deepEqual(JSON.parse(String(init?.body)), {
      documentId: alert.documentId,
      revision: 'revision-1',
    });
    return Response.json(confirmation);
  };
  assert.deepEqual(await registerDtAlert(alert, fetcher), confirmation);
  await assert.rejects(
    registerDtAlert(alert, async () =>
      Response.json({ ...confirmation, documentId: 'wrong' }),
    ),
    (error: unknown) => error instanceof DtAlertError && error.status === 502,
  );
});
test('No refleja errores privados y distingue sesión, permisos, conflicto y servicio', async () => {
  for (const status of [401, 403, 409, 503, 500]) {
    await assert.rejects(
      loadDtAlerts(undefined, async () =>
        Response.json({ message: 'private-secret' }, { status }),
      ),
      (error: unknown) =>
        error instanceof DtAlertError &&
        error.status === status &&
        !error.message.includes('private-secret'),
    );
  }
  await assert.rejects(
    loadDtAlerts(undefined, async () =>
      Response.json({ items: 'bad', calculatedAt }),
    ),
    (error: unknown) => error instanceof DtAlertError && error.status === 502,
  );
  await assert.rejects(
    loadDtAlerts(undefined, async () => new Response('invalid-json')),
    (error: unknown) => error instanceof DtAlertError && error.status === 502,
  );
});
test('Controla fallos de red y respeta cancelación del componente', async () => {
  await assert.rejects(
    loadDtAlerts(undefined, async () => {
      throw new Error('secret');
    }),
    (error: unknown) =>
      error instanceof DtAlertError &&
      error.status === 503 &&
      !error.message.includes('secret'),
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    loadDtAlerts(controller.signal, async (_url, init) => {
      assert.ok(init?.signal?.aborted);
      throw new DOMException('Cancelled', 'AbortError');
    }),
    (error: unknown) => error instanceof Error && error.name === 'AbortError',
  );
});
