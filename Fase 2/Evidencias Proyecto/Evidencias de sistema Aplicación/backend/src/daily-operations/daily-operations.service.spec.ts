import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { AuthUser } from '../auth/types/auth.types.js';
import { Prisma } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { StoresService } from '../stores/stores.service.js';
import {
  DailyOperationsService,
  type DailyOperationVoucherFile,
} from './daily-operations.service.js';
import type { DailyVoucherStorageService } from './daily-voucher-storage.service.js';
import type { CreateDailyOperationDto } from './dto/create-daily-operation.dto.js';

const STORE_ID = '1010021e-9bab-42d5-851c-417e9e2503bf';
const OTHER_STORE_ID = '2010021e-9bab-42d5-851c-417e9e2503bf';
const WORKER_1 = 'b2c3d4e5-f6a7-4890-b1c2-d3e4f5a6b7c8';
const WORKER_2 = 'c3d4e5f6-a7b8-4901-c2d3-e4f5a6b7c8d9';

const USER: AuthUser = {
  id: 'a9000000-0000-4000-8000-000000000001',
  email: 'supervisor@daily-unit-test.invalid',
  role: 'SUPERVISOR',
  storeId: STORE_ID,
};

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const VOUCHER_FILE: DailyOperationVoucherFile = {
  originalname: 'voucher-terminal-1.jpg',
  mimetype: 'image/jpeg',
  size: JPEG.length,
  buffer: JPEG,
};

const STORED_VOUCHER = {
  relativePath: 'vouchers/2026/11/voucher-id.jpg',
  mimeType: 'image/jpeg' as const,
  sizeBytes: JPEG.length,
  sha256Hash: 'ab'.repeat(32),
};

const DTO: CreateDailyOperationDto = {
  storeId: STORE_ID,
  businessDate: '2026-03-10',
  cardTipAmount: 31602,
  cashTipAmount: 4500,
  cashDifference: -1000,
  differenceReason: 'Vuelto no registrado',
  participantIds: [WORKER_1, WORKER_2],
};

const RECORD = {
  id: 'op-1',
  businessDate: new Date('2026-03-10T00:00:00.000Z'),
  cardTipAmount: BigInt(31602),
  cashTipAmount: BigInt(4500),
  tipFundAmount: BigInt(36102),
  cashDifference: BigInt(-1000),
  differenceReason: 'Vuelto no registrado',
  createdAt: new Date('2026-03-10T20:14:30.000Z'),
  updatedAt: new Date('2026-03-10T20:14:30.000Z'),
  store: { id: STORE_ID, name: 'Local Demo' },
  responsible: { id: USER.id, firstName: 'Supervisor', lastName: 'Demo' },
  voucher: {
    id: 'voucher-1',
    fileName: 'voucher-terminal-1.jpg',
    filePath: 'vouchers/2026/11/voucher-anterior.jpg',
    mimeType: 'image/jpeg',
    sizeBytes: BigInt(JPEG.length),
    sha256Hash: STORED_VOUCHER.sha256Hash,
    createdAt: new Date('2026-03-10T20:14:30.000Z'),
  },
  participants: [
    { worker: { id: WORKER_1, firstName: 'Ana', lastName: 'Participa' } },
    { worker: { id: WORKER_2, firstName: 'Beto', lastName: 'Participa' } },
  ],
};

function triggerError(
  originalCode: string,
  originalMessage: string,
): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('error de la base', {
    code: 'P2039',
    clientVersion: '7.10.0',
    meta: {
      driverAdapterError: {
        cause: { originalCode, originalMessage },
      },
    },
  });
}

