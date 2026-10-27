import { MAX_TIP_AMOUNT } from '../types/tips.types.js';
import {
  calculateTipDistribution,
  formatHundredths,
  toHundredths,
  TipDistributionError,
  type TipDistributionWorker,
} from './tip-distribution.calculator.js';

const A = 'a0000000-0000-4000-8000-000000000001';
const B = 'b0000000-0000-4000-8000-000000000002';
const C = 'c0000000-0000-4000-8000-000000000003';
const D = 'd0000000-0000-4000-8000-000000000004';

function amounts(
  fundAmount: number,
  workers: TipDistributionWorker[],
): Record<string, number> {
  return Object.fromEntries(
    calculateTipDistribution({ fundAmount, workers }).map((line) => [
      line.userId,
      line.amount,
    ]),
  );
}

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  return items.flatMap((item, index) =>
    permutations([...items.slice(0, index), ...items.slice(index + 1)]).map(
      (rest) => [item, ...rest],
    ),
  );
}

// PRNG determinista (mulberry32) para generar casos sin dependencias nuevas.
function mulberry32(seed: number): () => number {
  let state = seed;
  return (): number => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function expectDomainError(fn: () => unknown, code: string): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(TipDistributionError);
    expect((error as TipDistributionError).code).toBe(code);
    return;
  }
  throw new Error(`Se esperaba TipDistributionError ${code}`);
}

