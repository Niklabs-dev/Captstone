import { EqualDistributionError } from '../../tips/calculation/equal-daily-distribution.calculator.js';
import { planDailyTipAllocations } from './daily-tip-allocations.util.js';

// Cálculo del reparto automático de la operación diaria (SPRINT-4A-T03).
const IDS = [
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000002',
  '30000000-0000-4000-8000-000000000003',
  '40000000-0000-4000-8000-000000000004',
] as const;

// 2026-03-10 está a 20.522 días de 1970-01-01: con 3 participantes la
// rotación del residuo comienza en la posición 20.522 mod 3 = 2.
const BUSINESS_DATE = '2026-03-10';

function plan(fund: number, participantIds: readonly string[]) {
  return planDailyTipAllocations({
    operationId: 'op-1',
    businessDate: BUSINESS_DATE,
    tipFundAmount: fund,
    participantIds,
  });
}

function total(allocations: { amount: number }[]): number {
  return allocations.reduce((sum, allocation) => sum + allocation.amount, 0);
}

describe('planDailyTipAllocations (SPRINT-4A-T03)', () => {
  it('divide $40.000 entre 4 en $10.000 para cada uno', () => {
    expect(plan(40_000, IDS)).toEqual(
      IDS.map((workerId) => ({ workerId, amount: 10_000 })),
    );
  });

  it('entrega el peso de residuo al primero del orden estable y cuadra el fondo', () => {
    const result = plan(10_000, IDS.slice(0, 3));
    // Orden por ID; la rotación del día empieza en la posición 2: el tercer
    // ID recibe el peso extra.
    expect(result).toEqual([
      { workerId: IDS[0], amount: 3_333 },
      { workerId: IDS[1], amount: 3_333 },
      { workerId: IDS[2], amount: 3_334 },
    ]);
    expect(total(result)).toBe(10_000);
  });

  it('es determinista: el orden de entrada no cambia el resultado', () => {
    const reversed = [...IDS.slice(0, 3)].reverse();
    expect(plan(10_000, reversed)).toEqual(plan(10_000, IDS.slice(0, 3)));
  });

  it('reparte varios pesos de residuo de a $1 sin repetir a nadie', () => {
    const result = plan(10_003, IDS);
    expect(result.map((allocation) => allocation.amount).sort()).toEqual([
      2_500, 2_501, 2_501, 2_501,
    ]);
    expect(total(result)).toBe(10_003);
  });

  it('entrega todo el fondo a un único participante', () => {
    expect(plan(31_902, [IDS[0]])).toEqual([
      { workerId: IDS[0], amount: 31_902 },
    ]);
  });

  it('con fondo 0 no crea asignaciones', () => {
    expect(plan(0, [])).toEqual([]);
    expect(plan(0, IDS)).toEqual([]);
  });

  it('la suma siempre es el fondo exacto para fondos y selecciones variados', () => {
    for (let fund = 1; fund <= 2_000; fund += 37) {
      for (let count = 1; count <= IDS.length; count += 1) {
        expect(total(plan(fund, IDS.slice(0, count)))).toBe(fund);
      }
    }
  });

  it('rechaza un fondo mayor que 0 sin participantes', () => {
    expect(() => plan(1_000, [])).toThrow(EqualDistributionError);
  });
});
