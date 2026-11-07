import type { AuthUser } from '../../auth/types/auth.types.js';
import type { CreateDailyOperationDto } from '../dto/create-daily-operation.dto.js';
import type { DailyOperationResponse } from '../types/daily-operations.types.js';
import { isIdenticalDailyOperationRetry } from './daily-operation-retry.util.js';
const USER: AuthUser = {
  id: 'user-1',
  email: 'supervisor@moi-food.cl',
  role: 'SUPERVISOR',
  storeId: 'store-1',
};

const OTHER_USER: AuthUser = { ...USER, id: 'user-2' };

function dto(
  overrides: Partial<CreateDailyOperationDto> = {},
): CreateDailyOperationDto {
  return {
    storeId: 'store-1',
    businessDate: '2026-03-10',
    cardTipAmount: 31602,
    cashTipAmount: 4500,
    cashDifference: -1000,
    differenceReason: 'Vuelto no registrado',
    participantIds: ['worker-1', 'worker-2'],
    ...overrides,
  };
}

function operation(
  overrides: Partial<DailyOperationResponse> = {},
): DailyOperationResponse {
  return {
    id: 'op-1',
    store: { id: 'store-1', name: 'Subway Melipilla Centro' },
    businessDate: '2026-03-10',
    cardTipAmount: 31602,
    cashTipAmount: 4500,
    tipFundAmount: 36102,
    cashDifference: -1000,
    differenceReason: 'Vuelto no registrado',
    voucher: {
      id: 'voucher-1',
      fileName: 'voucher.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 183_492,
      sha256Hash: 'a'.repeat(64),
      createdAt: new Date('2026-03-10T20:15:00.000Z'),
    },
    responsible: { id: 'user-1', name: 'Supervisor Uno' },
    participants: [
      { id: 'worker-1', name: 'Ana Participa' },
      { id: 'worker-2', name: 'Beto Participa' },
    ],
    createdAt: new Date('2026-03-10T20:14:30.000Z'),
    updatedAt: new Date('2026-03-10T20:14:30.000Z'),
    ...overrides,
  };
}

describe('Reintento idéntico de la operación diaria (SPRINT-4R-T01)', () => {
  it('acepta el mismo contenido con el mismo voucher (mismo hash)', () => {
    expect(
      isIdenticalDailyOperationRetry(operation(), dto(), 'a'.repeat(64), USER),
    ).toBe(true);
  });

  it('acepta la comparación sin voucher cuando no hay propina de tarjeta', () => {
    const noCard = operation({
      cardTipAmount: 0,
      tipFundAmount: 4500,
      voucher: null,
    });
    const noCardDto = dto({ cardTipAmount: 0 });
    expect(isIdenticalDailyOperationRetry(noCard, noCardDto, null, USER)).toBe(
      true,
    );
  });

  it('rechaza un voucher distinto aunque los montos coincidan', () => {
    expect(
      isIdenticalDailyOperationRetry(operation(), dto(), 'b'.repeat(64), USER),
    ).toBe(false);
  });

  it('rechaza cuando falta el voucher que la operación existente sí tiene', () => {
    expect(isIdenticalDailyOperationRetry(operation(), dto(), null, USER)).toBe(
      false,
    );
  });

  it.each<[string, CreateDailyOperationDto, string, AuthUser]>([
    ['otro local', dto({ storeId: 'store-2' }), 'a'.repeat(64), USER],
    ['otra fecha', dto({ businessDate: '2026-03-11' }), 'a'.repeat(64), USER],
    [
      'otro monto de tarjeta',
      dto({ cardTipAmount: 31603 }),
      'a'.repeat(64),
      USER,
    ],
    [
      'otro monto de efectivo',
      dto({ cashTipAmount: 4501 }),
      'a'.repeat(64),
      USER,
    ],
    ['otra diferencia', dto({ cashDifference: 0 }), 'a'.repeat(64), USER],
    [
      'otro motivo',
      dto({ differenceReason: 'Otro motivo' }),
      'a'.repeat(64),
      USER,
    ],
    [
      'motivo omitido',
      dto({ differenceReason: undefined }),
      'a'.repeat(64),
      USER,
    ],
    ['otro responsable', dto(), 'a'.repeat(64), OTHER_USER],
  ])('rechaza %s', (_label, candidate, hash, user) => {
    expect(
      isIdenticalDailyOperationRetry(operation(), candidate, hash, user),
    ).toBe(false);
  });

  it('trata motivo ausente y null como equivalentes', () => {
    const withoutReason = operation({
      cashDifference: 0,
      differenceReason: null,
    });
    const retryDto = dto({ cashDifference: 0 });
    delete retryDto.differenceReason;
    expect(
      isIdenticalDailyOperationRetry(
        withoutReason,
        retryDto,
        'a'.repeat(64),
        USER,
      ),
    ).toBe(true);
  });

  it('acepta la misma selección en otro orden (comparación como conjunto)', () => {
    expect(
      isIdenticalDailyOperationRetry(
        operation(),
        dto({ participantIds: ['worker-2', 'worker-1'] }),
        'a'.repeat(64),
        USER,
      ),
    ).toBe(true);
  });

  it('acepta selección vacía en ambos lados cuando no hay fondo', () => {
    const noFund = operation({
      cardTipAmount: 0,
      cashTipAmount: 0,
      tipFundAmount: 0,
      voucher: null,
      participants: [],
    });
    expect(
      isIdenticalDailyOperationRetry(
        noFund,
        dto({ cardTipAmount: 0, cashTipAmount: 0, participantIds: [] }),
        null,
        USER,
      ),
    ).toBe(true);
  });

  it.each<[string, CreateDailyOperationDto]>([
    ['otra selección', dto({ participantIds: ['worker-1', 'worker-3'] })],
    [
      'selección con un participante menos',
      dto({ participantIds: ['worker-1'] }),
    ],
    [
      'selección con un participante más',
      dto({ participantIds: ['worker-1', 'worker-2', 'worker-3'] }),
    ],
    [
      'selección omitida cuando la operación sí tiene participantes',
      dto({ participantIds: undefined }),
    ],
  ])('rechaza %s', (_label, candidate) => {
    expect(
      isIdenticalDailyOperationRetry(
        operation(),
        candidate,
        'a'.repeat(64),
        USER,
      ),
    ).toBe(false);
  });
});
