import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { ROLE, type RoleCode } from '../src/auth/constants/roles.constants.js';
import type { AuthUser, JwtPayload } from '../src/auth/types/auth.types.js';
import { businessDateOf } from '../src/documents/utils/document-dates.util.js';
import { Prisma, PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { currentMonthRange } from '../src/tips/my-tips.service.js';
import type { MyTipsResponse } from '../src/tips/types/my-tips.types.js';
import { createDailyOperation } from './helpers/daily-operations.js';
import {
  createSwitchablePrisma,
  type SwitchablePrisma,
} from './helpers/switchable-prisma.js';

type App = Parameters<typeof request>[0];
type Tx = Prisma.TransactionClient;

// Tests de integración HTTP del portal de propinas del trabajador
// (SPRINT-4A-T09) contra PostgreSQL real: cada persona ve solo sus propinas
// por día (fecha, local, monto, estado y fecha de pago) con los totales
// pendiente y pagado; la propina que el supervisor guarda hoy aparece de
// inmediato como No pagada; acceso cruzado imposible (la identidad sale del
// JWT y userId se rechaza); ADMINISTRADOR y CONTADOR reciben 403. Todo corre
// dentro de withinRollback: la base se revierte.
const databaseUrl = process.env.TEST_DATABASE_URL;

// Fechas pasadas: no chocan con la operación de «hoy» que crea un test.
const D1 = '2026-10-05';
const D2 = '2026-10-06';
const FROM = '2026-10-01';
const TO = '2026-10-31';
const PAID_AT = '2026-10-07T15:00:00.000Z';

class Rollback extends Error {
  constructor() {
    super('rollback de prueba');
    this.name = 'Rollback';
  }
}

interface Fixture {
  tx: Tx;
  storeId: string;
  storeName: string;
  admin: AuthUser;
  accountant: AuthUser;
  supervisor: AuthUser;
  ana: AuthUser;
  beto: AuthUser;
  outsider: AuthUser;
  batchId: string;
}

function messagesOf(body: unknown): string {
  const message = (body as { message?: unknown }).message;
  if (Array.isArray(message)) return message.join(' ');
  return typeof message === 'string' ? message : '';
}

function todayInChile(): string {
  const { year, month, day } = businessDateOf(new Date());
  return [
    String(year).padStart(4, '0'),
    String(month).padStart(2, '0'),
    String(day).padStart(2, '0'),
  ].join('-');
}

describe.skipIf(!databaseUrl)(
  'API del portal de propinas del trabajador (SPRINT-4A-T09)',
  { timeout: 60_000 },
  () => {
    let app: INestApplication<App>;
    let jwt: JwtService;
    let prisma: PrismaClient;
    let switchable: SwitchablePrisma;

    function authorize(req: request.Test, user: AuthUser | null): request.Test {
      if (!user) return req;
      const payload: JwtPayload = {
        sub: user.id,
        email: user.email,
        role: user.role,
        storeId: user.storeId,
      };
      return req.set('Authorization', `Bearer ${jwt.sign(payload)}`);
    }

    function get(path: string, user: AuthUser | null): request.Test {
      return authorize(request(app.getHttpServer()).get(path), user);
    }

    function myTips(
      user: AuthUser | null,
      params: Record<string, string> = { from: FROM, to: TO },
    ): request.Test {
      const search = new URLSearchParams(params).toString();
      return get(search ? `/my-tips?${search}` : '/my-tips', user);
    }

    async function createUser(
      tx: Tx,
      role: RoleCode,
      storeId: string | null,
      firstName: string,
    ): Promise<AuthUser> {
      const roleRecord = await tx.role.upsert({
        where: { code: role },
        update: {},
        create: { code: role, name: role },
      });
      const id = randomUUID();
      const email = `${id}@my-tips-test.invalid`;
      await tx.user.create({
        data: {
          id,
          email,
          passwordHash: '$2b$04$hash-de-prueba',
          firstName,
          lastName: 'Portal',
          roleId: roleRecord.id,
          storeId,
        },
      });
      return { id, email, role, storeId };
    }

    // D1 $30.000 entre Ana, Beto y Sofía (todo pagado) y D2 $10.000 entre
    // Ana y Sofía (pendiente). Pía trabaja en otro local y no tiene propinas.
    async function createFixture(tx: Tx): Promise<Fixture> {
      const storeName = `Subway Portal Propinas ${randomUUID()}`;
      const store = await tx.store.create({
        data: { name: storeName, city: 'Melipilla', address: 'Calle 1' },
      });
      const otherStore = await tx.store.create({
        data: {
          name: `Subway Portal Propinas Otro ${randomUUID()}`,
          city: 'Calera',
          address: 'Calle 2',
        },
      });
      const supervisor = await createUser(
        tx,
        ROLE.SUPERVISOR,
        store.id,
        'Sofía',
      );
      const ana = await createUser(tx, ROLE.TRABAJADOR, store.id, 'Ana');
      const beto = await createUser(tx, ROLE.TRABAJADOR, store.id, 'Beto');
      const outsider = await createUser(
        tx,
        ROLE.TRABAJADOR,
        otherStore.id,
        'Pía',
      );
      const base = { storeId: store.id, responsibleId: supervisor.id };
      const d1 = await createDailyOperation(tx, {
        ...base,
        businessDate: D1,
        cashTipAmount: 30_000,
        participantIds: [ana.id, beto.id, supervisor.id],
      });
      await createDailyOperation(tx, {
        ...base,
        businessDate: D2,
        cashTipAmount: 10_000,
        participantIds: [ana.id, supervisor.id],
      });
      const accountant = await createUser(tx, ROLE.CONTADOR, null, 'Contador');
      const paid = await tx.dailyTipAllocation.findMany({
        where: { operationId: d1 },
      });
      const batch = await tx.tipPaymentBatch.create({
        data: {
          storeId: store.id,
          periodStart: new Date(`${D1}T00:00:00.000Z`),
          periodEnd: new Date(`${D1}T00:00:00.000Z`),
          totalAmount: paid.reduce((sum, tip) => sum + tip.amount, 0n),
          allocationCount: paid.length,
          paidById: accountant.id,
          paidAt: new Date(PAID_AT),
        },
      });
      await tx.dailyTipAllocation.updateMany({
        where: { id: { in: paid.map((tip) => tip.id) } },
        data: { status: 'PAID', paymentBatchId: batch.id },
      });
      return {
        tx,
        storeId: store.id,
        storeName,
        admin: await createUser(tx, ROLE.ADMINISTRADOR, null, 'Admin'),
        accountant,
        supervisor,
        ana,
        beto,
        outsider,
        batchId: batch.id,
      };
    }

    async function withinRollback(
      run: (fixture: Fixture) => Promise<void>,
    ): Promise<void> {
      try {
        await prisma.$transaction(
          async (tx) => {
            switchable.use(tx);
            const fixture = await createFixture(tx);
            // El fixture cumple la conciliación; luego se vuelve al modo
            // diferido, como en una transacción real de la API, y al final se
            // verifica como lo haría el commit.
            await tx.$executeRawUnsafe('SET CONSTRAINTS ALL IMMEDIATE');
            await tx.$executeRawUnsafe('SET CONSTRAINTS ALL DEFERRED');
            await run(fixture);
            await tx.$executeRawUnsafe('SET CONSTRAINTS ALL IMMEDIATE');
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
    });

    afterAll(async () => {
      await prisma.$disconnect();
      await app.close();
    });

    it('devuelve por día la fecha, el local, el monto, el estado y la fecha de pago, con los totales', async () => {
      await withinRollback(async (f) => {
        const response = await myTips(f.ana).expect(200);
        expect(response.headers['cache-control']).toBe('private, no-store');
        const body = response.body as MyTipsResponse;
        const store = { id: f.storeId, name: f.storeName };
        expect(body).toEqual({
          from: FROM,
          to: TO,
          days: [
            {
              id: expect.any(String) as string,
              businessDate: D2,
              store,
              amount: 5_000,
              status: 'UNPAID',
              paymentBatchId: null,
              paidAt: null,
            },
            {
              id: expect.any(String) as string,
              businessDate: D1,
              store,
              amount: 10_000,
              status: 'PAID',
              paymentBatchId: f.batchId,
              paidAt: PAID_AT,
            },
          ],
          totals: {
            totalAmount: 15_000,
            paidAmount: 10_000,
            unpaidAmount: 5_000,
            dayCount: 2,
          },
        });
        // Solo id y nombre del local: ningún dato personal de compañeros.
        expect(JSON.stringify(body)).not.toContain(f.beto.id);
        expect(JSON.stringify(body)).not.toContain('Beto');

        // Los totales cuadran con las propinas guardadas de Ana.
        const db = await f.tx.dailyTipAllocation.aggregate({
          where: { workerId: f.ana.id },
          _sum: { amount: true },
        });
        expect(body.totals.totalAmount).toBe(Number(db._sum.amount));

        // Un rango sin propinas responde vacío con totales en 0.
        const empty = (
          await myTips(f.ana, { from: '2026-09-01', to: '2026-09-30' }).expect(
            200,
          )
        ).body as MyTipsResponse;
        expect(empty).toEqual({
          from: '2026-09-01',
          to: '2026-09-30',
          days: [],
          totals: {
            totalAmount: 0,
            paidAmount: 0,
            unpaidAmount: 0,
            dayCount: 0,
          },
        });
      });
    });

    it('el supervisor también ve solo sus propias propinas', async () => {
      await withinRollback(async (f) => {
        const body = (await myTips(f.supervisor).expect(200))
          .body as MyTipsResponse;
        expect(body.days.map((day) => [day.businessDate, day.amount])).toEqual([
          [D2, 5_000],
          [D1, 10_000],
        ]);
        expect(body.totals).toMatchObject({ paidAmount: 10_000 });
      });
    });

    it('acceso cruzado: cada trabajador ve solo lo suyo y userId se rechaza', async () => {
      await withinRollback(async (f) => {
        const anaIds = new Set(
          (
            await f.tx.dailyTipAllocation.findMany({
              where: { workerId: f.ana.id },
              select: { id: true },
            })
          ).map((tip) => tip.id),
        );
        const beto = (await myTips(f.beto).expect(200)).body as MyTipsResponse;
        expect(beto.days).toHaveLength(1);
        expect(beto.days[0]).toMatchObject({
          businessDate: D1,
          status: 'PAID',
        });
        expect(beto.days.some((day) => anaIds.has(day.id))).toBe(false);
        expect(beto.totals).toMatchObject({
          totalAmount: 10_000,
          unpaidAmount: 0,
        });

        // Otro local, sin propinas propias: vacío, nunca las del local ajeno.
        const outsider = (await myTips(f.outsider).expect(200))
          .body as MyTipsResponse;
        expect(outsider.days).toEqual([]);

        // No hay forma de pedir las de otra persona ni de otro local.
        const withUserId = await myTips(f.beto, {
          from: FROM,
          to: TO,
          userId: f.ana.id,
        }).expect(400);
        expect(messagesOf(withUserId.body)).toContain('userId');
        await myTips(f.beto, { from: FROM, to: TO, workerId: f.ana.id }).expect(
          400,
        );
        await myTips(f.outsider, {
          from: FROM,
          to: TO,
          storeId: f.storeId,
        }).expect(400);
      });
    });

    it('ADMINISTRADOR y CONTADOR reciben 403 y sin sesión 401', async () => {
      await withinRollback(async (f) => {
        await myTips(f.admin).expect(403);
        await myTips(f.accountant).expect(403);
        await myTips(null).expect(401);
      });
    });

    it('la propina que el supervisor guarda hoy aparece de inmediato como No pagada', async () => {
      await withinRollback(async (f) => {
        const today = todayInChile();
        let save = authorize(
          request(app.getHttpServer()).post('/daily-operations'),
          f.supervisor,
        )
          .field('storeId', f.storeId)
          .field('businessDate', today)
          .field('cardTipAmount', '0')
          .field('cashTipAmount', '15000')
          .field('cashDifference', '0');
        for (const id of [f.ana.id, f.supervisor.id]) {
          save = save.field('participantIds', id);
        }
        await save.expect(201);

        // Sin from ni to: el mes en curso, que incluye hoy.
        const body = (await myTips(f.ana, {}).expect(200))
          .body as MyTipsResponse;
        expect(body).toMatchObject(currentMonthRange(new Date()));
        expect(body.days[0]).toMatchObject({
          businessDate: today,
          store: { id: f.storeId },
          amount: 7_500,
          status: 'UNPAID',
          paymentBatchId: null,
          paidAt: null,
        });
        expect(body.totals.unpaidAmount).toBeGreaterThanOrEqual(7_500);
      });
    });

    it('responde 400 con rango inválido, incompleto o mayor a 62 días', async () => {
      await withinRollback(async (f) => {
        const invalid: Record<string, string>[] = [
          { from: '2026-11-10', to: '2026-11-09' },
          { from: '2026-11-01', to: '2027-01-02' },
          { from: '2026-02-30', to: '2026-03-01' },
          { from: '01-11-2026', to: '2026-11-30' },
          { from: FROM },
          { to: TO },
        ];
        for (const params of invalid) {
          await myTips(f.ana, params).expect(400);
        }
        const tooLong = await myTips(f.ana, {
          from: '2026-11-01',
          to: '2027-01-02',
        }).expect(400);
        expect(messagesOf(tooLong.body)).toContain('62 días');
        await myTips(f.ana, { from: '2026-11-01', to: '2027-01-01' }).expect(
          200,
        );
      });
    });
  },
);
