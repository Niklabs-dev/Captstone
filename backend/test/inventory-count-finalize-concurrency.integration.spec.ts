import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { AUDIT_ACTION } from '../src/audit/constants/audit-actions.constants.js';
import { ROLE } from '../src/auth/constants/roles.constants.js';
import type { JwtPayload } from '../src/auth/types/auth.types.js';
import { PrismaClient, UnitOfMeasure } from '../src/generated/prisma/client.js';
import type {
  InventoryCountFinalization,
  InventoryCountSummary,
} from '../src/inventory/types/inventory-counts.types.js';

type App = Parameters<typeof request>[0];

// Concurrencia de la finalización de la toma (SPRINT-5-T06) por HTTP contra
// PostgreSQL real, con transacciones y conexiones reales (sin
// withinRollback: cada solicitud abre su propia transacción y la carrera es
// genuina). Para que las solicitudes se crucen de verdad, una transacción
// aparte retiene la toma con FOR NO KEY UPDATE (como un guardado en curso)
// hasta que las dos solicitudes quedan esperando su bloqueo, y entonces la
// suelta. En la revisión del PR #88 dos finalizaciones simultáneas terminaban
// en deadlock (500); ahora una responde 200 y la otra 409, sin líneas
// duplicadas. Los productos del test se crean DESACTIVADOS, con su línea
// vacía insertada al iniciar cada toma (un desactivado con línea se puede
// guardar): así no cambian el catálogo activo que leen, en paralelo, las
// suites que trabajan dentro de withinRollback. Los datos van con un local
// propio y se eliminan al final como
// mantenimiento (session_replication_role = replica: la toma finalizada, sus
// líneas y la auditoría son inmutables).
const databaseUrl = process.env.TEST_DATABASE_URL;

const DOMAIN = '@inventory-finalize-concurrency-test.invalid';
const ROUNDS = 3;

interface Session {
  id: string;
  token: string;
}

interface HttpResult {
  status: number;
  body: unknown;
}