describe('calculateTipDistribution (SPRINT-3-T12)', () => {
  it('reparte en proporción exacta a las horas', () => {
    expect(
      amounts(60000, [
        { userId: A, hoursWorked: '10' },
        { userId: B, hoursWorked: '20' },
        { userId: C, hoursWorked: '30' },
      ]),
    ).toEqual({ [A]: 10000, [B]: 20000, [C]: 30000 });
  });

  it('con fondo 0 todas las líneas quedan en 0', () => {
    const lines = calculateTipDistribution({
      fundAmount: 0,
      workers: [
        { userId: A, hoursWorked: '10' },
        { userId: B, hoursWorked: '0' },
      ],
    });
    expect(lines.map((line) => line.amount)).toEqual([0, 0]);
  });

  it('con fondo 0 y sin horas no lanza error', () => {
    expect(
      amounts(0, [
        { userId: A, hoursWorked: '0' },
        { userId: B, hoursWorked: '0.00' },
      ]),
    ).toEqual({ [A]: 0, [B]: 0 });
  });

  it('un trabajador con 0 horas recibe 0 y aparece en el resultado', () => {
    const lines = calculateTipDistribution({
      fundAmount: 1000,
      workers: [
        { userId: B, hoursWorked: '0' },
        { userId: A, hoursWorked: '8' },
      ],
    });
    expect(lines).toEqual([
      { userId: A, hoursWorked: '8.00', amount: 1000 },
      { userId: B, hoursWorked: '0.00', amount: 0 },
    ]);
  });

  it('asigna el residuo al mayor resto y desempata por userId menor', () => {
    expect(
      amounts(100, [
        { userId: C, hoursWorked: '1' },
        { userId: A, hoursWorked: '1' },
        { userId: B, hoursWorked: '1' },
      ]),
    ).toEqual({ [A]: 34, [B]: 33, [C]: 33 });
  });

  it('redondea con horas decimales y un fondo primo', () => {
    // H = 2000 centésimas; 97.513 × (750, 1225, 25) / 2000:
    // A: 36.567,375 → 36.567 (resto 750); B: 59.726,7125 → 59.726 (resto
    // 1425); C: 1.218,9125 → 1.218 (resto 1825). Residuo 2 → C y B.
    expect(
      amounts(97513, [
        { userId: A, hoursWorked: '7.5' },
        { userId: B, hoursWorked: '12.25' },
        { userId: C, hoursWorked: '0.25' },
      ]),
    ).toEqual({ [A]: 36567, [B]: 59727, [C]: 1219 });
  });

  it('devuelve el mismo resultado para todas las permutaciones de la entrada', () => {
    const workers: TipDistributionWorker[] = [
      { userId: D, hoursWorked: '3' },
      { userId: B, hoursWorked: '3' },
      { userId: A, hoursWorked: '3' },
      { userId: C, hoursWorked: '1.5' },
    ];
    const expected = calculateTipDistribution({ fundAmount: 1001, workers });
    expect(expected.map((line) => line.userId)).toEqual([A, B, C, D]);
    for (const permutation of permutations(workers)) {
      expect(
        calculateTipDistribution({ fundAmount: 1001, workers: permutation }),
      ).toEqual(expected);
    }
  });

  it('concilia siempre y cada monto difiere menos de 1 CLP del proporcional exacto', () => {
    const random = mulberry32(20261026);
    for (let caseIndex = 0; caseIndex < 500; caseIndex += 1) {
      const fundAmount = Math.floor(random() * 5_000_000);
      const size = 1 + Math.floor(random() * 12);
      const workers = Array.from({ length: size }, (_, index) => ({
        userId: `user-${String(index).padStart(2, '0')}`,
        hoursWorked: formatHundredths(BigInt(Math.floor(random() * 20000))),
      }));
      const totalHours = workers.reduce(
        (sum, worker) => sum + toHundredths(worker.hoursWorked),
        0n,
      );
      if (totalHours === 0n) continue;

      const lines = calculateTipDistribution({ fundAmount, workers });
      expect(lines.reduce((sum, line) => sum + line.amount, 0)).toBe(
        fundAmount,
      );
      for (const line of lines) {
        // |amount − fondo·h/H| < 1  ⇔  |amount·H − fondo·h| < H
        const exact = BigInt(fundAmount) * toHundredths(line.hoursWorked);
        const scaled = BigInt(line.amount) * totalHours;
        const diff = scaled > exact ? scaled - exact : exact - scaled;
        expect(diff < totalHours).toBe(true);
      }
    }
  });

  it('reparte MAX_TIP_AMOUNT sin pérdida de precisión', () => {
    const lines = calculateTipDistribution({
      fundAmount: MAX_TIP_AMOUNT,
      workers: [
        { userId: A, hoursWorked: '9999.99' },
        { userId: B, hoursWorked: '0.01' },
        { userId: C, hoursWorked: '1234.56' },
      ],
    });
    expect(lines.reduce((sum, line) => sum + line.amount, 0)).toBe(
      MAX_TIP_AMOUNT,
    );
    // 9.999.999.999 × 1 / 1.123.456 = 8.901,0 → floor 8901 (+1 si recibe residuo).
    expect(lines[1].amount).toBeGreaterThanOrEqual(8901);
    expect(lines[1].amount).toBeLessThanOrEqual(8902);
  });

  it('normaliza las horas a 2 decimales', () => {
    expect(toHundredths('37.5')).toBe(3750n);
    expect(toHundredths('0.05')).toBe(5n);
    expect(formatHundredths(3750n)).toBe('37.50');
    expect(formatHundredths(5n)).toBe('0.05');
  });

  it('rechaza horas negativas', () => {
    expectDomainError(
      () =>
        calculateTipDistribution({
          fundAmount: 100,
          workers: [{ userId: A, hoursWorked: '-1' }],
        }),
      'INVALID_HOURS',
    );
  });

  it('rechaza horas con más de 2 decimales o con formato inválido', () => {
    for (const hoursWorked of ['1.234', '1e2', '', 'abc', '1.']) {
      expectDomainError(
        () =>
          calculateTipDistribution({
            fundAmount: 100,
            workers: [{ userId: A, hoursWorked }],
          }),
        'INVALID_HOURS',
      );
    }
  });

  it('rechaza un fondo positivo cuando la suma de horas es 0', () => {
    expectDomainError(
      () =>
        calculateTipDistribution({
          fundAmount: 100,
          workers: [{ userId: A, hoursWorked: '0' }],
        }),
      'NO_HOURS_TO_DISTRIBUTE',
    );
    expectDomainError(
      () => calculateTipDistribution({ fundAmount: 100, workers: [] }),
      'NO_HOURS_TO_DISTRIBUTE',
    );
  });

  it('rechaza un fondo no entero, negativo o fuera de rango seguro', () => {
    for (const fundAmount of [10.5, -1, Number.NaN, 2 ** 53]) {
      expectDomainError(
        () =>
          calculateTipDistribution({
            fundAmount,
            workers: [{ userId: A, hoursWorked: '1' }],
          }),
        'INVALID_FUND',
      );
    }
  });

  it('rechaza trabajadores repetidos', () => {
    expectDomainError(
      () =>
        calculateTipDistribution({
          fundAmount: 100,
          workers: [
            { userId: A, hoursWorked: '1' },
            { userId: A, hoursWorked: '2' },
          ],
        }),
      'DUPLICATED_WORKER',
    );
  });
});
