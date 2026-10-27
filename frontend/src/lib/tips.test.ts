import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  TIP_INACTIVE_STORE_MESSAGE,
  TIP_METHODS,
  MAX_TIP_AMOUNT,
  isTipDate,
  tipBusinessDate,
  parseTipAmount,
  tipFieldErrors,
  parseTipInput,
  parseTipEntry,
  parseTipEntries,
  tipTotals,
  formatClp,
  tipErrorMessage,
  type TipEntry,
} from './tips';
import {
  getNavigationItems,
  getNavigationView,
  getPageRedirect,
} from './navigation';
import { createTip, loadTips, TipRequestError } from './tips-client';

const storeId = '61000000-0000-4000-8000-000000000311';
const input = {
  businessDate: '2026-10-26',
  paymentMethod: 'CASH' as const,
  amount: 12500,
};
const entry: TipEntry = {
  ...input,
  id: '62000000-0000-4000-8000-000000000311',
  store: { id: storeId, name: 'Centro' },
  responsible: {
    id: '63000000-0000-4000-8000-000000000311',
    name: 'Camila Supervisora',
  },
  createdAt: '2026-10-26T12:00:00Z',
  updatedAt: '2026-10-26T12:00:00Z',
};

test('La fecha acepta días reales y mantiene el contrato calendario del backend', () => {
  for (const date of ['2024-02-29', '2026-10-26', '0100-01-01', '9999-12-31'])
    assert.equal(isTipDate(date), true);
  for (const date of [
    '',
    '2026-02-29',
    '2026-02-30',
    '2026-13-01',
    '2026-01-00',
    '2026-1-1',
    '2026-10-26T00:00:00Z',
    '0099-01-01',
  ])
    assert.equal(isTipDate(date), false);
});
test('El día inicial usa Chile incluso cuando UTC ya cambió de fecha', () => {
  assert.equal(tipBusinessDate(new Date('2026-10-27T01:30:00Z')), '2026-10-26');
  assert.equal(tipBusinessDate(new Date('2026-07-27T03:30:00Z')), '2026-07-26');
});
test('CLP acepta cero y límite; rechaza vacíos, negativos, decimales y notación ambigua', () => {
  assert.equal(parseTipAmount(' 12500 '), 12500);
  assert.equal(parseTipAmount('0'), 0);
  assert.equal(parseTipAmount(String(MAX_TIP_AMOUNT)), MAX_TIP_AMOUNT);
  for (const amount of [
    '',
    ' ',
    '-1',
    '+1',
    '12.500',
    '12,50',
    '1e3',
    'Infinity',
    'NaN',
    String(MAX_TIP_AMOUNT + 1),
    '9007199254740993',
  ])
    assert.equal(parseTipAmount(amount), null);
});
test('Los errores identifican cada campo y un formulario válido no tiene errores', () => {
  assert.deepEqual(
    Object.keys(
      tipFieldErrors({ businessDate: '', paymentMethod: '', amount: '' }),
    ),
    ['businessDate', 'paymentMethod', 'amount'],
  );
  assert.deepEqual(
    tipFieldErrors({
      businessDate: input.businessDate,
      paymentMethod: 'CASH',
      amount: '0',
    }),
    {},
  );
  assert.match(
    tipFieldErrors({
      businessDate: input.businessDate,
      paymentMethod: 'CASH',
      amount: '-1',
    }).amount ?? '',
    /negativos/,
  );
});
test('El BFF solo admite los campos tipados del formulario y nunca identidad o local editables', () => {
  assert.deepEqual(parseTipInput(input), input);
  for (const bad of [
    null,
    [],
    { ...input, storeId },
    { ...input, responsibleId: entry.responsible.id },
    { ...input, amount: '12500' },
    { ...input, amount: -1 },
    { ...input, amount: 1.5 },
    { ...input, businessDate: '2026-02-30' },
    { ...input, paymentMethod: 'OTHER' },
  ])
    assert.equal(parseTipInput(bad), null);
});
test('La proyección conserva solo los datos públicos del registro', () => {
  assert.deepEqual(
    parseTipEntry(
      {
        ...entry,
        token: 'secret',
        filePath: '/private',
        responsible: { ...entry.responsible, passwordHash: 'secret' },
      },
      storeId,
      input.businessDate,
    ),
    entry,
  );
});
test('Se rechazan registros de otro local, fecha, montos inválidos o identidades incompletas', () => {
  for (const bad of [
    { ...entry, store: { ...entry.store, id: entry.id } },
    { ...entry, businessDate: '2026-10-25' },
    { ...entry, amount: '12500' },
    { ...entry, amount: -1 },
    { ...entry, amount: MAX_TIP_AMOUNT + 1 },
    { ...entry, responsible: null },
    { ...entry, id: '../private' },
    { ...entry, createdAt: 'incorrecta' },
  ])
    assert.equal(parseTipEntry(bad, storeId, input.businessDate), null);
});
test('La colección rechaza claves diarias duplicadas e identifica listas vacías válidas', () => {
  assert.deepEqual(parseTipEntries([], storeId, input.businessDate), []);
  assert.equal(
    parseTipEntries(
      [entry, { ...entry, id: entry.responsible.id }],
      storeId,
      input.businessDate,
    ),
    null,
  );
  assert.equal(
    parseTipEntries(
      [entry, { ...entry, paymentMethod: 'TRANSFER' }],
      storeId,
      input.businessDate,
    ),
    null,
  );
  assert.equal(parseTipEntries({}, storeId, input.businessDate), null);
});
test('Los cuatro medios se ordenan y suman en CLP sin perder cero ni precisión', () => {
  const entries = TIP_METHODS.map((method, index) => ({
    ...entry,
    id: '62000000-0000-4000-8000-00000000031' + index,
    paymentMethod: method,
    amount: index ? MAX_TIP_AMOUNT : 0,
  }));
  const parsed = parseTipEntries(
    [...entries].reverse(),
    storeId,
    input.businessDate,
  );
  assert.ok(parsed);
  assert.deepEqual(
    parsed.map((item) => item.paymentMethod),
    TIP_METHODS,
  );
  assert.deepEqual(tipTotals(parsed), {
    CASH: 0,
    DEBIT_CARD: MAX_TIP_AMOUNT,
    CREDIT_CARD: MAX_TIP_AMOUNT,
    TRANSFER: MAX_TIP_AMOUNT,
  });
  assert.match(formatClp(12500), /12\.500/);
  assert.match(formatClp(0), /\$\s*0/);
});
test('La ruta y el enlace solo están habilitados para el supervisor', () => {
  assert.deepEqual(getNavigationView('/propinas/diarias'), {
    href: '/propinas/diarias',
    title: 'Registro diario de propinas',
  });
  assert.equal(getNavigationView('/propinas/diarias-publicas').href, null);
  assert.equal(getPageRedirect('SUPERVISOR', '/propinas/diarias'), null);
  for (const role of ['ADMINISTRADOR', 'CONTADOR', 'TRABAJADOR'] as const) {
    assert.equal(
      getNavigationItems(role).some(
        (item) => item.href === '/propinas/diarias',
      ),
      false,
    );
    assert.equal(
      getPageRedirect(role, '/propinas/diarias'),
      role === 'TRABAJADOR'
        ? '/portal?reason=forbidden'
        : '/dashboard?reason=forbidden',
    );
  }
});
test('Los errores de permisos, conflicto y fallos externos son comprensibles', () => {
  assert.match(tipErrorMessage(403), /permiso/);
  assert.match(tipErrorMessage(409), /Ya existe/);
  assert.match(tipErrorMessage(500), /verificar/);
});
test('El cliente conserva la distinción entre alta y reintento idéntico', async (context) => {
  let status = 201;
  const mock = context.mock.method(globalThis, 'fetch', async () =>
    Response.json(entry, { status }),
  );
  assert.equal((await createTip(storeId, input)).created, true);
  status = 200;
  assert.equal((await createTip(storeId, input)).created, false);
  const options = mock.mock.calls[0].arguments[1] as RequestInit;
  assert.deepEqual(JSON.parse(String(options.body)), input);
});
test('El cliente rechaza respuestas ajenas y no muestra mensajes internos del servicio', async (context) => {
  let status = 200;
  context.mock.method(globalThis, 'fetch', async () =>
    Response.json(
      status === 200
        ? [{ ...entry, store: { id: entry.id, name: 'Ajeno' } }]
        : { message: 'SQL passwordHash secret' },
      { status },
    ),
  );
  await assert.rejects(
    loadTips(storeId, input.businessDate, new AbortController().signal),
    (error: unknown) =>
      error instanceof TipRequestError && error.status === 502,
  );
  status = 409;
  await assert.rejects(
    createTip(storeId, input),
    (error: unknown) =>
      error instanceof TipRequestError &&
      error.status === 409 &&
      !error.message.includes('secret'),
  );
});

test('El cliente distingue local inactivo sin mostrar mensajes externos ni confundir otros errores 400', async (context) => {
  let code: unknown = 'STORE_INACTIVE';
  let status = 400;
  context.mock.method(globalThis, 'fetch', async () =>
    Response.json({ code, message: 'SQL passwordHash secret' }, { status }),
  );
  await assert.rejects(
    createTip(storeId, input),
    (error: unknown) =>
      error instanceof TipRequestError &&
      error.status === 400 &&
      error.message === TIP_INACTIVE_STORE_MESSAGE,
  );
  code = 'UNKNOWN';
  await assert.rejects(
    createTip(storeId, input),
    (error: unknown) =>
      error instanceof TipRequestError &&
      error.message === tipErrorMessage(400),
  );
  code = 'STORE_INACTIVE';
  status = 403;
  await assert.rejects(
    createTip(storeId, input),
    (error: unknown) =>
      error instanceof TipRequestError &&
      error.message === tipErrorMessage(403),
  );
});
