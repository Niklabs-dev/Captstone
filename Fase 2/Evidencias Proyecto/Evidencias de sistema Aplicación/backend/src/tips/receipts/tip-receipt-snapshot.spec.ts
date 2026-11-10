import type { TipPoolReceiptDetail } from '../types/tip-pools.types.js';
import { parseReceiptDetail } from './tip-receipt-snapshot.js';

// Tests unitarios de la lectura de la foto de las constancias de pago
// (SPRINT-3-T13 y regla equitativa de SPRINT-4R-T04).

// Detalle tal como lo guardaba el pago de un reparto proporcional.
const PROPORTIONAL: TipPoolReceiptDetail = {
  rule: 'PROPORTIONAL_TO_HOURS',
  agreementSnapshot: {
    id: 'agreement-1',
    name: 'Pacto proporcional',
    rule: 'PROPORTIONAL_TO_HOURS',
    validFrom: '2026-01-01',
    validTo: null,
  },
  totalAmount: 12000,
  totalHours: '60.00',
  lines: [
    { userId: 'u-1', workerName: 'Ana Pérez', hoursWorked: '20.00', amount: 0 },
    {
      userId: 'u-2',
      workerName: 'Beto Soto',
      hoursWorked: '40.00',
      amount: 12000,
    },
  ],
};

// Detalle de un reparto equitativo: sin pacto ni horas.
const EQUAL: TipPoolReceiptDetail = {
  rule: 'EQUAL_SHARES',
  agreementSnapshot: null,
  totalAmount: 10001,
  totalHours: null,
  lines: [
    { userId: 'u-1', workerName: 'Ana Pérez', hoursWorked: null, amount: 5001 },
    { userId: 'u-2', workerName: 'Beto Soto', hoursWorked: null, amount: 5000 },
  ],
};

describe('parseReceiptDetail', () => {
  it('lee el detalle guardado de un reparto proporcional y de uno equitativo', () => {
    for (const detail of [PROPORTIONAL, EQUAL]) {
      const stored: unknown = JSON.parse(JSON.stringify(detail));
      expect(parseReceiptDetail(stored)).toEqual(detail);
    }
  });

  it('acepta un pacto ausente (repartos históricos sin copia)', () => {
    expect(
      parseReceiptDetail({
        agreementSnapshot: null,
        totalAmount: 0,
        totalHours: '0.00',
        lines: [],
      }).agreementSnapshot,
    ).toBeNull();
  });

  it('una constancia anterior a la regla equitativa se lee como proporcional', () => {
    const legacy = parseReceiptDetail({
      agreementSnapshot: null,
      totalAmount: 100,
      totalHours: '10.00',
      lines: [
        { userId: 'u-1', workerName: 'Ana', hoursWorked: '10.00', amount: 100 },
      ],
    });
    expect(legacy.rule).toBe('PROPORTIONAL_TO_HOURS');
    expect(legacy.lines[0].hoursWorked).toBe('10.00');
  });

  it('rechaza un detalle corrupto', () => {
    expect(() => parseReceiptDetail(null)).toThrow();
    expect(() =>
      parseReceiptDetail({
        totalAmount: '12000',
        totalHours: '60.00',
        lines: [],
      }),
    ).toThrow('El detalle guardado de la constancia no es válido');
    expect(() =>
      parseReceiptDetail({
        totalAmount: 12000,
        totalHours: '60.00',
        lines: [{ userId: 'u-1' }],
      }),
    ).toThrow();
    expect(() =>
      parseReceiptDetail({
        rule: 'BY_SENIORITY',
        totalAmount: 12000,
        totalHours: null,
        lines: [],
      }),
    ).toThrow('El detalle guardado de la constancia no es válido');
  });
});
