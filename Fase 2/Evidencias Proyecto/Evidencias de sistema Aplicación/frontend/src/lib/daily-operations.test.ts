import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DAILY_STORE_INACTIVE_MESSAGE,
  MAX_DAILY_AMOUNT,
  MAX_DIFFERENCE_REASON_LENGTH,
  MAX_VOUCHER_BYTES,
  dailyOperationErrorMessage,
  dailyOperationFieldErrors,
  formatSignedClp,
  isCashDifference,
  isDailyAmount,
  parseCashDifference,
  parseDailyAmount,
  parseDailyOperation,
  parseDailyOperations,
  voucherFileError,
  type DailyOperationFormFields,
} from './daily-operations';
import {
  createDailyOperation,
  DailyOperationRequestError,
  loadDailyOperationById,
  loadDailyOperations,
} from './daily-operations-client';

const storeId = '61000000-0000-4000-8000-000000000311';
const responsibleId = '63000000-0000-4000-8000-000000000311';
const operationId = '62000000-0000-4000-8000-000000000311';
const voucherId = '64000000-0000-4000-8000-000000000311';
const voucher = {
  id: voucherId,
  fileName: 'voucher-comedor.jpg',
  mimeType: 'image/jpeg',
  sizeBytes: 2048,
  sha256Hash: 'a'.repeat(64),
  createdAt: '2026-10-26T12:05:00Z',
};
const operation = {
  id: operationId,
  store: { id: storeId, name: 'Centro' },
  businessDate: '2026-10-26',
  cardTipAmount: 12500,
  cashTipAmount: 8000,
  tipFundAmount: 20500,
  cashDifference: -1500,
  differenceReason: 'Vale de caja firmado por la encargada',
  voucher,
  responsible: { id: responsibleId, name: 'Camila Supervisora' },
  createdAt: '2026-10-26T12:00:00Z',
  updatedAt: '2026-10-26T12:00:00Z',
};
const fields: DailyOperationFormFields = {
  businessDate: '2026-10-26',
  cardTipAmount: '12500',
  cashTipAmount: '8000',
  cashDifference: '-1500',
  differenceReason: 'Vale de caja firmado',
};

