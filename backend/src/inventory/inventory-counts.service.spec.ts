import { BadRequestException, ConflictException } from '@nestjs/common';
import { ROLE } from '../auth/constants/roles.constants.js';
import type { AuthUser } from '../auth/types/auth.types.js';
import { Prisma } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { InventoryCountsService } from './inventory-counts.service.js';

// Choque con el índice único de la toma En curso (SPRINT-5-T05): si dos
// inicios del mismo local chocan pese al bloqueo, la respuesta es 409, nunca
// un 500. Se simula el P2002 porque por HTTP depende de una carrera.
const supervisor: AuthUser = {
  id: 'supervisor-1',
  email: 'supervisora@moi-food.cl',
  role: ROLE.SUPERVISOR,
  storeId: 'store-1',
};

function serviceWith(
  open: { id: string; countDate: Date } | null,
): InventoryCountsService {
  const prisma = {
    $transaction: vi.fn().mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    ),
    inventoryCount: { findFirst: vi.fn().mockResolvedValue(open) },
  };
  return new InventoryCountsService(prisma as unknown as PrismaService);
}

async function conflictOf(
  service: InventoryCountsService,
): Promise<Record<string, unknown>> {
  const error: unknown = await service
    .start({}, supervisor)
    .catch((rejection: unknown) => rejection);
  expect(error).toBeInstanceOf(ConflictException);
  return (error as ConflictException).getResponse() as Record<string, unknown>;
}

describe('InventoryCountsService.start ante el índice único (SPRINT-5-T05)', () => {
  it('indica la toma en curso que ganó la carrera', async () => {
    const body = await conflictOf(
      serviceWith({
        id: 'count-1',
        countDate: new Date('2026-11-12T00:00:00.000Z'),
      }),
    );
    expect(body).toMatchObject({
      statusCode: 409,
      existingCountId: 'count-1',
      existingCountDate: '2026-11-12',
    });
  });

  it('responde 409 genérico si la otra toma ya no existe', async () => {
    const body = await conflictOf(serviceWith(null));
    expect(body).toEqual({
      statusCode: 409,
      message: 'Otra toma de este local se estaba iniciando',
      errors: {
        store: 'Vuelve a intentarlo: otra toma de tu local se estaba iniciando',
      },
    });
  });
});

// Finalización (SPRINT-5-T06): orden de las escrituras y traducción de los
// rechazos de la base a 409. Las carreras reales se prueban contra
// PostgreSQL en test/inventory-count-finalize.integration.spec.ts.
const COUNT_ID = '9c8b7a6f-5e4d-4c3b-8a29-1f0e9d8c7b6a';

function knownError(
  code: string,
  cause?: { originalCode: string; originalMessage: string },
): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('error de la base', {
    code,
    clientVersion: 'test',
    meta: cause === undefined ? undefined : { driverAdapterError: { cause } },
  });
}

const TRIGGER_FINALIZED = knownError('P2039', {
  originalCode: '42501',
  originalMessage: `La toma de inventario ${COUNT_ID} está finalizada: no se permite INSERT sobre sus líneas`,
});

const DEADLOCK = knownError('P2034', {
  originalCode: '40P01',
  originalMessage: 'deadlock detected',
});

function rejectingService(error: unknown): InventoryCountsService {
  const prisma = { $transaction: vi.fn().mockRejectedValue(error) };
  return new InventoryCountsService(prisma as unknown as PrismaService);
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error('Se esperaba un rechazo');
    },
    (rejection: unknown) => rejection,
  );
}

// Transacción simulada que registra el orden de las operaciones.
function recordingService(
  lines: Array<{ productId: string; countedQuantity: Prisma.Decimal | null }>,
): { service: InventoryCountsService; calls: string[] } {
  const calls: string[] = [];
  const record =
    <T>(name: string, value: T) =>
    (): Promise<T> => {
      calls.push(name);
      return Promise.resolve(value);
    };
  const tx = {
    $queryRaw: vi.fn((strings: TemplateStringsArray) => {
      const sql = strings.join('?');
      if (sql.includes('FOR KEY SHARE')) {
        calls.push('lockActiveProducts');
        return Promise.resolve([{ id: 'p-tuna' }]);
      }
      calls.push(sql.includes('FOR UPDATE') ? 'lockCount' : 'query');
      return Promise.resolve([{ store_id: 'store-1', status: 'OPEN' }]);
    }),
    $executeRaw: vi.fn(record('lockCatalogShared', 0)),
    inventoryCountLine: {
      findMany: vi.fn(record('readLines', lines)),
      createMany: vi.fn(record('insertEmptyLines', { count: 1 })),
    },
    inventoryTemplateRow: { findMany: vi.fn(record('readTemplate', [])) },
    product: {
      findMany: vi.fn(
        record('readActiveProducts', [
          {
            id: 'p-tuna',
            sku: null,
            name: 'Atún',
            unit: 'KG',
            packageName: null,
            boxContent: null,
            packagesPerBox: null,
            packageContent: null,
            looseOnly: true,
          },
        ]),
      ),
    },
    inventoryCount: {
      update: vi.fn(
        record('confirm', {
          id: COUNT_ID,
          status: 'CONFIRMED',
          countDate: new Date('2026-11-12T00:00:00.000Z'),
          countedAt: new Date(),
          finalizedAt: new Date(),
          storeId: 'store-1',
          store: { id: 'store-1', name: 'Local' },
          createdBy: { id: 'supervisor-1', firstName: 'S', lastName: 'R' },
          finalizedBy: { id: 'supervisor-1', firstName: 'S', lastName: 'R' },
          _count: { lines: 1 },
        }),
      ),
    },
  };
  const prisma = {
    $transaction: vi.fn((work: (client: typeof tx) => Promise<unknown>) =>
      work(tx),
    ),
  };
  return {
    service: new InventoryCountsService(prisma as unknown as PrismaService),
    calls,
  };
}

