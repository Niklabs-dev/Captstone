// Backend simulado exclusivo de las pruebas del panel consolidado (SPRINT-4-T15).
// Reproduce el contrato de Swagger de T13 y de GET /cash-closings/:id con el
// caso de vouchers del sprint (descuadre de 1.600 y propina de 31.602) y un
// cierre con líneas compensadas (−500 / +500).
import { createServer } from 'node:http';

const ids = {
  admin: 'a0000000-0000-4000-8000-000000000315',
  supervisor: 'a1000000-0000-4000-8000-000000000315',
  centro: '40000000-0000-4000-8000-000000000315',
  norte: '41000000-0000-4000-8000-000000000315',
  calera: '42000000-0000-4000-8000-000000000315',
  voucherClosing: 'c1000000-0000-4000-8000-000000000315',
  compensatedClosing: 'c2000000-0000-4000-8000-000000000315',
};
const roles = {
  'test-panel-admin': 'ADMINISTRADOR',
  'test-panel-error': 'ADMINISTRADOR',
  'test-panel-supervisor': 'SUPERVISOR',
  'test-panel-accountant': 'CONTADOR',
};
const methods = (cash, debit, credit) => [
  { paymentMethod: 'CASH', salesCount: cash ? 10 : 0, netAmount: cash },
  { paymentMethod: 'DEBIT_CARD', salesCount: debit ? 20 : 0, netAmount: debit },
  {
    paymentMethod: 'CREDIT_CARD',
    salesCount: credit ? 5 : 0,
    netAmount: credit,
  },
  { paymentMethod: 'TRANSFER', salesCount: 0, netAmount: 0 },
];
const noAlerts = { overdue: 0, upcoming: 0 };
const emptyClosings = {
  count: 0,
  shifts: [],
  netSalesAmount: 0,
  countedAmount: 0,
  cashDifference: 0,
  voucherDifference: 0,
  mrcomandaNetSales: 0,
  mercadoPagoNetSales: 0,
};
const sales = (salesCount, netAmount, byPaymentMethod) => ({
  salesCount,
  netAmount,
  closedSalesCount: salesCount,
  closedNetAmount: netAmount,
  unclosedSalesCount: 0,
  unclosedNetAmount: 0,
  byPaymentMethod,
});

function dashboard(date) {
  const stores = [
    {
      store: {
        id: ids.centro,
        name: 'Local de prueba Centro',
        city: 'Melipilla',
        isActive: true,
      },
      sales: sales(35, 675530, methods(120000, 511730, 43800)),
      cardTips: { registeredAmount: 31602, closingsAmount: 31602 },
      closings: {
        ...emptyClosings,
        count: 1,
        shifts: [1],
        netSalesAmount: 675530,
        countedAmount: 675530,
        voucherDifference: 1600,
        mrcomandaNetSales: 555530,
        mercadoPagoNetSales: 557130,
      },
      pendingDifferences: [
        {
          closingId: ids.voucherClosing,
          shift: 1,
          status: 'CLOSED',
          cashDifference: 0,
          voucherDifference: 1600,
          differenceReason: 'Voucher Mercado Pago con corte distinto',
          closedAt: date + 'T22:00:00.000Z',
        },
      ],
      alerts: {
        dtRegistration: { overdue: 1, upcoming: 2 },
        tipPayment: noAlerts,
      },
    },
    {
      store: {
        id: ids.norte,
        name: 'Local de prueba Norte',
        city: 'Melipilla',
        isActive: true,
      },
      sales: sales(20, 300000, methods(100000, 150000, 50000)),
      cardTips: { registeredAmount: 12000, closingsAmount: 12000 },
      closings: {
        ...emptyClosings,
        count: 1,
        shifts: [2],
        netSalesAmount: 300000,
        countedAmount: 300000,
        mrcomandaNetSales: 200000,
        mercadoPagoNetSales: 200000,
      },
      pendingDifferences: [
        {
          closingId: ids.compensatedClosing,
          shift: 2,
          status: 'CLOSED',
          cashDifference: 0,
          voucherDifference: 0,
          differenceReason: 'Pago registrado con el medio equivocado',
          closedAt: date + 'T23:00:00.000Z',
        },
      ],
      alerts: {
        dtRegistration: noAlerts,
        tipPayment: { overdue: 0, upcoming: 1 },
      },
    },
    {
      store: {
        id: ids.calera,
        name: 'Local de prueba Calera',
        city: 'La Calera',
        isActive: true,
      },
      sales: sales(0, 0, methods(0, 0, 0)),
      cardTips: { registeredAmount: 0, closingsAmount: 0 },
      closings: emptyClosings,
      pendingDifferences: [],
      alerts: { dtRegistration: noAlerts, tipPayment: noAlerts },
    },
  ];
  return {
    businessDate: date,
    timeZone: 'America/Santiago',
    periodStart: date + 'T03:00:00.000Z',
    periodEnd: date + 'T03:00:00.000Z',
    calculatedAt: new Date().toISOString(),
    stores,
    totals: {
      salesCount: 55,
      netAmount: 975530,
      closedNetAmount: 975530,
      unclosedNetAmount: 0,
      cardTipsRegisteredAmount: 43602,
      cardTipsClosingsAmount: 43602,
      closingsCount: 2,
      cashDifference: 0,
      voucherDifference: 1600,
      pendingDifferencesCount: 2,
      dtRegistrationAlerts: { overdue: 1, upcoming: 2 },
      tipPaymentAlerts: { overdue: 0, upcoming: 1 },
    },
  };
}

