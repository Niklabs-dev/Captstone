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
    mimeType: 'image/jpeg',
    sizeBytes: BigInt(JPEG.length),
    sha256Hash: STORED_VOUCHER.sha256Hash,
    createdAt: new Date('2026-03-10T20:14:30.000Z'),
  },
};

function createService() {
  const prisma = {
    $transaction: vi.fn(),
    $queryRaw: vi.fn().mockResolvedValue([]),
    dailyOperation: {
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
    },
    dailyOperationVoucher: {
      create: vi.fn(),
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

describe('DailyOperationsService (SPRINT-4R-T01)', () => {
  it('crea la operación con voucher, fondo calculado y montos BigInt', async () => {
    const { service, prisma, stores, voucherStorage } = createService();
    prisma.dailyOperation.findUnique.mockResolvedValue(null);
    prisma.dailyOperationVoucher.create.mockResolvedValue({
      id: 'voucher-1',
    });
    prisma.dailyOperation.create.mockResolvedValue({ id: 'op-1' });
    prisma.dailyOperation.findUniqueOrThrow.mockResolvedValue(RECORD);

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
    expect(result.operation).toMatchObject({
      id: 'op-1',
      businessDate: '2026-03-10',
      cardTipAmount: 31602,
      cashTipAmount: 4500,
      tipFundAmount: 36102,
      cashDifference: -1000,
      store: { id: STORE_ID, name: 'Local Demo' },
      responsible: { id: USER.id, name: 'Supervisor Demo' },
      voucher: {
        sha256Hash: STORED_VOUCHER.sha256Hash,
        mimeType: 'image/jpeg',
      },
    });
  });

  it('crea sin voucher cuando no hay propina de tarjeta', async () => {
    const { service, prisma, voucherStorage } = createService();
    prisma.dailyOperation.findUnique.mockResolvedValue(null);
    prisma.dailyOperation.create.mockResolvedValue({ id: 'op-2' });
    prisma.dailyOperation.findUniqueOrThrow.mockResolvedValue({
      ...RECORD,
      id: 'op-2',
      cardTipAmount: BigInt(0),
      tipFundAmount: BigInt(4500),
      voucher: null,
    });

    const result = await service.create(
      { ...DTO, cardTipAmount: 0 },
      undefined,
      USER,
    );

    expect(result.created).toBe(true);
    expect(voucherStorage.save).not.toHaveBeenCalled();
    expect(prisma.dailyOperationVoucher.create).not.toHaveBeenCalled();
    expect(prisma.dailyOperation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ voucherId: null }) as Record<
          string,
          unknown
        >,
      }),
    );
    expect(result.operation.voucher).toBeNull();
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

  it('exige motivo cuando la diferencia no es cero y lo conserva', async () => {
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

  it('resuelve el reintento idéntico con el mismo hash sin crear nada', async () => {
    const { service, prisma, voucherStorage } = createService();
    prisma.dailyOperation.findUnique.mockResolvedValue(RECORD);

    const result = await service.create(DTO, VOUCHER_FILE, USER);

    expect(result.created).toBe(false);
    expect(result.operation.id).toBe('op-1');
    expect(voucherStorage.save).not.toHaveBeenCalled();
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

    await expect(service.create(DTO, VOUCHER_FILE, USER)).rejects.toThrow(
      'fallo de red',
    );
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
});
