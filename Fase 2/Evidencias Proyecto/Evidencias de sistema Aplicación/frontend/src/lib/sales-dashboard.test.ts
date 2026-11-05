import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  chileToday,
  hasTipMismatch,
  isCompensatedDifference,
  parseSalesDashboard,
  storeBalance,
  storeBalanceLabel,
  type SalesDashboard,
  type StoreDashboard,
} from './sales-dashboard';
import {
  formatSignedClp,
  hasCompensatedLines,
  isClosingBalanced,
  parseCashClosing,
  paymentMethodLabel,
} from './cash-closings';
import {
  SalesDashboardError,
  loadCashClosing,
  loadSalesDashboard,
} from './sales-dashboard-client';

const closingId = 'c1000000-0000-4000-8000-000000000001';
const melipilla: StoreDashboard = {
  store: {
    id: '1010021e-9bab-42d5-851c-417e9e2503bf',
    name: 'Local de prueba Centro',
    city: 'Melipilla',
    isActive: true,
  },
  sales: {
    salesCount: 96,
    netAmount: 675530,
    closedSalesCount: 90,
    closedNetAmount: 655530,
    unclosedSalesCount: 6,
    unclosedNetAmount: 20000,
    byPaymentMethod: [
      { paymentMethod: 'CASH', salesCount: 40, netAmount: 120000 },
      { paymentMethod: 'DEBIT_CARD', salesCount: 42, netAmount: 511730 },
      { paymentMethod: 'CREDIT_CARD', salesCount: 14, netAmount: 43800 },
      { paymentMethod: 'TRANSFER', salesCount: 0, netAmount: 0 },
    ],
  },
  cardTips: { registeredAmount: 31602, closingsAmount: 31602 },
  closings: {
    count: 1,
    shifts: [1],
    netSalesAmount: 655530,
    countedAmount: 704530,
    cashDifference: -1000,
    voucherDifference: 1600,
    mrcomandaNetSales: 555530,
    mercadoPagoNetSales: 557130,
  },
  pendingDifferences: [
    {
      closingId,
      shift: 1,
      status: 'CLOSED',
      cashDifference: -1000,
      voucherDifference: 1600,
      differenceReason: 'Faltante de efectivo',
      closedAt: '2026-03-10T19:00:00.000Z',
    },
  ],
  alerts: {
    dtRegistration: { overdue: 1, upcoming: 2 },
    tipPayment: { overdue: 0, upcoming: 1 },
  },
};
const dashboard: SalesDashboard = {
  businessDate: '2026-03-10',
  timeZone: 'America/Santiago',
  periodStart: '2026-03-10T03:00:00.000Z',
  periodEnd: '2026-03-11T03:00:00.000Z',
  calculatedAt: '2026-03-10T23:15:00.000Z',
  stores: [melipilla],
  totals: {
    salesCount: 96,
    netAmount: 675530,
    closedNetAmount: 655530,
    unclosedNetAmount: 20000,
    cardTipsRegisteredAmount: 31602,
    cardTipsClosingsAmount: 31602,
    closingsCount: 1,
    cashDifference: -1000,
    voucherDifference: 1600,
    pendingDifferencesCount: 1,
    dtRegistrationAlerts: { overdue: 1, upcoming: 2 },
    tipPaymentAlerts: { overdue: 0, upcoming: 1 },
  },
};
const closing = {
  id: closingId,
  store: { id: melipilla.store.id, name: melipilla.store.name },
  businessDate: '2026-03-10',
  shift: 1,
  openingCash: 50000,
  status: 'CLOSED',
  notes: null,
  differenceReason: 'Compensación entre medios',
  responsible: { id: 'a0000000-0000-4000-8000-000000000001', name: 'Rosa' },
  closedBy: { id: 'a0000000-0000-4000-8000-000000000001', name: 'Rosa' },
  closedAt: '2026-03-10T19:00:00.000Z',
  lines: [
    {
      id: 'b0000000-0000-4000-8000-000000000001',
      paymentMethod: 'CASH',
      expectedAmount: 170000,
      countedAmount: 169500,
      difference: -500,
    },
    {
      id: 'b0000000-0000-4000-8000-000000000002',
      paymentMethod: 'DEBIT_CARD',
      expectedAmount: 511730,
      countedAmount: 512230,
      difference: 500,
    },
  ],
  totalExpectedAmount: 681730,
  totalCountedAmount: 681730,
  totalDifference: 0,
  vouchers: [
    {
      id: 'd0000000-0000-4000-8000-000000000001',
      source: 'MERCADO_PAGO',
      periodStart: '2026-03-10T12:00:00.000Z',
      periodEnd: '2026-03-10T19:00:00.000Z',
      amount: 588732,
      tipIncludedAmount: 31602,
      reference: null,
    },
  ],
  mrcomandaNetSales: 555530,
  mercadoPagoGrossAmount: 588732,
  mercadoPagoTipAmount: 31602,
  mercadoPagoNetSales: 557130,
  reconciliationDifference: 0,
  tipEntries: [],
  tipFundAmount: 31602,
  salesCount: 90,
  createdAt: '2026-03-10T19:00:00.000Z',
  updatedAt: '2026-03-10T19:00:00.000Z',
};

