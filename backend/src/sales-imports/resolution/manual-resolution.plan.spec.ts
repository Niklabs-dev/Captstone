import { BadRequestException, ConflictException } from '@nestjs/common';
import type {
  SalesImportLineResolutionDto,
  SalesImportResolutionDto,
} from '../dto/sales-import-request.dto.js';
import type { ParsedMrComandaReport } from '../parser/mrcomanda-report.types.js';
import type {
  ResolvedPaymentLine,
  ResolvedSalesReport,
  SalesImportIssue,
} from '../sales-import-resolver.service.js';
import {
  type ManualMethodCandidate,
  type ManualStoreCandidate,
  planManualResolution,
} from './manual-resolution.plan.js';

// Plan de la resolución manual (SPRINT-4A-T18; omisión automática y medios
// nuevos de SPRINT-4A-T21): reglas puras, sin base de datos. Los casos HTTP y de la base están en
// test/sales-imports-manual-resolution.integration.spec.ts.

const STORE: ManualStoreCandidate = {
  id: '1010021e-9bab-42d5-851c-417e9e2503bf',
  name: 'Santa María',
  isActive: true,
  subwayStoreId: null,
};
const CASH: ManualMethodCandidate = {
  id: 'b9000000-0000-4000-8000-000000000001',
  code: 'CASH',
  name: 'Efectivo',
  isActive: true,
};
const TRANSFER: ManualMethodCandidate = {
  id: 'b9000000-0000-4000-8000-000000000004',
  code: 'TRANSFER',
  name: 'Transferencia',
  isActive: true,
};
const INACTIVE_COUPON: ManualMethodCandidate = {
  id: 'b9000000-0000-4000-8000-000000000009',
  code: 'COUPON',
  name: 'Cupón',
  isActive: false,
};
const METHODS: readonly ManualMethodCandidate[] = [CASH, TRANSFER];

function line(
  lineNumber: number,
  label: string,
  amount: number,
  method: ManualMethodCandidate | null,
  skipped = false,
): ResolvedPaymentLine {
  return {
    lineNumber,
    rowNumber: lineNumber + 10,
    originalLabel: label,
    normalizedLabel: label.toUpperCase(),
    amount,
    percentage: null,
    paymentMethod: method
      ? { id: method.id, code: method.code, name: method.name }
      : null,
    skipped,
  };
}

// Por defecto: EFECTIVO con alias, un cupón con valor sin alias (pendiente)
// y «N.de Créd.» en 0 sin alias (se omite sola).
function resolved(
  options: {
    storeIdentified?: boolean;
    subwayStoreId?: string | null;
    storeIssue?: SalesImportIssue['code'];
    lines?: ResolvedPaymentLine[];
  } = {},
): ResolvedSalesReport {
  const lines = options.lines ?? [
    line(1, 'EFECTIVO', 823_260, CASH),
    line(2, 'CUPON', 50_000, null),
    line(3, 'N.de Créd.', 0, null, true),
  ];
  const subwayStoreId =
    options.subwayStoreId === undefined ? '72597' : options.subwayStoreId;
  const report = {
    subwayStoreId,
    lines,
    totalAmount: lines.reduce((sum, item) => sum + item.amount, 0),
  } as unknown as ParsedMrComandaReport;
  const issues: SalesImportIssue[] = [];
  if (options.storeIdentified !== true) {
    issues.push({
      code:
        options.storeIssue === 'STORE_INACTIVE'
          ? 'STORE_INACTIVE'
          : options.storeIssue === 'STORE_NOT_IDENTIFIED'
            ? 'STORE_NOT_IDENTIFIED'
            : 'STORE_NOT_CONFIGURED',
      externalStoreCode: '208 - 72597',
      subwayStoreId,
      message: 'local',
    });
  }
  return {
    report,
    store:
      options.storeIdentified === true
        ? { id: STORE.id, name: STORE.name }
        : null,
    lines,
    issues,
    canConfirm: false,
  };
}

function assign(
  lineNumber: number,
  paymentMethodId: string,
  remember = false,
): SalesImportLineResolutionDto {
  return { lineNumber, action: 'ASSIGN', paymentMethodId, remember };
}