function createService() {
  const prisma = {
    $transaction: vi.fn(),
    $queryRaw: vi.fn().mockResolvedValue([]),
    dailyOperation: {
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    dailyOperationVoucher: {
      create: vi.fn(),
      delete: vi.fn(),
    },
    dailyOperationParticipant: {
      createMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    user: {
      findMany: vi.fn(),
    },
  };
  prisma.$transaction.mockImplementation(
    (callback: (client: unknown) => Promise<unknown>) => callback(prisma),
  );
  const stores = { assertActive: vi.fn().mockResolvedValue({}) };
  const voucherStorage = {
    save: vi.fn().mockResolvedValue(STORED_VOUCHER),
    computeSha256: vi
      .fn()
      .mockImplementation((content: Buffer) =>
        content === JPEG ? STORED_VOUCHER.sha256Hash : 'cd'.repeat(32),
      ),
    remove: vi.fn().mockResolvedValue(undefined),
    read: vi.fn(),
  };
  const service = new DailyOperationsService(
    prisma as unknown as PrismaService,
    stores as unknown as StoresService,
    voucherStorage as unknown as DailyVoucherStorageService,
  );
  return { service, prisma, stores, voucherStorage };
}

describe('DailyOperationsService (SPRINT-4R-T01 y SPRINT-4R-T03)', () => {
  it('crea la operación con voucher, fondo calculado, participantes y montos BigInt', async () => {
    const { service, prisma, stores, voucherStorage } = createService();
    prisma.dailyOperation.findUnique.mockResolvedValue(null);
    prisma.dailyOperationVoucher.create.mockResolvedValue({
      id: 'voucher-1',
    });
    prisma.dailyOperation.create.mockResolvedValue({ id: 'op-1' });
    prisma.dailyOperation.findUniqueOrThrow.mockResolvedValue(RECORD);
    prisma.user.findMany.mockResolvedValue([
      { id: WORKER_1 },
      { id: WORKER_2 },
    ]);

    const result = await service.create(DTO, VOUCHER_FILE, USER);

    expect(result.created).toBe(true);
    expect(stores.assertActive).toHaveBeenCalledWith(STORE_ID);
    expect(voucherStorage.save).toHaveBeenCalledWith(JPEG, 'image/jpeg');
    expect(prisma.dailyOperationVoucher.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          fileName: 'voucher-terminal-1.jpg',
          filePath: STORED_VOUCHER.relativePath,
          sha256Hash: STORED_VOUCHER.sha256Hash,
        }) as Record<string, unknown>,
      }),
    );
    expect(prisma.dailyOperation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          storeId: STORE_ID,
          businessDate: new Date('2026-03-10T00:00:00.000Z'),
          cardTipAmount: BigInt(31602),
          cashTipAmount: BigInt(4500),
          tipFundAmount: BigInt(36102),
          cashDifference: BigInt(-1000),
          differenceReason: 'Vuelto no registrado',
          responsibleId: USER.id,
          voucherId: 'voucher-1',
        }) as Record<string, unknown>,
      }),
    );
    // La selección se guarda en la misma transacción que la operación.
    expect(prisma.dailyOperationParticipant.createMany).toHaveBeenCalledWith({
      data: [
        { operationId: 'op-1', workerId: WORKER_1 },
        { operationId: 'op-1', workerId: WORKER_2 },
      ],
    });
    expect(result.operation).toMatchObject({
      id: 'op-1',
      businessDate: '2026-03-10',
      cardTipAmount: 31602,
      cashTipAmount: 4500,
      tipFundAmount: 36102,
      cashDifference: -1000,
      store: { id: STORE_ID, name: 'Local Demo' },
      responsible: { id: USER.id, name: 'Supervisor Demo' },
      participants: [
        { id: WORKER_1, name: 'Ana Participa' },
        { id: WORKER_2, name: 'Beto Participa' },
      ],
      voucher: {
        sha256Hash: STORED_VOUCHER.sha256Hash,
        mimeType: 'image/jpeg',
      },
    });
  });

  it('crea sin voucher ni participantes cuando el fondo es 0', async () => {
    const { service, prisma, voucherStorage } = createService();
    prisma.dailyOperation.findUnique.mockResolvedValue(null);
    prisma.dailyOperation.create.mockResolvedValue({ id: 'op-2' });
    prisma.dailyOperation.findUniqueOrThrow.mockResolvedValue({
      ...RECORD,
      id: 'op-2',
      cardTipAmount: BigInt(0),
      cashTipAmount: BigInt(0),
      tipFundAmount: BigInt(0),
      voucher: null,
      participants: [],
    });

    const result = await service.create(
      { ...DTO, cardTipAmount: 0, cashTipAmount: 0, participantIds: [] },
      undefined,
      USER,
    );

    expect(result.created).toBe(true);
    expect(voucherStorage.save).not.toHaveBeenCalled();
    expect(prisma.dailyOperationVoucher.create).not.toHaveBeenCalled();
    expect(prisma.dailyOperationParticipant.createMany).not.toHaveBeenCalled();
    expect(prisma.dailyOperation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ voucherId: null }) as Record<
          string,
          unknown
        >,
      }),
    );
    expect(result.operation.voucher).toBeNull();
    expect(result.operation.participants).toEqual([]);
  });

  it('exige el voucher cuando hay propina de tarjeta', async () => {
    const { service, prisma } = createService();
    prisma.dailyOperation.findUnique.mockResolvedValue(null);
    await expect(service.create(DTO, undefined, USER)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.dailyOperation.create).not.toHaveBeenCalled();
  });

  it('rechaza un voucher cuando no hay propina de tarjeta', async () => {
    const { service } = createService();
    await expect(
      service.create({ ...DTO, cardTipAmount: 0 }, VOUCHER_FILE, USER),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('exige motivo cuando la diferencia no es cero', async () => {
    const { service, prisma } = createService();
    const noReason = { ...DTO };
    delete noReason.differenceReason;
    prisma.dailyOperation.findUnique.mockResolvedValue(null);
    await expect(
      service.create(noReason, VOUCHER_FILE, USER),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('permite la diferencia cero sin motivo', async () => {
    const { service, prisma } = createService();
    prisma.dailyOperation.findUnique.mockResolvedValue(null);
    prisma.dailyOperationVoucher.create.mockResolvedValue({
      id: 'voucher-1',
    });
    prisma.dailyOperation.create.mockResolvedValue({ id: 'op-3' });
    prisma.dailyOperation.findUniqueOrThrow.mockResolvedValue({
      ...RECORD,
      id: 'op-3',
      cashDifference: BigInt(0),
      differenceReason: null,
    });
    prisma.user.findMany.mockResolvedValue([
      { id: WORKER_1 },
      { id: WORKER_2 },
    ]);
    const noReason = { ...DTO };
    delete noReason.differenceReason;
    const result = await service.create(
      { ...noReason, cashDifference: 0 },
      VOUCHER_FILE,
      USER,
    );
    expect(result.created).toBe(true);
    expect(result.operation.cashDifference).toBe(0);
    expect(result.operation.differenceReason).toBeNull();
  });

  it('rechaza la selección vacía cuando el fondo es mayor que 0', async () => {
    const { service, prisma } = createService();
    prisma.dailyOperation.findUnique.mockResolvedValue(null);
    await expect(
      service.create({ ...DTO, participantIds: [] }, VOUCHER_FILE, USER),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.dailyOperation.create).not.toHaveBeenCalled();
  });

  it('rechaza selección informada cuando el fondo es 0', async () => {
    const { service, prisma } = createService();
    prisma.dailyOperation.findUnique.mockResolvedValue(null);
    await expect(
      service.create(
        { ...DTO, cardTipAmount: 0, cashTipAmount: 0 },
        undefined,
        USER,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.dailyOperation.create).not.toHaveBeenCalled();
  });

  it('rechaza participantIds repetidos identificándolos', async () => {
    const { service, prisma } = createService();
    prisma.dailyOperation.findUnique.mockResolvedValue(null);
    const attempt = service.create(
      { ...DTO, participantIds: [WORKER_1, WORKER_1] },
      VOUCHER_FILE,
      USER,
    );
    const error: unknown = await attempt.then(
      () => null,
      (rejection: unknown) => rejection,
    );
    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).message).toContain(WORKER_1);
    expect(prisma.dailyOperation.create).not.toHaveBeenCalled();
  });

  it('rechaza trabajadores no elegibles para el local (otro local, rol o inactivo)', async () => {
    const { service, prisma } = createService();
    prisma.dailyOperation.findUnique.mockResolvedValue(null);
    // El catálogo de elegibles solo devuelve a WORKER_1: WORKER_2 no es
    // trabajador activo del local (o tiene otro rol).
    prisma.user.findMany.mockResolvedValue([{ id: WORKER_1 }]);
    const attempt = service.create(DTO, VOUCHER_FILE, USER);
    const error: unknown = await attempt.then(
      () => null,
      (rejection: unknown) => rejection,
    );
    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).message).toContain(WORKER_2);
    expect(prisma.dailyOperation.create).not.toHaveBeenCalled();
  });

  it('resuelve el reintento idéntico con la misma selección en otro orden', async () => {
    const { service, prisma, voucherStorage } = createService();
    prisma.dailyOperation.findUnique.mockResolvedValue(RECORD);

    const result = await service.create(
      { ...DTO, participantIds: [WORKER_2, WORKER_1] },
      VOUCHER_FILE,
      USER,
    );

    expect(result.created).toBe(false);
    expect(result.operation.id).toBe('op-1');
    expect(voucherStorage.save).not.toHaveBeenCalled();
    expect(prisma.dailyOperation.create).not.toHaveBeenCalled();
    expect(prisma.dailyOperationParticipant.createMany).not.toHaveBeenCalled();
  });

  it('conflicto con existingOperationId cuando la selección difiere', async () => {
    const { service, prisma } = createService();
    prisma.dailyOperation.findUnique.mockResolvedValue(RECORD);

    const attempt = service.create(
      { ...DTO, participantIds: [WORKER_1] },
      VOUCHER_FILE,
      USER,
    );
    const error: unknown = await attempt.then(
      () => null,
      (rejection: unknown) => rejection,
    );
    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toMatchObject({
      existingOperationId: 'op-1',
    });
    expect(prisma.dailyOperation.create).not.toHaveBeenCalled();
  });

  it('conflicto con existingOperationId cuando el contenido difiere', async () => {
    const { service, prisma } = createService();
    prisma.dailyOperation.findUnique.mockResolvedValue(RECORD);

    const attempt = service.create(
      { ...DTO, cashTipAmount: 999 },
      VOUCHER_FILE,
      USER,
    );
    const error: unknown = await attempt.then(
      () => null,
      (rejection: unknown) => rejection,
    );
    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toMatchObject({
      existingOperationId: 'op-1',
    });
    expect(prisma.dailyOperation.create).not.toHaveBeenCalled();
  });

  it('un reintento con archivo distinto (hash distinto) no es idéntico', async () => {
    const { service, prisma } = createService();
    prisma.dailyOperation.findUnique.mockResolvedValue(RECORD);
    const otherFile: DailyOperationVoucherFile = {
      ...VOUCHER_FILE,
      buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0x99, 0x99]),
    };
    await expect(service.create(DTO, otherFile, USER)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('rechaza al supervisor de otro local antes de tocar la base', async () => {
    const { service, prisma } = createService();
    const otherSupervisor: AuthUser = {
      ...USER,
      id: 'b9000000-0000-4000-8000-000000000002',
      storeId: OTHER_STORE_ID,
    };
    await expect(
      service.create(DTO, VOUCHER_FILE, otherSupervisor),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.dailyOperation.findUnique).not.toHaveBeenCalled();
  });

  it('resuelve la carrera P2002 como duplicado idéntico', async () => {
    const { service, prisma, voucherStorage } = createService();
    // Primera lectura: nada. Dentro de la transacción: carrera (P2002).
    prisma.dailyOperation.findUnique
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('duplicado', {
          code: 'P2002',
          clientVersion: '7.10.0',
        }),
      )
      .mockResolvedValueOnce(RECORD);
    prisma.dailyOperation.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('duplicado', {
        code: 'P2002',
        clientVersion: '7.10.0',
      }),
    );
    prisma.user.findMany.mockResolvedValue([
      { id: WORKER_1 },
      { id: WORKER_2 },
    ]);

    const result = await service.create(DTO, VOUCHER_FILE, USER);

    expect(result.created).toBe(false);
    expect(result.operation.id).toBe('op-1');
    // El voucher guardado quedó huérfano: se elimina como mejor esfuerzo.
    expect(voucherStorage.remove).toHaveBeenCalledWith(
      STORED_VOUCHER.relativePath,
    );
  });

  it('limpia el voucher guardado si la transacción falla', async () => {
    const { service, prisma, voucherStorage } = createService();
    prisma.dailyOperation.findUnique.mockResolvedValue(null);
    prisma.dailyOperationVoucher.create.mockResolvedValue({
      id: 'voucher-1',
    });
    prisma.dailyOperation.create.mockRejectedValue(new Error('fallo de red'));
    prisma.user.findMany.mockResolvedValue([
      { id: WORKER_1 },
      { id: WORKER_2 },
    ]);

    await expect(service.create(DTO, VOUCHER_FILE, USER)).rejects.toThrow(
      'fallo de red',
    );
    expect(voucherStorage.remove).toHaveBeenCalledWith(
      STORED_VOUCHER.relativePath,
    );
  });

  it('mapea el rechazo de trigger de la base (selección no elegible) a 409 claro', async () => {
    const { service, prisma, voucherStorage } = createService();
    prisma.dailyOperation.findUnique.mockResolvedValue(null);
    prisma.dailyOperationVoucher.create.mockResolvedValue({
      id: 'voucher-1',
    });
    prisma.dailyOperation.create.mockResolvedValue({ id: 'op-1' });
    prisma.dailyOperation.findUniqueOrThrow.mockResolvedValue(RECORD);
    prisma.user.findMany.mockResolvedValue([
      { id: WORKER_1 },
      { id: WORKER_2 },
    ]);
    prisma.dailyOperationParticipant.createMany.mockRejectedValue(
      triggerError(
        '23514',
        'El participante x debe ser un trabajador activo del local de la operación y',
      ),
    );

    const attempt = service.create(DTO, VOUCHER_FILE, USER);
    const error: unknown = await attempt.then(
      () => null,
      (rejection: unknown) => rejection,
    );
    expect(error).toBeInstanceOf(ConflictException);
    // El voucher guardado queda huérfano: se elimina como mejor esfuerzo.
    expect(voucherStorage.remove).toHaveBeenCalledWith(
      STORED_VOUCHER.relativePath,
    );
  });

  it('findAll devuelve el arreglo de operaciones mapeadas', async () => {
    const { service, prisma } = createService();
    prisma.dailyOperation.findMany.mockResolvedValue([RECORD]);

    const result = await service.findAll(
      { storeId: STORE_ID, businessDate: '2026-03-10' },
      USER,
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 'op-1',
      businessDate: '2026-03-10',
      tipFundAmount: 36102,
      participants: [
        { id: WORKER_1, name: 'Ana Participa' },
        { id: WORKER_2, name: 'Beto Participa' },
      ],
    });
    expect(prisma.dailyOperation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          storeId: STORE_ID,
          businessDate: new Date('2026-03-10T00:00:00.000Z'),
        },
      }),
    );
  });

  it('findOne rechaza UUID inexistente y valida el acceso al local', async () => {
    const { service, prisma } = createService();
    prisma.dailyOperation.findUnique.mockResolvedValue(null);
    await expect(service.findOne('missing-id', USER)).rejects.toBeInstanceOf(
      NotFoundException,
    );

    const otherSupervisor: AuthUser = {
      ...USER,
      storeId: OTHER_STORE_ID,
    };
    prisma.dailyOperation.findUnique.mockResolvedValue(RECORD);
    await expect(
      service.findOne('op-1', otherSupervisor),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('el catálogo de elegibles devuelve solo id y nombre de TRABAJADOR activos del local', async () => {
    const { service, prisma } = createService();
    prisma.user.findMany.mockResolvedValue([
      { id: WORKER_2, firstName: 'Ana', lastName: 'Zurita' },
      { id: WORKER_1, firstName: 'Beto', lastName: 'Andrade' },
    ]);

    const result = await service.findEligibleWorkers(STORE_ID, USER);

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          storeId: STORE_ID,
          isActive: true,
          role: { code: 'TRABAJADOR' },
        },
        orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }, { id: 'asc' }],
        select: { id: true, firstName: true, lastName: true },
      }),
    );
    expect(result).toEqual([
      { id: WORKER_2, name: 'Ana Zurita' },
      { id: WORKER_1, name: 'Beto Andrade' },
    ]);
  });

  it('el catálogo respeta el alcance por local', async () => {
    const { service, prisma } = createService();
    const otherSupervisor: AuthUser = {
      ...USER,
      storeId: OTHER_STORE_ID,
    };
    await expect(
      service.findEligibleWorkers(STORE_ID, otherSupervisor),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });

  describe('update (PATCH)', () => {
    const NO_VOUCHER_RECORD = {
      ...RECORD,
      cardTipAmount: BigInt(0),
      tipFundAmount: BigInt(4500),
      voucher: null,
      participants: [
        { worker: { id: WORKER_1, firstName: 'Ana', lastName: 'Participa' } },
      ],
    };

    it('rechaza operación inexistente y local ajeno', async () => {
      const { service, prisma } = createService();
      prisma.dailyOperation.findUnique.mockResolvedValue(null);
      await expect(
        service.update('missing-id', { cashTipAmount: 1 }, undefined, USER),
      ).rejects.toBeInstanceOf(NotFoundException);

      prisma.dailyOperation.findUnique.mockResolvedValue(RECORD);
      // Lectura de la fila bloqueada dentro de la transacción.
      prisma.dailyOperation.findUniqueOrThrow.mockResolvedValueOnce(RECORD);
      const otherSupervisor: AuthUser = {
        ...USER,
        storeId: OTHER_STORE_ID,
      };
      await expect(
        service.update(
          'op-1',
          { cashTipAmount: 1 },
          undefined,
          otherSupervisor,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rechaza una corrección vacía', async () => {
      const { service, prisma } = createService();
      prisma.dailyOperation.findUnique.mockResolvedValue(RECORD);
      // Lectura de la fila bloqueada dentro de la transacción.
      prisma.dailyOperation.findUniqueOrThrow.mockResolvedValueOnce(RECORD);
      await expect(
        service.update('op-1', {}, undefined, USER),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.dailyOperation.update).not.toHaveBeenCalled();
    });

    it('corrige montos y selección conservando el voucher registrado', async () => {
      const { service, prisma, voucherStorage } = createService();
      prisma.dailyOperation.findUnique.mockResolvedValue(RECORD);
      // Lectura de la fila bloqueada dentro de la transacción.
      prisma.dailyOperation.findUniqueOrThrow.mockResolvedValueOnce(RECORD);
      prisma.user.findMany.mockResolvedValue([{ id: WORKER_1 }]);
      prisma.dailyOperation.findUniqueOrThrow.mockResolvedValue({
        ...RECORD,
        cashTipAmount: BigInt(5000),
        tipFundAmount: BigInt(36602),
        participants: [
          {
            worker: { id: WORKER_1, firstName: 'Ana', lastName: 'Participa' },
          },
        ],
      });

      const result = await service.update(
        'op-1',
        { cashTipAmount: 5000, participantIds: [WORKER_1] },
        undefined,
        USER,
      );

      expect(prisma.dailyOperation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'op-1' },
          data: expect.objectContaining({
            cardTipAmount: BigInt(31602),
            cashTipAmount: BigInt(5000),
            tipFundAmount: BigInt(36602),
            cashDifference: BigInt(-1000),
            differenceReason: 'Vuelto no registrado',
            voucherId: 'voucher-1',
          }) as Record<string, unknown>,
        }),
      );
      expect(prisma.dailyOperationVoucher.delete).not.toHaveBeenCalled();
      expect(prisma.dailyOperationParticipant.deleteMany).toHaveBeenCalledWith({
        where: { operationId: 'op-1' },
      });
      expect(prisma.dailyOperationParticipant.createMany).toHaveBeenCalledWith({
        data: [{ operationId: 'op-1', workerId: WORKER_1 }],
      });
      expect(result.participants).toEqual([
        { id: WORKER_1, name: 'Ana Participa' },
      ]);
      // Sin reemplazo no se toca ningún archivo.
      expect(voucherStorage.remove).not.toHaveBeenCalled();
    });

    it('reemplaza el voucher conservando la selección cuando no se envía', async () => {
      const { service, prisma, voucherStorage } = createService();
      prisma.dailyOperation.findUnique.mockResolvedValue(RECORD);
      // Lectura de la fila bloqueada dentro de la transacción.
      prisma.dailyOperation.findUniqueOrThrow.mockResolvedValueOnce(RECORD);
      prisma.dailyOperationVoucher.create.mockResolvedValue({
        id: 'voucher-2',
      });
      prisma.dailyOperation.findUniqueOrThrow.mockResolvedValue({
        ...RECORD,
        voucher: {
          ...RECORD.voucher,
          id: 'voucher-2',
          fileName: 'voucher-corregido.jpg',
          filePath: STORED_VOUCHER.relativePath,
          sha256Hash: STORED_VOUCHER.sha256Hash,
        },
      });

      await service.update('op-1', {}, VOUCHER_FILE, USER);

      expect(prisma.dailyOperationVoucher.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            filePath: STORED_VOUCHER.relativePath,
            fileName: 'voucher-terminal-1.jpg',
          }) as Record<string, unknown>,
        }),
      );
      expect(prisma.dailyOperation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ voucherId: 'voucher-2' }) as Record<
            string,
            unknown
          >,
        }),
      );
      expect(prisma.dailyOperationVoucher.delete).toHaveBeenCalledWith({
        where: { id: 'voucher-1' },
      });
      // La selección no se envía: se conserva (sin deleteMany).
      expect(
        prisma.dailyOperationParticipant.deleteMany,
      ).not.toHaveBeenCalled();
      // El archivo reemplazado se elimina tras el commit.
      expect(voucherStorage.remove).toHaveBeenCalledWith(
        'vouchers/2026/11/voucher-anterior.jpg',
      );
    });

    it('retira voucher y selección cuando la tarjeta y el fondo quedan en 0', async () => {
      const { service, prisma, voucherStorage } = createService();
      prisma.dailyOperation.findUnique.mockResolvedValue(RECORD);
      // Lectura de la fila bloqueada dentro de la transacción.
      prisma.dailyOperation.findUniqueOrThrow.mockResolvedValueOnce(RECORD);
      prisma.dailyOperation.findUniqueOrThrow.mockResolvedValue({
        ...RECORD,
        cardTipAmount: BigInt(0),
        cashTipAmount: BigInt(0),
        tipFundAmount: BigInt(0),
        voucher: null,
        participants: [],
      });

      await service.update(
        'op-1',
        { cardTipAmount: 0, cashTipAmount: 0 },
        undefined,
        USER,
      );

      expect(prisma.dailyOperation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ voucherId: null }) as Record<
            string,
            unknown
          >,
        }),
      );
      expect(prisma.dailyOperationVoucher.delete).toHaveBeenCalledWith({
        where: { id: 'voucher-1' },
      });
      expect(prisma.dailyOperationParticipant.deleteMany).toHaveBeenCalledWith({
        where: { operationId: 'op-1' },
      });
      expect(
        prisma.dailyOperationParticipant.createMany,
      ).not.toHaveBeenCalled();
      expect(voucherStorage.remove).toHaveBeenCalledWith(
        'vouchers/2026/11/voucher-anterior.jpg',
      );
    });

    it('rechaza voucher de reemplazo con tarjeta resultante 0', async () => {
      const { service, prisma } = createService();
      prisma.dailyOperation.findUnique.mockResolvedValue(RECORD);
      // Lectura de la fila bloqueada dentro de la transacción.
      prisma.dailyOperation.findUniqueOrThrow.mockResolvedValueOnce(RECORD);
      await expect(
        service.update('op-1', { cardTipAmount: 0 }, VOUCHER_FILE, USER),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.dailyOperation.update).not.toHaveBeenCalled();
    });

    it('exige voucher cuando la tarjeta resultante es mayor que 0 y no hay registrado', async () => {
      const { service, prisma } = createService();
      prisma.dailyOperation.findUnique.mockResolvedValue(NO_VOUCHER_RECORD);
      await expect(
        service.update('op-1', { cardTipAmount: 100 }, undefined, USER),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.dailyOperation.update).not.toHaveBeenCalled();
    });

    it('exige motivo cuando la diferencia resultante no es cero', async () => {
      const { service, prisma } = createService();
      prisma.dailyOperation.findUnique.mockResolvedValue({
        ...RECORD,
        differenceReason: null,
        cashDifference: BigInt(0),
      });
      await expect(
        service.update('op-1', { cashDifference: -500 }, undefined, USER),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.dailyOperation.update).not.toHaveBeenCalled();
    });

    it('limpia el motivo cuando la caja queda cuadrada', async () => {
      const { service, prisma } = createService();
      prisma.dailyOperation.findUnique.mockResolvedValue(RECORD);
      // Lectura de la fila bloqueada dentro de la transacción.
      prisma.dailyOperation.findUniqueOrThrow.mockResolvedValueOnce(RECORD);
      prisma.dailyOperation.findUniqueOrThrow.mockResolvedValue({
        ...RECORD,
        cashDifference: BigInt(0),
        differenceReason: null,
      });

      await service.update('op-1', { cashDifference: 0 }, undefined, USER);

      expect(prisma.dailyOperation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ differenceReason: null }) as Record<
            string,
            unknown
          >,
        }),
      );
    });

    it('rechaza selección vacía con fondo mayor que 0 y selección informada con fondo 0', async () => {
      const { service, prisma } = createService();
      prisma.dailyOperation.findUnique.mockResolvedValue(RECORD);
      // Lectura de la fila bloqueada dentro de la transacción.
      prisma.dailyOperation.findUniqueOrThrow.mockResolvedValueOnce(RECORD);
      await expect(
        service.update('op-1', { participantIds: [] }, undefined, USER),
      ).rejects.toBeInstanceOf(BadRequestException);

      await expect(
        service.update(
          'op-1',
          { cardTipAmount: 0, cashTipAmount: 0, participantIds: [WORKER_1] },
          undefined,
          USER,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.dailyOperation.update).not.toHaveBeenCalled();
    });

    it('rechaza duplicados y no elegibles en la corrección', async () => {
      const { service, prisma } = createService();
      prisma.dailyOperation.findUnique.mockResolvedValue(RECORD);
      // Lectura de la fila bloqueada dentro de la transacción.
      prisma.dailyOperation.findUniqueOrThrow.mockResolvedValueOnce(RECORD);
      await expect(
        service.update(
          'op-1',
          { participantIds: [WORKER_1, WORKER_1] },
          undefined,
          USER,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);

      prisma.user.findMany.mockResolvedValue([{ id: WORKER_1 }]);
      const attempt = service.update(
        'op-1',
        { participantIds: [WORKER_1, WORKER_2] },
        undefined,
        USER,
      );
      const error: unknown = await attempt.then(
        () => null,
        (rejection: unknown) => rejection,
      );
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).message).toContain(WORKER_2);
      expect(prisma.dailyOperation.update).not.toHaveBeenCalled();
    });

    it('bloquea la fila y replanifica sobre el estado vigente dentro de la transacción', async () => {
      const { service, prisma, voucherStorage } = createService();
      // Foto previa: voucher-1. Una corrección concurrente ya lo reemplazó
      // por voucher-9 antes de obtener el bloqueo: se retira el vigente.
      prisma.dailyOperation.findUnique.mockResolvedValue(RECORD);
      prisma.dailyOperation.findUniqueOrThrow.mockResolvedValueOnce({
        ...RECORD,
        voucher: {
          ...RECORD.voucher,
          id: 'voucher-9',
          filePath: 'vouchers/2026/11/voucher-concurrente.jpg',
        },
      });
      prisma.dailyOperation.findUniqueOrThrow.mockResolvedValue({
        ...RECORD,
        cardTipAmount: BigInt(0),
        cashTipAmount: BigInt(0),
        tipFundAmount: BigInt(0),
        voucher: null,
        participants: [],
      });

      await service.update(
        'op-1',
        { cardTipAmount: 0, cashTipAmount: 0 },
        undefined,
        USER,
      );

      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
      expect(prisma.dailyOperationVoucher.delete).toHaveBeenCalledWith({
        where: { id: 'voucher-9' },
      });
      expect(voucherStorage.remove).toHaveBeenCalledWith(
        'vouchers/2026/11/voucher-concurrente.jpg',
      );
      expect(voucherStorage.remove).not.toHaveBeenCalledWith(
        'vouchers/2026/11/voucher-anterior.jpg',
      );
    });

    it('mapea el rechazo de trigger (reparto CONFIRMED/PAID) a 409 claro', async () => {
      const { service, prisma, voucherStorage } = createService();
      prisma.dailyOperation.findUnique.mockResolvedValue(RECORD);
      // Lectura de la fila bloqueada dentro de la transacción.
      prisma.dailyOperation.findUniqueOrThrow.mockResolvedValueOnce(RECORD);
      prisma.user.findMany.mockResolvedValue([{ id: WORKER_1 }]);
      prisma.dailyOperationParticipant.deleteMany.mockRejectedValue(
        triggerError(
          '42501',
          'La operación op-1 alimenta un reparto confirmado o pagado: no se permite DELETE sobre participantes',
        ),
      );

      const attempt = service.update(
        'op-1',
        { participantIds: [WORKER_1] },
        undefined,
        USER,
      );
      const error: unknown = await attempt.then(
        () => null,
        (rejection: unknown) => rejection,
      );
      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).message).toContain(
        'reparto confirmado o pagado',
      );
      // El voucher no se tocó: nada que limpiar.
      expect(voucherStorage.remove).not.toHaveBeenCalled();
    });

    it('limpia el voucher guardado si la corrección falla', async () => {
      const { service, prisma, voucherStorage } = createService();
      prisma.dailyOperation.findUnique.mockResolvedValue(RECORD);
      // Lectura de la fila bloqueada dentro de la transacción.
      prisma.dailyOperation.findUniqueOrThrow.mockResolvedValueOnce(RECORD);
      prisma.dailyOperationVoucher.create.mockResolvedValue({
        id: 'voucher-2',
      });
      prisma.dailyOperation.update.mockRejectedValue(new Error('fallo de red'));

      await expect(
        service.update('op-1', {}, VOUCHER_FILE, USER),
      ).rejects.toThrow('fallo de red');
      expect(voucherStorage.remove).toHaveBeenCalledWith(
        STORED_VOUCHER.relativePath,
      );
    });
  });
});
