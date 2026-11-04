import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { createHash, randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { AUDIT_ACTION } from '../src/audit/constants/audit-actions.constants.js';
import { ROLE, type RoleCode } from '../src/auth/constants/roles.constants.js';
import type { AuthUser, JwtPayload } from '../src/auth/types/auth.types.js';
import { Prisma, PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { TipPoolsService } from '../src/tips/tip-pools.service.js';
import type {
  TipPoolReceiptResponse,
  TipPoolResponse,
} from '../src/tips/types/tip-pools.types.js';
import {
  createSwitchablePrisma,
  type SwitchablePrisma,
} from './helpers/switchable-prisma.js';

type App = Parameters<typeof request>[0];

// Tests de integración de las constancias de propinas (SPRINT-4-T01) por HTTP
// contra PostgreSQL real. Toda la aplicación corre dentro de la transacción
// del test (helpers/switchable-prisma.ts) y esta se revierte: el reparto
// pagado, que es inmutable, nunca queda en la base. Cada test crea sus datos
// con UUID propios, con los valores del reparto demo, en vez de usar el seed:
// sembrar mantendría bloqueadas filas compartidas y haría esperar a los specs
// que corren en paralelo. Se omiten si no se define TEST_DATABASE_URL.
const databaseUrl = process.env.TEST_DATABASE_URL;

const STORE_NAME_PREFIX = 'Subway Constancias Test';
const EMAIL_DOMAIN = '@my-tip-receipts-test.invalid';
const PERIOD = { start: '2026-01-05', end: '2026-01-11' } as const;
const PAYMENT_DATE = '2026-01-12';
const PDF_NAME =
  /^attachment; filename="constancia-propinas_2026-01-05_2026-01-11_[0-9a-f]{8}\.pdf"/;

class Rollback extends Error {
  constructor() {
    super('rollback de prueba');
    this.name = 'Rollback';
  }
}

interface Fixture {
  tx: Prisma.TransactionClient;
  storeName: string;
  accountant: AuthUser;
  admin: AuthUser;
  supervisor: AuthUser;
  workerOne: AuthUser;
  workerTwo: AuthUser;
  pool: TipPoolResponse;
}

interface FixtureOptions {
  // Horas del supervisor en el período; sin valor no participa del reparto.
  supervisorHours?: number;
}

function sha256(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

function day(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

async function createUser(
  tx: Prisma.TransactionClient,
  role: RoleCode,
  storeId: string | null,
  firstName: string,
): Promise<AuthUser> {
  const { id: roleId } = await tx.role.upsert({
    where: { code: role },
    update: {},
    create: { code: role, name: role },
  });
  const id = randomUUID();
  const email = `${id}${EMAIL_DOMAIN}`;
  await tx.user.create({
    data: {
      id,
      email,
      passwordHash: '$2b$04$hash-de-prueba',
      firstName,
      lastName: 'Constancias',
      roleId,
      storeId,
    },
  });
  return { id, email, role, storeId };
}

describe.skipIf(!databaseUrl)(
  'Constancias de propinas por HTTP (SPRINT-4-T01)',
  { timeout: 60_000 },
  () => {
    let app: INestApplication<App>;
    let jwt: JwtService;
    let prisma: PrismaClient;
    let switchable: SwitchablePrisma;

    function token(user: AuthUser): string {
      const payload: JwtPayload = {
        sub: user.id,
        email: user.email,
        role: user.role,
        storeId: user.storeId,
      };
      return jwt.sign(payload);
    }

    function get(path: string, user: AuthUser | null) {
      const req = request(app.getHttpServer()).get(path);
      if (user) req.set('Authorization', `Bearer ${token(user)}`);
      return req;
    }

    // Descarga que entrega el cuerpo binario como Buffer.
    function download(path: string, user: AuthUser) {
      return get(path, user).responseType('blob');
    }

    // Mismo escenario del reparto demo: 25.000 entre dos trabajadores con 40 y
    // 60 horas, que da 10.000 y 15.000. El reparto queda en DRAFT. Con
    // supervisorHours el supervisor también registra horas y recibe su línea
    // (25 horas: 8.000 / 12.000 / 5.000).
    async function createFixture(
      tx: Prisma.TransactionClient,
      options: FixtureOptions,
    ): Promise<Fixture> {
      const storeName = `${STORE_NAME_PREFIX} ${randomUUID()}`;
      const store = await tx.store.create({
        data: {
          id: randomUUID(),
          name: storeName,
          city: 'Melipilla',
          address: 'Calle 123',
        },
      });
      const accountant = await createUser(tx, ROLE.CONTADOR, null, 'Contador');
      const admin = await createUser(tx, ROLE.ADMINISTRADOR, null, 'Admin');
      const supervisor = await createUser(
        tx,
        ROLE.SUPERVISOR,
        store.id,
        'Supervisor',
      );
      const workerOne = await createUser(
        tx,
        ROLE.TRABAJADOR,
        store.id,
        'Trabajador Uno',
      );
      const workerTwo = await createUser(
        tx,
        ROLE.TRABAJADOR,
        store.id,
        'Trabajador Dos',
      );
      await tx.tipAgreement.create({
        data: {
          id: randomUUID(),
          name: 'Pacto constancias test',
          rule: 'PROPORTIONAL_TO_HOURS',
          validFrom: day('2026-01-01'),
          storeId: store.id,
          createdById: supervisor.id,
        },
      });
      await tx.tipEntry.createMany({
        data: [
          { date: '2026-01-05', paymentMethod: 'CASH' as const, amount: 10000 },
          {
            date: '2026-01-06',
            paymentMethod: 'DEBIT_CARD' as const,
            amount: 15000,
          },
        ].map(({ date, paymentMethod, amount }) => ({
          id: randomUUID(),
          businessDate: day(date),
          paymentMethod,
          amount,
          storeId: store.id,
          responsibleId: supervisor.id,
        })),
      });
      await tx.workHoursRecord.createMany({
        data: [
          { workerId: workerOne.id, hoursWorked: 40 },
          { workerId: workerTwo.id, hoursWorked: 60 },
          ...(options.supervisorHours
            ? [
                {
                  workerId: supervisor.id,
                  hoursWorked: options.supervisorHours,
                },
              ]
            : []),
        ].map(({ workerId, hoursWorked }) => ({
          id: randomUUID(),
          periodStart: day(PERIOD.start),
          periodEnd: day(PERIOD.end),
          hoursWorked,
          storeId: store.id,
          workerId,
          recordedById: supervisor.id,
        })),
      });
      const { pool } = await app.get(TipPoolsService).preview(
        {
          storeId: store.id,
          periodStart: PERIOD.start,
          periodEnd: PERIOD.end,
        },
        accountant,
      );
      return {
        tx,
        storeName,
        accountant,
        admin,
        supervisor,
        workerOne,
        workerTwo,
        pool,
      };
    }

    async function withinRollback(
      fn: (f: Fixture) => Promise<void>,
      options: FixtureOptions = {},
    ): Promise<void> {
      try {
        await prisma.$transaction(
          async (tx) => {
            switchable.use(tx);
            await fn(await createFixture(tx, options));
            throw new Rollback();
          },
          { maxWait: 30_000, timeout: 50_000 },
        );
      } catch (error) {
        if (!(error instanceof Rollback)) throw error;
      } finally {
        switchable.use(null);
      }
    }

    function confirm(f: Fixture): Promise<TipPoolResponse> {
      return app
        .get(TipPoolsService)
        .confirm(f.pool.id, { expectedVersion: f.pool.version }, f.accountant);
    }

    async function pay(f: Fixture): Promise<TipPoolResponse> {
      const ready = await confirm(f);
      return app
        .get(TipPoolsService)
        .pay(
          ready.id,
          { expectedVersion: ready.version, paymentDate: PAYMENT_DATE },
          f.accountant,
        );
    }

    function receiptOf(f: Fixture, userId: string) {
      return f.tx.tipPoolReceipt.findUniqueOrThrow({
        where: { poolId_userId: { poolId: f.pool.id, userId } },
      });
    }

    function downloadAudits(f: Fixture, receiptId: string) {
      return f.tx.auditLog.findMany({
        where: { entityType: 'tip_pool_receipts', entityId: receiptId },
        select: { action: true, detail: true, storeId: true, userId: true },
      });
    }

    // La lista y la descarga rechazan por igual un reparto sin pagar.
    async function expectPoolReceiptsConflict(f: Fixture): Promise<void> {
      for (const user of [f.accountant, f.admin]) {
        await get(`/tip-pools/${f.pool.id}/receipts`, user).expect(409);
        await get(
          `/tip-pools/${f.pool.id}/receipts/${f.workerOne.id}/download`,
          user,
        ).expect(409);
      }
    }

    beforeAll(async () => {
      process.env.DATABASE_URL = databaseUrl;
      process.env.JWT_SECRET = 'secreto-de-pruebas';
      process.env.JWT_EXPIRES_IN = '1h';
      process.env.JWT_REFRESH_EXPIRES_IN = '7d';
      process.env.DOCUMENTS_STORAGE_PATH = './storage/test-documents';
      process.env.DOCUMENTS_MAX_SIZE_MB = '1';

      switchable = createSwitchablePrisma();
      const moduleFixture: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(PrismaService)
        .useValue(switchable.service)
        .compile();
      app = moduleFixture.createNestApplication();
      // Mismo pipe de validación que main.ts.
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
    }, 60_000);

    afterAll(async () => {
      await prisma.$disconnect();
      await app.close();
    });

    describe('trabajador en /my-tip-receipts', () => {
      it('lista solo su constancia del reparto PAID, sin líneas de compañeros', async () => {
        await withinRollback(async (f) => {
          await pay(f);
          const receipt = await receiptOf(f, f.workerOne.id);

          const response = await get('/my-tip-receipts', f.workerOne).expect(
            200,
          );

          expect(response.headers['cache-control']).toBe('private, no-store');
          expect(response.body).toEqual([
            {
              id: receipt.id,
              userId: f.workerOne.id,
              status: 'PAID',
              storeName: f.storeName,
              periodStart: PERIOD.start,
              periodEnd: PERIOD.end,
              hoursWorked: '40.00',
              amount: 10000,
              paymentDate: PAYMENT_DATE,
              paidByName: 'Contador Constancias',
              createdAt: receipt.createdAt.toISOString(),
            },
          ]);
          expect(JSON.stringify(response.body)).not.toContain(f.workerTwo.id);

          const other = await get('/my-tip-receipts', f.workerTwo).expect(200);
          expect(other.body).toEqual([
            expect.objectContaining({
              userId: f.workerTwo.id,
              amount: 15000,
            }),
          ]);
        });
      });

      it('descarga su PDF con SHA-256, sin caché y con nombre sin datos personales', async () => {
        await withinRollback(async (f) => {
          await pay(f);
          const receipt = await receiptOf(f, f.workerOne.id);

          const response = await download(
            `/my-tip-receipts/${receipt.id}/download`,
            f.workerOne,
          ).expect(200);

          const body = response.body as Buffer;
          expect(body.subarray(0, 4).toString('latin1')).toBe('%PDF');
          expect(response.headers['content-type']).toBe('application/pdf');
          expect(response.headers['x-content-sha256']).toBe(sha256(body));
          expect(response.headers['x-content-type-options']).toBe('nosniff');
          expect(response.headers['cache-control']).toBe('private, no-store');
          expect(response.headers['content-disposition']).toMatch(PDF_NAME);
          expect(response.headers['content-disposition']).not.toMatch(
            /trabajador|constancias_/i,
          );
        });
      });

      it('audita la descarga con la constancia como entidad y solo el userId', async () => {
        await withinRollback(async (f) => {
          await pay(f);
          const receipt = await receiptOf(f, f.workerOne.id);

          await download(
            `/my-tip-receipts/${receipt.id}/download`,
            f.workerOne,
          ).expect(200);

          expect(await downloadAudits(f, receipt.id)).toEqual([
            {
              action: AUDIT_ACTION.TIP_POOL_RECEIPT_DOWNLOADED,
              detail: { userId: f.workerOne.id },
              storeId: receipt.storeId,
              userId: f.workerOne.id,
            },
          ]);
        });
      });

      it('responde 404 a la constancia de un compañero y no audita', async () => {
        await withinRollback(async (f) => {
          await pay(f);
          const peer = await receiptOf(f, f.workerTwo.id);

          await get(`/my-tip-receipts/${peer.id}/download`, f.workerOne).expect(
            404,
          );

          expect(await downloadAudits(f, peer.id)).toEqual([]);
        });
      });

      it('no muestra constancias con el reparto en DRAFT', async () => {
        await withinRollback(async (f) => {
          const response = await get('/my-tip-receipts', f.workerOne).expect(
            200,
          );
          expect(response.body).toEqual([]);
        });
      });

      it('no muestra constancias con el reparto en CONFIRMED', async () => {
        await withinRollback(async (f) => {
          await confirm(f);
          const response = await get('/my-tip-receipts', f.workerOne).expect(
            200,
          );
          expect(response.body).toEqual([]);
        });
      });

      it('oculta una constancia forzada en un reparto sin pagar', async () => {
        await withinRollback(async (f) => {
          const pool = await confirm(f);
          // El trigger impide esta fila: se omite como en purgeTestAuditLogs
          // para demostrar que el filtro PAID de la consulta actúa por sí solo.
          await f.tx.$executeRaw`SET LOCAL session_replication_role = replica`;
          const forced = await f.tx.tipPoolReceipt.create({
            data: {
              id: randomUUID(),
              poolId: pool.id,
              userId: f.workerOne.id,
              workerName: 'Trabajador Uno Constancias',
              storeId: pool.store.id,
              storeName: pool.store.name,
              periodStart: day(pool.periodStart),
              periodEnd: day(pool.periodEnd),
              hoursWorked: new Prisma.Decimal('40.00'),
              amount: new Prisma.Decimal(10000),
              paymentDate: day(PAYMENT_DATE),
              paidById: f.accountant.id,
              paidByName: 'Contador Constancias',
              detail: {
                agreementSnapshot: null,
                totalAmount: 25000,
                totalHours: '100.00',
                lines: [],
              },
            },
          });
          await f.tx.$executeRaw`SET LOCAL session_replication_role = origin`;

          const list = await get('/my-tip-receipts', f.workerOne).expect(200);
          expect(list.body).toEqual([]);
          await get(
            `/my-tip-receipts/${forced.id}/download`,
            f.workerOne,
          ).expect(404);
          expect(await downloadAudits(f, forced.id)).toEqual([]);
          await expectPoolReceiptsConflict(f);
        });
      });

      it('valida el ID y rechaza cualquier parámetro de consulta', async () => {
        await withinRollback(async (f) => {
          await pay(f);
          const receipt = await receiptOf(f, f.workerOne.id);
          const user = f.workerOne;

          await get(`/my-tip-receipts/${randomUUID()}/download`, user).expect(
            404,
          );
          await get('/my-tip-receipts/no-es-uuid/download', user).expect(400);
          await get(`/my-tip-receipts?userId=${f.workerTwo.id}`, user).expect(
            400,
          );
          await get(
            `/my-tip-receipts/${receipt.id}/download?userId=${f.workerTwo.id}`,
            user,
          ).expect(400);
        });
      });

      it('exige sesión', async () => {
        await withinRollback(async (f) => {
          await pay(f);
          const receipt = await receiptOf(f, f.workerOne.id);
          const path = `/my-tip-receipts/${receipt.id}/download`;

          await get('/my-tip-receipts', null).expect(401);
          await get(path, null).expect(401);
          expect(await downloadAudits(f, receipt.id)).toEqual([]);
        });
      });
    });

    // SPRINT-4-T01 (revisión del PO): cualquier usuario autenticado consulta
    // solo sus propias constancias PAID, sea cual sea su rol o local actual.
    describe('cualquier rol en /my-tip-receipts', () => {
      it('un supervisor con horas en el período lista y descarga su constancia', async () => {
        await withinRollback(
          async (f) => {
            await get('/my-tip-receipts', f.supervisor).expect(200, []);
            await pay(f);
            const receipt = await receiptOf(f, f.supervisor.id);

            const list = await get('/my-tip-receipts', f.supervisor).expect(
              200,
            );
            expect(list.body).toEqual([
              expect.objectContaining({
                id: receipt.id,
                userId: f.supervisor.id,
                status: 'PAID',
                hoursWorked: '25.00',
                amount: 5000,
              }),
            ]);

            const file = await download(
              `/my-tip-receipts/${receipt.id}/download`,
              f.supervisor,
            ).expect(200);
            const body = file.body as Buffer;
            expect(body.subarray(0, 4).toString('latin1')).toBe('%PDF');
            expect(file.headers['x-content-sha256']).toBe(sha256(body));
            expect(await downloadAudits(f, receipt.id)).toEqual([
              expect.objectContaining({
                detail: { userId: f.supervisor.id },
                userId: f.supervisor.id,
              }),
            ]);

            // Sigue sin ver la constancia de un trabajador de su local.
            const peer = await receiptOf(f, f.workerOne.id);
            await get(
              `/my-tip-receipts/${peer.id}/download`,
              f.supervisor,
            ).expect(404);
            expect(await downloadAudits(f, peer.id)).toEqual([]);
          },
          { supervisorHours: 25 },
        );
      });

      it('conserva la constancia tras un ascenso y un cambio de local con el mismo userId', async () => {
        await withinRollback(async (f) => {
          await pay(f);
          const receipt = await receiptOf(f, f.workerOne.id);
          const newStore = await f.tx.store.create({
            data: {
              id: randomUUID(),
              name: `${STORE_NAME_PREFIX} ${randomUUID()}`,
              city: 'Calera',
              address: 'Calle 456',
            },
          });

          // Ascenso a supervisor de otro local y luego a contador sin local.
          const steps: { role: RoleCode; storeId: string | null }[] = [
            { role: ROLE.SUPERVISOR, storeId: newStore.id },
            { role: ROLE.CONTADOR, storeId: null },
          ];
          for (const { role, storeId } of steps) {
            const { id: roleId } = await f.tx.role.upsert({
              where: { code: role },
              update: {},
              create: { code: role, name: role },
            });
            await f.tx.user.update({
              where: { id: f.workerOne.id },
              data: { roleId, storeId },
            });
            // JWT nuevo con el rol y el local actuales; mismo userId.
            const promoted: AuthUser = { ...f.workerOne, role, storeId };

            const list = await get('/my-tip-receipts', promoted).expect(200);
            expect(list.body).toEqual([
              expect.objectContaining({
                id: receipt.id,
                userId: f.workerOne.id,
                storeName: f.storeName,
                amount: 10000,
              }),
            ]);
            await download(
              `/my-tip-receipts/${receipt.id}/download`,
              promoted,
            ).expect(200);
          }
          expect(await downloadAudits(f, receipt.id)).toHaveLength(2);
        });
      });

      it('contador y administrador sin constancias propias reciben listado vacío y 404 en una ajena', async () => {
        await withinRollback(async (f) => {
          await pay(f);
          const peer = await receiptOf(f, f.workerOne.id);
          for (const user of [f.accountant, f.admin]) {
            const list = await get('/my-tip-receipts', user).expect(200);
            expect(list.body).toEqual([]);
            expect(list.headers['cache-control']).toBe('private, no-store');
            await get(`/my-tip-receipts/${peer.id}/download`, user).expect(404);
          }
          expect(await downloadAudits(f, peer.id)).toEqual([]);
        });
      });
    });

    describe('contador y administrador en /tip-pools/:id/receipts', () => {
      it('listan y descargan la constancia de cualquier trabajador, sin caché', async () => {
        await withinRollback(async (f) => {
          await pay(f);
          for (const user of [f.accountant, f.admin]) {
            const list = await get(
              `/tip-pools/${f.pool.id}/receipts`,
              user,
            ).expect(200);
            expect(list.headers['cache-control']).toBe('private, no-store');
            expect(
              Object.fromEntries(
                (list.body as TipPoolReceiptResponse[]).map((receipt) => [
                  receipt.userId,
                  receipt.amount,
                ]),
              ),
            ).toEqual({
              [f.workerOne.id]: 10000,
              [f.workerTwo.id]: 15000,
            });

            for (const worker of [f.workerOne, f.workerTwo]) {
              const file = await download(
                `/tip-pools/${f.pool.id}/receipts/${worker.id}/download`,
                user,
              ).expect(200);
              expect(file.headers['content-type']).toBe('application/pdf');
              expect(file.headers['cache-control']).toBe('private, no-store');
              expect(file.headers['x-content-type-options']).toBe('nosniff');
            }
          }
        });
      });

      it('responden 409 con el reparto en DRAFT', async () => {
        await withinRollback(async (f) => {
          await expectPoolReceiptsConflict(f);
        });
      });

      it('responden 409 con el reparto en CONFIRMED', async () => {
        await withinRollback(async (f) => {
          await confirm(f);
          await expectPoolReceiptsConflict(f);
        });
      });
    });

    it('la transacción revertida no deja datos en la base', async () => {
      expect(
        await prisma.store.count({
          where: { name: { startsWith: STORE_NAME_PREFIX } },
        }),
      ).toBe(0);
      expect(
        await prisma.tipPoolReceipt.count({
          where: { storeName: { startsWith: STORE_NAME_PREFIX } },
        }),
      ).toBe(0);
      expect(
        await prisma.user.count({
          where: { email: { endsWith: EMAIL_DOMAIN } },
        }),
      ).toBe(0);
      expect(
        await prisma.auditLog.count({
          where: { user: { email: { endsWith: EMAIL_DOMAIN } } },
        }),
      ).toBe(0);
    });
  },
);
