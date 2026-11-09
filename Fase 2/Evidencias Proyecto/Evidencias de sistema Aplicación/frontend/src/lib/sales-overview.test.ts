import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  addDays,
  calendarError,
  calendarFormError,
  closureFormError,
  formatAmount,
  formatSignedAmount,
  importDetailHref,
  methodAmount,
  missingSalesDays,
  operationDetailHref,
  parseCalendarInput,
  parseClosureInput,
  parseDashboardDate,
  parseOperatingCalendar,
  parseReportFilters,
  parseSalesDashboard,
  parseSalesDays,
  parseSalesReport,
  reportQuery,
  salesDayPresentation,
  salesOverviewError,
  weekdaysSummary,
  type SalesDayItem,
} from './sales-overview';
import { formatClp } from './tips';

// SPRINT-4R-T14: contratos y reglas de presentación del panel, los reportes y
// el calendario de ventas del administrador.
const STORE = {
  id: '1010021e-9bab-42d5-851c-417e9e2503bf',
  name: 'Santa María',
  city: 'Melipilla',
  isActive: true,
};
const OTHER = {
  id: '2020021e-9bab-42d5-851c-417e9e2503bf',
  name: 'Calera',
  city: 'La Calera',
  isActive: true,
};
const IMPORT_ID = '7c1e2d3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f';
const OPERATION_ID = '3f2e1d0c-9b8a-4765-8432-10fedcba9876';
const CLOSURE_ID = '5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d';
const METHODS = [
  { paymentMethod: 'CASH', paymentMethodName: 'Efectivo', isActive: true },
  { paymentMethod: 'OLD', paymentMethodName: 'Cheque', isActive: false },
];
const SALES = {
  importId: IMPORT_ID,
  version: 2,
  confirmedAt: '2026-11-07T13:05:00.000Z',
  totalAmount: 675530,
  byPaymentMethod: [
    { ...METHODS[0], amount: 675530 },
    { ...METHODS[1], amount: 0 },
  ],
};
const OPERATION = {
  operationId: OPERATION_ID,
  cardTipAmount: 12000,
  cashTipAmount: 8000,
  tipFundAmount: 20000,
  cashDifference: { amount: -2500, type: 'FALTANTE', reason: 'Vuelto' },
};
const STATUS = {
  status: 'IMPORTADO',
  activeImportId: IMPORT_ID,
  pendingImportId: null,
  closure: null,
};
const CLOSED = {
  status: 'CERRADO',
  activeImportId: null,
  pendingImportId: null,
  closure: { id: CLOSURE_ID, reason: 'Feriado' },
};
const SUMMARY = { IMPORTADO: 1, PENDIENTE: 0, ATRASADO: 0, CERRADO: 1 };
const TIPS = {
  operationsCount: 1,
  cardTipAmount: 12000,
  cashTipAmount: 8000,
  tipFundAmount: 20000,
};
const DIFFERENCES = {
  count: 1,
  surplusCount: 0,
  shortageCount: 1,
  surplusAmount: 0,
  shortageAmount: -2500,
};
const LINE = {
  store: { id: STORE.id, name: STORE.name },
  businessDate: '2026-11-07',
  operationId: OPERATION_ID,
  amount: -2500,
  type: 'FALTANTE',
  reason: 'Vuelto',
};
const ALERTS = { overdue: 1, upcoming: 2 };
function dashboard(overrides: Record<string, unknown> = {}): unknown {
  return {
    businessDate: '2026-11-07',
    today: '2026-11-08',
    alertsAsOf: '2026-11-08',
    timeZone: 'America/Santiago',
    calculatedAt: '2026-11-08T12:00:00.000Z',
    paymentMethods: METHODS,
    stores: [
      {
        store: STORE,
        importStatus: STATUS,
        sales: SALES,
        dailyOperation: OPERATION,
        alerts: { dtRegistration: ALERTS, tipPayment: ALERTS },
      },
      {
        store: OTHER,
        importStatus: CLOSED,
        sales: null,
        dailyOperation: null,
        alerts: { dtRegistration: ALERTS, tipPayment: ALERTS },
      },
    ],
    cashDifferences: [LINE],
    totals: {
      sales: {
        importedDays: 1,
        totalAmount: 675530,
        byPaymentMethod: SALES.byPaymentMethod,
      },
      storesWithoutImport: 0,
      tips: TIPS,
      storesWithoutDailyOperation: 0,
      cashDifferences: DIFFERENCES,
      importStatus: SUMMARY,
      dtRegistrationAlerts: ALERTS,
      tipPaymentAlerts: ALERTS,
    },
    ...overrides,
  };
}
function report(overrides: Record<string, unknown> = {}): unknown {
  return {
    from: '2026-11-01',
    to: '2026-11-07',
    today: '2026-11-08',
    timeZone: 'America/Santiago',
    storeId: null,
    calculatedAt: '2026-11-08T12:00:00.000Z',
    paymentMethods: METHODS,
    stores: [
      {
        store: STORE,
        sales: {
          importedDays: 1,
          totalAmount: 675530,
          byPaymentMethod: SALES.byPaymentMethod,
        },
        tips: TIPS,
        cashDifferences: DIFFERENCES,
        importStatus: SUMMARY,
        days: [
          {
            businessDate: '2026-11-06',
            importStatus: CLOSED,
            sales: null,
            dailyOperation: null,
          },
          {
            businessDate: '2026-11-07',
            importStatus: STATUS,
            sales: SALES,
            dailyOperation: OPERATION,
          },
        ],
      },
    ],
    cashDifferences: [LINE],
    totals: {
      sales: {
        importedDays: 1,
        totalAmount: 675530,
        byPaymentMethod: SALES.byPaymentMethod,
      },
      tips: TIPS,
      cashDifferences: DIFFERENCES,
      importStatus: SUMMARY,
    },
    ...overrides,
  };
}

