import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DAILY_STORE_INACTIVE_MESSAGE,
  MAX_DAILY_AMOUNT,
  MAX_DIFFERENCE_REASON_LENGTH,
  MAX_VOUCHER_BYTES,
  dailyOperationErrorMessage,
  dailyOperationFieldErrors,
  dailyParticipantSelectionError,
  formatSignedClp,
  isCashDifference,
  isDailyAmount,
  parseCashDifference,
  parseDailyAmount,
  parseDailyOperation,
  parseDailyOperations,
  parseEligibleWorkers,
  voucherFileError,
  type DailyOperationFormFields,
} from './daily-operations';
import {
  createDailyOperation,
  DailyOperationRequestError,
  loadDailyOperationById,
  loadDailyOperations,
  loadEligibleWorkers,
  patchDailyOperation,
} from './daily-operations-client';

const storeId = '61000000-0000-4000-8000-000000000311';
const responsibleId = '63000000-0000-4000-8000-000000000311';
const operationId = '62000000-0000-4000-8000-000000000311';
const voucherId = '64000000-0000-4000-8000-000000000311';
const participantId = '65000000-0000-4000-8000-000000000311';
const secondParticipantId = '65000000-0000-4000-8000-000000000312';
const voucher = {
  id: voucherId,
  fileName: 'voucher-comedor.jpg',
  mimeType: 'image/jpeg',
  sizeBytes: 2048,
  sha256Hash: 'a'.repeat(64),
  createdAt: '2026-10-26T12:05:00Z',
};
const participants = [
  { id: participantId, name: 'Benito Trabajador' },
  { id: secondParticipantId, name: 'Ana Trabajadora' },
];
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
  participants,
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
        participants: [
          { ...participants[0], email: 'privado@example.test', phone: '+56' },
          participants[1],
        ],
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
    { ...operation, participants: 'nadie' },
    { ...operation, participants: null },
    { ...operation, participants: [participants[0], participants[0]] },
    { ...operation, participants: [{ id: participantId, name: '  ' }] },
    { ...operation, participants: [{ id: 'no-uuid', name: 'Ana' }] },
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
test('El catálogo de elegibles conserva el orden y exige identidades únicas', () => {
  const ordered = [
    { id: secondParticipantId, name: 'Ana Trabajadora' },
    { id: participantId, name: 'Benito Trabajador' },
  ];
  assert.deepEqual(parseEligibleWorkers(ordered), ordered);
  assert.deepEqual(parseEligibleWorkers([]), []);
  for (const bad of [
    null,
    {},
    [ordered[0], ordered[0]],
    [{ id: participantId, name: '' }],
    [{ id: 'no-uuid', name: 'Ana' }],
    [[ordered[0]]],
  ])
    assert.equal(parseEligibleWorkers(bad), null, JSON.stringify(bad));
});
test('La selección de participantes se exige solo con fondo mayor que cero', () => {
  assert.equal(dailyParticipantSelectionError(null, 0, 0), null);
  assert.equal(dailyParticipantSelectionError(0, null, 0), null);
  assert.equal(dailyParticipantSelectionError(0, 0, 0), null);
  assert.equal(dailyParticipantSelectionError(0, 0, 2), null);
  assert.equal(dailyParticipantSelectionError(12500, 8000, 2), null);
  assert.equal(
    dailyParticipantSelectionError(0, 8000, 0),
    'Selecciona al menos un trabajador participante: hay propinas por repartir.',
  );
  assert.equal(
    dailyParticipantSelectionError(12500, 0, 0),
    'Selecciona al menos un trabajador participante: hay propinas por repartir.',
  );
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
    participantIds: [participantId, secondParticipantId],
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
  assert.deepEqual(body.getAll('participantIds'), input.participantIds);
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
      participantIds: [],
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
        participantIds: [],
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
        participantIds: [],
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
        participantIds: [],
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
        participantIds: [],
      },
      null,
    ),
    (error: unknown) =>
      error instanceof DailyOperationRequestError && error.status === 503,
  );
});
test('El catálogo de elegibles se consulta por el local y rechaza respuestas privadas', async (context) => {
  const eligible = [
    { id: secondParticipantId, name: 'Ana Trabajadora' },
    { id: participantId, name: 'Benito Trabajador' },
  ];
  let payload: unknown = eligible;
  const mock = context.mock.method(globalThis, 'fetch', async () =>
    Response.json(payload, { status: 200 }),
  );
  const signal = new AbortController().signal;
  assert.deepEqual(await loadEligibleWorkers(storeId, signal), eligible);
  assert.equal(
    mock.mock.calls[0].arguments[0],
    '/api/daily-operations/eligible-workers?storeId=' + storeId,
  );
  payload = [...eligible, { id: participantId, name: 'Duplicada' }];
  await assert.rejects(
    loadEligibleWorkers(storeId, signal),
    (error: unknown) =>
      error instanceof DailyOperationRequestError && error.status === 502,
  );
  payload = { email: 'privado@example.test' };
  await assert.rejects(
    loadEligibleWorkers(storeId, signal),
    (error: unknown) =>
      error instanceof DailyOperationRequestError && error.status === 502,
  );
  payload = eligible;
  context.mock.method(globalThis, 'fetch', async () => {
    throw new Error('network down');
  });
  await assert.rejects(
    loadEligibleWorkers(storeId, signal),
    (error: unknown) =>
      error instanceof DailyOperationRequestError && error.status === 503,
  );
});
test('La corrección envía solo los campos definidos con participantIds repetidos', async (context) => {
  const mock = context.mock.method(globalThis, 'fetch', async () =>
    Response.json(
      {
        ...operation,
        cashTipAmount: 9000,
        tipFundAmount: 21500,
        participants: [participants[1]],
      },
      { status: 200 },
    ),
  );
  const corrected = await patchDailyOperation(
    operationId,
    {
      cashTipAmount: 9000,
      participantIds: [secondParticipantId],
    },
    null,
  );
  assert.equal(corrected.cashTipAmount, 9000);
  assert.equal(corrected.participants.length, 1);
  const request = mock.mock.calls[0].arguments;
  assert.equal(request[0], '/api/daily-operations/' + operationId);
  assert.equal(request[1]?.method, 'PATCH');
  const body = request[1]?.body as FormData;
  assert.equal(body.get('cashTipAmount'), '9000');
  assert.deepEqual(body.getAll('participantIds'), [secondParticipantId]);
  assert.equal(body.get('cardTipAmount'), null);
  assert.equal(body.get('voucher'), null);
});
test('La corrección conserva el voucher de reemplazo y mapea el conflicto', async (context) => {
  const file = new File(['nuevo'], 'voucher2.png', { type: 'image/png' });
  const mock = context.mock.method(globalThis, 'fetch', async () =>
    Response.json(operation, { status: 200 }),
  );
  await patchDailyOperation(
    operationId,
    { cardTipAmount: 12500, differenceReason: 'Voucher reemplazado' },
    file,
  );
  const body = mock.mock.calls[0].arguments[1]?.body as FormData;
  assert.ok(body.get('voucher') instanceof File);
  assert.equal(body.get('differenceReason'), 'Voucher reemplazado');
  mock.mock.restore();
  context.mock.method(globalThis, 'fetch', async () =>
    Response.json(
      { message: 'SQL secret', existingOperationId: operationId },
      { status: 409 },
    ),
  );
  await assert.rejects(
    patchDailyOperation(operationId, { cashTipAmount: 1 }, null),
    (error: unknown) => {
      assert.ok(error instanceof DailyOperationRequestError);
      assert.equal(error.status, 409);
      assert.equal(error.existingOperationId, operationId);
      return true;
    },
  );
});
