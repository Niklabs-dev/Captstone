import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '../src/generated/prisma/client.js';

// Concurrencia de la toma de inventario (SPRINT-5-T01) contra PostgreSQL real
// con transacciones reales (sin withinRollback: cada carrera necesita dos
// sesiones que vean los mismos datos confirmados). El trigger de las líneas
// toma la toma con FOR NO KEY UPDATE (20261111130000), así que las escrituras
// de líneas de una toma se serializan entre sí y con su finalización:
// - un guardado que llega mientras la finalización aún no confirma espera y,
//   cuando la finalización confirma, se rechaza porque la toma ya está
//   CONFIRMED;
// - dos finalizaciones simultáneas no terminan en deadlock (40P01): una
//   confirma y la otra recibe el rechazo del trigger (SQLSTATE 42501);
// - un guardado que además actualiza la toma no se cruza en deadlock con una
//   finalización.
// Con el FOR SHARE original (20261111120000) las dos últimas carreras
// terminaban en deadlock. Los datos van con un local propio y se eliminan al
// finalizar como mantenimiento (session_replication_role = replica, porque
// la toma finalizada es inmutable).
const databaseUrl = process.env.TEST_DATABASE_URL;

const DOMAIN = '@inventory-concurrency-test.invalid';
const COUNT_DATE = new Date('2026-11-11T00:00:00.000Z');

interface Fixture {
  storeId: string;
  supervisorId: string;
  countedProductId: string;
  uncountedProductId: string;
}

// SQLSTATE original del error de PostgreSQL. Prisma lo expone en
// meta.driverAdapterError.cause.originalCode (P2039 para los RAISE de los
// triggers) y, para un deadlock, como P2034.
function sqlState(error: unknown): string | null {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return null;
  const meta = error.meta as
    { driverAdapterError?: { cause?: { originalCode?: unknown } } } | undefined;
  const code = meta?.driverAdapterError?.cause?.originalCode;
  return typeof code === 'string' ? code : null;
}

// Texto del error para comparar el mensaje del trigger.
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : '';
}

