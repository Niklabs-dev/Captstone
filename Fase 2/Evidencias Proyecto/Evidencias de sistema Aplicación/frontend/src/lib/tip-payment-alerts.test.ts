import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  alertPeriod,
  alertPeriodIsClipped,
  groupAlertsByStore,
  overdueText,
  parseTipPaymentAlerts,
  parseTipPaymentAlertSummary,
  tipAlertHref,
  tipAlertsError,
  tipAlertSummaryText,
} from './tip-payment-alerts';

// Alerta legal de pago de propinas (SPRINT-4A-T22): contrato, agrupación por
// local, enlace a /propinas con el período vencido y textos.

const storeA = { id: '1010021e-9bab-42d5-851c-417e9e2503bf', name: 'Centro' };
const storeB = { id: '2020021e-9bab-42d5-851c-417e9e2503bf', name: 'Calera' };
const ana = { id: 'b2c3d4e5-f6a7-4890-b1c2-d3e4f5a6b7c8', name: 'Ana Pérez' };
const beto = { id: 'c3c3d4e5-f6a7-4890-b1c2-d3e4f5a6b7c8', name: 'Beto Soto' };

const anaAlert = {
  store: storeA,
  worker: ana,
  allocationCount: 2,
  amount: 8000,
  oldestBusinessDate: '2026-10-20',
  newestBusinessDate: '2026-10-28',
  deadline: '2026-10-29',
  daysOverdue: 12,
};
const betoAlert = {
  store: storeB,
  worker: beto,
  allocationCount: 1,
  amount: 5000,
  oldestBusinessDate: '2026-10-27',
  newestBusinessDate: '2026-10-27',
  deadline: '2026-11-05',
  daysOverdue: 5,
};
const carlaAlert = {
  ...betoAlert,
  store: storeA,
  worker: { ...beto, id: 'd4d4d4e5-f6a7-4890-b1c2-d3e4f5a6b7c8' },
  oldestBusinessDate: '2026-10-25',
  newestBusinessDate: '2026-10-30',
};
const totals = {
  alertCount: 2,
  allocationCount: 3,
  amount: 13000,
  oldestBusinessDate: '2026-10-20',
  newestBusinessDate: '2026-10-28',
  maxDaysOverdue: 12,
};
function response(overrides: Record<string, unknown> = {}): unknown {
  return {
    legalPaymentDays: 7,
    asOf: '2026-11-10',
    overdueThrough: '2026-10-30',
    items: [{ ...anaAlert, store: { ...storeA, private: 'x' } }, betoAlert],
    totals,
    calculatedAt: '2026-11-10T15:00:00.000Z',
    ...overrides,
  };
}

test('Proyecta las alertas, el plazo vigente y los totales', () => {
  const parsed = parseTipPaymentAlerts(response());
  assert.ok(parsed);
  assert.equal(parsed.legalPaymentDays, 7);
  assert.equal(parsed.overdueThrough, '2026-10-30');
  assert.deepEqual(parsed.items, [anaAlert, betoAlert]);
  assert.deepEqual(parsed.totals, totals);
  assert.ok(!JSON.stringify(parsed).includes('private'));
});

test('Rechaza contratos antiguos o inconsistentes', () => {
  // Contrato previo a SPRINT-4A-T22: registros tip_entries con plazo por
  // vencer y sin plazo legal ni trabajador.
  assert.equal(
    parseTipPaymentAlerts({
      items: [
        {
          id: storeA.id,
          tipEntryId: storeA.id,
          store: storeA,
          businessDate: '2026-10-20',
          amount: 1,
          deadline: '2026-10-29',
          daysRemaining: 2,
          status: 'UPCOMING',
          pool: null,
        },
      ],
      calculatedAt: '2026-11-10T15:00:00.000Z',
    }),
    null,
  );
  assert.equal(parseTipPaymentAlerts(response({ legalPaymentDays: 0 })), null);
  assert.equal(parseTipPaymentAlerts(response({ asOf: '10-11-2026' })), null);
  // Una alerta sin atraso o con fechas invertidas no es válida.
  assert.equal(
    parseTipPaymentAlerts(
      response({ items: [{ ...anaAlert, daysOverdue: 0 }, betoAlert] }),
    ),
    null,
  );
  assert.equal(
    parseTipPaymentAlerts(
      response({
        items: [{ ...anaAlert, oldestBusinessDate: '2026-10-29' }, betoAlert],
      }),
    ),
    null,
  );
  // Los totales deben contar las alertas recibidas.
  assert.equal(parseTipPaymentAlerts(response({ items: [anaAlert] })), null);
  assert.equal(parseTipPaymentAlerts(null), null);
});