test('Acepta el contrato de Swagger de T13 y descarta campos ajenos', () => {
  assert.deepEqual(
    parseSalesDashboard({
      ...dashboard,
      secret: 'ignored',
      stores: [{ ...melipilla, extra: true }],
    }),
    dashboard,
  );
});

test('Rechaza montos inválidos, locales duplicados y conteos inconsistentes', () => {
  const broken: unknown[] = [
    { ...dashboard, businessDate: '2026-02-30' },
    { ...dashboard, stores: [melipilla, melipilla] },
    {
      ...dashboard,
      stores: [{ ...melipilla, sales: { ...melipilla.sales, netAmount: -1 } }],
    },
    {
      ...dashboard,
      stores: [{ ...melipilla, sales: { ...melipilla.sales, netAmount: 1.5 } }],
    },
    {
      ...dashboard,
      stores: [
        { ...melipilla, closings: { ...melipilla.closings, shifts: [] } },
      ],
    },
    { ...dashboard, totals: { ...dashboard.totals, netAmount: '1' } },
    {
      ...dashboard,
      stores: [
        {
          ...melipilla,
          sales: {
            ...melipilla.sales,
            byPaymentMethod: [
              melipilla.sales.byPaymentMethod[0],
              melipilla.sales.byPaymentMethod[0],
            ],
          },
        },
      ],
    },
  ];
  for (const value of broken) assert.equal(parseSalesDashboard(value), null);
});

test('Los descuadres pueden ser negativos y los medios nuevos de T32 se aceptan', () => {
  const parsed = parseSalesDashboard({
    ...dashboard,
    stores: [
      {
        ...melipilla,
        sales: {
          ...melipilla.sales,
          byPaymentMethod: [
            { paymentMethod: 'JUNAEB', salesCount: 2, netAmount: 9000 },
          ],
        },
      },
    ],
  });
  assert.equal(
    parsed?.stores[0].sales.byPaymentMethod[0].paymentMethod,
    'JUNAEB',
  );
  assert.equal(paymentMethodLabel('JUNAEB'), 'JUNAEB');
  assert.equal(paymentMethodLabel('DEBIT_CARD'), 'Tarjeta de débito');
});

test('El estado del local distingue sin cierres, cuadrado y no cuadrado', () => {
  assert.equal(storeBalance(melipilla), 'UNBALANCED');
  assert.equal(storeBalanceLabel('UNBALANCED'), 'No cuadrado');
  const balanced = { ...melipilla, pendingDifferences: [] };
  assert.equal(storeBalance(balanced), 'BALANCED');
  assert.equal(
    storeBalance({
      ...balanced,
      closings: { ...melipilla.closings, count: 0, shifts: [] },
    }),
    'NO_CLOSINGS',
  );
});

