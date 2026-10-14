import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  collectStores,
  filterUsers,
  hasSameOrigin,
  parseCreateUser,
  parseFilters,
  parseManagedUser,
  parseUserList,
} from './users';
import {
  callUsersBackend,
  listManagedUsers,
  mutateManagedUser,
  verifyAdministrator,
} from './users-backend';
const id = '10000000-0000-4000-8000-000000000001';
const storeId = '10000000-0000-4000-8000-000000000002';
const user = {
  id,
  email: 'ana@example.test',
  firstName: 'Ana',
  lastName: 'Pérez',
  isActive: true,
  role: { code: 'ADMINISTRADOR', name: 'Administrador' },
  store: null,
};
const input = {
  firstName: ' Ana ',
  lastName: ' Pérez ',
  email: ' ANA@example.test ',
  password: 'Password123 ',
  roleCode: 'CONTADOR',
};
function responding(data: unknown, status = 200): typeof fetch {
  return async () => Response.json(data, { status });
}
test('Normaliza los datos del alta sin alterar la contraseña ni admitir campos extra', () => {
  const result = parseCreateUser({
    ...input,
    isActive: false,
    passwordHash: 'secret',
  });
  assert.equal(result.ok, true);
  if (result.ok)
    assert.deepEqual(result.data, {
      firstName: 'Ana',
      lastName: 'Pérez',
      email: 'ana@example.test',
      password: input.password,
      roleCode: 'CONTADOR',
    });
});
test('Rechaza nombres vacíos, correo inválido y límites excesivos', () => {
  for (const value of [
    null,
    [],
    {},
    { ...input, firstName: ' ' },
    { ...input, lastName: 'x'.repeat(81) },
    { ...input, email: 'bad' },
    { ...input, email: `${'a'.repeat(160)}@test.cl` },
  ])
    assert.equal(parseCreateUser(value).ok, false);
});
test('Respeta el mínimo de contraseña y el límite bcrypt de 72 bytes', () => {
  assert.equal(parseCreateUser({ ...input, password: 'short' }).ok, false);
  assert.equal(
    parseCreateUser({ ...input, password: 'á'.repeat(37) }).ok,
    false,
  );
  assert.equal(
    parseCreateUser({ ...input, password: 'a'.repeat(72) }).ok,
    true,
  );
});
test('Los roles locales requieren UUID; los globales no admiten local', () => {
  for (const roleCode of ['TRABAJADOR', 'SUPERVISOR']) {
    assert.equal(parseCreateUser({ ...input, roleCode }).ok, false);
    assert.equal(
      parseCreateUser({ ...input, roleCode, storeId: 'bad' }).ok,
      false,
    );
    assert.equal(parseCreateUser({ ...input, roleCode, storeId }).ok, true);
  }
  assert.equal(parseCreateUser({ ...input, storeId }).ok, false);
  assert.equal(parseCreateUser({ ...input, roleCode: 'OWNER' }).ok, false);
});
test('Valida las respuestas y elimina campos sensibles antes de exponerlas', () => {
  assert.deepEqual(
    parseManagedUser({
      ...user,
      passwordHash: 'secret',
      refreshToken: 'secret',
      rut: 'personal',
    }),
    user,
  );
  for (const value of [
    { ...user, role: { code: 'OWNER', name: 'Dueño' } },
    { ...user, store: { id: 'bad', name: 'Local' } },
    { ...user, isActive: 'true' },
    null,
  ])
    assert.equal(parseManagedUser(value), null);
  assert.equal(parseUserList([user, null]), null);
  assert.equal(parseUserList({}), null);
});
test('Combina locales de cuentas y catálogo, deduplica y valida configuración', () => {
  const localUser = parseManagedUser({
    ...user,
    store: { id: storeId, name: 'Local A' },
  });
  assert.ok(localUser);
  assert.deepEqual(
    collectStores([localUser], [{ id: storeId, name: ' Local B ' }]),
    [{ id: storeId, name: 'Local B' }],
  );
  assert.throws(() => collectStores([], [{ id: 'bad', name: 'A' }]));
});
test('Combina búsqueda, rol, estado y local sin modificar los datos', () => {
  const admin = parseManagedUser(user);
  const worker = parseManagedUser({
    ...user,
    id: storeId,
    isActive: false,
    role: { code: 'TRABAJADOR', name: 'Trabajador' },
    store: { id: storeId, name: 'Local' },
  });
  assert.ok(admin);
  assert.ok(worker);
  assert.deepEqual(
    filterUsers([admin, worker], ' PÉREZ ', 'TRABAJADOR', 'false', storeId),
    [worker],
  );
  assert.deepEqual(filterUsers([admin, worker], '', 'CONTADOR', '', ''), []);
});
test('Valida los filtros sin aceptar parámetros arbitrarios', () => {
  assert.deepEqual(
    parseFilters(new URLSearchParams('roleCode=CONTADOR&isActive=false')),
    { ok: true, data: 'roleCode=CONTADOR&isActive=false' },
  );
  for (const query of [
    'roleCode=OWNER',
    'storeId=bad',
    'isActive=yes',
    'token=secret',
  ])
    assert.equal(parseFilters(new URLSearchParams(query)).ok, false);
});
test('Rechaza mutaciones de otros orígenes y soporta el host público en Docker', () => {
  assert.equal(
    hasSameOrigin(
      new Request('http://0.0.0.0:3000/api/users', {
        headers: { host: 'localhost:3102', origin: 'http://localhost:3102' },
      }),
    ),
    true,
  );
  assert.equal(
    hasSameOrigin(
      new Request('http://localhost:3102/api/users', {
        headers: { origin: 'https://evil.test' },
      }),
    ),
    false,
  );
  assert.equal(
    hasSameOrigin(new Request('http://localhost:3102/api/users')),
    false,
  );
});
test('Verifica identidad con el backend y permite exclusivamente al administrador', async () => {
  assert.equal((await verifyAdministrator(undefined)).ok, false);
  const identity = { id, email: user.email, role: 'ADMINISTRADOR' };
  assert.deepEqual(
    await verifyAdministrator('token', async (url) =>
      Response.json(String(url).endsWith('/auth/me') ? identity : [user]),
    ),
    {
      ok: true,
      data: identity,
    },
  );
  for (const role of ['CONTADOR', 'SUPERVISOR', 'TRABAJADOR']) {
    const result = await verifyAdministrator(
      'token',
      responding({ ...identity, role }),
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 403);
  }
  assert.equal(
    (
      await verifyAdministrator(
        'token',
        responding({ ...identity, role: 'OWNER' }),
      )
    ).ok,
    false,
  );
  const invalid = await verifyAdministrator('fake', responding({}, 401));
  assert.equal(invalid.ok, false);
  if (!invalid.ok) assert.equal(invalid.status, 401);
});

