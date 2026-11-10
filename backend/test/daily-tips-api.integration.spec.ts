import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { ROLE, type RoleCode } from '../src/auth/constants/roles.constants.js';
import type { AuthUser, JwtPayload } from '../src/auth/types/auth.types.js';
import { Prisma, PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import type {
  DailyTipDayDetailResponse,
  DailyTipDaysResponse,
  DailyTipSummaryResponse,
} from '../src/tips/types/daily-tips.types.js';
import { createDailyOperation } from './helpers/daily-operations.js';
import {
  createSwitchablePrisma,
  type SwitchablePrisma,
} from './helpers/switchable-prisma.js';

type App = Parameters<typeof request>[0];
type Tx = Prisma.TransactionClient;

// Tests de integración HTTP de la consulta de propinas diarias por
// trabajador (SPRINT-4A-T04) contra PostgreSQL real: total por día con su
// estado (No pagado, Parcial, Pagado), detalle por trabajador de un día y
// resumen del período por trabajador con filtro por estado; los totales
// cuadran con las propinas guardadas; acceso por rol y local; validación del
// rango. Todo corre dentro de withinRollback: la base se revierte.
const databaseUrl = process.env.TEST_DATABASE_URL;

const D1 = '2026-11-03';
const D2 = '2026-11-04';
const D3 = '2026-11-05';
const FROM = '2026-11-01';
const TO = '2026-11-30';

class Rollback extends Error {
  constructor() {
    super('rollback de prueba');
    this.name = 'Rollback';
  }
}

interface Fixture {
  tx: Tx;
  storeId: string;
  otherStoreId: string;
  admin: AuthUser;
  accountant: AuthUser;
  supervisor: AuthUser;
  otherSupervisor: AuthUser;
  ana: AuthUser;
  beto: AuthUser;
  carla: AuthUser;
  operations: Record<string, string>;
  batchId: string;
}

function messagesOf(body: unknown): string {
  const message = (body as { message?: unknown }).message;
  if (Array.isArray(message)) return message.join(' ');
  return typeof message === 'string' ? message : '';
}

describe.skipIf(!databaseUrl)(
  'API de consulta de propinas diarias (SPRINT-4A-T04)',
  { timeout: 60_000 },
  () => {
    let app: INestApplication<App>;
    let jwt: JwtService;
    let prisma: PrismaClient;
    let switchable: SwitchablePrisma;

    function get(path: string, user: AuthUser | null): request.Test {
      const req = request(app.getHttpServer()).get(path);
      if (!user) return req;
      const payload: JwtPayload = {
        sub: user.id,
        email: user.email,
        role: user.role,
        storeId: user.storeId,
      };
      return req.set('Authorization', `Bearer ${jwt.sign(payload)}`);
    }

    function query(params: Record<string, string>): string {
      return new URLSearchParams(params).toString();
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
      const email = `${id}@daily-tips-test.invalid`;
      await tx.user.create({
        data: {
          id,
          email,
          passwordHash: '$2b$04$hash-de-prueba',
          firstName,
          lastName: 'Propinas',
          roleId: roleRecord.id,
          storeId,
        },
      });
      return { id, email, role, storeId };
    }

    // Tres días del local: D1 $40.000 entre 4 (todo pagado), D2 $10.000
    // entre 3 (solo la propina de Ana pagada) y D3 con fondo 0. Las propinas
    // las genera el helper con la misma regla que la API (SPRINT-4A-T03).
    async function createFixture(tx: Tx): Promise<Fixture> {
      const store = await tx.store.create({
        data: {
          name: `Subway Propinas Diarias API ${randomUUID()}`,
          city: 'Melipilla',
          address: 'Calle 1',
        },
      });
      const otherStore = await tx.store.create({
        data: {
          name: `Subway Propinas Diarias API Otro ${randomUUID()}`,
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
      const carla = await createUser(tx, ROLE.TRABAJADOR, store.id, 'Carla');
      const base = { storeId: store.id, responsibleId: supervisor.id };
      const operations = {
        [D1]: await createDailyOperation(tx, {
          ...base,
          businessDate: D1,
          cashTipAmount: 40_000,
          participantIds: [ana.id, beto.id, carla.id, supervisor.id],
        }),
        [D2]: await createDailyOperation(tx, {
          ...base,
          businessDate: D2,
          cashTipAmount: 10_000,
          participantIds: [ana.id, beto.id, supervisor.id],
        }),
        [D3]: await createDailyOperation(tx, { ...base, businessDate: D3 }),
      };
      const accountant = await createUser(tx, ROLE.CONTADOR, null, 'Contador');
      // Lote de pago (el endpoint de pago es SPRINT-4A-T06): todo D1 y la
      // propina de Ana en D2.
      const paid = await tx.dailyTipAllocation.findMany({
        where: {
          OR: [
            { operationId: operations[D1] },
            { operationId: operations[D2], workerId: ana.id },
          ],
        },
      });
      const batch = await tx.tipPaymentBatch.create({
        data: {
          storeId: store.id,
          periodStart: new Date(`${D1}T00:00:00.000Z`),
          periodEnd: new Date(`${D2}T00:00:00.000Z`),
          totalAmount: paid.reduce((sum, tip) => sum + tip.amount, 0n),
          allocationCount: paid.length,
          paidById: accountant.id,
          paidAt: new Date('2026-11-06T15:00:00.000Z'),
        },
      });
      await tx.dailyTipAllocation.updateMany({
        where: { id: { in: paid.map((tip) => tip.id) } },
        data: { status: 'PAID', paymentBatchId: batch.id },
      });
      return {
        tx,
        storeId: store.id,
        otherStoreId: otherStore.id,
        admin: await createUser(tx, ROLE.ADMINISTRADOR, null, 'Admin'),
        accountant,
        supervisor,
        otherSupervisor: await createUser(
          tx,
          ROLE.SUPERVISOR,
          otherStore.id,
          'Otro',
        ),
        ana,
        beto,
        carla,
        operations,
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
            // Las propinas del fixture cumplen la conciliación de la base.
            await tx.$executeRawUnsafe('SET CONSTRAINTS ALL IMMEDIATE');
            await run(fixture);
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

    // Totales de la base para comparar con la API.
    async function dbTotals(
      f: Fixture,
      status?: 'PAID' | 'UNPAID',
    ): Promise<number> {
      const aggregate = await f.tx.dailyTipAllocation.aggregate({
        where: { storeId: f.storeId, ...(status ? { status } : {}) },
        _sum: { amount: true },
      });
      return Number(aggregate._sum.amount ?? 0n);
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

    it('devuelve por día el total, los participantes y el estado (Pagado, Parcial, No pagado)', async () => {
      await withinRollback(async (f) => {
        const body = (
          await get(
            `/daily-tips/days?${query({ storeId: f.storeId, from: FROM, to: TO })}`,
            f.admin,
          ).expect(200)
        ).body as DailyTipDaysResponse;

        expect(body.store.id).toBe(f.storeId);
        expect(body).toMatchObject({ from: FROM, to: TO });
        expect(body.days).toEqual([
          {
            operationId: f.operations[D1],
            businessDate: D1,
            tipFundAmount: 40_000,
            participantCount: 4,
            totalAmount: 40_000,
            paidAmount: 40_000,
            unpaidAmount: 0,
            status: 'PAID',
          },
          {
            operationId: f.operations[D2],
            businessDate: D2,
            tipFundAmount: 10_000,
            participantCount: 3,
            totalAmount: 10_000,
            paidAmount: expect.any(Number) as number,
            unpaidAmount: expect.any(Number) as number,
            status: 'PARTIAL',
          },
          {
            operationId: f.operations[D3],
            businessDate: D3,
            tipFundAmount: 0,
            participantCount: 0,
            totalAmount: 0,
            paidAmount: 0,
            unpaidAmount: 0,
            status: 'UNPAID',
          },
        ]);
        const [, partial] = body.days;
        expect(partial.paidAmount + partial.unpaidAmount).toBe(10_000);
        expect([3_333, 3_334]).toContain(partial.paidAmount);

        // Los totales cuadran con las propinas guardadas.
        expect(body.totals).toEqual({
          totalAmount: await dbTotals(f),
          paidAmount: await dbTotals(f, 'PAID'),
          unpaidAmount: await dbTotals(f, 'UNPAID'),
          dayCount: 3,
        });
        expect(body.totals.totalAmount).toBe(50_000);

        // Rango sin el D1: solo los días del rango.
        const narrow = (
          await get(
            `/daily-tips/days?${query({ storeId: f.storeId, from: D2, to: D2 })}`,
            f.accountant,
          ).expect(200)
        ).body as DailyTipDaysResponse;
        expect(narrow.days.map((day) => day.businessDate)).toEqual([D2]);
      });
    });

    it('detalla un día por trabajador: $40.000 entre 4 son $10.000 a cada uno', async () => {
      await withinRollback(async (f) => {
        const body = (
          await get(
            `/daily-tips/day?${query({ storeId: f.storeId, businessDate: D1 })}`,
            f.accountant,
          ).expect(200)
        ).body as DailyTipDayDetailResponse;

        expect(body).toMatchObject({
          operationId: f.operations[D1],
          businessDate: D1,
          totalAmount: 40_000,
          participantCount: 4,
          status: 'PAID',
          store: { id: f.storeId },
        });
        // Ordenadas por nombre; solo id y nombre de cada persona.
        expect(body.allocations.map((tip) => tip.worker)).toEqual([
          { id: f.ana.id, name: 'Ana Propinas' },
          { id: f.beto.id, name: 'Beto Propinas' },
          { id: f.carla.id, name: 'Carla Propinas' },
          { id: f.supervisor.id, name: 'Sofía Propinas' },
        ]);
        for (const tip of body.allocations) {
          expect(tip).toMatchObject({
            amount: 10_000,
            status: 'PAID',
            paymentBatchId: f.batchId,
            paidAt: '2026-11-06T15:00:00.000Z',
          });
        }
        expect(JSON.stringify(body)).not.toContain(f.ana.email);

        // Día parcial: la propina pendiente no trae lote ni fecha de pago.
        const partial = (
          await get(
            `/daily-tips/day?${query({ storeId: f.storeId, businessDate: D2 })}`,
            f.admin,
          ).expect(200)
        ).body as DailyTipDayDetailResponse;
        expect(partial.status).toBe('PARTIAL');
        const pending = partial.allocations.filter(
          (tip) => tip.status === 'UNPAID',
        );
        expect(pending).toHaveLength(2);
        for (const tip of pending) {
          expect(tip.paymentBatchId).toBeNull();
          expect(tip.paidAt).toBeNull();
        }
        expect(
          partial.allocations.reduce((sum, tip) => sum + tip.amount, 0),
        ).toBe(partial.totalAmount);

        // Día con fondo 0: total 0 y sin propinas.
        const empty = (
          await get(
            `/daily-tips/day?${query({ storeId: f.storeId, businessDate: D3 })}`,
            f.admin,
          ).expect(200)
        ).body as DailyTipDayDetailResponse;
        expect(empty).toMatchObject({ totalAmount: 0, allocations: [] });

        // Día sin operación registrada.
        await get(
          `/daily-tips/day?${query({ storeId: f.storeId, businessDate: '2026-11-20' })}`,
          f.admin,
        ).expect(404);
      });
    });

    it('resume el período por trabajador con días, pendiente, pagado y total general', async () => {
      await withinRollback(async (f) => {
        const body = (
          await get(
            `/daily-tips/summary?${query({ storeId: f.storeId, from: FROM, to: TO })}`,
            f.accountant,
          ).expect(200)
        ).body as DailyTipSummaryResponse;

        expect(body.status).toBeNull();
        expect(body.workers.map((row) => row.worker.name)).toEqual([
          'Ana Propinas',
          'Beto Propinas',
          'Carla Propinas',
          'Sofía Propinas',
        ]);
        const byName = new Map(
          body.workers.map((row) => [row.worker.name, row]),
        );
        // Ana: D1 pagado (10.000) + D2 pagado; Carla solo D1.
        expect(byName.get('Ana Propinas')).toMatchObject({
          dayCount: 2,
          unpaidAmount: 0,
        });
        expect(byName.get('Carla Propinas')).toEqual({
          worker: { id: f.carla.id, name: 'Carla Propinas' },
          dayCount: 1,
          totalAmount: 10_000,
          paidAmount: 10_000,
          unpaidAmount: 0,
        });
        expect(byName.get('Beto Propinas')).toMatchObject({
          dayCount: 2,
          paidAmount: 10_000,
        });
        for (const row of body.workers) {
          expect(row.totalAmount).toBe(row.paidAmount + row.unpaidAmount);
        }

        // El total general cuadra con los trabajadores y con la base.
        const sum = (key: 'totalAmount' | 'paidAmount' | 'unpaidAmount') =>
          body.workers.reduce((total, row) => total + row[key], 0);
        expect(body.totals).toEqual({
          totalAmount: sum('totalAmount'),
          paidAmount: sum('paidAmount'),
          unpaidAmount: sum('unpaidAmount'),
          workerCount: 4,
          dayCount: 2,
        });
        expect(body.totals.totalAmount).toBe(await dbTotals(f));
        expect(body.totals.paidAmount).toBe(await dbTotals(f, 'PAID'));
      });
    });

    it('filtra el resumen por estado: solo lo pendiente o solo lo pagado', async () => {
      await withinRollback(async (f) => {
        const unpaid = (
          await get(
            `/daily-tips/summary?${query({ storeId: f.storeId, from: FROM, to: TO, status: 'UNPAID' })}`,
            f.admin,
          ).expect(200)
        ).body as DailyTipSummaryResponse;
        expect(unpaid.status).toBe('UNPAID');
        // En D2 quedan pendientes Beto y Sofía.
        expect(unpaid.workers.map((row) => row.worker.id).sort()).toEqual(
          [f.beto.id, f.supervisor.id].sort(),
        );
        expect(unpaid.totals).toMatchObject({
          paidAmount: 0,
          totalAmount: await dbTotals(f, 'UNPAID'),
          dayCount: 1,
        });

        const paid = (
          await get(
            `/daily-tips/summary?${query({ storeId: f.storeId, from: FROM, to: TO, status: 'PAID' })}`,
            f.admin,
          ).expect(200)
        ).body as DailyTipSummaryResponse;
        expect(paid.totals).toMatchObject({
          unpaidAmount: 0,
          totalAmount: await dbTotals(f, 'PAID'),
          workerCount: 4,
        });
        expect(paid.totals.totalAmount + unpaid.totals.totalAmount).toBe(
          50_000,
        );
      });
    });

    it('ADMINISTRADOR y CONTADOR consultan todos los locales; el SUPERVISOR solo el suyo; TRABAJADOR 403', async () => {
      await withinRollback(async (f) => {
        const own = query({ storeId: f.storeId, from: FROM, to: TO });
        const other = query({ storeId: f.otherStoreId, from: FROM, to: TO });
        const day = query({ storeId: f.storeId, businessDate: D1 });
        for (const path of ['days', 'summary']) {
          await get(`/daily-tips/${path}?${own}`, f.admin).expect(200);
          await get(`/daily-tips/${path}?${own}`, f.accountant).expect(200);
          await get(`/daily-tips/${path}?${other}`, f.admin).expect(200);
          await get(`/daily-tips/${path}?${other}`, f.accountant).expect(200);
          await get(`/daily-tips/${path}?${own}`, f.supervisor).expect(200);
          await get(`/daily-tips/${path}?${other}`, f.supervisor).expect(403);
          await get(`/daily-tips/${path}?${own}`, f.otherSupervisor).expect(
            403,
          );
          await get(`/daily-tips/${path}?${own}`, f.ana).expect(403);
          await get(`/daily-tips/${path}?${own}`, null).expect(401);
        }
        await get(`/daily-tips/day?${day}`, f.supervisor).expect(200);
        await get(`/daily-tips/day?${day}`, f.otherSupervisor).expect(403);
        await get(`/daily-tips/day?${day}`, f.ana).expect(403);
        await get(`/daily-tips/day?${day}`, null).expect(401);

        // Otro local sin operaciones: vacío, no error.
        const empty = (
          await get(`/daily-tips/days?${other}`, f.admin).expect(200)
        ).body as DailyTipDaysResponse;
        expect(empty.days).toEqual([]);
        expect(empty.totals).toEqual({
          totalAmount: 0,
          paidAmount: 0,
          unpaidAmount: 0,
          dayCount: 0,
        });
      });
    });

    it('responde 400 con rango inválido o mayor a 62 días y 404 con local inexistente', async () => {
      await withinRollback(async (f) => {
        const invalid: Record<string, string>[] = [
          { storeId: f.storeId, from: '2026-11-10', to: '2026-11-09' },
          { storeId: f.storeId, from: '2026-11-01', to: '2027-01-02' },
          { storeId: f.storeId, from: '2026-02-30', to: '2026-03-01' },
          { storeId: f.storeId, from: '01-11-2026', to: '2026-11-30' },
          { storeId: 'no-es-uuid', from: FROM, to: TO },
          { storeId: f.storeId, from: FROM },
        ];
        for (const params of invalid) {
          for (const path of ['days', 'summary']) {
            await get(`/daily-tips/${path}?${query(params)}`, f.admin).expect(
              400,
            );
          }
        }
        const tooLong = await get(
          `/daily-tips/days?${query({ storeId: f.storeId, from: '2026-11-01', to: '2027-01-02' })}`,
          f.admin,
        ).expect(400);
        expect(messagesOf(tooLong.body)).toContain('62 días');
        // 62 días exactos (ambos extremos incluidos) es válido.
        await get(
          `/daily-tips/days?${query({ storeId: f.storeId, from: '2026-11-01', to: '2027-01-01' })}`,
          f.admin,
        ).expect(200);

        await get(
          `/daily-tips/summary?${query({ storeId: f.storeId, from: FROM, to: TO, status: 'PENDIENTE' })}`,
          f.admin,
        ).expect(400);
        await get(
          `/daily-tips/day?${query({ storeId: f.storeId, businessDate: '2026-13-01' })}`,
          f.admin,
        ).expect(400);

        const missing = '00000000-0000-4000-8000-000000000000';
        await get(
          `/daily-tips/days?${query({ storeId: missing, from: FROM, to: TO })}`,
          f.admin,
        ).expect(404);
        await get(
          `/daily-tips/day?${query({ storeId: missing, businessDate: D1 })}`,
          f.admin,
        ).expect(404);
      });
    });
  },
);