function create(
  lineNumber: number,
  name: string,
  remember = true,
): SalesImportLineResolutionDto {
  return { lineNumber, action: 'CREATE', name, remember };
}

function dto(
  partial: Partial<SalesImportResolutionDto> = {},
): SalesImportResolutionDto {
  return {
    expectedActiveImportId: null,
    store: { storeId: STORE.id, remember: true },
    lines: [assign(2, TRANSFER.id)],
    ...partial,
  };
}

function rejection(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(BadRequestException);
    return (error as BadRequestException).message;
  }
  throw new Error('Se esperaba un 400');
}

function conflict(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(ConflictException);
    const response = (error as ConflictException).getResponse();
    expect(response).toMatchObject({ code: 'PAYMENT_METHOD_NAME_TAKEN' });
    return (error as ConflictException).message;
  }
  throw new Error('Se esperaba un 409');
}

describe('planManualResolution (SPRINT-4A-T18)', () => {
  it('elige el local, recuerda su ID Subway y asocia la línea pendiente', () => {
    const plan = planManualResolution(resolved(), dto(), STORE, METHODS);
    expect(plan.store).toEqual({ id: STORE.id, name: STORE.name });
    expect(plan.storeResolution).toBe('MANUAL');
    expect(plan.rememberSubwayStoreId).toBe('72597');
    expect(plan.lines).toEqual([
      expect.objectContaining({
        target: { kind: 'EXISTING', paymentMethodId: CASH.id },
        resolution: 'AUTOMATIC',
        remember: false,
      }),
      expect.objectContaining({
        target: { kind: 'EXISTING', paymentMethodId: TRANSFER.id },
        resolution: 'MANUAL',
        remember: false,
      }),
    ]);
  });

  it('sin «recordar» elige el local sin asignarle el ID Subway', () => {
    const plan = planManualResolution(
      resolved(),
      dto({ store: { storeId: STORE.id, remember: false } }),
      STORE,
      METHODS,
    );
    expect(plan.storeResolution).toBe('MANUAL');
    expect(plan.rememberSubwayStoreId).toBeNull();
  });

  it('asocia a mano una línea con monto y puede recordar su alias', () => {
    const plan = planManualResolution(
      resolved({
        storeIdentified: true,
        lines: [
          line(1, 'EFECTIVO', 800_000, CASH),
          line(2, 'TRANSF. BANCO', 73_260, null),
        ],
      }),
      dto({ store: null, lines: [assign(2, TRANSFER.id, true)] }),
      null,
      METHODS,
    );
    expect(plan.storeResolution).toBe('AUTOMATIC');
    expect(plan.lines[1]).toMatchObject({
      target: { kind: 'EXISTING', paymentMethodId: TRANSFER.id },
      resolution: 'MANUAL',
      remember: true,
    });
    expect(plan.skipped).toEqual([]);
  });

  it('exige cubrir todos los datos pendientes', () => {
    expect(
      rejection(() =>
        planManualResolution(resolved(), dto({ store: null }), null, METHODS),
      ),
    ).toContain('Elige el local');
    expect(
      rejection(() =>
        planManualResolution(resolved(), dto({ lines: [] }), STORE, METHODS),
      ),
    ).toContain('Falta elegir el medio de pago de «CUPON»');
  });

  it('rechaza resolver datos que no están pendientes o repetirlos', () => {
    expect(
      rejection(() =>
        planManualResolution(
          resolved(),
          dto({ lines: [assign(2, TRANSFER.id), assign(1, CASH.id)] }),
          STORE,
          METHODS,
        ),
      ),
    ).toContain('La línea 1 no está pendiente');
    expect(
      rejection(() =>
        planManualResolution(
          resolved(),
          dto({ lines: [assign(2, TRANSFER.id), assign(2, TRANSFER.id)] }),
          STORE,
          METHODS,
        ),
      ),
    ).toContain('más de una vez');
    expect(
      rejection(() =>
        planManualResolution(
          resolved({ storeIdentified: true }),
          dto(),
          STORE,
          METHODS,
        ),
      ),
    ).toContain('ya se identificó por su ID Subway');
  });

  it('rechaza un archivo que ya no tiene nada por identificar', () => {
    expect(
      rejection(() =>
        planManualResolution(
          resolved({
            storeIdentified: true,
            lines: [line(1, 'EFECTIVO', 873_260, CASH)],
          }),
          dto({ store: null, lines: [] }),
          null,
          METHODS,
        ),
      ),
    ).toContain('ya no tiene datos por identificar');
  });

  it('exige un local y un medio existentes y activos', () => {
    expect(
      rejection(() => planManualResolution(resolved(), dto(), null, METHODS)),
    ).toContain('El local elegido no existe');
    expect(
      rejection(() =>
        planManualResolution(
          resolved(),
          dto(),
          { ...STORE, isActive: false },
          METHODS,
        ),
      ),
    ).toContain('está inactivo');
    expect(
      rejection(() =>
        planManualResolution(resolved(), dto(), STORE, [
          CASH,
          { ...TRANSFER, isActive: false },
        ]),
      ),
    ).toContain('«Transferencia» elegido para «CUPON» está inactivo');
    expect(
      rejection(() => planManualResolution(resolved(), dto(), STORE, [CASH])),
    ).toContain('no existe');
  });

  it('«recordar» el local nunca sobrescribe un ID Subway configurado', () => {
    expect(
      rejection(() =>
        planManualResolution(
          resolved(),
          dto(),
          { ...STORE, subwayStoreId: '74413' },
          METHODS,
        ),
      ),
    ).toContain('ya tiene el ID Subway 74413 y no se sobrescribe');
    expect(
      rejection(() =>
        planManualResolution(
          resolved({ storeIssue: 'STORE_INACTIVE' }),
          dto(),
          STORE,
          METHODS,
        ),
      ),
    ).toContain('ya está asignado a un local inactivo');
    expect(
      rejection(() =>
        planManualResolution(
          resolved({
            storeIssue: 'STORE_NOT_IDENTIFIED',
            subwayStoreId: null,
          }),
          dto(),
          STORE,
          METHODS,
        ),
      ),
    ).toContain('no hay nada que recordar');
  });
});

