import { TIP_POOL_ISSUE_CODE } from '../types/tip-pools.types.js';
import {
  validateEqualPoolSources,
  type DailyOperationCandidate,
} from './equal-pool-validation.js';

// Tests unitarios de la validación de fuentes del reparto equitativo
// (SPRINT-4R-T04).

const PERIOD = { periodStart: '2026-10-01', periodEnd: '2026-10-15' } as const;

function operation(
  overrides: Partial<DailyOperationCandidate> = {},
): DailyOperationCandidate {
  return {
    id: 'op-1',
    businessDate: '2026-10-02',
    tipFundAmount: 10_000,
    participantIds: ['w-1', 'w-2'],
    usedByPoolId: null,
    ...overrides,
  };
}

describe('validateEqualPoolSources', () => {
  it('sin causas cuando cada día con fondo tiene participantes', () => {
    expect(
      validateEqualPoolSources({
        ...PERIOD,
        currentPoolId: null,
        operations: [
          operation(),
          // Un día sin propinas no exige participantes.
          operation({ id: 'op-2', tipFundAmount: 0, participantIds: [] }),
        ],
      }),
    ).toEqual([]);
  });

  it('DAILY_OPERATIONS_MISSING sin operaciones en el período', () => {
    expect(
      validateEqualPoolSources({
        ...PERIOD,
        currentPoolId: null,
        operations: [],
      }),
    ).toEqual([
      {
        code: TIP_POOL_ISSUE_CODE.DAILY_OPERATIONS_MISSING,
        message:
          'No hay operaciones diarias registradas en el local entre el 2026-10-01 y el 2026-10-15.',
      },
    ]);
  });

  it('DAILY_PARTICIPANTS_MISSING identifica los días con fondo y sin participantes', () => {
    const issues = validateEqualPoolSources({
      ...PERIOD,
      currentPoolId: null,
      operations: [
        operation(),
        operation({
          id: 'op-3',
          businessDate: '2026-10-03',
          tipFundAmount: 4_500,
          participantIds: [],
        }),
      ],
    });
    expect(issues).toEqual([
      {
        code: TIP_POOL_ISSUE_CODE.DAILY_PARTICIPANTS_MISSING,
        message: expect.stringContaining('1 día(s)') as string,
        details: {
          operations: [
            {
              operationId: 'op-3',
              businessDate: '2026-10-03',
              tipFundAmount: 4_500,
            },
          ],
        },
      },
    ]);
  });

  it('DAILY_OPERATION_ALREADY_USED salvo que sea el borrador que se recalcula', () => {
    const used = operation({ usedByPoolId: 'pool-otro' });
    expect(
      validateEqualPoolSources({
        ...PERIOD,
        currentPoolId: 'pool-actual',
        operations: [used],
      }).map((issue) => issue.code),
    ).toEqual([TIP_POOL_ISSUE_CODE.DAILY_OPERATION_ALREADY_USED]);

    expect(
      validateEqualPoolSources({
        ...PERIOD,
        currentPoolId: 'pool-otro',
        operations: [used],
      }),
    ).toEqual([]);
  });

  it('junta todas las causas a la vez', () => {
    expect(
      validateEqualPoolSources({
        ...PERIOD,
        currentPoolId: null,
        operations: [
          operation({ usedByPoolId: 'pool-otro' }),
          operation({ id: 'op-2', participantIds: [] }),
        ],
      }).map((issue) => issue.code),
    ).toEqual([
      TIP_POOL_ISSUE_CODE.DAILY_OPERATION_ALREADY_USED,
      TIP_POOL_ISSUE_CODE.DAILY_PARTICIPANTS_MISSING,
    ]);
  });
});
