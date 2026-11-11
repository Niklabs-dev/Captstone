import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';

// Concurrencia entre la finalización de una toma y un guardado de línea
// (SPRINT-5-T01) contra PostgreSQL real con transacciones reales (sin
// withinRollback: la carrera necesita dos sesiones que vean los mismos datos
// confirmados). El trigger de las líneas toma la toma con FOR SHARE: un
// guardado que llega mientras la finalización aún no confirma espera y,
// cuando la finalización confirma, se rechaza porque la toma ya está
// CONFIRMED. Sin ese bloqueo, el guardado leería la toma OPEN y modificaría
// una línea de un inventario finalizado. Los datos van con un local propio y
// se eliminan al finalizar como mantenimiento (session_replication_role =
// replica, porque la toma finalizada es inmutable).
const databaseUrl = process.env.TEST_DATABASE_URL;

const DOMAIN = '@inventory-concurrency-test.invalid';

describe.skipIf(!databaseUrl)(
  'Concurrencia de la toma de inventario (SPRINT-5-T01)',
  { timeout: 60_000 },
  () => {
    let prisma: PrismaClient;
    let storeId = '';
    let productId = '';
    let createdRoleId: string | null = null;

    beforeAll(() => {
      prisma = new PrismaClient({
        adapter: new PrismaPg({ connectionString: databaseUrl }),
      });
    });

    afterAll(async () => {
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
        await tx.inventoryCountLine.deleteMany({
          where: { count: { storeId } },
        });
        await tx.inventoryCount.deleteMany({ where: { storeId } });
        await tx.product.deleteMany({ where: { id: productId } });
        await tx.user.deleteMany({ where: { email: { endsWith: DOMAIN } } });
        await tx.store.deleteMany({ where: { id: storeId } });
        if (createdRoleId) {
          await tx.role.delete({ where: { id: createdRoleId } });
        }
      });
      await prisma.$disconnect();
    });

    // Espera a que alguna sesión de esta base quede bloqueada esperando un
    // lock (el guardado concurrente detenido por el FOR SHARE).
    async function waitForLockWait(): Promise<void> {
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const rows = await prisma.$queryRaw<Array<{ waiting: bigint }>>`
          SELECT count(*) AS waiting FROM pg_stat_activity
          WHERE datname = current_database()
            AND wait_event_type = 'Lock'
            AND query LIKE '%inventory_count_lines%'`;
        if (rows[0].waiting > 0n) return;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error('El guardado concurrente nunca quedó esperando el lock');
    }

    it('un guardado concurrente con la finalización espera y se rechaza', async () => {
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
      storeId = store.id;
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
      const product = await prisma.product.create({
        data: {
          name: 'Carne Fajita',
          unit: 'KG',
          boxContent: '5',
          packageContent: '2.5',
        },
      });
      productId = product.id;
      const count = await prisma.inventoryCount.create({
        data: {
          storeId: store.id,
          createdById: supervisor.id,
          countDate: new Date('2026-11-11T00:00:00.000Z'),
        },
      });
      const line = await prisma.inventoryCountLine.create({
        data: {
          countId: count.id,
          productId: product.id,
          boxes: 1,
          countedQuantity: '5',
          productName: product.name,
          unit: product.unit,
          boxContent: product.boxContent,
          packageContent: product.packageContent,
          savedById: supervisor.id,
        },
      });

      // Resultado del guardado concurrente: null si se guardó o el error.
      let saveOutcome: Promise<unknown> = Promise.resolve(null);
      await prisma.$transaction(
        async (tx) => {
          await tx.inventoryCount.update({
            where: { id: count.id },
            data: {
              status: 'CONFIRMED',
              finalizedAt: new Date(),
              finalizedById: supervisor.id,
              templateSnapshot: [],
            },
          });
          // Guardado en otra sesión mientras la finalización no confirma.
          saveOutcome = prisma.inventoryCountLine
            .update({
              where: { id: line.id },
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
      expect(String(error)).toMatch(/está finalizada: no se permite UPDATE/);
      const stored = await prisma.inventoryCountLine.findUniqueOrThrow({
        where: { id: line.id },
      });
      expect(stored.boxes).toBe(1);
      expect(stored.countedQuantity?.toFixed(3)).toBe('5.000');
    });
  },
);
