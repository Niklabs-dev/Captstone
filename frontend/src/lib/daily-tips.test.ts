import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  allocationStatusPresentation,
  dailyTipsError,
  dayStatusPresentation,
  exportFileName,
  parseDayQuery,
  parsePaymentBatch,
  parsePaymentBatches,
  parseRange,
  parseRangeQuery,
  parseSummaryQuery,
  parseTipDayDetail,
  parseTipDays,
  parseTipSummary,
  parseTipsFilters,
  paymentPreview,
  paymentSuccessMessage,
  periodLabel,
  rangeQuery,
  tipsPageHref,
  weekOf,
  type TipSummary,
} from './daily-tips';

const store = { id: '1010021e-9bab-42d5-851c-417e9e2503bf', name: 'Centro' };
const other = '2020021e-9bab-42d5-851c-417e9e2503bf';
const worker = { id: 'b2c3d4e5-f6a7-4890-b1c2-d3e4f5a6b7c8', name: 'María' };
const second = { id: 'c3c3d4e5-f6a7-4890-b1c2-d3e4f5a6b7c8', name: 'Pedro' };
const batchId = 'd4d3d4e5-f6a7-4890-b1c2-d3e4f5a6b7c8';
const day = {
  operationId: '9b2f6c1e-0d4a-4c3b-8e5f-1a2b3c4d5e6f',
  businessDate: '2026-11-03',
  tipFundAmount: 40_000,
  participantCount: 4,
  totalAmount: 40_000,
  paidAmount: 10_000,
  unpaidAmount: 30_000,
  status: 'PARTIAL',
};
const days = {
  store,
  from: '2026-11-02',
  to: '2026-11-08',
  days: [day],
  totals: {
    totalAmount: 40_000,
    paidAmount: 10_000,
    unpaidAmount: 30_000,
    dayCount: 1,
  },
};
const summary = {
  store,
  from: '2026-11-02',
  to: '2026-11-08',
  status: null,
  workers: [
    {
      worker,
      dayCount: 1,
      totalAmount: 10_000,
      paidAmount: 10_000,
      unpaidAmount: 0,
    },
    {
      worker: second,
      dayCount: 1,
      totalAmount: 30_000,
      paidAmount: 0,
      unpaidAmount: 30_000,
    },
  ],
  totals: {
    totalAmount: 40_000,
    paidAmount: 10_000,
    unpaidAmount: 30_000,
    workerCount: 2,
    dayCount: 1,
  },
};
const batch = {
  id: batchId,
  store,
  periodStart: '2026-11-02',
  periodEnd: '2026-11-08',
  totalAmount: 30_000,
  allocationCount: 3,
  workerCount: 1,
  paidBy: { id: worker.id, name: 'Contadora' },
  paidAt: '2026-11-10T15:00:00.000Z',
};

test('Los días del período respetan el contrato y cuadran sus montos', () => {
  assert.deepEqual(parseTipDays(days), days);
  assert.equal(
    parseTipDays({ ...days, days: [{ ...day, paidAmount: 0 }] }),
    null,
    'total distinto de pagado + pendiente',
  );
  assert.equal(
    parseTipDays({ ...days, days: [{ ...day, status: 'DRAFT' }] }),
    null,
  );
  assert.equal(parseTipDays({ ...days, from: '2026-11-09' }), null);
  assert.equal(parseTipDays({ ...days, store: { id: 'x', name: 'A' } }), null);
  assert.equal(
    parseTipDays({ ...days, days: [{ ...day, totalAmount: 1.5 }] }),
    null,
  );
  assert.equal(parseTipDays(null), null);
});

test('El detalle del día exige lote y fecha solo en las propinas pagadas', () => {
  const paid = {
    id: 'e5e3d4e5-f6a7-4890-b1c2-d3e4f5a6b7c8',
    worker,
    amount: 10_000,
    status: 'PAID',
    paymentBatchId: batchId,
    paidAt: '2026-11-10T15:00:00.000Z',
  };
  const unpaid = {
    ...paid,
    id: 'f6e3d4e5-f6a7-4890-b1c2-d3e4f5a6b7c8',
    worker: second,
    status: 'UNPAID',
    paymentBatchId: null,
    paidAt: null,
  };
  const detail = { ...day, store, allocations: [paid, unpaid] };
  assert.deepEqual(parseTipDayDetail(detail), detail);
  assert.equal(
    parseTipDayDetail({
      ...detail,
      allocations: [{ ...paid, paymentBatchId: null }],
    }),
    null,
  );
  assert.equal(
    parseTipDayDetail({ ...detail, allocations: [{ ...unpaid, paidAt: '' }] }),
    null,
  );
  assert.equal(parseTipDayDetail({ ...detail, allocations: null }), null);
});

