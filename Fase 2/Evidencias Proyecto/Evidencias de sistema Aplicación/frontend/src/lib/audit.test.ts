import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  auditActionLabel,
  auditModuleLabel,
  auditPageHref,
  auditQuery,
  formatAuditDate,
  isCalendarDate,
  mergeAuditStores,
  parseAuditFilters,
  parseAuditPage,
  parseConfiguredAuditStores,
  type AuditFilters,
} from './audit';
import { fetchAuditPage, verifyAuditAdministrator } from './audit-backend';

const admin = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'admin@example.test',
  role: 'ADMINISTRADOR',
  storeId: null,
};
const store = {
  id: '10000000-0000-4000-8000-000000000016',
  name: 'Local de prueba',
};
const entry = {
  id: '9007199254740993',
  action: 'USER_CREATED',
  entityType: 'users',
  entityId: null,
  createdAt: '2026-10-05T02:30:00.000Z',
  user: { ...admin, firstName: 'Prueba', lastName: 'Admin' },
  store: null,
};
const filters: AuditFilters = { limit: 25, offset: 0 };

test('Filtros por defecto y extremos opcionales mantienen días de Chile sin conversión UTC', () => {
  assert.deepEqual(parseAuditFilters(new URLSearchParams()), {
    ok: true,
    data: { ...filters, storeId: undefined, from: undefined, to: undefined },
  });
  for (const query of [
    'from=2026-10-05',
    'to=2026-10-05',
    'from=2026-10-05&to=2026-10-05',
  ]) {
    const result = parseAuditFilters(new URLSearchParams(query));
    assert.ok(result.ok);
    assert.ok(auditQuery(result.data).includes(query.split('&')[0]));
  }
});
test('Rechaza fechas inexistentes, formatos incorrectos y rangos invertidos', () => {
  for (const query of [
    'from=2026-02-30',
    'from=2026-13-01',
    'from=2026-2-01',
    'from=2026-10-06&to=2026-10-05',
    'to=2026-04-31',
  ])
    assert.equal(parseAuditFilters(new URLSearchParams(query)).ok, false);
  assert.equal(isCalendarDate('2024-02-29'), true);
  assert.equal(isCalendarDate('2026-02-29'), false);
});
test('Valida UUID, paginación, parámetros duplicados y campos desconocidos', () => {
  for (const query of [
    'storeId=bad',
    'offset=-1',
    'offset=1.5',
    'offset=9007199254740992',
    'limit=0',
    'limit=201',
    'limit=1e2',
    'from=2026-10-01&from=2026-10-02',
    'token=secret',
  ])
    assert.equal(
      parseAuditFilters(new URLSearchParams(query)).ok,
      false,
      query,
    );
  assert.equal(
    parseAuditFilters(
      new URLSearchParams('storeId=' + store.id + '&limit=200&offset=0'),
    ).ok,
    true,
  );
});
test('Los enlaces de paginación conservan local y fechas sin aceptar destinos externos', () => {
  const href = auditPageHref(
    { ...filters, storeId: store.id, from: '2026-10-05', to: '2026-10-06' },
    25,
  );
  const url = new URL(href, 'http://localhost');
  assert.equal(url.pathname, '/admin/auditoria');
  assert.equal(url.searchParams.get('offset'), '25');
  assert.equal(url.searchParams.get('storeId'), store.id);
  assert.equal(url.searchParams.get('from'), '2026-10-05');
  assert.equal(url.searchParams.get('to'), '2026-10-06');
});
test('Proyecta el contrato de auditoría sin detalles, IP, user-agent ni propiedades extra', () => {
  const page = parseAuditPage({
    items: [
      {
        ...entry,
        detail: { password: 'secret' },
        ipAddress: '1.2.3.4',
        userAgent: 'secret',
        extra: 'secret',
      },
    ],
    total: 1,
    limit: 25,
    offset: 0,
  });
  assert.ok(page);
  assert.equal(page.items[0].id, '9007199254740993');
  assert.equal(page.items[0].store, null);
  assert.ok(!JSON.stringify(page).includes('secret'));
  assert.ok(!JSON.stringify(page).includes('ipAddress'));
  assert.ok(!JSON.stringify(page).includes('role'));
});
test('Rechaza contratos malformados y admite responsables o locales ausentes', () => {
  const valid = { items: [entry], total: 1, limit: 25, offset: 0 };
  for (const value of [
    null,
    { ...valid, total: -1 },
    { ...valid, limit: 201 },
    { ...valid, offset: -1 },
    { ...valid, items: [{}] },
    { ...valid, items: [{ ...entry, createdAt: 'no-date' }] },
    { ...valid, items: [{ ...entry, store: { id: 'bad', name: 'Local' } }] },
  ])
    assert.equal(parseAuditPage(value), null);
  assert.ok(
    parseAuditPage({ ...valid, items: [{ ...entry, user: null, store }] }),
  );
});
test('El catálogo deduplica locales y rechaza configuración inválida', () => {
  assert.deepEqual(mergeAuditStores([store], [store]), [store]);
  assert.deepEqual(parseConfiguredAuditStores(undefined), []);
  assert.deepEqual(parseConfiguredAuditStores(JSON.stringify([store])), [
    store,
  ]);
  for (const value of ['{}', 'broken', '[{"id":"bad","name":"Local"}]'])
    assert.equal(parseConfiguredAuditStores(value), null);
});
test('Muestra hora chilena tanto en verano como en invierno y conserva acciones desconocidas', () => {
  assert.ok(formatAuditDate('2026-10-05T02:30:00.000Z').includes('23:30:00'));
  assert.ok(formatAuditDate('2026-07-05T03:30:00.000Z').includes('23:30:00'));
  assert.equal(auditActionLabel('USER_CREATED'), 'Usuario creado');
  assert.equal(
    auditActionLabel('TIP_POOL_RECALCULATED'),
    'TIP_POOL_RECALCULATED',
  );
  assert.equal(auditActionLabel('toString'), 'toString');
  assert.equal(auditModuleLabel('users'), 'Usuarios');
  assert.equal(auditModuleLabel('future_module'), 'future_module');
});
test('El administrador se verifica contra su estado actual; no basta un JWT antiguo', async (t) => {
  let active = true,
    role = 'ADMINISTRADOR';
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request) =>
    Response.json(
      String(url).endsWith('/auth/me')
        ? admin
        : [
            {
              id: admin.id,
              isActive: active,
              role: { code: role },
              store: null,
            },
            {
              id: store.id,
              isActive: true,
              role: { code: 'TRABAJADOR' },
              store,
            },
          ],
    ),
  );
  const result = await verifyAuditAdministrator('token');
  assert.ok(result.ok);
  assert.deepEqual(result.data.stores, [store]);
  active = false;
  assert.deepEqual((await verifyAuditAdministrator('token')).ok, false);
  active = true;
  role = 'CONTADOR';
  const changed = await verifyAuditAdministrator('token');
  assert.ok(!changed.ok);
  assert.equal(changed.status, 403);
});
test('Los otros roles se rechazan antes de consultar usuarios o auditoría', async (t) => {
  const requests: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request) => {
    requests.push(String(url));
    return Response.json({ ...admin, role: 'TRABAJADOR' });
  });
  const result = await verifyAuditAdministrator('token');
  assert.ok(!result.ok);
  assert.equal(result.status, 403);
  assert.equal(requests.length, 1);
});
test('La consulta mantiene bearer en servidor, evita caché y valida la página recibida', async (t) => {
  let broken = false;
  t.mock.method(
    globalThis,
    'fetch',
    async (url: string | URL | Request, init: RequestInit) => {
      assert.ok(String(url).endsWith('/audit-logs?limit=25&offset=0'));
      assert.equal(
        init.headers && new Headers(init.headers).get('Authorization'),
        'Bearer private-token',
      );
      assert.equal(init.cache, 'no-store');
      assert.equal(init.redirect, 'error');
      return Response.json(
        broken ? {} : { items: [entry], total: 1, limit: 25, offset: 0 },
      );
    },
  );
  assert.ok((await fetchAuditPage('private-token', filters)).ok);
  broken = true;
  const result = await fetchAuditPage('private-token', filters);
  assert.ok(!result.ok);
  assert.equal(result.status, 502);
});
test('Los errores del backend no filtran mensajes internos y la caída falla de forma cerrada', async (t) => {
  let status = 400;
  t.mock.method(globalThis, 'fetch', async () => {
    if (status === 0) throw new Error('internal-secret');
    return Response.json({ message: 'internal-secret' }, { status });
  });
  for (const code of [400, 401, 403, 500, 0]) {
    status = code;
    const result = await fetchAuditPage('token', filters);
    assert.ok(!result.ok);
    assert.equal(result.status, code === 0 ? 503 : code === 500 ? 502 : code);
    assert.ok(!result.message.includes('internal-secret'));
  }
});