function isDeadlock(error: unknown): boolean {
  return (
    sqlState(error) === '40P01' ||
    (error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2034') ||
    /deadlock/i.test(errorText(error))
  );
}

describe.skipIf(!databaseUrl)(
  'Concurrencia de la toma de inventario (SPRINT-5-T01)',
  { timeout: 60_000 },
  () => {
    let prisma: PrismaClient;
    let fixture: Fixture;
    const productIds: string[] = [];
    let createdRoleId: string | null = null;

    beforeAll(async () => {
      prisma = new PrismaClient({
        adapter: new PrismaPg({ connectionString: databaseUrl }),
      });
      const existingRole = await prisma.role.findUnique({
        where: { code: 'SUPERVISOR' },
      });
      const role =
        existingRole ??
        (await prisma.role.create({
          data: { code: 'SUPERVISOR', name: 'Supervisor' },
        }));
      if (!existingRole) createdRoleId = role.id;
      const store = await prisma.store.create({
        data: {
          name: `Subway Inventario Concurrencia ${randomUUID()}`,
          city: 'Melipilla',
          address: 'Calle 123',
        },
      });
      const supervisor = await prisma.user.create({
        data: {
          email: `${randomUUID()}${DOMAIN}`,
          passwordHash: '$2b$04$hash-de-prueba',
          firstName: 'Supervisor',
          lastName: 'Concurrencia',
          roleId: role.id,
          storeId: store.id,
        },
      });
      const counted = await prisma.product.create({
        data: {
          name: 'Carne Fajita',
          unit: 'KG',
          boxContent: '5',
          packageContent: '2.5',
        },
      });
      const uncounted = await prisma.product.create({
        data: { name: 'Tomate', unit: 'KG' },
      });
      productIds.push(counted.id, uncounted.id);
      fixture = {
        storeId: store.id,
        supervisorId: supervisor.id,
        countedProductId: counted.id,
        uncountedProductId: uncounted.id,
      };
    });

    afterAll(async () => {
      if (fixture) {
        await prisma.$transaction(async (tx) => {
          await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
          await tx.inventoryCountLine.deleteMany({
            where: { count: { storeId: fixture.storeId } },
          });
          await tx.inventoryCount.deleteMany({
            where: { storeId: fixture.storeId },
          });
          await tx.product.deleteMany({ where: { id: { in: productIds } } });
          await tx.user.deleteMany({
            where: { email: { endsWith: DOMAIN } },
          });
          await tx.store.deleteMany({ where: { id: fixture.storeId } });
          if (createdRoleId) {
            await tx.role.delete({ where: { id: createdRoleId } });
          }
        });
      }
      await prisma.$disconnect();
    });

    // Espera a que una sesión de esta base quede bloqueada esperando un lock
    // mientras escribe una toma o sus líneas (la escritura detenida por el
    // bloqueo de la toma).
    async function waitForLockWait(): Promise<void> {
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const rows = await prisma.$queryRaw<Array<{ waiting: bigint }>>`
          SELECT count(*) AS waiting FROM pg_stat_activity
          WHERE datname = current_database()
            AND wait_event_type = 'Lock'
            AND query LIKE '%inventory_count%'`;
        if (rows[0].waiting > 0n) return;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error('La escritura concurrente nunca quedó esperando el lock');
    }

    // Toma OPEN con una línea contada (1 caja de Carne Fajita).
    async function openCountWithLine(): Promise<{
      countId: string;
      lineId: string;
    }> {
      const count = await prisma.inventoryCount.create({
        data: {
          storeId: fixture.storeId,
          createdById: fixture.supervisorId,
          countDate: COUNT_DATE,
        },
      });
      const line = await prisma.inventoryCountLine.create({
        data: {
          countId: count.id,
          productId: fixture.countedProductId,
          boxes: 1,
          countedQuantity: '5',
          productName: 'Carne Fajita',
          unit: 'KG',
          boxContent: '5',
          packageContent: '2.5',
          savedById: fixture.supervisorId,
        },
      });
      return { countId: count.id, lineId: line.id };
    }

    // Línea vacía del producto no contado, como la inserta la finalización.
    function insertEmptyLine(tx: Prisma.TransactionClient, countId: string) {
      return tx.inventoryCountLine.create({
        data: {
          countId,
          productId: fixture.uncountedProductId,
          productName: 'Tomate',
          unit: 'KG',
          savedById: fixture.supervisorId,
        },
      });
    }

    function confirm(tx: Prisma.TransactionClient, countId: string) {
      return tx.inventoryCount.update({
        where: { id: countId },
        data: {
          status: 'CONFIRMED',
          finalizedAt: new Date(),
          finalizedById: fixture.supervisorId,
          templateSnapshot: [],
        },
      });
    }

    // Finalización completa (líneas vacías y luego CONFIRMED) en su propia
    // transacción. Devuelve null si confirmó o el error.
    function finalizeInOwnTransaction(countId: string): Promise<unknown> {
      return prisma
        .$transaction(
          async (tx) => {
            await insertEmptyLine(tx, countId);
            await confirm(tx, countId);
          },
          { maxWait: 30_000, timeout: 30_000 },
        )
        .then(
          () => null,
          (error: unknown) => error,
        );
    }

    it('un guardado concurrente con la finalización espera y se rechaza', async () => {
      const { countId, lineId } = await openCountWithLine();

      // Resultado del guardado concurrente: null si se guardó o el error.
      let saveOutcome: Promise<unknown> = Promise.resolve(null);
      await prisma.$transaction(
        async (tx) => {
          await confirm(tx, countId);
          // Guardado en otra sesión mientras la finalización no confirma.
          saveOutcome = prisma.inventoryCountLine
            .update({
              where: { id: lineId },
              data: { boxes: 2, countedQuantity: '10' },
            })
            .then(
              () => null,
              (error: unknown) => error,
            );
          await waitForLockWait();
        },
        { maxWait: 30_000, timeout: 30_000 },
      );

      const error = await saveOutcome;
      expect(error).toBeInstanceOf(Error);
      expect(sqlState(error)).toBe('42501');
      expect(errorText(error)).toMatch(/está finalizada: no se permite UPDATE/);
      const stored = await prisma.inventoryCountLine.findUniqueOrThrow({
        where: { id: lineId },
      });
      expect(stored.boxes).toBe(1);
      expect(stored.countedQuantity?.toFixed(3)).toBe('5.000');
    });

    it('dos finalizaciones simultáneas: una confirma y la otra se rechaza, sin deadlock', async () => {
      const { countId } = await openCountWithLine();

      // La primera finalización inserta su línea vacía y, antes de confirmar,
      // arranca la segunda en otra sesión y espera a que quede bloqueada.
      let secondOutcome: Promise<unknown> = Promise.resolve(null);
      const firstOutcome = await prisma
        .$transaction(
          async (tx) => {
            await insertEmptyLine(tx, countId);
            secondOutcome = finalizeInOwnTransaction(countId);
            await waitForLockWait();
            await confirm(tx, countId);
          },
          { maxWait: 30_000, timeout: 30_000 },
        )
        .then(
          () => null,
          (error: unknown) => error,
        );
      const outcomes = [firstOutcome, await secondOutcome];

      expect(outcomes.some(isDeadlock)).toBe(false);
      const rejected = outcomes.filter((outcome) => outcome !== null);
      expect(rejected).toHaveLength(1);
      expect(sqlState(rejected[0])).toBe('42501');
      expect(errorText(rejected[0])).toMatch(
        /está finalizada: no se permite INSERT sobre sus líneas/,
      );

      const count = await prisma.inventoryCount.findUniqueOrThrow({
        where: { id: countId },
        include: { lines: true },
      });
      expect(count.status).toBe('CONFIRMED');
      // La línea contada y una sola línea vacía (la de quien confirmó).
      expect(count.lines).toHaveLength(2);
    });

    it('un guardado que también actualiza la toma no se cruza en deadlock con la finalización', async () => {
      const { countId, lineId } = await openCountWithLine();

      let finalizeOutcome: Promise<unknown> = Promise.resolve(null);
      const saveOutcome = await prisma
        .$transaction(
          async (tx) => {
            await tx.inventoryCountLine.update({
              where: { id: lineId },
              data: { boxes: 2, countedQuantity: '10' },
            });
            finalizeOutcome = finalizeInOwnTransaction(countId);
            await waitForLockWait();
            await tx.inventoryCount.update({
              where: { id: countId },
              data: { notes: 'guardado parcial' },
            });
          },
          { maxWait: 30_000, timeout: 30_000 },
        )
        .then(
          () => null,
          (error: unknown) => error,
        );
      const outcomes = [saveOutcome, await finalizeOutcome];

      expect(outcomes.some(isDeadlock)).toBe(false);
      // El guardado entró antes: los dos terminan bien y la toma queda
      // finalizada con lo guardado.
      expect(outcomes).toEqual([null, null]);
      const count = await prisma.inventoryCount.findUniqueOrThrow({
        where: { id: countId },
        include: { lines: true },
      });
      expect(count.status).toBe('CONFIRMED');
      expect(count.notes).toBe('guardado parcial');
      const saved = count.lines.find((line) => line.id === lineId);
      expect(saved?.boxes).toBe(2);
    });
  },
);
