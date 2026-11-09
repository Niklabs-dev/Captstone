import type { Prisma } from '../generated/prisma/client.js';
import { OperatingDaysService } from '../operating-days/operating-days.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { StoresService } from '../stores/stores.service.js';
import { SalesReportsService } from './sales-reports.service.js';

// Lecturas coherentes de los reportes (SPRINT-4R-T13): importaciones,
// operaciones, estado diario y catálogo se leen dentro de UNA transacción
// REPEATABLE READ, así una importación confirmada entre dos consultas no deja
// un día con ventas null y estado IMPORTADO.

const NOW = new Date('2026-11-08T15:00:00.000Z');
const QUERY = { from: '2026-11-01', to: '2026-11-07' };

// Modelos que leen los reportes; cada método devuelve vacío.
const MODELS = {
  store: ['findMany', 'findUnique'],
  paymentMethod: ['findMany'],
  salesImport: ['findMany'],
  dailyOperation: ['findMany'],
  storeOperatingSchedule: ['findMany'],
  storeClosure: ['findMany'],
  cashClosing: ['findMany'],
  sale: ['groupBy'],
} as const;

type FakeMethod = ReturnType<typeof vi.fn<() => Promise<unknown>>>;
type FakeModels = Record<string, Record<string, FakeMethod>>;

function fakeModels(implementation: () => Promise<unknown>): FakeModels {
  return Object.fromEntries(
    Object.entries(MODELS).map(([model, methods]) => [
      model,
      Object.fromEntries(
        methods.map((method) => [method, vi.fn(implementation)]),
      ),
    ]),
  );
}

function method(models: FakeModels, model: string, name: string): FakeMethod {
  const fake = models[model]?.[name];
  if (!fake) throw new Error(`Modelo ${model}.${name} no simulado`);
  return fake;
}

function createService() {
  const tx = fakeModels(() => Promise.resolve([]));
  // Fuera de la transacción no se lee nada.
  const root = fakeModels(() =>
    Promise.reject(new Error('lectura fuera de la transacción')),
  );
  const $transaction = vi.fn(
    (
      work: (client: Prisma.TransactionClient) => Promise<unknown>,
    ): Promise<unknown> => work(tx as unknown as Prisma.TransactionClient),
  );
  const prisma = { ...root, $transaction } as unknown as PrismaService;
  const operatingDays = new OperatingDaysService(
    prisma,
    {} as unknown as StoresService,
  );
  return {
    service: new SalesReportsService(prisma, operatingDays),
    $transaction,
    root,
    tx,
  };
}

function calls(models: FakeModels): number {
  return Object.values(models)
    .flatMap((methods) => Object.values(methods))
    .reduce((sum, fake) => sum + fake.mock.calls.length, 0);
}

describe('SalesReportsService (SPRINT-4R-T13)', () => {
  it('lee el reporte vigente en una sola transacción REPEATABLE READ', async () => {
    const { service, $transaction, root, tx } = createService();

    await service.report(QUERY, NOW);

    expect($transaction).toHaveBeenCalledTimes(1);
    expect($transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'RepeatableRead',
    });
    expect(calls(root)).toBe(0);
    // El estado diario (GET /sales-days) también lee dentro de la misma foto.
    expect(method(tx, 'storeOperatingSchedule', 'findMany')).toHaveBeenCalled();
    expect(method(tx, 'salesImport', 'findMany')).toHaveBeenCalled();
  });

  it('valida el local dentro de la misma transacción', async () => {
    const { service, root, tx } = createService();
    method(tx, 'store', 'findUnique').mockResolvedValue({ id: 'local' });

    await service.report({ ...QUERY, storeId: 'local' }, NOW);

    expect(method(tx, 'store', 'findUnique')).toHaveBeenCalled();
    expect(calls(root)).toBe(0);
  });

  it('lee el legado en una sola transacción REPEATABLE READ', async () => {
    const { service, $transaction, root, tx } = createService();

    await service.legacy(QUERY, NOW);

    expect($transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'RepeatableRead',
    });
    expect(calls(root)).toBe(0);
    expect(method(tx, 'cashClosing', 'findMany')).toHaveBeenCalled();
    expect(method(tx, 'sale', 'groupBy')).toHaveBeenCalled();
  });
});
