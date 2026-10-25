import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  normalizeStoreText,
  parseStoreInput,
  parseStore,
  parseStores,
  storeOptions,
  storeFieldError,
  type Store,
} from './stores';
import {
  loadStores,
  saveStore,
  changeStoreState,
  StoreError,
} from './stores-client';
import { fetchStores } from './stores-backend';
const store: Store = {
  id: '11000000-0000-4000-8000-000000000302',
  name: 'Santa María',
  city: 'Melipilla',
  address: 'Av. Santa María 1250',
  isActive: true,
  createdAt: '2026-10-24T12:00:00Z',
  updatedAt: '2026-10-24T12:00:00Z',
};
const input = { name: store.name, city: store.city, address: store.address };
test('Un fallo al cargar distingue la lectura del guardado y orienta una recuperación válida', async () => {
  await assert.rejects(
    loadStores(undefined, async () =>
      Response.json({ message: 'detalle interno' }, { status: 500 }),
    ),
    (error) =>
      error instanceof StoreError &&
      /cargar el catálogo/.test(error.message) &&
      !/guardar|detalle interno/.test(error.message),
  );
  await assert.rejects(
    saveStore(null, input, async () =>
      Response.json({ message: 'detalle interno' }, { status: 500 }),
    ),
    (error) =>
      error instanceof StoreError &&
      /guardar el local/.test(error.message) &&
      !/detalle interno/.test(error.message),
  );
});
test('El conflicto de desactivación explica las cuentas activas y no acusa un nombre duplicado', async () => {
  await assert.rejects(
    changeStoreState(store, async () =>
      Response.json({ message: 'detalle interno' }, { status: 409 }),
    ),
    (error) =>
      error instanceof StoreError &&
      /usuarios activos asignados/.test(error.message) &&
      /desde Usuarios/.test(error.message) &&
      !/Reasigna|otro nombre|detalle interno/.test(error.message),
  );
});
test('Normaliza espacios e invisibles como el backend, conserva tildes y valida límites', () => {
  assert.equal(normalizeStoreText('  Santa\u200b   María  '), 'Santa María');
  assert.deepEqual(
    parseStoreInput({ ...input, name: ' Santa\u200b  María ' }),
    input,
  );
  for (const name of [
    '',
    '  ',
    '\u200b',
    '123',
    '-',
    'a'.repeat(101),
    'Local\0',
  ])
    assert.equal(parseStoreInput({ ...input, name }), null);
  assert.ok(
    parseStoreInput({
      ...input,
      name: 'á'.repeat(100),
      address: '1'.repeat(200),
    }),
  );
  assert.equal(parseStoreInput({ ...input, address: '1'.repeat(201) }), null);
  assert.ok(storeFieldError('city', '123'));
  assert.equal(storeFieldError('address', '1250'), null);
});
test('El contrato rechaza null, campos de privilegio y metadatos inválidos sin filtrar secretos', () => {
  for (const value of [
    null,
    {},
    [],
    { ...input, isActive: false },
    { ...input, id: store.id },
    { ...input, city: null },
  ])
    assert.equal(parseStoreInput(value), null);
  assert.deepEqual(parseStore({ ...store, secret: 'private' }), store);
  for (const value of [
    { ...store, isActive: 'true' },
    { ...store, id: '123' },
    { ...store, createdAt: 'ayer' },
    { ...store, address: null },
  ])
    assert.equal(parseStore(value), null);
  assert.equal(parseStores([store, store]), null);
  assert.equal(parseStores([store, {}]), null);
  assert.deepEqual(parseStores([]), []);
});
test('Los locales inactivos permanecen en historial y se excluyen de nuevas asignaciones', () => {
  const inactive = {
    ...store,
    id: '22000000-0000-4000-8000-000000000302',
    isActive: false,
  };
  assert.equal(storeOptions([store, inactive]).length, 2);
  assert.deepEqual(storeOptions([store, inactive], true), [
    { id: store.id, name: store.name, isActive: true },
  ]);
});
test('El catálogo del cliente usa solo el BFF, no expone bearer y se valida en ejecución', async () => {
  const result = await loadStores(undefined, async (url, init) => {
    assert.equal(url, '/api/stores');
    assert.equal(init?.cache, 'no-store');
    assert.equal(init?.credentials, 'same-origin');
    assert.equal(init?.redirect, 'error');
    assert.equal(new Headers(init?.headers).get('Authorization'), null);
    return Response.json([store]);
  });
  assert.deepEqual(result, [store]);
  await assert.rejects(
    loadStores(undefined, async () => Response.json([{}])),
    (error) => error instanceof StoreError && error.status === 502,
  );
});
test('Crear y editar no aceptan confirmaciones con otro ID o datos diferentes', async () => {
  assert.deepEqual(
    await saveStore(null, input, async (_url, init) => {
      assert.equal(init?.method, 'POST');
      assert.deepEqual(JSON.parse(String(init?.body)), input);
      return Response.json(store, { status: 201 });
    }),
    store,
  );
  await assert.rejects(
    saveStore(store, input, async () =>
      Response.json({ ...store, id: '22000000-0000-4000-8000-000000000302' }),
    ),
    /no pudo verificarse/,
  );
  await assert.rejects(
    saveStore(null, input, async () =>
      Response.json({ ...store, isActive: false }),
    ),
    /no pudo verificarse/,
  );
});
test('Activar y desactivar exigen el local y estado de destino, no cambian registros ajenos', async () => {
  const inactive = await changeStoreState(store, async (url, init) => {
    assert.equal(url, '/api/stores/' + store.id + '/deactivate');
    assert.equal(init?.method, 'PATCH');
    return Response.json({ ...store, isActive: false });
  });
  assert.equal(inactive.isActive, false);
  assert.equal(
    (
      await changeStoreState(inactive, async (url) => {
        assert.equal(url, '/api/stores/' + store.id + '/reactivate');
        return Response.json(store);
      })
    ).isActive,
    true,
  );
  await assert.rejects(
    changeStoreState(store, async () => Response.json(store)),
    /no pudo verificarse/,
  );
});
test('Errores 400, 401, 403, 404 y 409 son claros y no reflejan mensajes privados', async () => {
  for (const status of [400, 401, 403, 404, 409, 503]) {
    await assert.rejects(
      loadStores(undefined, async () =>
        Response.json({ message: 'SQL secreto' }, { status }),
      ),
      (error) =>
        error instanceof StoreError &&
        error.status === status &&
        !error.message.includes('SQL'),
    );
  }
  await assert.rejects(
    saveStore(null, input, async () =>
      Response.json({ message: 'interno' }, { status: 409 }),
    ),
    /Ya existe un local/,
  );
  await assert.rejects(
    loadStores(undefined, async () => {
      throw new Error('red privada');
    }),
    (error) => error instanceof StoreError && error.status === 503,
  );
});
test('El adaptador del servidor usa token privado y rechaza catálogos dañados', async (context) => {
  const mocked = context.mock.method(
    globalThis,
    'fetch',
    async (_url: string, init: RequestInit) => {
      assert.equal(
        new Headers(init.headers).get('Authorization'),
        'Bearer test-only',
      );
      return Response.json([store]);
    },
  );
  assert.deepEqual(await fetchStores('test-only'), { ok: true, data: [store] });
  mocked.mock.mockImplementation(async () => Response.json([{}]));
  const invalid = await fetchStores('test-only');
  assert.equal(invalid.ok, false);
  if (!invalid.ok) assert.equal(invalid.status, 502);
});
