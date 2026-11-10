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
import { createDailyOperation } from './helpers/daily-operations.js';
import {
  confirmLegacyTipPool,
  createLegacyTipPool,
  payLegacyTipPool,
} from './helpers/legacy-tip-pools.js';
import {
  ensureDefaultPaymentMethods,
  paymentMethodIdOf,
} from './helpers/payment-methods.js';
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

    // Mismos montos del reparto demo con la regla equitativa (SPRINT-4R-T04):
    // el 05-01 los dos trabajadores se reparten 20.000 (15.000 de tarjeta y
    // 5.000 en efectivo) y el 06-01 solo el segundo recibe 5.000 en efectivo:
    // 10.000 y 15.000, total 25.000. Desde SPRINT-4A-T08 la API ya no
    // calcula ni paga repartos: el histórico se construye en la base con el
    // helper de repartos históricos y queda en DRAFT.
    async function createFixture(
      tx: Prisma.TransactionClient,
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
      const mixedDay = await createDailyOperation(tx, {
        storeId: store.id,
        responsibleId: supervisor.id,
        businessDate: '2026-01-05',
        cardTipAmount: 15000,
        cashTipAmount: 5000,
        participantIds: [workerOne.id, workerTwo.id],
      });
      const cashDay = await createDailyOperation(tx, {
        storeId: store.id,
        responsibleId: supervisor.id,
        businessDate: '2026-01-06',
        cashTipAmount: 5000,
        participantIds: [workerTwo.id],
      });
      const created = await createLegacyTipPool(tx, {
        storeId: store.id,
        periodStart: PERIOD.start,
        periodEnd: PERIOD.end,
        accountantId: accountant.id,
        status: 'DRAFT',
        days: [
          {
            operationId: mixedDay,
            businessDate: '2026-01-05',
            fundAmount: 20000,
            participantIds: [workerOne.id, workerTwo.id],
          },
          {
            operationId: cashDay,
            businessDate: '2026-01-06',
            fundAmount: 5000,
            participantIds: [workerTwo.id],
          },
        ],
      });
      const pool = await app
        .get(TipPoolsService)
        .findOne(created.id, accountant);
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

    // Reparto proporcional histórico (anterior a SPRINT-4R-T04) en otro
    // período del mismo local, construido directamente en la base como lo
    // dejaba el motor anterior: pacto, registros diarios, horas 40/60 y
    // líneas 10.000/15.000. Queda en DRAFT para confirmarlo y pagarlo con el
    // helper de repartos históricos.
    async function createLegacyPool(f: Fixture): Promise<TipPoolResponse> {
      const legacy = { start: '2025-12-01', end: '2025-12-07' } as const;
      const storeId = f.pool.store.id;
      const agreement = await f.tx.tipAgreement.create({
        data: {
          id: randomUUID(),
          name: 'Pacto constancias histórico',
          rule: 'PROPORTIONAL_TO_HOURS',
          validFrom: day('2025-01-01'),
          storeId,
          createdById: f.supervisor.id,
        },
      });
      await ensureDefaultPaymentMethods(f.tx);
      const cashId = await paymentMethodIdOf(f.tx, 'CASH');
      const debitId = await paymentMethodIdOf(f.tx, 'DEBIT_CARD');
      const entries = [
        {
          id: randomUUID(),
          date: '2025-12-01',
          methodId: cashId,
          amount: 10000,
        },
        {
          id: randomUUID(),
          date: '2025-12-02',
          methodId: debitId,
          amount: 15000,
        },
      ];
      await f.tx.tipEntry.createMany({
        data: entries.map((entry) => ({
          id: entry.id,
          businessDate: day(entry.date),
          paymentMethodId: entry.methodId,
          amount: entry.amount,
          storeId,
          responsibleId: f.supervisor.id,
        })),
      });
      const pool = await f.tx.tipPool.create({
        data: {
          storeId,
          periodStart: day(legacy.start),
          periodEnd: day(legacy.end),
          totalAmount: 25000,
          agreementId: agreement.id,
          agreementSnapshot: {
            id: agreement.id,
            name: agreement.name,
            rule: 'PROPORTIONAL_TO_HOURS',
            validFrom: '2025-01-01',
            validTo: null,
          },
          calculatedById: f.accountant.id,
          sources: {
            create: entries.map((entry) => ({
              tipEntryId: entry.id,
              amount: entry.amount,
            })),
          },
          lines: {
            create: [
              { userId: f.workerOne.id, hoursWorked: 40, amount: 10000 },
              { userId: f.workerTwo.id, hoursWorked: 60, amount: 15000 },
            ],
          },
        },
        select: { id: true },
      });
      return app.get(TipPoolsService).findOne(pool.id, f.accountant);
    }

    async function withinRollback(
      fn: (f: Fixture) => Promise<void>,
    ): Promise<void> {
      try {
        await prisma.$transaction(
          async (tx) => {
            switchable.use(tx);
            await fn(await createFixture(tx));
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

    async function confirm(f: Fixture): Promise<TipPoolResponse> {
      await confirmLegacyTipPool(f.tx, f.pool.id, f.accountant.id);
      return app.get(TipPoolsService).findOne(f.pool.id, f.accountant);
    }

    async function pay(f: Fixture): Promise<TipPoolResponse> {
      await confirm(f);
      await payLegacyTipPool(f.tx, f.pool.id, f.accountant.id, PAYMENT_DATE);
      return app.get(TipPoolsService).findOne(f.pool.id, f.accountant);
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
              hoursWorked: null,
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
              hoursWorked: null,
              amount: new Prisma.Decimal(10000),
              paymentDate: day(PAYMENT_DATE),
              paidById: f.accountant.id,
              paidByName: 'Contador Constancias',
              detail: {
                rule: 'EQUAL_SHARES',
                agreementSnapshot: null,
                totalAmount: 25000,
                totalHours: null,
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

    describe('compatibilidad con repartos proporcionales históricos (SPRINT-4R-T04)', () => {
      it('la constancia proporcional conserva sus horas y su PDF se descarga', async () => {
        await withinRollback(async (f) => {
          const legacy = await createLegacyPool(f);
          expect(legacy.rule).toBe('PROPORTIONAL_TO_HOURS');
          expect(legacy.totalHours).toBe('100.00');
          await confirmLegacyTipPool(f.tx, legacy.id, f.accountant.id);
          await payLegacyTipPool(
            f.tx,
            legacy.id,
            f.accountant.id,
            PAYMENT_DATE,
          );

          const list = await get('/my-tip-receipts', f.workerOne).expect(200);
          expect(list.body).toEqual([
            expect.objectContaining({
              userId: f.workerOne.id,
              periodStart: '2025-12-01',
              periodEnd: '2025-12-07',
              hoursWorked: '40.00',
              amount: 10000,
            }),
          ]);
          const [own] = list.body as { id: string }[];
          const file = await download(
            `/my-tip-receipts/${own.id}/download`,
            f.workerOne,
          ).expect(200);
          const body = file.body as Buffer;
          expect(body.subarray(0, 4).toString('latin1')).toBe('%PDF');
          expect(file.headers['x-content-sha256']).toBe(sha256(body));

          const receipts = (
            await get(`/tip-pools/${legacy.id}/receipts`, f.accountant).expect(
              200,
            )
          ).body as TipPoolReceiptResponse[];
          expect(
            receipts.map((receipt) => [
              receipt.userId,
              receipt.hoursWorked,
              receipt.detail.rule,
              receipt.detail.totalHours,
            ]),
          ).toEqual(
            expect.arrayContaining([
              [f.workerOne.id, '40.00', 'PROPORTIONAL_TO_HOURS', '100.00'],
              [f.workerTwo.id, '60.00', 'PROPORTIONAL_TO_HOURS', '100.00'],
            ]),
          );
        });
      });

      it('la constancia equitativa no inventa horas y declara su regla', async () => {
        await withinRollback(async (f) => {
          await pay(f);
          const receipts = (
            await get(`/tip-pools/${f.pool.id}/receipts`, f.accountant).expect(
              200,
            )
          ).body as TipPoolReceiptResponse[];
          expect(receipts).toHaveLength(2);
          for (const receipt of receipts) {
            expect(receipt.hoursWorked).toBeNull();
            expect(receipt.detail.rule).toBe('EQUAL_SHARES');
            expect(receipt.detail.totalHours).toBeNull();
            expect(receipt.detail.totalAmount).toBe(25000);
          }
        });
      });
    });

    describe('roles autorizados en /my-tip-receipts (SPRINT-4-T02)', () => {
      it('un trabajador que pasa a supervisor del mismo local lista y descarga su constancia', async () => {
        // Un SUPERVISOR no participa del reparto equitativo (los participantes
        // son TRABAJADOR activos del local al registrar el día): la constancia
        // se emite como trabajador y se conserva tras el cambio de rol.
        await withinRollback(async (f) => {
          await get('/my-tip-receipts', f.supervisor).expect(200, []);
          await pay(f);
          const receipt = await receiptOf(f, f.workerOne.id);
          const { id: roleId } = await f.tx.role.upsert({
            where: { code: ROLE.SUPERVISOR },
            update: {},
            create: { code: ROLE.SUPERVISOR, name: ROLE.SUPERVISOR },
          });
          await f.tx.user.update({
            where: { id: f.workerOne.id },
            data: { roleId },
          });
          const promoted: AuthUser = { ...f.workerOne, role: ROLE.SUPERVISOR };

          const list = await get('/my-tip-receipts', promoted).expect(200);
          expect(list.body).toEqual([
            expect.objectContaining({
              id: receipt.id,
              userId: f.workerOne.id,
              status: 'PAID',
              hoursWorked: null,
              amount: 10000,
            }),
          ]);

          const file = await download(
            `/my-tip-receipts/${receipt.id}/download`,
            promoted,
          ).expect(200);
          const body = file.body as Buffer;
          expect(body.subarray(0, 4).toString('latin1')).toBe('%PDF');
          expect(file.headers['x-content-sha256']).toBe(sha256(body));
          expect(await downloadAudits(f, receipt.id)).toEqual([
            expect.objectContaining({
              detail: { userId: f.workerOne.id },
              userId: f.workerOne.id,
            }),
          ]);

          // Sigue sin ver la constancia de un trabajador de su local, y el
          // supervisor que no participó no tiene constancia propia.
          const peer = await receiptOf(f, f.workerTwo.id);
          await get(`/my-tip-receipts/${peer.id}/download`, promoted).expect(
            404,
          );
          expect(await downloadAudits(f, peer.id)).toEqual([]);
          await get('/my-tip-receipts', f.supervisor).expect(200, []);
        });
      });

      it('conserva el historial al pasar a supervisor de otro local y deniega al pasar a un rol global', async () => {
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

          // El historial sigue disponible como supervisor; los roles globales
          // conservan la gestión, pero dejan de acceder a la consulta personal.
          const steps: { role: RoleCode; storeId: string | null }[] = [
            { role: ROLE.SUPERVISOR, storeId: newStore.id },
            { role: ROLE.CONTADOR, storeId: null },
            { role: ROLE.ADMINISTRADOR, storeId: null },
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

            if (role !== ROLE.SUPERVISOR) {
              await get('/my-tip-receipts', promoted).expect(403);
              await download(
                `/my-tip-receipts/${receipt.id}/download`,
                promoted,
              ).expect(403);
              continue;
            }

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
          expect(await downloadAudits(f, receipt.id)).toHaveLength(1);
        });
      });

      it('contador y administrador reciben 403 en listado y descarga personal', async () => {
        await withinRollback(async (f) => {
          await pay(f);
          const peer = await receiptOf(f, f.workerOne.id);
          for (const user of [f.accountant, f.admin]) {
            await get('/my-tip-receipts', user).expect(403);
            await get(`/my-tip-receipts/${peer.id}/download`, user).expect(403);
            await get(`/my-tip-receipts/${randomUUID()}/download`, user).expect(
              403,
            );
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