test('El resumen por trabajador y los lotes de pago se validan completos', () => {
  assert.deepEqual(parseTipSummary(summary), summary);
  assert.deepEqual(parseTipSummary({ ...summary, status: 'UNPAID' }), {
    ...summary,
    status: 'UNPAID',
  });
  assert.equal(parseTipSummary({ ...summary, status: 'PARTIAL' }), null);
  assert.equal(
    parseTipSummary({
      ...summary,
      totals: { ...summary.totals, dayCount: -1 },
    }),
    null,
  );
  assert.deepEqual(parsePaymentBatch(batch), batch);
  assert.deepEqual(parsePaymentBatches({ batches: [batch] }), [batch]);
  assert.deepEqual(parsePaymentBatches({ batches: [] }), []);
  assert.equal(parsePaymentBatches([batch]), null);
  assert.equal(
    parsePaymentBatch({ ...batch, periodStart: '2026-11-09' }),
    null,
  );
  assert.equal(parsePaymentBatch({ ...batch, paidAt: 'ayer' }), null);
});

test('El BFF acepta solo las consultas del contrato, sin claves extra ni repetidas', () => {
  const range = { storeId: store.id, from: '2026-11-02', to: '2026-11-08' };
  assert.deepEqual(parseRangeQuery(new URLSearchParams(range)), range);
  assert.equal(rangeQuery(range), new URLSearchParams(range).toString());
  assert.equal(
    parseRangeQuery(new URLSearchParams({ ...range, extra: '1' })),
    null,
  );
  assert.equal(
    parseRangeQuery(
      new URLSearchParams(rangeQuery(range) + '&storeId=' + other),
    ),
    null,
  );
  assert.equal(
    parseRangeQuery(new URLSearchParams({ ...range, from: '2026-11-09' })),
    null,
  );
  assert.equal(
    parseRangeQuery(new URLSearchParams({ ...range, to: '2027-01-03' })),
    null,
    'más de 62 días',
  );
  assert.deepEqual(
    parseRangeQuery(new URLSearchParams({ ...range, to: '2027-01-02' })),
    { ...range, to: '2027-01-02' },
    '62 días exactos',
  );
  assert.deepEqual(
    parseSummaryQuery(new URLSearchParams({ ...range, status: 'UNPAID' })),
    { ...range, status: 'UNPAID' },
  );
  assert.deepEqual(parseSummaryQuery(new URLSearchParams(range)), {
    ...range,
    status: null,
  });
  assert.equal(
    parseSummaryQuery(new URLSearchParams({ ...range, status: 'PARTIAL' })),
    null,
  );
  assert.deepEqual(
    parseDayQuery(
      new URLSearchParams({ storeId: store.id, businessDate: '2026-11-03' }),
    ),
    { storeId: store.id, businessDate: '2026-11-03' },
  );
  assert.equal(
    parseDayQuery(
      new URLSearchParams({ storeId: store.id, businessDate: '2026-02-30' }),
    ),
    null,
  );
  assert.equal(parseRange({ ...range, extra: true }), null);
  assert.equal(parseRange({ ...range, storeId: '../stores' }), null);
});

test('La semana por defecto va de lunes a domingo, también entre años', () => {
  assert.deepEqual(weekOf('2026-11-10'), {
    from: '2026-11-09',
    to: '2026-11-15',
  });
  assert.deepEqual(weekOf('2026-11-09'), {
    from: '2026-11-09',
    to: '2026-11-15',
  });
  assert.deepEqual(weekOf('2026-11-15'), {
    from: '2026-11-09',
    to: '2026-11-15',
  });
  assert.deepEqual(weekOf('2027-01-01'), {
    from: '2026-12-28',
    to: '2027-01-03',
  });
});