test('Rechaza un JWT todavía válido si el administrador fue desactivado o cambió de rol', async () => {
  const identity = { id, email: user.email, role: 'ADMINISTRADOR' };
  for (const [accounts, status] of [
    [[], 401],
    [[{ ...user, isActive: false }], 401],
    [[{ ...user, role: { code: 'CONTADOR', name: 'Contador' } }], 403],
  ] as const) {
    const result = await verifyAdministrator('valid-old-token', async (url) =>
      Response.json(String(url).endsWith('/auth/me') ? identity : accounts),
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, status);
  }
});
test('Envía el bearer al servidor y evita caché, redirecciones y filtraciones', async () => {
  await listManagedUsers(
    'private-token',
    'isActive=false',
    async (url, init) => {
      assert.match(String(url), /\/users\?isActive=false$/);
      assert.equal(init?.cache, 'no-store');
      assert.equal(init?.redirect, 'error');
      assert.equal(
        new Headers(init?.headers).get('Authorization'),
        'Bearer private-token',
      );
      return Response.json([user]);
    },
  );
});
test('Desactivación y creación preservan el contrato y validan la respuesta', async () => {
  const parsed = parseCreateUser(input);
  assert.ok(parsed.ok);
  const result = await mutateManagedUser(
    'token',
    parsed.data,
    async (_url, init) => {
      assert.equal(init?.method, 'POST');
      assert.deepEqual(JSON.parse(String(init?.body)), parsed.data);
      return Response.json(user);
    },
  );
  assert.equal(result.ok, true);
  await mutateManagedUser('token', { id }, async (url, init) => {
    assert.ok(String(url).endsWith(`/${id}/deactivate`));
    assert.equal(init?.method, 'PATCH');
    return Response.json({ ...user, isActive: false });
  });
  assert.equal(
    (await listManagedUsers('token', '', responding({ users: [] }))).ok,
    false,
  );
});
test('Maneja conflictos, fallos del servicio y errores de red sin mostrar mensajes internos', async () => {
  for (const status of [400, 401, 403, 404, 409, 500]) {
    const result = await callUsersBackend(
      '/users',
      'token',
      {},
      responding({ message: 'SQL private details' }, status),
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, status === 500 ? 502 : status);
      assert.ok(!result.message.includes('SQL'));
    }
  }
  const result = await callUsersBackend('/users', 'token', {}, async () => {
    throw new Error('network');
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.status, 503);
});
