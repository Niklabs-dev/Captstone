import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  PAYMENT_METHOD_BEHAVIORS,
  isPaymentMethodBehavior,
  normalizePaymentMethodCode,
  paymentMethodCodeError,
  paymentMethodNameError,
  paymentMethodSortOrderError,
  parsePaymentMethodSortOrder,
  parsePaymentMethodCreateInput,
  parsePaymentMethodUpdateInput,
  parsePaymentMethod,
  parsePaymentMethods,
  sortPaymentMethods,
  paymentMethodErrorMessage,
  type PaymentMethod,
} from './payment-methods';
import {
  loadPaymentMethods,
  createPaymentMethod,
  updatePaymentMethod,
  changePaymentMethodState,
  PaymentMethodError,
} from './payment-methods-client';

const method: PaymentMethod = {
  id: '7a000000-0000-4000-8000-000000000011',
  code: 'JUNEB',
  name: 'Junaeb',
  sortOrder: 10,
  isActive: true,
  behavior: 'EXTERNAL_OTHER',
  availableForTips: false,
  createdAt: '2026-11-01T12:00:00Z',
  updatedAt: '2026-11-01T12:00:00Z',
};
const createInput = {
  code: 'juneb',
  name: '  Junaeb ',
  sortOrder: '10',
  behavior: 'EXTERNAL_OTHER',
  availableForTips: false,
};

