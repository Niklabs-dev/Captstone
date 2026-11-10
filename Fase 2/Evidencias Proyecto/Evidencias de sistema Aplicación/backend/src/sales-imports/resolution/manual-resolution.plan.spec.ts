import { BadRequestException } from '@nestjs/common';
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

// Plan de la resolución manual (SPRINT-4A-T18): reglas puras, sin base de
// datos. Los casos HTTP y de la base están en
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
const METHODS = new Map([CASH, TRANSFER].map((method) => [method.id, method]));

function line(
  lineNumber: number,
  label: string,
  amount: number,
  method: ManualMethodCandidate | null,
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
  };
}

function resolved(
  options: {
    storeIdentified?: boolean;
    subwayStoreId?: string | null;
    storeIssue?: SalesImportIssue['code'];
    lines?: ResolvedPaymentLine[];
  } = {},
): ResolvedSalesReport {
  const lines = options.lines ?? [
    line(1, 'EFECTIVO', 873_260, CASH),
    line(2, 'N.de Créd.', 0, null),
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

function skip(lineNumber: number): SalesImportLineResolutionDto {
  return { lineNumber, action: 'SKIP', remember: false };
}

function assign(
  lineNumber: number,
  paymentMethodId: string,
  remember = false,
): SalesImportLineResolutionDto {
  return { lineNumber, action: 'ASSIGN', paymentMethodId, remember };
}

function dto(
  partial: Partial<SalesImportResolutionDto> = {},
): SalesImportResolutionDto {
  return {
    expectedActiveImportId: null,
    store: { storeId: STORE.id, remember: true },
    lines: [skip(2)],
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

describe('planManualResolution (SPRINT-4A-T18)', () => {
  it('elige el local, recuerda su ID Subway y omite la línea en 0', () => {
    const plan = planManualResolution(resolved(), dto(), STORE, METHODS);
    expect(plan.store).toEqual({ id: STORE.id, name: STORE.name });
    expect(plan.storeResolution).toBe('MANUAL');
    expect(plan.rememberSubwayStoreId).toBe('72597');
    expect(plan.lines).toEqual([
      expect.objectContaining({
        paymentMethodId: CASH.id,
        resolution: 'AUTOMATIC',
        remember: false,
      }),
    ]);
    expect(plan.skipped.map((item) => item.originalLabel)).toEqual([
      'N.de Créd.',
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
      paymentMethodId: TRANSFER.id,
      resolution: 'MANUAL',
      remember: true,
    });
    expect(plan.skipped).toEqual([]);
  });

  it('rechaza omitir una línea con monto distinto de 0', () => {
    const message = rejection(() =>
      planManualResolution(
        resolved({
          lines: [
            line(1, 'EFECTIVO', 800_000, CASH),
            line(2, 'N.de Créd.', -1_500, null),
          ],
        }),
        dto(),
        STORE,
        METHODS,
      ),
    );
    expect(message).toContain('solo se omiten líneas en 0');
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
    ).toContain('Falta elegir el medio de pago de «N.de Créd.»');
  });

  it('rechaza resolver datos que no están pendientes o repetirlos', () => {
    expect(
      rejection(() =>
        planManualResolution(
          resolved(),
          dto({ lines: [skip(2), assign(1, CASH.id)] }),
          STORE,
          METHODS,
        ),
      ),
    ).toContain('La línea 1 no está pendiente');
    expect(
      rejection(() =>
        planManualResolution(
          resolved(),
          dto({ lines: [skip(2), skip(2)] }),
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
    const inactive = new Map([[TRANSFER.id, { ...TRANSFER, isActive: false }]]);
    expect(
      rejection(() =>
        planManualResolution(
          resolved(),
          dto({ lines: [assign(2, TRANSFER.id)] }),
          STORE,
          inactive,
        ),
      ),
    ).toContain('«Transferencia» elegido para «N.de Créd.» está inactivo');
    expect(
      rejection(() =>
        planManualResolution(
          resolved(),
          dto({ lines: [assign(2, TRANSFER.id)] }),
          STORE,
          new Map(),
        ),
      ),
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

  it('una línea omitida no lleva medio ni se recuerda', () => {
    expect(
      rejection(() =>
        planManualResolution(
          resolved(),
          dto({
            lines: [{ ...skip(2), paymentMethodId: CASH.id }],
          }),
          STORE,
          METHODS,
        ),
      ),
    ).toContain('no lleva medio de pago');
    expect(
      rejection(() =>
        planManualResolution(
          resolved(),
          dto({ lines: [{ ...skip(2), remember: true }] }),
          STORE,
          METHODS,
        ),
      ),
    ).toContain('Solo se recuerda una línea asociada');
  });

  it('no permite omitir todas las líneas del reporte', () => {
    expect(
      rejection(() =>
        planManualResolution(
          resolved({ lines: [line(1, 'N.de Créd.', 0, null)] }),
          dto({ lines: [skip(1)] }),
          STORE,
          METHODS,
        ),
      ),
    ).toContain('Asocia al menos una línea');
  });
});
