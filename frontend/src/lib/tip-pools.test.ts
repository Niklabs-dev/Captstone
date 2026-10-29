import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  parsePool,
  parsePoolForPeriod,
  parsePeriod,
  parsePoolAction,
  parseAlerts,
  parseReceipts,
  poolError,
} from './tip-pools';
const id = 'a9000000-0000-4000-8000-000000000001';
const person = { id, name: 'Prueba', passwordHash: 'private' };
const period = {
  storeId: id,
  periodStart: '2026-01-01',
  periodEnd: '2026-01-02',
};
const pool = {
  id,
  version: 1,
  status: 'DRAFT',
  store: person,
  ...period,
  totalAmount: 5,
  totalHours: '1.00',
  agreement: null,
  lines: [
    { userId: id, workerName: 'Persona', hoursWorked: '1.00', amount: 5 },
  ],
  sources: [
    {
      tipEntryId: id,
      businessDate: '2026-01-01',
      paymentMethod: 'CASH',
      amount: 5,
    },
  ],
  reconciled: true,
  notes: null,
  calculatedBy: person,
  calculatedAt: '2026-01-03T12:00:00Z',
  confirmedBy: null,
  confirmedAt: null,
  paidBy: null,
  paidAt: null,
  paymentDate: null,
  receiptsCount: 0,
};
test('El período exige fechas reales, orden y únicamente los campos permitidos', () => {
  assert.deepEqual(parsePeriod(period), period);
  for (const bad of [
    { ...period, periodEnd: '2026-02-30' },
    { ...period, periodEnd: '2025-01-01' },
    { ...period, storeId: 'otro' },
    { ...period, role: 'ADMINISTRADOR' },
  ])
    assert.equal(parsePeriod(bad), null);
});
test('La foto del reparto verifica conciliación, unicidad, montos, estado y versión', () => {
  assert.ok(parsePool(pool));
  for (const bad of [
    { ...pool, totalAmount: 6 },
    { ...pool, version: 0 },
    { ...pool, status: 'UNKNOWN' },
    { ...pool, lines: [...pool.lines, ...pool.lines] },
    { ...pool, sources: [...pool.sources, ...pool.sources] },
    { ...pool, totalAmount: -1 },
    { ...pool, totalHours: 'NaN' },
  ])
    assert.equal(parsePool(bad), null);
});
test('La proyección no expone datos adicionales de responsables ni local', () => {
  const parsed = parsePool(pool)!;
  assert.deepEqual(parsed.store, { id, name: 'Prueba' });
  assert.deepEqual(parsed.calculatedBy, { id, name: 'Prueba' });
  assert.ok(!JSON.stringify(parsed).includes('private'));
});
test('Las acciones solo aceptan versión válida y los campos propios', () => {
  assert.deepEqual(
    parsePoolAction({ expectedVersion: 1, notes: ' Hola ' }, 'observations'),
    { expectedVersion: 1, notes: 'Hola' },
  );
  assert.equal(
    parsePoolAction({ expectedVersion: 1, notes: ' ' }, 'observations'),
    null,
  );
  assert.equal(
    parsePoolAction(
      { expectedVersion: 1, notes: 'x'.repeat(256) },
      'observations',
    ),
    null,
  );
  assert.equal(
    parsePoolAction({ expectedVersion: 1, status: 'PAID' }, 'confirm'),
    null,
  );
  assert.equal(
    parsePoolAction({ expectedVersion: 1, paymentDate: '2026-02-30' }, 'pay'),
    null,
  );
  assert.equal(parsePoolAction({ expectedVersion: 0 }, 'confirm'), null);
});
test('Alertas conservan plazos del backend y proyectan datos conocidos', () => {
  const value = {
    calculatedAt: pool.calculatedAt,
    items: [
      {
        id,
        store: person,
        businessDate: '2026-01-01',
        amount: 5,
        deadline: '2026-01-12',
        daysRemaining: -2,
        status: 'OVERDUE',
        pool: null,
      },
    ],
  };
  assert.equal(parseAlerts(value)?.items[0].daysRemaining, -2);
  assert.ok(!JSON.stringify(parseAlerts(value)).includes('private'));
  assert.equal(
    parseAlerts({
      ...value,
      items: [{ ...value.items[0], deadline: 'inválida' }],
    }),
    null,
  );
});
test('Constancias verifican identidad de reparto y eliminan extras', () => {
  const receipt = {
    id,
    poolId: id,
    userId: id,
    workerName: 'Prueba',
    amount: 5,
    paymentDate: '2026-01-03',
    paidBy: person,
  };
  assert.ok(parseReceipts([receipt], id));
  assert.ok(!JSON.stringify(parseReceipts([receipt], id)).includes('private'));
  assert.equal(parseReceipts([{ ...receipt, poolId: 'otro' }], id), null);
  assert.equal(parseReceipts([receipt, receipt], id), null);
});
test('Los conflictos indican recargar y los fallos no publican errores internos', () => {
  assert.match(poolError(409), /Actualiza/);
  assert.match(poolError(422), /pacto/);
  assert.match(poolError(500), /Conservamos tus campos/);
});

test('El cálculo y la consulta rechazan respuestas de otro local o período', () => {
  assert.ok(parsePoolForPeriod(pool, period));
  assert.equal(
    parsePoolForPeriod(
      {
        ...pool,
        store: { ...person, id: 'a9000000-0000-4000-8000-000000000099' },
      },
      period,
    ),
    null,
  );
  assert.equal(
    parsePoolForPeriod({ ...pool, periodEnd: '2026-01-03' }, period),
    null,
  );
});
