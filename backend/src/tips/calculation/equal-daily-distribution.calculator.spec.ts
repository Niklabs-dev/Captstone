import {
  calculateEqualDailyDistribution,
  epochDay,
  EqualDistributionError,
  splitDailyFund,
  type EqualDailyShareDay,
} from './equal-daily-distribution.calculator.js';

const A = 'a0000000-0000-4000-8000-000000000001';
const B = 'b0000000-0000-4000-8000-000000000002';
const C = 'c0000000-0000-4000-8000-000000000003';
const D = 'd0000000-0000-4000-8000-000000000004';

function day(
  businessDate: string,
  fundAmount: number,
  participantIds: string[],
  operationId = `op-${businessDate}`,
): EqualDailyShareDay {
  return { operationId, businessDate, fundAmount, participantIds };
}

function errorCodeOf(run: () => unknown): string | null {
  try {
    run();
    return null;
  } catch (error) {
    return error instanceof EqualDistributionError ? error.code : 'OTHER';
  }
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

describe('reparto equitativo diario (SPRINT-4R-T04)', () => {
  describe('splitDailyFund', () => {
    it('$10.000 entre 3 asigna $3.334, $3.333 y $3.333 y suma el fondo exacto', () => {
      const allocations = splitDailyFund(day('2026-10-05', 10_000, [C, A, B]));

      expect(allocations.map((line) => line.userId)).toEqual([A, B, C]);
      expect(allocations.map((line) => line.amount).sort()).toEqual([
        3333, 3333, 3334,
      ]);
      expect(allocations.reduce((sum, line) => sum + line.amount, 0)).toBe(
        10_000,
      );
    });

    it('el peso extra va a la posición díaDesdeEpoch mod n (orden por ID)', () => {
      const date = '2026-10-05';
      const offset = epochDay(date) % 3;
      const allocations = splitDailyFund(day(date, 10_000, [A, B, C]));
      const expected = [3333, 3333, 3333];
      expected[offset] = 3334;
      expect(allocations.map((line) => line.amount)).toEqual(expected);
    });

    it('con varios pesos sobrantes avanza circularmente desde el desfase del día', () => {
      // 10 entre 4: base 2 y residuo 2 → dos participantes consecutivos
      // (circularmente) reciben 3.
      const date = '2026-10-07';
      const offset = epochDay(date) % 4;
      const allocations = splitDailyFund(day(date, 10, [D, C, B, A]));
      const expected = [2, 2, 2, 2];
      expected[offset] = 3;
      expected[(offset + 1) % 4] = 3;
      expect(allocations.map((line) => line.amount)).toEqual(expected);
    });

    it('es determinista sin importar el orden en que llegan los participantes', () => {
      const first = splitDailyFund(day('2026-10-05', 10_001, [A, B, C, D]));
      const second = splitDailyFund(day('2026-10-05', 10_001, [D, B, A, C]));
      expect(second).toEqual(first);
    });

    it('un fondo divisible reparte en partes iguales y un solo participante recibe todo', () => {
      expect(
        splitDailyFund(day('2026-10-05', 9_000, [A, B, C])).map(
          (line) => line.amount,
        ),
      ).toEqual([3000, 3000, 3000]);
      expect(splitDailyFund(day('2026-10-05', 9_001, [B]))).toEqual([
        { userId: B, amount: 9_001 },
      ]);
    });

    it('fondo 0 sin participantes no genera asignaciones', () => {
      expect(splitDailyFund(day('2026-10-05', 0, []))).toEqual([]);
    });

    it('rechaza fondo positivo sin participantes, repetidos, fondos y fechas inválidos', () => {
      expect(errorCodeOf(() => splitDailyFund(day('2026-10-05', 1, [])))).toBe(
        'NO_PARTICIPANTS',
      );
      expect(
        errorCodeOf(() => splitDailyFund(day('2026-10-05', 10, [A, A]))),
      ).toBe('DUPLICATED_PARTICIPANT');
      expect(
        errorCodeOf(() => splitDailyFund(day('2026-10-05', -1, [A]))),
      ).toBe('INVALID_FUND');
      expect(
        errorCodeOf(() => splitDailyFund(day('2026-10-05', 10.5, [A]))),
      ).toBe('INVALID_FUND');
      expect(
        errorCodeOf(() => splitDailyFund(day('2026-02-30', 10, [A]))),
      ).toBe('INVALID_DATE');
      expect(
        errorCodeOf(() => splitDailyFund(day('05-10-2026', 10, [A]))),
      ).toBe('INVALID_DATE');
    });
  });

  describe('calculateEqualDailyDistribution', () => {
    it('suma las asignaciones diarias por trabajador y no divide el período entre la unión', () => {
      // Día 1: A y B se reparten 10.000. Día 2: solo C recibe 6.000.
      // Dividir 16.000 entre la unión (A, B, C) daría 5.333 a cada uno: mal.
      const result = calculateEqualDailyDistribution([
        day('2026-10-01', 10_000, [A, B]),
        day('2026-10-02', 6_000, [C]),
      ]);

      expect(result.lines).toEqual([
        { userId: A, amount: 5_000 },
        { userId: B, amount: 5_000 },
        { userId: C, amount: 6_000 },
      ]);
      expect(result.totalAmount).toBe(16_000);
      expect(result.days.map((item) => item.allocations.length)).toEqual([
        2, 1,
      ]);
    });

    it('un no seleccionado no recibe línea', () => {
      const result = calculateEqualDailyDistribution([
        day('2026-10-01', 7_000, [A, C]),
      ]);
      expect(result.lines.map((line) => line.userId)).toEqual([A, C]);
      expect(result.lines.some((line) => line.userId === B)).toBe(false);
    });

    it('la rotación reparte el peso extra entre todos en días consecutivos', () => {
      // Tres días seguidos de $10.000 entre los mismos 3: cada uno recibe el
      // peso extra exactamente una vez.
      const result = calculateEqualDailyDistribution([
        day('2026-10-05', 10_000, [A, B, C]),
        day('2026-10-06', 10_000, [A, B, C]),
        day('2026-10-07', 10_000, [A, B, C]),
      ]);
      expect(result.lines).toEqual([
        { userId: A, amount: 10_000 },
        { userId: B, amount: 10_000 },
        { userId: C, amount: 10_000 },
      ]);
    });

    it('un período sin fondo ni participantes queda en 0 sin líneas', () => {
      const result = calculateEqualDailyDistribution([
        day('2026-10-01', 0, []),
      ]);
      expect(result).toEqual({
        days: [
          {
            operationId: 'op-2026-10-01',
            businessDate: '2026-10-01',
            fundAmount: 0,
            allocations: [],
          },
        ],
        lines: [],
        totalAmount: 0,
      });
    });

    it('rechaza una operación repetida y propaga el día sin participantes', () => {
      expect(
        errorCodeOf(() =>
          calculateEqualDailyDistribution([
            day('2026-10-01', 10, [A], 'op-1'),
            day('2026-10-02', 10, [A], 'op-1'),
          ]),
        ),
      ).toBe('DUPLICATED_OPERATION');
      expect(
        errorCodeOf(() =>
          calculateEqualDailyDistribution([
            day('2026-10-01', 10, [A]),
            day('2026-10-02', 10, []),
          ]),
        ),
      ).toBe('NO_PARTICIPANTS');
    });

    it('casos aleatorios: las líneas siempre suman el fondo y nadie difiere en más de $1 por día', () => {
      const random = mulberry32(20261107);
      const pool = [A, B, C, D];
      for (let iteration = 0; iteration < 500; iteration += 1) {
        const days: EqualDailyShareDay[] = [];
        for (let index = 0; index < 1 + Math.floor(random() * 15); index += 1) {
          const participants = pool.filter(() => random() < 0.6);
          const fund =
            participants.length === 0 ? 0 : Math.floor(random() * 2_000_000);
          const date = new Date(Date.UTC(2026, 9, 1 + index))
            .toISOString()
            .slice(0, 10);
          days.push(day(date, fund, participants));
        }
        const result = calculateEqualDailyDistribution(days);
        const fund = days.reduce((sum, item) => sum + item.fundAmount, 0);
        expect(result.lines.reduce((sum, line) => sum + line.amount, 0)).toBe(
          fund,
        );
        for (const item of result.days) {
          const values = item.allocations.map((line) => line.amount);
          if (values.length > 0) {
            expect(
              Math.max(...values) - Math.min(...values),
            ).toBeLessThanOrEqual(1);
          }
        }
      }
    });
  });
});