test('El comportamiento solo acepta los valores del contrato y tiene etiquetas', () => {
  for (const behavior of PAYMENT_METHOD_BEHAVIORS)
    assert.equal(isPaymentMethodBehavior(behavior), true);
  for (const bad of ['CARD', 'card', '', null, 3])
    assert.equal(isPaymentMethodBehavior(bad), false);
});
test('El código se normaliza como el backend: UPPER_SNAKE con tokens alfanuméricos', () => {
  assert.equal(
    normalizePaymentMethodCode('  tarjeta banco-xyz '),
    'TARJETA_BANCO_XYZ',
  );
  assert.equal(normalizePaymentMethodCode('cafe\u200B'), 'CAFE');
  assert.equal(normalizePaymentMethodCode('__a__b__'), 'A_B');
  for (const [value, message] of [
    ['', 'Ingresa'],
    ['   ', 'Ingresa'],
    ['1', '2 y 40'],
    ['1234', 'letra'],
    ['A'.repeat(41), '40'],
    ['tarjeta!!', 'letras'],
  ] as const)
    assert.match(paymentMethodCodeError(value) ?? '', new RegExp(message));
  assert.equal(paymentMethodCodeError('JUNEB_2'), null);
  assert.equal(paymentMethodCodeError('1UP'), null);
});
test('El nombre exige letras, sin caracteres de control y con límite de 100', () => {
  for (const [value, message] of [
    ['', 'Ingresa'],
    ['123', 'letra'],
    ['A'.repeat(101), '100'],
    ['Café\u0000', 'control'],
  ] as const)
    assert.match(paymentMethodNameError(value) ?? '', new RegExp(message));
  assert.equal(paymentMethodNameError(' Tarjeta  Banco XYZ '), null);
});
test('El orden de lista es un entero mayor o igual a cero y rechaza textos y decimales', () => {
  assert.equal(parsePaymentMethodSortOrder('0'), 0);
  assert.equal(parsePaymentMethodSortOrder(9999), 9999);
  assert.equal(parsePaymentMethodSortOrder(10000), 10000);
  for (const bad of [
    '',
    '-1',
    '1.5',
    '10_000',
    null,
    NaN,
    1.2,
    9007199254740993,
  ])
    assert.equal(parsePaymentMethodSortOrder(bad), null);
  assert.match(paymentMethodSortOrderError('-1') ?? '', /entero/);
});
test('El alta exige exactamente los cinco campos y los normaliza', () => {
  assert.deepEqual(parsePaymentMethodCreateInput(createInput), {
    code: 'JUNEB',
    name: 'Junaeb',
    sortOrder: 10,
    behavior: 'EXTERNAL_OTHER',
    availableForTips: false,
  });
  for (const bad of [
    null,
    [],
    { ...createInput, id: method.id },
    { ...createInput, isActive: true },
    { ...createInput, extra: true },
    { ...createInput, code: '' },
    { ...createInput, behavior: 'OTRO' },
    { ...createInput, availableForTips: 'true' },
    {
      code: 'JUNEB',
      name: 'Junaeb',
      sortOrder: 10,
      behavior: 'EXTERNAL_OTHER',
    },
  ])
    assert.equal(parsePaymentMethodCreateInput(bad), null);
});
test('La edición admite un subconjunto de campos editable y nunca el código', () => {
  assert.deepEqual(parsePaymentMethodUpdateInput({ name: 'Junaeb Empresa' }), {
    name: 'Junaeb Empresa',
  });
  assert.deepEqual(
    parsePaymentMethodUpdateInput({
      sortOrder: 5,
      behavior: 'CASH',
      availableForTips: true,
    }),
    { sortOrder: 5, behavior: 'CASH', availableForTips: true },
  );
  for (const bad of [
    {},
    null,
    { code: 'OTRO' },
    { name: '' },
    { sortOrder: -1 },
    { behavior: 'OTRO' },
    { availableForTips: 'no' },
  ])
    assert.equal(parsePaymentMethodUpdateInput(bad), null);
});
test('El parser del catálogo valida cada medio, ordena y rechaza duplicados', () => {
  const other: PaymentMethod = {
    ...method,
    id: '7a000000-0000-4000-8000-000000000012',
    code: 'CASH',
    name: 'Efectivo',
    sortOrder: 1,
  };
  const parsed = parsePaymentMethods([method, other]);
  assert.ok(parsed);
  assert.deepEqual(
    parsed.map((item) => item.code),
    ['CASH', 'JUNEB'],
  );
  assert.equal(parsePaymentMethods({}), null);
  assert.equal(parsePaymentMethods([method, method]), null);
  assert.equal(parsePaymentMethods([{ ...method, behavior: 'OTRO' }]), null);
  assert.equal(parsePaymentMethods([{ ...method, isActive: 'true' }]), null);
  assert.deepEqual(parsePaymentMethod({ ...method, token: 'secret' }), method);
});
test('El orden manual respeta sortOrder y desempata por código', () => {
  const items = [
    { ...method, code: 'B', sortOrder: 2 },
    { ...method, code: 'A', sortOrder: 2 },
    { ...method, code: 'C', sortOrder: 1 },
  ];
  assert.deepEqual(
    sortPaymentMethods(items).map((item) => item.code),
    ['C', 'A', 'B'],
  );
});
test('Los mensajes de error distinguen carga, guardado y permisos sin datos internos', () => {
  assert.match(paymentMethodErrorMessage(403), /permiso/);
  assert.match(paymentMethodErrorMessage(409), /código/);
  assert.match(paymentMethodErrorMessage(503, 'load'), /catálogo/);
  assert.match(paymentMethodErrorMessage(500, 'load'), /cargar/);
});
test('El cliente consulta el catálogo con los filtros elegidos', async (context) => {
  const mock = context.mock.method(globalThis, 'fetch', async () =>
    Response.json([method]),
  );
  const result = await loadPaymentMethods(
    { isActive: true, availableForTips: true },
    undefined,
  );
  assert.deepEqual(result, [method]);
  const url = String(mock.mock.calls[0].arguments[0]);
  assert.ok(url.startsWith('/api/payment-methods?'));
  assert.ok(url.includes('isActive=true'));
  assert.ok(url.includes('availableForTips=true'));
  await loadPaymentMethods({}, undefined);
  assert.equal(String(mock.mock.calls[1].arguments[0]), '/api/payment-methods');
});
test('El cliente de alta normaliza y verifica la respuesta contra lo enviado', async (context) => {
  context.mock.method(globalThis, 'fetch', async () =>
    Response.json({ ...method, name: 'Otro' }, { status: 201 }),
  );
  await assert.rejects(
    createPaymentMethod({
      code: 'JUNEB',
      name: 'Junaeb',
      sortOrder: 10,
      behavior: 'EXTERNAL_OTHER',
      availableForTips: false,
    }),
    (error: unknown) =>
      error instanceof PaymentMethodError && error.status === 502,
  );
});
test('El cliente de edición conserva el código estable y detecta respuestas ajenas', async (context) => {
  const mock = context.mock.method(globalThis, 'fetch', async () =>
    Response.json({ ...method, code: 'OTRO' }),
  );
  await assert.rejects(
    updatePaymentMethod(method, { name: 'Junaeb Empresa' }),
    (error: unknown) =>
      error instanceof PaymentMethodError && error.status === 502,
  );
  mock.mock.restore();
  context.mock.method(globalThis, 'fetch', async () =>
    Response.json({ ...method, name: 'Junaeb Empresa' }),
  );
  const result = await updatePaymentMethod(method, { name: 'Junaeb Empresa' });
  assert.equal(result.name, 'Junaeb Empresa');
  assert.equal(result.code, 'JUNEB');
});
test('El cliente de estado alterna desactivación y reactivación', async (context) => {
  const mock = context.mock.method(globalThis, 'fetch', async () =>
    Response.json({ ...method, isActive: false }),
  );
  const deactivated = await changePaymentMethodState(method);
  assert.equal(deactivated.isActive, false);
  const url = String(mock.mock.calls[0].arguments[0]);
  assert.ok(url.endsWith('/' + method.id + '/deactivate'));
  mock.mock.restore();
  context.mock.method(globalThis, 'fetch', async () =>
    Response.json({ ...method, isActive: false }),
  );
  await assert.rejects(
    changePaymentMethodState({ ...method, isActive: false }),
    (error: unknown) =>
      error instanceof PaymentMethodError && error.status === 502,
  );
});
test('El cliente mapea errores HTTP a mensajes públicos', async (context) => {
  context.mock.method(globalThis, 'fetch', async () =>
    Response.json({ message: 'SQL passwordHash secret' }, { status: 403 }),
  );
  await assert.rejects(
    loadPaymentMethods(),
    (error: unknown) =>
      error instanceof PaymentMethodError &&
      error.status === 403 &&
      !error.message.includes('secret'),
  );
});