test('Un cierre compensado (−500 / +500) nunca figura como cuadrado', () => {
  const pending = {
    ...melipilla.pendingDifferences[0],
    cashDifference: 0,
    voucherDifference: 0,
  };
  assert.equal(isCompensatedDifference(pending), true);
  assert.equal(
    storeBalance({ ...melipilla, pendingDifferences: [pending] }),
    'UNBALANCED',
  );
  const parsed = parseCashClosing(closing);
  assert.ok(parsed);
  assert.equal(parsed.totalDifference, 0);
  assert.equal(isClosingBalanced(parsed), false);
  assert.equal(hasCompensatedLines(parsed), true);
  assert.equal(
    isClosingBalanced({
      lines: parsed.lines.map((line) => ({ ...line, difference: 0 })),
      reconciliationDifference: 1600,
    }),
    false,
  );
});

test('Advierte cuando la propina registrada no coincide con los vouchers', () => {
  assert.equal(hasTipMismatch(melipilla), false);
  assert.equal(
    hasTipMismatch({
      ...melipilla,
      cardTips: { registeredAmount: 31602, closingsAmount: 33202 },
    }),
    true,
  );
});

test('El detalle del cierre rechaza diferencias que no cuadran con sus montos', () => {
  assert.equal(
    parseCashClosing({
      ...closing,
      lines: [{ ...closing.lines[0], difference: 0 }],
    }),
    null,
  );
  assert.equal(parseCashClosing({ ...closing, status: 'DRAFT' }), null);
});

test('Formatea diferencias con signo y calcula el día en hora de Chile', () => {
  assert.equal(formatSignedClp(0), '$0');
  assert.match(formatSignedClp(1600), /^\+\$1\.600$/);
  assert.match(formatSignedClp(-500), /^−\$500$/);
  assert.equal(chileToday(new Date('2026-03-11T02:30:00Z')), '2026-03-10');
  assert.equal(chileToday(new Date('2026-03-11T03:30:00Z')), '2026-03-11');
});

function respond(status: number, body: unknown): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })) as typeof fetch;
}

test('El cliente consulta solo la ruta interna y valida el día respondido', async () => {
  let requested = '';
  const fetcher = (async (input: RequestInfo | URL) => {
    requested = String(input);
    return new Response(JSON.stringify(dashboard));
  }) as typeof fetch;
  assert.deepEqual(
    await loadSalesDashboard('2026-03-10', undefined, fetcher),
    dashboard,
  );
  assert.equal(requested, '/api/sales-dashboard?date=2026-03-10');
  await assert.rejects(
    loadSalesDashboard('2026-03-11', undefined, respond(200, dashboard)),
    (error: unknown) =>
      error instanceof SalesDashboardError && error.status === 502,
  );
  await assert.rejects(
    loadSalesDashboard('10-03-2026', undefined, respond(200, dashboard)),
    (error: unknown) =>
      error instanceof SalesDashboardError && error.status === 400,
  );
});

test('El cliente traduce errores sin exponer mensajes del servidor', async () => {
  await assert.rejects(
    loadSalesDashboard(
      '2026-03-10',
      undefined,
      respond(403, { message: 'private-error' }),
    ),
    (error: unknown) =>
      error instanceof SalesDashboardError &&
      error.status === 403 &&
      !error.message.includes('private'),
  );
  await assert.rejects(
    loadSalesDashboard('2026-03-10', undefined, (async () => {
      throw new TypeError('network');
    }) as typeof fetch),
    (error: unknown) =>
      error instanceof SalesDashboardError && error.status === 503,
  );
  await assert.rejects(
    loadCashClosing(closingId, undefined, respond(404, {})),
    (error: unknown) =>
      error instanceof SalesDashboardError && error.status === 404,
  );
  assert.equal(
    (await loadCashClosing(closingId, undefined, respond(200, closing))).id,
    closingId,
  );
});