function line(n, paymentMethod, expectedAmount, countedAmount) {
  return {
    id: 'b' + n + '000000-0000-4000-8000-000000000315',
    paymentMethod,
    expectedAmount,
    countedAmount,
    difference: countedAmount - expectedAmount,
  };
}

function closing(id) {
  const person = { id: ids.supervisor, name: 'Rosa Supervisora' };
  const base = {
    id,
    businessDate: '2026-11-04',
    openingCash: 50000,
    status: 'CLOSED',
    notes: null,
    responsible: person,
    closedBy: person,
    closedAt: '2026-11-04T22:00:00.000Z',
    vouchers: [],
    tipEntries: [],
    createdAt: '2026-11-04T22:00:00.000Z',
    updatedAt: '2026-11-04T22:00:00.000Z',
  };
  if (id === ids.voucherClosing)
    return {
      ...base,
      store: { id: ids.centro, name: 'Local de prueba Centro' },
      shift: 1,
      differenceReason: 'Voucher Mercado Pago con corte distinto',
      lines: [
        line(1, 'CASH', 170000, 170000),
        line(2, 'DEBIT_CARD', 511730, 511730),
        line(3, 'CREDIT_CARD', 43800, 43800),
      ],
      totalExpectedAmount: 725530,
      totalCountedAmount: 725530,
      totalDifference: 0,
      vouchers: [
        {
          id: 'd1000000-0000-4000-8000-000000000315',
          source: 'MRCOMANDA',
          periodStart: '2026-11-04T12:00:00.000Z',
          periodEnd: '2026-11-04T22:00:00.000Z',
          amount: 555530,
          tipIncludedAmount: 0,
          reference: 'Z-1024',
        },
        {
          id: 'd2000000-0000-4000-8000-000000000315',
          source: 'MERCADO_PAGO',
          periodStart: '2026-11-04T12:00:00.000Z',
          periodEnd: '2026-11-04T22:00:00.000Z',
          amount: 588732,
          tipIncludedAmount: 31602,
          reference: null,
        },
      ],
      mrcomandaNetSales: 555530,
      mercadoPagoGrossAmount: 588732,
      mercadoPagoTipAmount: 31602,
      mercadoPagoNetSales: 557130,
      reconciliationDifference: 1600,
      tipFundAmount: 31602,
      salesCount: 35,
    };
  if (id === ids.compensatedClosing)
    return {
      ...base,
      store: { id: ids.norte, name: 'Local de prueba Norte' },
      shift: 2,
      differenceReason: 'Pago registrado con el medio equivocado',
      lines: [
        line(4, 'CASH', 150000, 149500),
        line(5, 'DEBIT_CARD', 150000, 150500),
      ],
      totalExpectedAmount: 300000,
      totalCountedAmount: 300000,
      totalDifference: 0,
      mrcomandaNetSales: 200000,
      mercadoPagoGrossAmount: 212000,
      mercadoPagoTipAmount: 12000,
      mercadoPagoNetSales: 200000,
      reconciliationDifference: 0,
      tipFundAmount: 12000,
      salesCount: 20,
    };
  return null;
}

function send(response, status, body) {
  response.writeHead(status);
  response.end(JSON.stringify(body));
}

createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  response.setHeader('Content-Type', 'application/json');
  response.setHeader('Cache-Control', 'no-store');
  const token = (request.headers.authorization ?? '').replace('Bearer ', '');
  const role = roles[token];
  if (!role) return send(response, 401, {});
  const userId = role === 'ADMINISTRADOR' ? ids.admin : ids.supervisor;
  if (url.pathname === '/auth/me')
    return send(response, 200, {
      id: userId,
      email: 'panel@example.test',
      role,
      storeId: role === 'SUPERVISOR' ? ids.centro : null,
    });
  if (url.pathname === '/users') {
    if (role !== 'ADMINISTRADOR') return send(response, 403, {});
    return send(response, 200, [
      {
        id: ids.admin,
        email: 'panel@example.test',
        firstName: 'Administrador',
        lastName: 'Prueba',
        role: { code: 'ADMINISTRADOR', name: 'Administrador' },
        store: null,
        isActive: true,
        createdAt: '2026-10-14T12:00:00Z',
      },
    ]);
  }
  if (url.pathname === '/sales-dashboard') {
    if (role !== 'ADMINISTRADOR') return send(response, 403, {});
    if (token === 'test-panel-error')
      return send(response, 500, { message: 'private-error' });
    const date = url.searchParams.get('date');
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date))
      return send(response, 400, {});
    return send(response, 200, dashboard(date));
  }
  const match = /^\/cash-closings\/([0-9a-f-]{36})$/.exec(url.pathname);
  if (match) {
    const detail = closing(match[1]);
    return detail ? send(response, 200, detail) : send(response, 404, {});
  }
  return send(response, 404, {});
}).listen(3147, '127.0.0.1', () =>
  console.log('Backend de prueba del panel consolidado en loopback:3147.'),
);