test('El panel conserva null como ausencia de datos y las alertas vigentes', () => {
  const parsed = parseSalesDashboard(dashboard());
  assert.ok(parsed);
  assert.equal(parsed.alertsAsOf, '2026-11-08');
  assert.equal(parsed.stores[1].sales, null);
  assert.equal(parsed.stores[1].dailyOperation, null);
  assert.equal(parsed.stores[1].importStatus.closure?.reason, 'Feriado');
  assert.equal(parsed.stores[0].dailyOperation?.cashDifference.amount, -2500);
  assert.deepEqual(
    parsed.paymentMethods.map((method) => method.paymentMethod),
    ['CASH', 'OLD'],
  );
});

test('El panel rechaza contratos antiguos o inconsistentes', () => {
  // Contrato previo a SPRINT-4R-T13: sin alertsAsOf ni importStatus.
  assert.equal(parseSalesDashboard(dashboard({ alertsAsOf: undefined })), null);
  // Una venta ausente nunca puede llegar como cero.
  const zeroSales = dashboard() as { stores: Record<string, unknown>[] };
  zeroSales.stores[1].sales = 0;
  assert.equal(parseSalesDashboard(zeroSales), null);
  // El tipo de diferencia debe coincidir con el signo.
  const wrongSign = dashboard({
    cashDifferences: [{ ...LINE, type: 'SOBRANTE' }],
  });
  assert.equal(parseSalesDashboard(wrongSign), null);
  // Los faltantes se totalizan con signo negativo, sin compensar.
  const netted = dashboard() as { totals: Record<string, unknown> };
  netted.totals.cashDifferences = { ...DIFFERENCES, shortageAmount: 2500 };
  assert.equal(parseSalesDashboard(netted), null);
  assert.equal(parseSalesDashboard(null), null);
});

test('El reporte valida días, medios dinámicos y estados', () => {
  const parsed = parseSalesReport(report());
  assert.ok(parsed);
  assert.equal(parsed.stores[0].days.length, 2);
  assert.equal(parsed.stores[0].days[0].sales, null);
  assert.equal(parsed.stores[0].days[0].importStatus.status, 'CERRADO');
  assert.equal(parseSalesReport(report({ storeId: 'local' })), null);
  const badStatus = report() as {
    stores: { days: { importStatus: Record<string, unknown> }[] }[];
  };
  badStatus.stores[0].days[0].importStatus.status = 'FALTANTE';
  assert.equal(parseSalesReport(badStatus), null);
});

