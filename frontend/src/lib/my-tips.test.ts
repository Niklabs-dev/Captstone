import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  formatMonth,
  monthOptions,
  monthRange,
  myTipsBackendPath,
  myTipsError,
  myTipStatusLabel,
  parseMonthFilter,
  parseMyTips,
  shiftMonth,
  weekdayOf,
  MONTH_OPTION_COUNT,
} from './my-tips';

// «Mis propinas» del portal (SPRINT-4A-T10): contrato de GET /my-tips, filtro
// por mes y textos de estado.
const store = { id: '1010021e-9bab-42d5-851c-417e9e2503bf', name: 'Local A' };
const batch = 'b2c3d4e5-f6a7-4890-b1c2-d3e4f5a6b7c8';
const unpaid = {
  id: 'c1a2b3d4-e5f6-4789-a012-b3c4d5e6f7a8',
  businessDate: '2026-11-09',
  store,
  amount: 7_500,
  status: 'UNPAID',
  paymentBatchId: null,
  paidAt: null,
};
const paid = {
  id: 'c1a2b3d4-e5f6-4789-a012-b3c4d5e6f7a9',
  businessDate: '2026-11-03',
  store,
  amount: 10_000,
  status: 'PAID',
  paymentBatchId: batch,
  paidAt: '2026-11-06T15:00:00.000Z',
};
const response = {
  from: '2026-11-01',
  to: '2026-11-30',
  days: [unpaid, paid],
  totals: {
    totalAmount: 17_500,
    paidAmount: 10_000,
    unpaidAmount: 7_500,
    dayCount: 2,
  },
};

test('acepta la respuesta del backend con sus totales pendiente y pagado', () => {
  const parsed = parseMyTips(response);
  assert.ok(parsed);
  assert.equal(parsed.days.length, 2);
  assert.deepEqual(parsed.totals, response.totals);
  // Si ayer le tocaron 7.500, hoy aparecen como No pagada.
  assert.equal(myTipStatusLabel(parsed.days[0].status), 'No pagada');
  assert.equal(myTipStatusLabel(parsed.days[1].status), 'Pagada');
  // Mes sin propinas: vacío y totales en 0.
  assert.deepEqual(
    parseMyTips({
      from: '2026-10-01',
      to: '2026-10-31',
      days: [],
      totals: { totalAmount: 0, paidAmount: 0, unpaidAmount: 0, dayCount: 0 },
    })?.days,
    [],
  );
});

test('rechaza respuestas inconsistentes', () => {
  const withTotals = (totals: Record<string, number>) => ({
    ...response,
    totals: { ...response.totals, ...totals },
  });
  for (const value of [
    null,
    [],
    { ...response, from: '2026-12-01' },
    { ...response, days: [{ ...unpaid, businessDate: '2026-10-31' }] },
    { ...response, days: [unpaid, unpaid] },
    { ...response, days: [{ ...unpaid, paidAt: paid.paidAt }, paid] },
    { ...response, days: [unpaid, { ...paid, paymentBatchId: null }] },
    { ...response, days: [unpaid, { ...paid, status: 'PARTIAL' }] },
    { ...response, days: [{ ...unpaid, amount: -1 }, paid] },
    { ...response, days: [{ ...unpaid, amount: 1.5 }, paid] },
    { ...response, days: [{ ...unpaid, store: { id: 'x', name: 'A' } }, paid] },
    withTotals({ unpaidAmount: 0 }),
    withTotals({ totalAmount: 1 }),
    withTotals({ dayCount: 1 }),
  ])
    assert.equal(parseMyTips(value), null);
});

test('el mes por defecto es el actual y los inválidos o futuros vuelven a él', () => {
  assert.deepEqual(parseMonthFilter(undefined, '2026-11-10'), {
    ok: true,
    range: { month: '2026-11', from: '2026-11-01', to: '2026-11-30' },
  });
  assert.deepEqual(parseMonthFilter(['2026-02', 'x'], '2026-11-10'), {
    ok: true,
    range: { month: '2026-02', from: '2026-02-01', to: '2026-02-28' },
  });
  for (const value of ['2026-13', '2026-1', 'noviembre', '2026-12']) {
    const result = parseMonthFilter(value, '2026-11-10');
    assert.equal(result.ok, false);
    assert.equal(result.range.month, '2026-11');
  }
});

test('rangos, meses vecinos y opciones del filtro', () => {
  assert.deepEqual(monthRange('2028-02'), {
    month: '2028-02',
    from: '2028-02-01',
    to: '2028-02-29',
  });
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
  assert.equal(shiftMonth('2026-12', 1), '2027-01');
  const options = monthOptions('2026-11-10', '2026-11');
  assert.equal(options.length, MONTH_OPTION_COUNT);
  assert.equal(options[0], '2026-11');
  assert.equal(options[1], '2026-10');
  assert.equal(monthOptions('2026-11-10', '2020-01').at(-1), '2020-01');
  assert.equal(
    myTipsBackendPath(monthRange('2026-11')),
    '/my-tips?from=2026-11-01&to=2026-11-30',
  );
});

test('textos de fecha y errores sin mensajes del backend', () => {
  assert.equal(formatMonth('2026-11'), 'Noviembre de 2026');
  assert.equal(weekdayOf('2026-11-09'), 'lunes');
  assert.match(myTipsError(401), /sesión venció/);
  assert.match(myTipsError(403), /permiso/);
  assert.match(myTipsError(500), /No se pudieron consultar/);
});