describe('planManualResolution: omisión automática (SPRINT-4A-T21)', () => {
  it('omite sola la línea en 0 sin alias, sin que la resolución la mencione', () => {
    const plan = planManualResolution(resolved(), dto(), STORE, METHODS);
    expect(plan.skipped.map((item) => item.originalLabel)).toEqual([
      'N.de Créd.',
    ]);
    expect(plan.lines.map((item) => item.line.originalLabel)).toEqual([
      'EFECTIVO',
      'CUPON',
    ]);
  });

  it('con el local por elegir y solo una línea en 0, basta elegir el local', () => {
    const plan = planManualResolution(
      resolved({
        lines: [
          line(1, 'EFECTIVO', 873_260, CASH),
          line(2, 'N.de Créd.', 0, null, true),
        ],
      }),
      dto({ lines: [] }),
      STORE,
      METHODS,
    );
    expect(plan.lines).toHaveLength(1);
    expect(plan.skipped).toHaveLength(1);
  });

  it('una línea omitida sola no se puede resolver a mano', () => {
    expect(
      rejection(() =>
        planManualResolution(
          resolved(),
          dto({ lines: [assign(2, TRANSFER.id), assign(3, CASH.id)] }),
          STORE,
          METHODS,
        ),
      ),
    ).toContain('se omite sola por estar en 0');
  });

  it('si todas las líneas están en 0 sin alias, se pide el medio de cada una', () => {
    const lines = [line(1, 'N.de Créd.', 0, null)];
    expect(
      rejection(() =>
        planManualResolution(
          resolved({ lines }),
          dto({ lines: [] }),
          STORE,
          METHODS,
        ),
      ),
    ).toContain('Falta elegir el medio de pago de «N.de Créd.»');
    const plan = planManualResolution(
      resolved({ lines }),
      dto({ lines: [assign(1, CASH.id)] }),
      STORE,
      METHODS,
    );
    expect(plan.skipped).toEqual([]);
    expect(plan.lines[0].resolution).toBe('MANUAL');
  });
});