test('El estado diario de ventas y el calendario se proyectan al contrato', () => {
  const days = parseSalesDays({
    today: '2026-11-08',
    from: '2026-10-09',
    to: '2026-11-08',
    summary: SUMMARY,
    items: [
      {
        store: { id: STORE.id, name: STORE.name },
        businessDate: '2026-11-07',
        status: 'ATRASADO',
        activeImportId: null,
        pendingImportId: null,
        closure: null,
      },
    ],
  });
  assert.equal(days?.items[0].status, 'ATRASADO');
  assert.equal(
    parseSalesDays({ today: '2026-11-08', from: 'x', to: '2026-11-08' }),
    null,
  );
  const calendar = parseOperatingCalendar({
    store: { id: STORE.id, name: STORE.name },
    configured: true,
    weekdays: [6, 1, 2],
    trackingStartDate: '2026-11-01',
    updatedAt: '2026-11-08T14:00:00.000Z',
    updatedBy: { id: OTHER.id, name: 'Administrador' },
    closures: [
      {
        id: CLOSURE_ID,
        date: '2026-12-25',
        reason: 'Navidad',
        createdAt: '2026-11-08T14:00:00.000Z',
        createdBy: { id: OTHER.id, name: 'Administrador' },
      },
    ],
  });
  assert.deepEqual(calendar?.weekdays, [1, 2, 6]);
  assert.equal(calendar?.closures[0].reason, 'Navidad');
  const unconfigured = parseOperatingCalendar({
    store: { id: STORE.id, name: STORE.name },
    configured: false,
    weekdays: [],
    trackingStartDate: null,
    updatedAt: null,
    updatedBy: null,
    closures: [],
  });
  assert.equal(unconfigured?.configured, false);
  assert.equal(
    parseOperatingCalendar({ ...unconfigured, weekdays: [0] }),
    null,
  );
});

test('El BFF solo acepta el cuerpo acotado del calendario y del cierre', () => {
  assert.deepEqual(
    parseCalendarInput({ weekdays: [5, 1], trackingStartDate: '2026-11-01' }),
    { weekdays: [1, 5], trackingStartDate: '2026-11-01' },
  );
  for (const invalid of [
    { weekdays: [], trackingStartDate: '2026-11-01' },
    { weekdays: [1, 1], trackingStartDate: '2026-11-01' },
    { weekdays: [8], trackingStartDate: '2026-11-01' },
    { weekdays: [1.5], trackingStartDate: '2026-11-01' },
    { weekdays: [1], trackingStartDate: '2026-02-30' },
    { weekdays: [1], trackingStartDate: '2026-11-01', storeId: STORE.id },
  ])
    assert.equal(parseCalendarInput(invalid), null);
  assert.deepEqual(
    parseClosureInput({ date: '2026-12-25', reason: '  Navidad  ' }),
    { date: '2026-12-25', reason: 'Navidad' },
  );
  for (const invalid of [
    { date: '2026-12-25', reason: '   ' },
    { date: '2026-12-25', reason: 'x'.repeat(301) },
    { date: '25-12-2026', reason: 'Navidad' },
    { date: '2026-12-25', reason: 'Navidad', extra: true },
  ])
    assert.equal(parseClosureInput(invalid), null);
  assert.equal(closureFormError('', 'Navidad'), 'Indica la fecha del cierre.');
  assert.equal(
    closureFormError('2026-12-25', ' '),
    'Indica el motivo del cierre.',
  );
  assert.equal(closureFormError('2026-12-25', 'Navidad'), null);
  assert.match(calendarFormError([], '2026-11-01') ?? '', /al menos un día/);
  assert.equal(calendarFormError([1], '2026-11-01'), null);
});

test('El día del panel es hoy por defecto y nunca futuro ni inválido', () => {
  assert.deepEqual(parseDashboardDate(undefined, '2026-11-08'), {
    ok: true,
    date: '2026-11-08',
  });
  assert.deepEqual(parseDashboardDate(['2026-11-01'], '2026-11-08'), {
    ok: true,
    date: '2026-11-01',
  });
  const future = parseDashboardDate('2026-11-09', '2026-11-08');
  assert.equal(future.ok, false);
  assert.match(future.ok ? '' : future.message, /días futuros.*08-11-2026/);
  const invalid = parseDashboardDate('2026-13-01', '2026-11-08');
  assert.equal(invalid.ok, false);
  assert.equal(invalid.ok ? '' : invalid.value, '2026-13-01');
});