describe('InventoryCountsService.finalize (SPRINT-5-T06)', () => {
  it('bloquea la toma con FOR UPDATE antes de insertar las líneas vacías y confirma al final', async () => {
    const { service, calls } = recordingService([
      { productId: 'p-fajita', countedQuantity: new Prisma.Decimal('10.3') },
    ]);

    const result = await service.finalize(COUNT_ID, supervisor);

    expect(calls).toEqual([
      'lockCount',
      'readLines',
      'lockCatalogShared',
      'readTemplate',
      'lockActiveProducts',
      'readActiveProducts',
      'insertEmptyLines',
      'confirm',
    ]);
    expect(result).toMatchObject({
      id: COUNT_ID,
      status: 'CONFIRMED',
      countedProducts: 1,
      totalProducts: 2,
      uncountedProducts: 1,
    });
  });

  it('una toma sin productos contados no se finaliza: 400 sin escribir nada', async () => {
    const { service, calls } = recordingService([
      { productId: 'p-fajita', countedQuantity: null },
    ]);

    const error = await rejectionOf(service.finalize(COUNT_ID, supervisor));

    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).getResponse()).toEqual({
      statusCode: 400,
      message: 'La toma no tiene productos contados',
      errors: {
        countId:
          'Guarda lo contado de al menos un producto antes de finalizar la toma',
      },
    });
    expect(calls).toEqual(['lockCount', 'readLines']);
  });

  it('el trigger rechaza una toma ya finalizada (P2039, 42501): 409 «está finalizada»', async () => {
    const rejection = await rejectionOf(
      rejectingService(TRIGGER_FINALIZED).finalize(COUNT_ID, supervisor),
    );
    expect(rejection).toBeInstanceOf(ConflictException);
    expect((rejection as ConflictException).getResponse()).toEqual({
      statusCode: 409,
      message: 'La toma de inventario está finalizada',
      errors: { countId: 'La toma está finalizada: no admite cambios' },
    });
  });

  it.each([
    ['deadlock (P2034, 40P01)', DEADLOCK],
    ['conflicto de transacción sin SQLSTATE (P2034)', knownError('P2034')],
    [
      'deadlock informado por el driver (40P01)',
      knownError('P2010', {
        originalCode: '40P01',
        originalMessage: 'deadlock detected',
      }),
    ],
    ['línea duplicada (P2002)', knownError('P2002')],
  ])('%s: 409, nunca 500', async (_case, error) => {
    const rejection = await rejectionOf(
      rejectingService(error).finalize(COUNT_ID, supervisor),
    );
    expect(rejection).toBeInstanceOf(ConflictException);
    expect((rejection as ConflictException).getResponse()).toMatchObject({
      statusCode: 409,
      message: 'Otra solicitud estaba modificando esta toma',
    });
  });

  it.each([
    [
      '23514',
      'La toma de inventario nace En curso (OPEN): se finaliza después',
    ],
    ['42501', 'La línea 4d3c2b1a no puede cambiar de toma ni de producto'],
  ])(
    'otro rechazo de un trigger (%s) también es 409, con su mensaje',
    async (originalCode, message) => {
      const rejection = await rejectionOf(
        rejectingService(
          knownError('P2039', { originalCode, originalMessage: message }),
        ).finalize(COUNT_ID, supervisor),
      );
      expect(rejection).toBeInstanceOf(ConflictException);
      expect((rejection as ConflictException).getResponse()).toEqual({
        statusCode: 409,
        message,
        errors: { countId: message },
      });
    },
  );

  it('los demás errores se propagan sin traducir', async () => {
    const unexpected = new Error('conexión perdida');
    expect(
      await rejectionOf(
        rejectingService(unexpected).finalize(COUNT_ID, supervisor),
      ),
    ).toBe(unexpected);
  });

  it('guardar una línea también traduce el rechazo del trigger a 409', async () => {
    const rejection = await rejectionOf(
      rejectingService(TRIGGER_FINALIZED).saveLine(
        COUNT_ID,
        'p-fajita',
        { boxes: 1 },
        supervisor,
      ),
    );
    expect(rejection).toBeInstanceOf(ConflictException);
    expect((rejection as ConflictException).getResponse()).toMatchObject({
      message: 'La toma de inventario está finalizada',
    });
  });
});