test('Los filtros usan el primer local activo y la semana actual por defecto', () => {
  const stores = [
    { id: other, name: 'Cerrado', isActive: false },
    { ...store, isActive: true },
  ];
  assert.deepEqual(parseTipsFilters({}, '2026-11-10', stores), {
    ok: true,
    filters: { storeId: store.id, from: '2026-11-09', to: '2026-11-15' },
  });
  assert.deepEqual(
    parseTipsFilters(
      { storeId: [other, store.id], from: '2026-11-01', to: '2026-11-03' },
      '2026-11-10',
      stores,
    ),
    {
      ok: true,
      filters: { storeId: other, from: '2026-11-01', to: '2026-11-03' },
    },
  );
  const cases: [Record<string, string>, RegExp][] = [
    [{ from: '2026-11-01' }, /inicio y la de término/],
    [{ from: '2026-11-31', to: '2026-12-01' }, /no es válida/],
    [{ from: '2026-11-05', to: '2026-11-01' }, /posterior/],
    [{ from: '2026-01-01', to: '2026-03-31' }, /62 días/],
    [{ storeId: 'centro' }, /local válido/],
  ];
  for (const [params, message] of cases) {
    const result = parseTipsFilters(params, '2026-11-10', stores);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.message, message);
  }
  const empty = parseTipsFilters({}, '2026-11-10', []);
  assert.equal(empty.ok, false);
  assert.equal(
    tipsPageHref({ storeId: store.id, from: '2026-11-09', to: '2026-11-15' }),
    `/propinas?storeId=${store.id}&from=2026-11-09&to=2026-11-15`,
  );
});

test('Un día con fondo 0 se muestra como «Sin propinas» y no como no pagado', () => {
  assert.deepEqual(
    dayStatusPresentation({ status: 'UNPAID', totalAmount: 0 }),
    {
      label: 'Sin propinas',
      tone: 'neutral',
    },
  );
  assert.equal(
    dayStatusPresentation({ status: 'UNPAID', totalAmount: 1 }).label,
    'No pagado',
  );
  assert.equal(
    dayStatusPresentation({ status: 'PARTIAL', totalAmount: 1 }).label,
    'Parcial',
  );
  assert.equal(
    dayStatusPresentation({ status: 'PAID', totalAmount: 1 }).label,
    'Pagado',
  );
  assert.equal(allocationStatusPresentation('PAID').label, 'Pagada');
  assert.equal(allocationStatusPresentation('UNPAID').label, 'No pagada');
  assert.equal(
    periodLabel('2026-11-02', '2026-11-08'),
    '02-11-2026 al 08-11-2026',
  );
  assert.equal(periodLabel('2026-11-02', '2026-11-02'), '02-11-2026');
});

test('La confirmación de pago usa lo pendiente y cuenta solo a quienes tienen pendiente', () => {
  const parsed = parseTipSummary(summary) as TipSummary;
  assert.deepEqual(paymentPreview(parsed), {
    from: '2026-11-02',
    to: '2026-11-08',
    unpaidAmount: 30_000,
    workerCount: 1,
  });
  const settled = parseTipSummary({
    ...summary,
    workers: [summary.workers[0]],
    totals: {
      ...summary.totals,
      totalAmount: 10_000,
      unpaidAmount: 0,
      workerCount: 1,
    },
  }) as TipSummary;
  assert.equal(paymentPreview(settled), null);
  const message = paymentSuccessMessage(batch);
  assert.match(message, /30\.000/);
  assert.match(message, /1 trabajador del período 02-11-2026 al 08-11-2026/);
});

test('El nombre del Excel viene del backend solo si es seguro', () => {
  const range = { from: '2026-11-02', to: '2026-11-08' };
  assert.equal(
    exportFileName(
      'attachment; filename="propinas_centro_2026-11-02_2026-11-08.xlsx"',
      range,
    ),
    'propinas_centro_2026-11-02_2026-11-08.xlsx',
  );
  assert.equal(
    exportFileName(
      'attachment; filename="a.xlsx"; filename*=UTF-8\'\'propinas_mar%C3%ADa.xlsx',
      range,
    ),
    'propinas_maría.xlsx',
  );
  for (const header of [
    null,
    'attachment',
    'attachment; filename="../../etc/passwd.xlsx"',
    'attachment; filename="informe.exe"',
    'attachment; filename=".xlsx"',
  ])
    assert.equal(
      exportFileName(header, range),
      'propinas_2026-11-02_2026-11-08.xlsx',
    );
});

test('Los mensajes de error orientan la acción y no exponen el backend', () => {
  assert.match(dailyTipsError(409, 'pay'), /No hay propinas pendientes/);
  assert.match(dailyTipsError(404, 'day'), /operación registrada/);
  assert.match(dailyTipsError(404, 'export'), /aún no está disponible/);
  assert.match(dailyTipsError(400), /62 días/);
  assert.match(dailyTipsError(401), /sesión venció/);
  assert.equal(dailyTipsError(500), dailyTipsError(502));
});
