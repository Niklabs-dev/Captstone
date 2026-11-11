import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  groupPoolHistory,
  parsePool,
  parsePools,
  parseReceipts,
  poolError,
  poolReceiptHref,
  poolRuleLabel,
  POOL_STATUS,
  POOL_STATUS_NOTE,
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
  rule: 'PROPORTIONAL_TO_HOURS',
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
  dailySources: [],
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
test('Los códigos de medios salen del catálogo y no de una lista fija (SPRINT-4-T32)', () => {
  const dynamic = parsePool({
    ...pool,
    sources: [{ ...pool.sources[0], paymentMethod: 'JUNEB', amount: 5 }],
  });
  assert.ok(dynamic);
  assert.equal(dynamic.sources[0].paymentMethod, 'JUNEB');
  for (const bad of [
    { ...pool.sources[0], paymentMethod: '' },
    { ...pool.sources[0], paymentMethod: '   ' },
    { ...pool.sources[0], paymentMethod: 5 },
    { ...pool.sources[0], paymentMethod: 'CASH\u0000' },
  ])
    assert.equal(parsePool({ ...pool, sources: [bad] }), null);
});
test('Los errores explican qué pasó sin publicar errores internos', () => {
  assert.match(poolError(409), /no tiene constancias/);
  assert.match(poolError(403), /permiso/);
  assert.match(poolError(500), /Intenta nuevamente/);
});

test('El histórico valida todas las fotos y separa los borradores sin efecto (SPRINT-4A-T08)', () => {
  const draft = { ...pool, id: 'a9000000-0000-4000-8000-000000000011' };
  const paid = {
    ...pool,
    id: 'a9000000-0000-4000-8000-000000000012',
    status: 'PAID',
    confirmedBy: person,
    confirmedAt: '2026-01-03T13:00:00Z',
    paidBy: person,
    paidAt: '2026-01-03T14:00:00Z',
    paymentDate: '2026-01-03',
    receiptsCount: 1,
  };
  const confirmed = {
    ...paid,
    id: 'a9000000-0000-4000-8000-000000000013',
    status: 'CONFIRMED',
    paidBy: null,
    paidAt: null,
    paymentDate: null,
    receiptsCount: 0,
  };
  const list = parsePools([draft, paid, confirmed]);
  assert.ok(list);
  const groups = groupPoolHistory(list);
  assert.deepEqual(
    groups.closed.map((item) => item.id),
    [paid.id, confirmed.id],
  );
  assert.deepEqual(
    groups.drafts.map((item) => item.id),
    [draft.id],
  );
  assert.equal(parsePools([paid, { ...draft, totalAmount: -1 }]), null);
  assert.equal(parsePools({ items: [] }), null);
  assert.deepEqual(parsePools([]), []);
  assert.equal(POOL_STATUS.DRAFT, 'Borrador sin efecto');
  assert.match(POOL_STATUS_NOTE.DRAFT, /no tiene efecto/);
  assert.equal(
    poolReceiptHref(paid.id, id),
    `/api/tip-pools/${paid.id}/receipts/${id}/download`,
  );
});

// SPRINT-4R-T06: reparto equitativo sin horas, con operaciones diarias.
const otherId = 'a9000000-0000-4000-8000-000000000002';
const equalPool = {
  ...pool,
  rule: 'EQUAL_SHARES',
  totalAmount: 10_001,
  totalHours: null,
  lines: [
    { userId: id, workerName: 'Ana', hoursWorked: null, amount: 5_001 },
    { userId: otherId, workerName: 'Bruno', hoursWorked: null, amount: 5_000 },
  ],
  sources: [],
  dailySources: [
    {
      operationId: id,
      businessDate: '2026-01-01',
      cardTipAmount: 1,
      cashTipAmount: 10_000,
      amount: 10_001,
    },
  ],
};
test('Acepta el reparto equitativo sin horas ni pacto y concilia sus operaciones', () => {
  const parsed = parsePool(equalPool);
  assert.ok(parsed);
  assert.equal(parsed.rule, 'EQUAL_SHARES');
  assert.equal(parsed.totalHours, null);
  assert.equal(parsed.lines[0].hoursWorked, null);
  assert.match(poolRuleLabel(parsed.rule), /equitativo/);
});
test('No inventa horas ni mezcla reglas y conserva la conciliación fallida', () => {
  const lines = equalPool.lines;
  for (const bad of [
    { ...equalPool, totalHours: '0.00' },
    { ...equalPool, lines: [{ ...lines[0], hoursWorked: '1.00' }, lines[1]] },
    { ...pool, totalHours: null },
    { ...pool, lines: [{ ...pool.lines[0], hoursWorked: null }] },
    { ...pool, rule: 'OTRA' },
    { ...equalPool, dailySources: undefined },
    {
      ...equalPool,
      dailySources: [...equalPool.dailySources, ...equalPool.dailySources],
    },
  ])
    assert.equal(parsePool(bad), null);
  const failed = parsePool({
    ...equalPool,
    lines: [lines[0], { ...lines[1], amount: 4_999 }],
    reconciled: false,
  });
  assert.ok(failed);
  assert.equal(failed.reconciled, false);
  // El flag del backend debe coincidir con la suma real.
  assert.equal(
    parsePool({
      ...equalPool,
      lines: [lines[0], { ...lines[1], amount: 4_999 }],
      reconciled: true,
    }),
    null,
  );
});