describe('planManualResolution: crear el medio (SPRINT-4A-T21)', () => {
  it('crea un medio con el nombre indicado y su código, y recuerda la etiqueta', () => {
    const plan = planManualResolution(
      resolved(),
      dto({ lines: [create(2, 'Cupón Ñuñoa')] }),
      STORE,
      METHODS,
    );
    expect(plan.lines[1]).toMatchObject({
      target: { kind: 'NEW', name: 'Cupón Ñuñoa', code: 'CUPON_NUNOA' },
      resolution: 'MANUAL',
      remember: true,
    });
  });

  it('dos líneas con el mismo nombre comparten el medio nuevo', () => {
    const plan = planManualResolution(
      resolved({
        lines: [
          line(1, 'CUPON A', 10_000, null),
          line(2, 'CUPON B', 20_000, null),
        ],
      }),
      dto({ lines: [create(1, 'Cupones'), create(2, 'Cupones')] }),
      STORE,
      METHODS,
    );
    expect(plan.lines.map((item) => item.target)).toEqual([
      { kind: 'NEW', name: 'Cupones', code: 'CUPONES' },
      { kind: 'NEW', name: 'Cupones', code: 'CUPONES' },
    ]);
    expect(
      rejection(() =>
        planManualResolution(
          resolved({
            lines: [
              line(1, 'CUPON A', 10_000, null),
              line(2, 'CUPON B', 20_000, null),
            ],
          }),
          dto({ lines: [create(1, 'Cupones'), create(2, 'cupones')] }),
          STORE,
          METHODS,
        ),
      ),
    ).toContain('generan el mismo código CUPONES');
  });

  it('valida la forma de la acción y el nombre', () => {
    expect(
      rejection(() =>
        planManualResolution(
          resolved(),
          dto({ lines: [create(2, 'Cupón', false)] }),
          STORE,
          METHODS,
        ),
      ),
    ).toContain('siempre se recuerda');
    expect(
      rejection(() =>
        planManualResolution(
          resolved(),
          dto({
            lines: [{ ...create(2, 'Cupón'), paymentMethodId: CASH.id }],
          }),
          STORE,
          METHODS,
        ),
      ),
    ).toContain('no lleva un medio del catálogo');
    expect(
      rejection(() =>
        planManualResolution(
          resolved(),
          dto({ lines: [{ ...create(2, 'Cupón'), name: null }] }),
          STORE,
          METHODS,
        ),
      ),
    ).toContain('Indica el nombre');
    expect(
      rejection(() =>
        planManualResolution(
          resolved(),
          dto({ lines: [create(2, 'Cupón\u0007')] }),
          STORE,
          METHODS,
        ),
      ),
    ).toContain('caracteres de control');
    expect(
      rejection(() =>
        planManualResolution(
          resolved(),
          dto({ lines: [create(2, 'ÆØ')] }),
          STORE,
          METHODS,
        ),
      ),
    ).toContain('no permite generar un código');
    expect(
      rejection(() =>
        planManualResolution(
          resolved(),
          dto({ lines: [{ ...assign(2, TRANSFER.id), name: 'Cupón' }] }),
          STORE,
          METHODS,
        ),
      ),
    ).toContain('no lleva el nombre de un medio nuevo');
  });

  it('no duplica un medio existente: responde 409 con un código estable', () => {
    expect(
      conflict(() =>
        planManualResolution(
          resolved(),
          dto({ lines: [create(2, '  transferencia ')] }),
          STORE,
          METHODS,
        ),
      ),
    ).toContain('elígelo en el selector');
    expect(
      conflict(() =>
        planManualResolution(
          resolved(),
          dto({ lines: [create(2, 'CUPON')] }),
          STORE,
          [...METHODS, INACTIVE_COUPON],
        ),
      ),
    ).toContain('está inactivo: reactívalo');
    expect(
      conflict(() =>
        planManualResolution(
          resolved(),
          dto({ lines: [create(2, 'Transfer')] }),
          STORE,
          METHODS,
        ),
      ),
    ).toContain('genera el código TRANSFER');
  });
});
