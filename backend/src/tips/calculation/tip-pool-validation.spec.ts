import { TIP_POOL_ISSUE_CODE } from '../types/tip-pools.types.js';
import {
  validateTipPoolSources,
  type AgreementCandidate,
  type HoursCandidate,
  type TipPoolValidationInput,
} from './tip-pool-validation.js';

const STORE = '1010021e-9bab-42d5-851c-417e9e2503bf';
const OTHER_STORE = '73b590e0-11b2-4781-ba7b-4f7f8c2c6e35';

const AGREEMENT: AgreementCandidate = {
  id: 'agreement-1',
  name: 'Pacto 2026',
  rule: 'PROPORTIONAL_TO_HOURS',
  validFrom: '2026-01-01',
  validTo: null,
};

function hours(overrides: Partial<HoursCandidate> = {}): HoursCandidate {
  return {
    id: 'hours-1',
    workerId: 'worker-1',
    workerName: 'Ana Pérez',
    periodStart: '2026-10-01',
    periodEnd: '2026-10-15',
    hoursWorked: '40.00',
    workerStoreId: STORE,
    workerActive: true,
    ...overrides,
  };
}

function input(
  overrides: Partial<TipPoolValidationInput> = {},
): TipPoolValidationInput {
  return {
    storeId: STORE,
    periodStart: '2026-10-01',
    periodEnd: '2026-10-15',
    currentPoolId: null,
    fundAmount: 10000,
    agreements: [AGREEMENT],
    entries: [
      {
        id: 'entry-1',
        businessDate: '2026-10-02',
        paymentMethod: 'CASH',
        usedByPoolId: null,
      },
    ],
    hours: [hours()],
    ...overrides,
  };
}

function codes(value: TipPoolValidationInput): string[] {
  return validateTipPoolSources(value).issues.map((issue) => issue.code);
}

describe('validateTipPoolSources (SPRINT-3-T12)', () => {
  it('no reporta causas cuando el pacto, los registros y las horas cuadran', () => {
    const result = validateTipPoolSources(input());
    expect(result.issues).toEqual([]);
    expect(result.agreement).toEqual(AGREEMENT);
    expect(result.hours).toHaveLength(1);
  });

  it('acepta un pacto que termina justo el último día del período', () => {
    expect(
      codes(
        input({
          agreements: [
            { ...AGREEMENT, validFrom: '2026-10-01', validTo: '2026-10-15' },
          ],
        }),
      ),
    ).toEqual([]);
  });

  it('reporta AGREEMENT_MISSING sin pactos que toquen el período', () => {
    expect(
      codes(
        input({
          agreements: [{ ...AGREEMENT, validTo: '2026-09-30' }],
        }),
      ),
    ).toEqual([TIP_POOL_ISSUE_CODE.AGREEMENT_MISSING]);
  });

  it('reporta AGREEMENT_CHANGES_IN_PERIOD si el pacto cubre solo una parte', () => {
    const result = validateTipPoolSources(
      input({
        agreements: [
          { ...AGREEMENT, validTo: '2026-10-07' },
          { ...AGREEMENT, id: 'agreement-2', validFrom: '2026-10-08' },
        ],
      }),
    );
    expect(result.issues.map((issue) => issue.code)).toEqual([
      TIP_POOL_ISSUE_CODE.AGREEMENT_CHANGES_IN_PERIOD,
    ]);
    expect(result.agreement).toBeNull();
    expect(result.issues[0].details).toEqual({
      agreements: [
        expect.objectContaining({ id: 'agreement-1' }),
        expect.objectContaining({ id: 'agreement-2' }),
      ],
    });
  });

  it('reporta AGREEMENT_RULE_UNSUPPORTED con otra regla', () => {
    expect(
      codes(input({ agreements: [{ ...AGREEMENT, rule: 'EQUAL_SHARES' }] })),
    ).toEqual([TIP_POOL_ISSUE_CODE.AGREEMENT_RULE_UNSUPPORTED]);
  });

  it('reporta TIP_ENTRIES_MISSING sin registros diarios', () => {
    expect(codes(input({ entries: [] }))).toEqual([
      TIP_POOL_ISSUE_CODE.TIP_ENTRIES_MISSING,
    ]);
  });

  it('reporta TIP_ENTRY_ALREADY_USED salvo para el borrador que se reemplaza', () => {
    const entries = [
      {
        id: 'entry-1',
        businessDate: '2026-10-02',
        paymentMethod: 'CASH' as const,
        usedByPoolId: 'pool-draft',
      },
    ];
    expect(codes(input({ entries }))).toEqual([
      TIP_POOL_ISSUE_CODE.TIP_ENTRY_ALREADY_USED,
    ]);
    expect(codes(input({ entries, currentPoolId: 'pool-draft' }))).toEqual([]);
  });

  it('reporta WORK_HOURS_MISSING y WORK_HOURS_PERIOD_MISMATCH a la vez', () => {
    expect(
      codes(
        input({
          hours: [
            hours({ periodStart: '2026-10-01', periodEnd: '2026-10-14' }),
          ],
        }),
      ),
    ).toEqual([
      TIP_POOL_ISSUE_CODE.WORK_HOURS_MISSING,
      TIP_POOL_ISSUE_CODE.WORK_HOURS_PERIOD_MISMATCH,
    ]);
  });

  it('ignora horas que no tocan el período', () => {
    expect(
      codes(
        input({
          hours: [
            hours(),
            hours({
              id: 'hours-2',
              periodStart: '2026-10-16',
              periodEnd: '2026-10-31',
            }),
          ],
        }),
      ),
    ).toEqual([]);
  });

  it('reporta WORK_HOURS_TOTAL_ZERO solo si hay fondo por repartir', () => {
    const zero = [hours({ hoursWorked: '0.00' })];
    expect(codes(input({ hours: zero }))).toEqual([
      TIP_POOL_ISSUE_CODE.WORK_HOURS_TOTAL_ZERO,
    ]);
    expect(codes(input({ hours: zero, fundAmount: 0 }))).toEqual([]);
  });

  it('reporta WORKER_NOT_IN_STORE por otro local o usuario inactivo', () => {
    const result = validateTipPoolSources(
      input({
        hours: [
          hours({ workerStoreId: OTHER_STORE }),
          hours({ id: 'hours-2', workerId: 'worker-2', workerActive: false }),
        ],
      }),
    );
    expect(result.issues).toEqual([
      expect.objectContaining({
        code: TIP_POOL_ISSUE_CODE.WORKER_NOT_IN_STORE,
        details: {
          workers: [
            expect.objectContaining({
              userId: 'worker-1',
              reason: 'OTHER_STORE',
            }),
            expect.objectContaining({ userId: 'worker-2', reason: 'INACTIVE' }),
          ],
        },
      }),
    ]);
  });

  it('junta todas las causas en una sola respuesta', () => {
    expect(codes(input({ agreements: [], entries: [], hours: [] }))).toEqual([
      TIP_POOL_ISSUE_CODE.AGREEMENT_MISSING,
      TIP_POOL_ISSUE_CODE.TIP_ENTRIES_MISSING,
      TIP_POOL_ISSUE_CODE.WORK_HOURS_MISSING,
    ]);
  });

  it('cada causa trae un mensaje en español no vacío', () => {
    const result = validateTipPoolSources(
      input({ agreements: [], entries: [], hours: [] }),
    );
    for (const issue of result.issues) {
      expect(issue.message.length).toBeGreaterThan(10);
    }
  });
});
