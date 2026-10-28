import { PDFDocument } from 'pdf-lib';
import type { TipPoolReceiptResponse } from '../types/tip-pools.types.js';
import {
  buildReceiptFileName,
  formatChileanDate,
  formatClp,
  receiptRows,
  renderTipReceiptPdf,
} from './tip-receipt-pdf.js';

// Tests unitarios de la constancia de pago en PDF (SPRINT-3-T13).

const RECEIPT: TipPoolReceiptResponse = {
  id: '3f1c2b9a-6d4e-4c1a-9b7f-2a8e5d0c4b11',
  poolId: 'pool-1',
  userId: 'u-1',
  workerName: 'Ñandú Pérez',
  store: { id: 'store-1', name: 'Melipilla Centro' },
  periodStart: '2026-10-01',
  periodEnd: '2026-10-15',
  hoursWorked: '37.50',
  amount: 1234567,
  paymentDate: '2026-10-27',
  paidBy: { id: 'acc-1', name: 'Lucas Contador' },
  detail: {
    agreementSnapshot: {
      id: 'agreement-1',
      name: 'Pacto proporcional',
      rule: 'PROPORTIONAL_TO_HOURS',
      validFrom: '2026-01-01',
      validTo: null,
    },
    totalAmount: 2500000,
    totalHours: '75.00',
    lines: [],
  },
  createdAt: new Date('2026-10-27T15:00:00Z'),
};

const ISSUED_AT = new Date('2026-10-27T18:05:00Z'); // 15:05 en Chile.

describe('formato de la constancia', () => {
  it('formatea montos CLP con separador de miles', () => {
    expect(formatClp(0)).toBe('$0');
    expect(formatClp(999)).toBe('$999');
    expect(formatClp(10000)).toBe('$10.000');
    expect(formatClp(1234567)).toBe('$1.234.567');
  });

  it('formatea fechas como DD-MM-YYYY', () => {
    expect(formatChileanDate('2026-01-05')).toBe('05-01-2026');
  });

  it('el nombre del archivo no lleva datos personales', () => {
    const fileName = buildReceiptFileName(RECEIPT);
    expect(fileName).toBe(
      'constancia-propinas_2026-10-01_2026-10-15_3f1c2b9a.pdf',
    );
    expect(fileName).not.toContain('Pérez');
  });

  it('incluye todos los datos exigidos', () => {
    expect(Object.fromEntries(receiptRows(RECEIPT, ISSUED_AT))).toEqual({
      Local: 'Melipilla Centro',
      Período: '01-10-2026 al 15-10-2026',
      Trabajador: 'Ñandú Pérez',
      'Horas trabajadas': '37,50',
      'Monto pagado': '$1.234.567',
      'Fecha de pago': '27-10-2026',
      'Responsable del pago': 'Lucas Contador',
      'Pacto aplicado': 'Pacto proporcional (PROPORTIONAL_TO_HOURS)',
      'Total del reparto': '$2.500.000',
      'Horas del reparto': '75,00',
      'ID de la constancia': RECEIPT.id,
      'Fecha de emisión': '27-10-2026 15:05 (hora de Chile)',
    });
  });
});

describe('renderTipReceiptPdf', () => {
  it('genera un PDF válido de una página', async () => {
    const bytes = await renderTipReceiptPdf(RECEIPT, ISSUED_AT);

    expect(Buffer.from(bytes.subarray(0, 4)).toString('latin1')).toBe('%PDF');
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(1);
    expect(pdf.getTitle()).toBe('Constancia de pago de propinas');
  });

  it('no falla con caracteres que la fuente no puede dibujar', async () => {
    const bytes = await renderTipReceiptPdf(
      { ...RECEIPT, workerName: 'Ana 李 → Pérez 😀' },
      ISSUED_AT,
    );
    expect(bytes.length).toBeGreaterThan(0);
  });
});