test('Los montos aceptan cero y límite; la diferencia admite signo y normaliza -0', () => {
  assert.equal(parseDailyAmount(' 12500 '), 12500);
  assert.equal(parseDailyAmount('0'), 0);
  assert.equal(parseDailyAmount(String(MAX_DAILY_AMOUNT)), MAX_DAILY_AMOUNT);
  for (const amount of [
    '',
    '-1',
    '+1',
    '12.500',
    '1e3',
    String(MAX_DAILY_AMOUNT + 1),
  ])
    assert.equal(parseDailyAmount(amount), null);
  assert.equal(parseCashDifference('-1500'), -1500);
  assert.equal(parseCashDifference('+2000'), 2000);
  assert.equal(parseCashDifference('0'), 0);
  assert.equal(parseCashDifference('-0'), 0);
  assert.equal(Object.is(parseCashDifference('-0'), -0), false);
  assert.equal(parseCashDifference(''), null);
  assert.equal(parseCashDifference('12.500'), null);
  assert.equal(isCashDifference(MAX_DAILY_AMOUNT), true);
  assert.equal(isCashDifference(-MAX_DAILY_AMOUNT), true);
  assert.equal(isCashDifference(-MAX_DAILY_AMOUNT - 1), false);
  assert.equal(isDailyAmount(-1), false);
});
test('El voucher valida formato y tamaño antes de enviarse', () => {
  assert.equal(voucherFileError({ size: 1024, type: 'image/png' }), null);
  assert.equal(
    voucherFileError({ size: 1024, type: 'application/pdf' }),
    'La foto del voucher debe estar en formato JPEG, PNG o WebP.',
  );
  assert.equal(
    voucherFileError({ size: MAX_VOUCHER_BYTES + 1, type: 'image/webp' }),
    'La foto del voucher supera el máximo de 5 MiB.',
  );
  assert.equal(
    voucherFileError({ size: 0, type: 'image/jpeg' }),
    'La foto del voucher está vacía. Vuelve a tomarla.',
  );
});
test('Los errores identifican cada campo y el motivo es exigido solo con diferencia', () => {
  assert.deepEqual(
    Object.keys(
      dailyOperationFieldErrors(
        {
          businessDate: '',
          cardTipAmount: '',
          cashTipAmount: '',
          cashDifference: '',
          differenceReason: '',
        },
        false,
      ),
    ),
    ['businessDate', 'cardTipAmount', 'cashTipAmount', 'cashDifference'],
  );
  assert.deepEqual(dailyOperationFieldErrors(fields, true), {});
  assert.deepEqual(
    dailyOperationFieldErrors(
      { ...fields, cashDifference: '0', differenceReason: '' },
      true,
    ),
    {},
  );
  assert.equal(
    dailyOperationFieldErrors({ ...fields, differenceReason: '  ' }, true)
      .differenceReason,
    'Indica el motivo de la diferencia cuando no es cero.',
  );
  assert.equal(
    dailyOperationFieldErrors(
      {
        ...fields,
        differenceReason: 'x'.repeat(MAX_DIFFERENCE_REASON_LENGTH + 1),
      },
      true,
    ).differenceReason,
    'El motivo debe tener como máximo 500 caracteres.',
  );
  assert.equal(
    dailyOperationFieldErrors(
      { ...fields, cardTipAmount: '0', cashDifference: '0' },
      false,
    ).voucher,
    undefined,
  );
  assert.equal(
    dailyOperationFieldErrors({ ...fields, cardTipAmount: '12500' }, false)
      .voucher,
    'Adjunta la foto del voucher de las propinas con tarjeta.',
  );
  assert.equal(
    dailyOperationFieldErrors(
      { ...fields, cardTipAmount: '0', cashDifference: '0' },
      true,
    ).voucher,
    'La foto del voucher solo se acepta cuando hay propina con tarjeta. Quítala o ingresa ese monto.',
  );
  assert.match(
    dailyOperationFieldErrors({ ...fields, cashDifference: 'abc' }, true)
      .cashDifference ?? '',
    /con signo/,
  );
});
test('La proyección conserva solo los datos públicos de la operación', () => {
  assert.deepEqual(
    parseDailyOperation(
      {
        ...operation,
        token: 'secret',
        filePath: '/private',
        voucher: { ...voucher, storagePath: '/private' },
        responsible: { ...operation.responsible, passwordHash: 'secret' },
      },
      storeId,
      operation.businessDate,
    ),
    parseDailyOperation(operation, storeId, operation.businessDate),
  );
});
test('Se rechazan operaciones de otro local o fecha y fondos inconsistentes', () => {
  const valid = parseDailyOperation(operation, storeId, operation.businessDate);
  assert.ok(valid);
  for (const bad of [
    { ...operation, store: { ...operation.store, id: operation.id } },
    { ...operation, businessDate: '2026-10-25' },
    { ...operation, cardTipAmount: -1 },
    { ...operation, cashTipAmount: MAX_DAILY_AMOUNT + 1 },
    { ...operation, tipFundAmount: 20501 },
    { ...operation, cashDifference: -MAX_DAILY_AMOUNT - 1 },
    { ...operation, differenceReason: '' },
    { ...operation, differenceReason: '  ' },
    { ...operation, differenceReason: null },
    { ...operation, voucher: { ...voucher, mimeType: 'application/pdf' } },
    { ...operation, voucher: { ...voucher, sizeBytes: MAX_VOUCHER_BYTES + 1 } },
    { ...operation, voucher: { ...voucher, sha256Hash: 'zz' } },
    { ...operation, voucher: { ...voucher, id: 'no-uuid' } },
    { ...operation, responsible: null },
    { ...operation, createdAt: 'incorrecta' },
  ])
    assert.equal(
      parseDailyOperation(bad, storeId, operation.businessDate),
      null,
      JSON.stringify(bad).slice(0, 80),
    );
  // Sin diferencia no se exige motivo y el voucher puede ser nulo.
  const zero = parseDailyOperation(
    {
      ...operation,
      cashDifference: 0,
      differenceReason: null,
      voucher: null,
      cardTipAmount: 0,
      tipFundAmount: 8000,
    },
    storeId,
    operation.businessDate,
  );
  assert.ok(zero);
  assert.equal(zero.cashDifference, 0);
  assert.equal(zero.differenceReason, null);
  assert.equal(zero.voucher, null);
});
test('La colección solo admite cero o una operación por local y fecha', () => {
  assert.deepEqual(
    parseDailyOperations([], storeId, operation.businessDate),
    [],
  );
  const parsed = parseDailyOperations(
    [operation],
    storeId,
    operation.businessDate,
  );
  assert.equal(parsed?.length, 1);
  assert.equal(parsed?.[0].id, operationId);
  assert.equal(
    parseDailyOperations(
      [operation, operation],
      storeId,
      operation.businessDate,
    ),
    null,
  );
  assert.equal(parseDailyOperations([operation], storeId, '2026-10-25'), null);
  assert.equal(parseDailyOperations({}, storeId, operation.businessDate), null);
  assert.equal(
    parseDailyOperations([null], storeId, operation.businessDate),
    null,
  );
});
test('La diferencia firmada se formatea con signo explícito', () => {
  assert.match(formatSignedClp(2000), /^\+/);
  assert.match(formatSignedClp(-1500), /^-/);
  assert.match(formatSignedClp(0), /^\$/);
  assert.match(formatSignedClp(0), /[^+-]/);
});
test('Los errores de permisos, conflicto y voucher son comprensibles', () => {
  assert.match(dailyOperationErrorMessage(403), /permiso/);
  assert.match(dailyOperationErrorMessage(409), /Ya existe/);
  assert.match(dailyOperationErrorMessage(413), /5 MiB/);
  assert.match(dailyOperationErrorMessage(415), /JPEG, PNG o WebP/);
  assert.match(dailyOperationErrorMessage(500), /verificar/);
});
test('El cliente conserva la distinción entre alta y reintento idéntico', async (context) => {
  let status = 201;
  const mock = context.mock.method(globalThis, 'fetch', async () =>
    Response.json(operation, { status }),
  );
  const file = new File(['voucher'], 'voucher.jpg', { type: 'image/jpeg' });
  const input = {
    storeId,
    businessDate: fields.businessDate,
    cardTipAmount: 12500,
    cashTipAmount: 8000,
    cashDifference: -1500,
    differenceReason: fields.differenceReason,
  };
  assert.equal((await createDailyOperation(input, file)).created, true);
  status = 200;
  assert.equal((await createDailyOperation(input, file)).created, false);
  const body = mock.mock.calls[0].arguments[1]?.body as FormData;
  assert.equal(body.get('storeId'), storeId);
  assert.equal(body.get('businessDate'), input.businessDate);
  assert.equal(body.get('cardTipAmount'), '12500');
  assert.equal(body.get('cashTipAmount'), '8000');
  assert.equal(body.get('cashDifference'), '-1500');
  assert.equal(body.get('differenceReason'), input.differenceReason);
  assert.ok(body.get('voucher') instanceof File);
});
test('El cliente reenvía el motivo solo cuando hay contenido y omite el voucher ausente', async (context) => {
  const mock = context.mock.method(globalThis, 'fetch', async () =>
    Response.json(
      {
        ...operation,
        differenceReason: null,
        cashDifference: 0,
        voucher: null,
      },
      { status: 201 },
    ),
  );
  await createDailyOperation(
    {
      storeId,
      businessDate: fields.businessDate,
      cardTipAmount: 0,
      cashTipAmount: 8000,
      cashDifference: 0,
      differenceReason: '   ',
    },
    null,
  );
  const body = mock.mock.calls[0].arguments[1]?.body as FormData;
  assert.equal(body.get('differenceReason'), null);
  assert.equal(body.get('voucher'), null);
});
test('El conflicto expone el ID consultable de la operación existente', async (context) => {
  context.mock.method(globalThis, 'fetch', async () =>
    Response.json(
      {
        message: 'SQL passwordHash /private/secret',
        existingOperationId: operationId,
      },
      { status: 409 },
    ),
  );
  await assert.rejects(
    createDailyOperation(
      {
        storeId,
        businessDate: fields.businessDate,
        cardTipAmount: 1,
        cashTipAmount: 0,
        cashDifference: 0,
        differenceReason: '',
      },
      null,
    ),
    (error: unknown) => {
      assert.ok(error instanceof DailyOperationRequestError);
      assert.equal(error.status, 409);
      assert.equal(error.existingOperationId, operationId);
      assert.equal(error.message.includes('secret'), false);
      return true;
    },
  );
});
test('El local inactivo se traduce sin mostrar mensajes externos', async (context) => {
  let payload: unknown = { code: 'STORE_INACTIVE', message: 'SQL secret' };
  context.mock.method(globalThis, 'fetch', async () =>
    Response.json(payload, { status: 400 }),
  );
  await assert.rejects(
    createDailyOperation(
      {
        storeId,
        businessDate: fields.businessDate,
        cardTipAmount: 1,
        cashTipAmount: 0,
        cashDifference: 0,
        differenceReason: '',
      },
      null,
    ),
    (error: unknown) =>
      error instanceof DailyOperationRequestError &&
      error.status === 400 &&
      error.message === DAILY_STORE_INACTIVE_MESSAGE,
  );
  payload = { code: 'OTHER', message: 'SQL secret' };
  await assert.rejects(
    createDailyOperation(
      {
        storeId,
        businessDate: fields.businessDate,
        cardTipAmount: 1,
        cashTipAmount: 0,
        cashDifference: 0,
        differenceReason: '',
      },
      null,
    ),
    (error: unknown) =>
      error instanceof DailyOperationRequestError &&
      error.message === dailyOperationErrorMessage(400),
  );
});
test('La consulta distingue fecha sin operación, registrada y respuesta ajena', async (context) => {
  let payload: unknown = [];
  context.mock.method(globalThis, 'fetch', async () =>
    Response.json(payload, { status: 200 }),
  );
  const signal = new AbortController().signal;
  assert.deepEqual(
    await loadDailyOperations(storeId, operation.businessDate, signal),
    [],
  );
  payload = [operation];
  const loaded = await loadDailyOperations(
    storeId,
    operation.businessDate,
    signal,
  );
  assert.equal(loaded[0].id, operationId);
  payload = [{ ...operation, store: { id: operation.id, name: 'Ajeno' } }];
  await assert.rejects(
    loadDailyOperations(storeId, operation.businessDate, signal),
    (error: unknown) =>
      error instanceof DailyOperationRequestError && error.status === 502,
  );
});
test('El detalle por ID exige el propio local y rechaza respuestas privadas', async (context) => {
  let payload: unknown = operation;
  context.mock.method(globalThis, 'fetch', async () =>
    Response.json(payload, { status: 200 }),
  );
  const signal = new AbortController().signal;
  assert.equal(
    (await loadDailyOperationById(operationId, storeId, signal)).id,
    operationId,
  );
  payload = { ...operation, store: { id: operation.id, name: 'Ajeno' } };
  await assert.rejects(
    loadDailyOperationById(operationId, storeId, signal),
    (error: unknown) =>
      error instanceof DailyOperationRequestError && error.status === 502,
  );
  payload = { ...operation, voucher: { ...voucher, sha256Hash: 'private!' } };
  await assert.rejects(
    loadDailyOperationById(operationId, storeId, signal),
    (error: unknown) =>
      error instanceof DailyOperationRequestError && error.status === 502,
  );
});
test('Los fallos de red se presentan como servicio no disponible', async (context) => {
  context.mock.method(globalThis, 'fetch', async () => {
    throw new Error('network down');
  });
  await assert.rejects(
    createDailyOperation(
      {
        storeId,
        businessDate: fields.businessDate,
        cardTipAmount: 1,
        cashTipAmount: 0,
        cashDifference: 0,
        differenceReason: '',
      },
      null,
    ),
    (error: unknown) =>
      error instanceof DailyOperationRequestError && error.status === 503,
  );
});