test('Los filtros del reporte replican las validaciones del backend', () => {
  const today = '2026-11-08';
  assert.deepEqual(parseReportFilters({}, today), {
    ok: true,
    filters: { from: '2026-11-02', to: today, storeId: '' },
  });
  const messages = [
    [{ from: '2026-11-01' }, /fecha de inicio y la de término/],
    [{ from: '2026-11-31', to: today }, /no es válida/],
    [{ from: '2026-11-05', to: '2026-11-01' }, /posterior a la de término/],
    [{ from: '2026-11-01', to: '2026-11-09' }, /días futuros/],
    [{ from: '2025-11-07', to: today }, /366 días/],
    [{ from: '2026-11-01', to: today, storeId: 'santa' }, /local válido/],
  ] as const;
  for (const [params, message] of messages) {
    const result = parseReportFilters(params, today);
    assert.equal(result.ok, false);
    assert.match(result.ok ? '' : result.message, message);
  }
  // 366 días exactos siguen siendo válidos.
  const longest = parseReportFilters({ from: '2025-11-08', to: today }, today);
  assert.equal(longest.ok, true);
  const scoped = parseReportFilters(
    { from: '2026-11-01', to: today, storeId: STORE.id },
    today,
  );
  assert.ok(scoped.ok);
  assert.equal(
    reportQuery(scoped.filters),
    `from=2026-11-01&to=2026-11-08&storeId=${STORE.id}`,
  );
});

test('Un dato ausente se muestra «Sin dato», nunca $0', () => {
  assert.equal(formatAmount(null), 'Sin dato');
  assert.equal(formatAmount(undefined), 'Sin dato');
  assert.equal(formatAmount(0), formatClp(0));
  assert.equal(formatSignedAmount(-2500), '-' + formatClp(2500));
  assert.equal(formatSignedAmount(1500), '+' + formatClp(1500));
  assert.equal(methodAmount(null, 'CASH'), null);
  assert.equal(
    methodAmount(
      { byPaymentMethod: [{ paymentMethod: 'CASH', amount: 9 }] },
      'CASH',
    ),
    9,
  );
  // Con Excel vigente, un medio que no figura vale cero (la venta existe).
  assert.equal(methodAmount({ byPaymentMethod: [] }, 'CASH'), 0);
});

test('PENDIENTE y ATRASADO se distinguen y CERRADO no es faltante', () => {
  const pending = salesDayPresentation('PENDIENTE');
  const late = salesDayPresentation('ATRASADO');
  assert.notEqual(pending.tone, late.tone);
  assert.notEqual(pending.label, late.label);
  assert.equal(late.tone, 'crit');
  assert.equal(salesDayPresentation(null).label, 'Sin seguimiento');
  const item = (
    businessDate: string,
    status: SalesDayItem['status'],
    name = 'B',
  ): SalesDayItem => ({
    store: { id: STORE.id, name },
    businessDate,
    status,
    activeImportId: null,
    pendingImportId: null,
    closure: null,
  });
  const missing = missingSalesDays([
    item('2026-11-08', 'PENDIENTE'),
    item('2026-11-06', 'ATRASADO'),
    item('2026-11-07', 'CERRADO'),
    item('2026-11-07', 'ATRASADO', 'A'),
    item('2026-11-05', 'IMPORTADO'),
  ]);
  assert.deepEqual(
    missing.map((day) => `${day.businessDate}:${day.status}`),
    ['2026-11-07:ATRASADO', '2026-11-06:ATRASADO', '2026-11-08:PENDIENTE'],
  );
});

test('Fechas, días de la semana, enlaces y mensajes', () => {
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(addDays('2024-03-01', -1), '2024-02-29');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(weekdaysSummary([1, 2, 3, 4, 5, 6, 7]), 'Todos los días');
  assert.equal(weekdaysSummary([1, 3, 6]), 'Lunes, miércoles y sábado');
  assert.equal(weekdaysSummary([7]), 'Domingo');
  assert.equal(
    importDetailHref(IMPORT_ID),
    `/admin/importacion-ventas?importacion=${IMPORT_ID}#sales-detail-title`,
  );
  assert.equal(
    operationDetailHref(OPERATION_ID),
    `/admin/panel-ventas/operaciones/${OPERATION_ID}`,
  );
  assert.equal(salesOverviewError(500), salesOverviewError(502));
  assert.match(salesOverviewError(403), /administrador/);
  assert.match(calendarError(409), /Ya existe un cierre/);
  assert.equal(calendarError(418), calendarError(502));
});