test('El resumen sin alertas lleva fechas null y conteos en cero', () => {
  const empty = {
    alertCount: 0,
    allocationCount: 0,
    amount: 0,
    oldestBusinessDate: null,
    newestBusinessDate: null,
    maxDaysOverdue: 0,
  };
  assert.deepEqual(parseTipPaymentAlertSummary(empty), empty);
  assert.equal(
    parseTipPaymentAlertSummary({ ...empty, oldestBusinessDate: '2026-10-20' }),
    null,
  );
  assert.equal(
    parseTipPaymentAlertSummary({ ...totals, oldestBusinessDate: null }),
    null,
  );
  assert.equal(
    parseTipPaymentAlertSummary({ ...totals, maxDaysOverdue: 0 }),
    null,
  );
  // Las cuentas vencidas/por vencer anteriores ya no son válidas.
  assert.equal(parseTipPaymentAlertSummary({ overdue: 1, upcoming: 0 }), null);
});

test('Agrupa por local con su monto, días, período y mayor atraso', () => {
  const groups = groupAlertsByStore([anaAlert, betoAlert, carlaAlert]);
  assert.deepEqual(
    groups.map((group) => group.store.name),
    ['Centro', 'Calera'],
  );
  assert.deepEqual(groups[0].summary, {
    alertCount: 2,
    allocationCount: 3,
    amount: 13000,
    oldestBusinessDate: '2026-10-20',
    newestBusinessDate: '2026-10-30',
    maxDaysOverdue: 12,
  });
  assert.equal(groups[0].items.length, 2);
  assert.equal(groups[1].summary.amount, 5000);
});

test('Enlaza a /propinas con el local y el período vencido', () => {
  assert.equal(
    tipAlertHref(storeA.id, totals),
    `/propinas?storeId=${storeA.id}&from=2026-10-20&to=2026-10-28`,
  );
  assert.equal(
    tipAlertHref(storeA.id, {
      oldestBusinessDate: null,
      newestBusinessDate: null,
    }),
    '/propinas',
  );
  // Un período vencido mayor que el máximo de la vista se recorta desde la
  // fecha más antigua (62 días, ambos extremos incluidos).
  assert.deepEqual(alertPeriod('2026-08-01', '2026-10-30'), {
    from: '2026-08-01',
    to: '2026-10-01',
  });
  assert.equal(alertPeriodIsClipped('2026-08-01', '2026-10-30'), true);
  assert.deepEqual(alertPeriod('2026-08-01', '2026-10-01'), {
    from: '2026-08-01',
    to: '2026-10-01',
  });
  assert.equal(alertPeriodIsClipped('2026-08-01', '2026-10-01'), false);
});

test('Textos de monto, atraso y errores sin mensajes internos', () => {
  assert.equal(overdueText(1), '1 día de atraso');
  assert.equal(overdueText(12), '12 días de atraso');
  assert.equal(
    tipAlertSummaryText(totals),
    '$13.000 sin pagar · 3 propinas · hasta 12 días de atraso',
  );
  assert.equal(
    tipAlertSummaryText({
      alertCount: 0,
      allocationCount: 0,
      amount: 0,
      oldestBusinessDate: null,
      newestBusinessDate: null,
      maxDaysOverdue: 0,
    }),
    'Sin propinas vencidas',
  );
  for (const status of [401, 403, 429, 502, 503])
    assert.match(tipAlertsError(status), /\.$/);
});