describe.skipIf(!databaseUrl)(
  'Concurrencia de la finalización de la toma (SPRINT-5-T06)',
  { timeout: 120_000 },
  () => {
    let app: INestApplication<App>;
    let jwt: JwtService;
    let prisma: PrismaClient;
    let storeId: string;
    let supervisorA: Session;
    let supervisorB: Session;
    let countedProductId: string;
    let pendingProductId: string;
    let createdRoleId: string | null = null;

    async function supervisor(roleId: string): Promise<Session> {
      const created = await prisma.user.create({
        data: {
          email: `${randomUUID()}${DOMAIN}`,
          passwordHash: '$2b$04$hash-de-prueba',
          firstName: 'Supervisor',
          lastName: 'Finalización',
          roleId,
          storeId,
        },
      });
      const payload: JwtPayload = {
        sub: created.id,
        email: created.email,
        role: ROLE.SUPERVISOR,
        storeId,
      };
      return { id: created.id, token: await jwt.signAsync(payload) };
    }

    beforeAll(async () => {
      process.env.DATABASE_URL = databaseUrl;
      process.env.JWT_SECRET = 'secreto-de-pruebas';
      process.env.JWT_EXPIRES_IN = '1h';
      process.env.JWT_REFRESH_EXPIRES_IN = '7d';
      process.env.DOCUMENTS_STORAGE_PATH = './storage/test-documents';
      const moduleFixture: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();
      app = moduleFixture.createNestApplication();
      app.useGlobalPipes(
        new ValidationPipe({
          whitelist: true,
          forbidNonWhitelisted: true,
          transform: true,
        }),
      );
      await app.init();
      jwt = app.get(JwtService);
      prisma = new PrismaClient({
        adapter: new PrismaPg({ connectionString: databaseUrl }),
      });

      const existingRole = await prisma.role.findUnique({
        where: { code: ROLE.SUPERVISOR },
      });
      const role =
        existingRole ??
        (await prisma.role.create({
          data: { code: ROLE.SUPERVISOR, name: 'Supervisor' },
        }));
      if (!existingRole) createdRoleId = role.id;
      const suffix = randomUUID().slice(0, 8);
      storeId = (
        await prisma.store.create({
          data: {
            name: `Subway Finalización Concurrencia ${suffix}`,
            city: 'Melipilla',
            address: 'Calle ficticia 1',
          },
        })
      ).id;
      supervisorA = await supervisor(role.id);
      supervisorB = await supervisor(role.id);
      countedProductId = (
        await prisma.product.create({
          data: {
            name: `Carne Fajita Finalización ${suffix}`,
            unit: UnitOfMeasure.KG,
            boxContent: '5',
            packageContent: '2.5',
            packageName: 'bolsa',
            isActive: false,
          },
        })
      ).id;
      pendingProductId = (
        await prisma.product.create({
          data: {
            name: `Tomate Finalización ${suffix}`,
            unit: UnitOfMeasure.KG,
            looseOnly: true,
            isActive: false,
          },
        })
      ).id;
    }, 60_000);

    afterAll(async () => {
      if (prisma && storeId) {
        await prisma.$transaction(async (tx) => {
          await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
          const counts = await tx.inventoryCount.findMany({
            where: { storeId },
            select: { id: true },
          });
          const countIds = counts.map((count) => count.id);
          await tx.auditLog.deleteMany({
            where: {
              OR: [
                { storeId },
                { entityId: { in: countIds } },
                { user: { email: { endsWith: DOMAIN } } },
              ],
            },
          });
          await tx.inventoryCountLine.deleteMany({
            where: { countId: { in: countIds } },
          });
          await tx.inventoryCount.deleteMany({ where: { storeId } });
          await tx.product.deleteMany({
            where: { id: { in: [countedProductId, pendingProductId] } },
          });
          await tx.user.deleteMany({
            where: { email: { endsWith: DOMAIN } },
          });
          await tx.store.deleteMany({ where: { id: storeId } });
          if (createdRoleId) {
            await tx.role.delete({ where: { id: createdRoleId } });
          }
        });
        await prisma.$disconnect();
      }
      await app?.close();
    });

    const http = () => request(app.getHttpServer());
    const auth = (session: Session) => ({
      Authorization: `Bearer ${session.token}`,
    });

    // Las solicitudes de supertest arrancan al pedir su resultado.
    function send(test: request.Test): Promise<HttpResult> {
      return test.then((response) => ({
        status: response.status,
        body: response.body as unknown,
      }));
    }

    const finalize = (session: Session, countId: string) =>
      send(
        http().post(`/inventory-counts/${countId}/finalize`).set(auth(session)),
      );
    const save = (
      session: Session,
      countId: string,
      productId: string,
      body: object,
    ) =>
      send(
        http()
          .put(`/inventory-counts/${countId}/lines/${productId}`)
          .set(auth(session))
          .send(body),
      );

    // Toma En curso del local con un producto contado (1 caja = 5 kg) y otro
    // pendiente (línea vacía).
    async function countWithLine(): Promise<string> {
      const started = await http()
        .post('/inventory-counts')
        .set(auth(supervisorA))
        .send({})
        .expect(201);
      const countId = (started.body as InventoryCountSummary).id;
      const products = await prisma.product.findMany({
        where: { id: { in: [countedProductId, pendingProductId] } },
      });
      await prisma.inventoryCountLine.createMany({
        data: products.map((product) => ({
          countId,
          productId: product.id,
          productName: product.name,
          unit: product.unit,
          packageName: product.packageName,
          boxContent: product.boxContent,
          packageContent: product.packageContent,
          looseOnly: product.looseOnly,
          savedById: supervisorA.id,
        })),
      });
      const saved = await save(supervisorA, countId, countedProductId, {
        boxes: 1,
      });
      expect(saved.status).toBe(200);
      return countId;
    }

    // Sesiones que esperan, directa o indirectamente (en la cola del mismo
    // bloqueo), a la transacción `blocker`.
    async function waitingOn(blocker: number): Promise<number> {
      const rows = await prisma.$queryRaw<Array<{ waiting: bigint }>>`
        WITH RECURSIVE waiting(pid) AS (
          SELECT pid FROM pg_stat_activity
          WHERE ${blocker}::int = ANY(pg_blocking_pids(pid))
          UNION
          SELECT a.pid FROM pg_stat_activity a
          JOIN waiting w ON w.pid = ANY(pg_blocking_pids(a.pid))
        )
        SELECT count(*) AS waiting FROM waiting`;
      return Number(rows[0].waiting);
    }

    // Retiene la toma con FOR NO KEY UPDATE, lanza las solicitudes y las
    // suelta recién cuando todas esperan el bloqueo: así se cruzan.
    async function race(
      countId: string,
      launch: () => Array<Promise<HttpResult>>,
    ): Promise<HttpResult[]> {
      let pending: Promise<HttpResult[]> = Promise.resolve([]);
      await prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`
            SELECT id FROM inventory_counts WHERE id = ${countId}::uuid
            FOR NO KEY UPDATE`;
          const [{ pid }] = await tx.$queryRaw<Array<{ pid: number }>>`
            SELECT pg_backend_pid() AS pid`;
          const requests = launch();
          pending = Promise.all(requests);
          for (let attempt = 0; attempt < 200; attempt += 1) {
            if ((await waitingOn(pid)) >= requests.length) return;
            await new Promise((resolve) => setTimeout(resolve, 25));
          }
          throw new Error('Las solicitudes nunca quedaron esperando la toma');
        },
        { maxWait: 30_000, timeout: 30_000 },
      );
      return pending;
    }

    it(`dos finalizaciones simultáneas: una responde 200 y la otra 409, sin duplicados ni 500 (${ROUNDS} rondas)`, async () => {
      for (let round = 0; round < ROUNDS; round += 1) {
        // Cada ronda inicia una toma nueva: la anterior quedó finalizada.
        const countId = await countWithLine();

        const results = await race(countId, () => [
          finalize(supervisorA, countId),
          finalize(supervisorB, countId),
        ]);

        expect(results.map((result) => result.status).sort()).toEqual([
          200, 409,
        ]);
        const winner = results.find((result) => result.status === 200);
        const loser = results.find((result) => result.status === 409);
        expect(loser?.body).toEqual({
          statusCode: 409,
          message: 'La toma de inventario está finalizada',
          errors: { countId: 'La toma está finalizada: no admite cambios' },
        });
        const finalized = winner?.body as InventoryCountFinalization;
        expect(finalized).toMatchObject({
          id: countId,
          status: 'CONFIRMED',
          countedProducts: 1,
        });

        const stored = await prisma.inventoryCount.findUniqueOrThrow({
          where: { id: countId },
          include: { lines: true },
        });
        expect(stored.status).toBe('CONFIRMED');
        expect(stored.finalizedById).toBe(finalized.finalizedBy?.id);
        // Una línea por producto: sin duplicados de la finalización perdedora.
        const productIds = stored.lines.map((line) => line.productId);
        expect(new Set(productIds).size).toBe(productIds.length);
        expect(stored.lines).toHaveLength(finalized.totalProducts);
        expect(
          stored.lines.filter((line) => line.countedQuantity === null),
        ).toHaveLength(finalized.uncountedProducts);
        expect(
          stored.lines.find((line) => line.productId === pendingProductId),
        ).toMatchObject({ countedQuantity: null, looseOnly: true });
        // Una sola finalización auditada.
        expect(
          await prisma.auditLog.count({
            where: {
              action: AUDIT_ACTION.INVENTORY_COUNT_FINALIZED,
              entityId: countId,
            },
          }),
        ).toBe(1);
      }
    });

    it('un guardado simultáneo con la finalización entra antes o responde 409, nunca 500', async () => {
      const countId = await countWithLine();

      const [finalized, saved] = await race(countId, () => [
        finalize(supervisorA, countId),
        save(supervisorB, countId, pendingProductId, { looseQuantity: '1.5' }),
      ]);

      expect(finalized.status).toBe(200);
      expect([200, 409]).toContain(saved.status);
      const line = await prisma.inventoryCountLine.findUniqueOrThrow({
        where: {
          countId_productId: { countId, productId: pendingProductId },
        },
      });
      const result = finalized.body as InventoryCountFinalization;
      if (saved.status === 200) {
        // El guardado entró antes: la finalización lo cuenta.
        expect(line.countedQuantity?.toFixed(3)).toBe('1.500');
        expect(result.countedProducts).toBe(2);
      } else {
        // La finalización entró antes: el producto quedó sin contar.
        expect(saved.body).toMatchObject({
          message: 'La toma de inventario está finalizada',
        });
        expect(line.countedQuantity).toBeNull();
        expect(result.countedProducts).toBe(1);
      }
    });
  },
);
