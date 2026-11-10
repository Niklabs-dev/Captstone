import {
  NotFoundException,
  ValidationPipe,
  type INestApplication,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { AUDIT_ACTION } from '../src/audit/constants/audit-actions.constants.js';
import { ROLE, type RoleCode } from '../src/auth/constants/roles.constants.js';
import type { AuthUser, JwtPayload } from '../src/auth/types/auth.types.js';
import { Prisma, PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import type { TipPaymentBatchResponse } from '../src/tips/types/daily-tips.types.js';
import { TipPoolsService } from '../src/tips/tip-pools.service.js';
import {
  TIP_POOL_RETIRED_MESSAGE,
  type TipPoolReceiptResponse,
  type TipPoolResponse,
} from '../src/tips/types/tip-pools.types.js';
import { createDailyOperation } from './helpers/daily-operations.js';
import {
  createLegacyTipPool,
  type LegacyTipPool,
} from './helpers/legacy-tip-pools.js';
import { ensureDefaultPaymentMethods } from './helpers/payment-methods.js';
import {
  createSwitchablePrisma,
  type SwitchablePrisma,
} from './helpers/switchable-prisma.js';

type App = Parameters<typeof request>[0];
type Tx = Prisma.TransactionClient;

// Repartos por período como histórico de solo lectura (SPRINT-4A-T08) por
// HTTP contra PostgreSQL real. El reparto se genera al guardar la operación
// diaria y se paga por lote: el cálculo, la observación, la confirmación y el
// pago por período responden 410 sin tocar la base (así nadie paga por aquí
// propinas que el pago por lote también pagaría), mientras contador y
// administrador siguen consultando los repartos guardados y descargando las
// constancias de los pagados. Los borradores y confirmados antiguos no
// bloquean el flujo diario. Toda la aplicación corre dentro de la
// transacción del test (helpers/switchable-prisma.ts), que se revierte. Se
// omiten si no se define TEST_DATABASE_URL.
const databaseUrl = process.env.TEST_DATABASE_URL;

const EMAIL_DOMAIN = '@tip-pools-history-test.invalid';
const PAID_PERIOD = { start: '2026-09-01', end: '2026-09-07' } as const;
const CONFIRMED_PERIOD = { start: '2026-09-08', end: '2026-09-14' } as const;
const DRAFT_PERIOD = { start: '2026-09-15', end: '2026-09-21' } as const;

const RETIRED_BODY = {
  statusCode: 410,
  error: 'Gone',
  message: TIP_POOL_RETIRED_MESSAGE,
};

class Rollback extends Error {
  constructor() {
    super('rollback de prueba');
    this.name = 'Rollback';
  }
}

interface Fixture {
  tx: Tx;
  storeId: string;
  admin: AuthUser;
  accountant: AuthUser;
  supervisor: AuthUser;
  ana: AuthUser;
  beto: AuthUser;
  carla: AuthUser;
  // Operaciones que alimentan cada reparto (una por período).
  operations: { paid: string; confirmed: string; draft: string };
  paid: LegacyTipPool;
  confirmed: LegacyTipPool;
  draft: LegacyTipPool;
}

async function createUser(
  tx: Tx,
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
      lastName: 'Historico',
      roleId,
      storeId,
    },
  });
  return { id, email, role, storeId };
}

// Tres repartos antiguos del mismo local, uno por estado, cada uno alimentado
// por una operación diaria en efectivo de su período: PAID (9.000 entre Ana,
// Beto y Carla), CONFIRMED (6.000 entre Beto y Carla) y DRAFT (3.001 entre Ana
// y Beto). Las propinas diarias de las tres operaciones quedan No pagadas.
async function createFixture(tx: Tx): Promise<Fixture> {
  await ensureDefaultPaymentMethods(tx);
  const store = await tx.store.create({
    data: {
      name: `Subway Historico Repartos ${randomUUID()}`,
      city: 'Melipilla',
      address: 'Calle 123',
    },
  });
  const accountant = await createUser(tx, ROLE.CONTADOR, null, 'Carmen');
  const supervisor = await createUser(tx, ROLE.SUPERVISOR, store.id, 'Sofia');
  const ana = await createUser(tx, ROLE.TRABAJADOR, store.id, 'Ana');
  const beto = await createUser(tx, ROLE.TRABAJADOR, store.id, 'Beto');
  const carla = await createUser(tx, ROLE.TRABAJADOR, store.id, 'Carla');
  const specs = {
    paid: {
      period: PAID_PERIOD,
      fund: 9000,
      people: [ana.id, beto.id, carla.id],
    },
    confirmed: {
      period: CONFIRMED_PERIOD,
      fund: 6000,
      people: [beto.id, carla.id],
    },
    draft: { period: DRAFT_PERIOD, fund: 3001, people: [ana.id, beto.id] },
  } as const;
  const operations = { paid: '', confirmed: '', draft: '' };
  const pools: Partial<Record<keyof typeof specs, LegacyTipPool>> = {};
  for (const key of ['paid', 'confirmed', 'draft'] as const) {
    const spec = specs[key];
    operations[key] = await createDailyOperation(tx, {
      storeId: store.id,
      responsibleId: supervisor.id,
      businessDate: spec.period.start,
      cashTipAmount: spec.fund,
      participantIds: spec.people,
    });
    pools[key] = await createLegacyTipPool(tx, {
      storeId: store.id,
      periodStart: spec.period.start,
      periodEnd: spec.period.end,
      accountantId: accountant.id,
      status:
        key === 'paid' ? 'PAID' : key === 'confirmed' ? 'CONFIRMED' : 'DRAFT',
      paymentDate: '2026-09-08',
      days: [
        {
          operationId: operations[key],
          businessDate: spec.period.start,
          fundAmount: spec.fund,
          participantIds: spec.people,
        },
      ],
    });
  }
  const { paid, confirmed, draft } = pools;
  if (!paid || !confirmed || !draft) throw new Error('Faltan repartos');
  return {
    tx,
    storeId: store.id,
    admin: await createUser(tx, ROLE.ADMINISTRADOR, null, 'Admin'),
    accountant,
    supervisor,
    ana,
    beto,
    carla,
    operations,
    paid,
    confirmed,
    draft,
  };
}

// Foto de todo lo que una acción sobre repartos podría cambiar.
async function poolsSnapshot(f: Fixture): Promise<string> {
  const pools = await f.tx.tipPool.findMany({
    where: { storeId: f.storeId },
    include: {
      lines: true,
      dailyOperationSources: true,
      receipts: true,
    },
    orderBy: { periodStart: 'asc' },
  });
  const allocations = await f.tx.dailyTipAllocation.findMany({
    where: { storeId: f.storeId },
    orderBy: [{ operationId: 'asc' }, { workerId: 'asc' }],
  });
  return JSON.stringify({ pools, allocations }, (_key, value: unknown) =>
    typeof value === 'bigint' ? value.toString() : value,
  );
}

describe.skipIf(!databaseUrl)(
  'Repartos por período como histórico de solo lectura (SPRINT-4A-T08)',
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

    function post(path: string, user: AuthUser | null, body: object = {}) {
      const req = request(app.getHttpServer()).post(path);
      if (user) req.set('Authorization', `Bearer ${token(user)}`);
      return req.send(body);
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

    it('lista los repartos del más reciente al más antiguo y filtra por local y período exacto', async () => {
      await withinRollback(async (f) => {
        for (const user of [f.accountant, f.admin]) {
          const byStore = (
            await get(`/tip-pools?storeId=${f.storeId}`, user).expect(200)
          ).body as TipPoolResponse[];
          expect(byStore.map((pool) => [pool.id, pool.status])).toEqual([
            [f.draft.id, 'DRAFT'],
            [f.confirmed.id, 'CONFIRMED'],
            [f.paid.id, 'PAID'],
          ]);
          expect(byStore[2]).toMatchObject({
            rule: 'EQUAL_SHARES',
            totalAmount: 9000,
            totalHours: null,
            reconciled: true,
            paymentDate: '2026-09-08',
            receiptsCount: 3,
          });

          const exact = (
            await get(
              `/tip-pools?storeId=${f.storeId}&periodStart=${CONFIRMED_PERIOD.start}&periodEnd=${CONFIRMED_PERIOD.end}`,
              user,
            ).expect(200)
          ).body as TipPoolResponse[];
          expect(exact.map((pool) => pool.id)).toEqual([f.confirmed.id]);

          // Sin filtros aparecen todos los locales, en el mismo orden.
          const all = (await get('/tip-pools', user).expect(200))
            .body as TipPoolResponse[];
          const ownIds = all
            .map((pool) => pool.id)
            .filter((id) =>
              [f.draft.id, f.confirmed.id, f.paid.id].includes(id),
            );
          expect(ownIds).toEqual([f.draft.id, f.confirmed.id, f.paid.id]);
        }
      });
    });

    it('valida los filtros con 400', async () => {
      await withinRollback(async (f) => {
        for (const query of [
          `storeId=${f.storeId}&periodStart=${PAID_PERIOD.start}`,
          `periodEnd=${PAID_PERIOD.end}`,
          `periodStart=${PAID_PERIOD.end}&periodEnd=${PAID_PERIOD.start}`,
          'periodStart=2026-02-30&periodEnd=2026-03-01',
          'storeId=no-es-uuid',
          'status=PAID',
        ]) {
          await get(`/tip-pools?${query}`, f.accountant).expect(400);
        }
        await get('/tip-pools/no-es-uuid', f.accountant).expect(400);
      });
    });

    it('la consulta por ID devuelve la foto guardada sin cambiarla', async () => {
      await withinRollback(async (f) => {
        const before = await poolsSnapshot(f);
        const pool = (
          await get(`/tip-pools/${f.draft.id}`, f.admin).expect(200)
        ).body as TipPoolResponse;
        expect(pool).toMatchObject({
          id: f.draft.id,
          status: 'DRAFT',
          totalAmount: 3001,
          confirmedBy: null,
          paidBy: null,
          receiptsCount: 0,
        });
        expect(
          Object.fromEntries(
            pool.lines.map((line) => [line.userId, line.amount]),
          ),
        ).toEqual(
          Object.fromEntries(
            f.draft.lines.map((line) => [line.userId, line.amount]),
          ),
        );
        expect(await poolsSnapshot(f)).toBe(before);
        await get(`/tip-pools/${randomUUID()}`, f.accountant).expect(404);
      });
    });

    it('sin acceso al local el servicio responde como si no existiera', async () => {
      await withinRollback(async (f) => {
        const service = app.get(TipPoolsService);
        const foreign: AuthUser = {
          ...f.supervisor,
          storeId: randomUUID(),
        };
        await expect(
          service.findOne(f.paid.id, foreign),
        ).rejects.toBeInstanceOf(NotFoundException);
        await expect(
          service.listReceipts(f.paid.id, foreign),
        ).rejects.toBeInstanceOf(NotFoundException);
        expect(
          (await service.findAll({}, foreign)).some(
            (pool) => pool.store.id === f.storeId,
          ),
        ).toBe(false);
      });
    });

    it('las constancias de un reparto PAID siguen listándose y descargándose, con auditoría', async () => {
      await withinRollback(async (f) => {
        for (const user of [f.accountant, f.admin]) {
          const receipts = (
            await get(`/tip-pools/${f.paid.id}/receipts`, user).expect(200)
          ).body as TipPoolReceiptResponse[];
          expect(
            Object.fromEntries(
              receipts.map((receipt) => [receipt.userId, receipt.amount]),
            ),
          ).toEqual(
            Object.fromEntries(
              f.paid.lines.map((line) => [line.userId, line.amount]),
            ),
          );

          const file = await get(
            `/tip-pools/${f.paid.id}/receipts/${f.ana.id}/download`,
            user,
          )
            .responseType('blob')
            .expect(200);
          const body = file.body as Buffer;
          expect(body.subarray(0, 5).toString('latin1')).toBe('%PDF-');
          expect(file.headers['content-type']).toBe('application/pdf');
          expect(file.headers['cache-control']).toBe('private, no-store');
          expect(file.headers['x-content-type-options']).toBe('nosniff');
          expect(file.headers['content-disposition']).toMatch(
            /^attachment; filename="constancia-propinas_2026-09-01_2026-09-07_[0-9a-f]{8}\.pdf"/,
          );
          expect(file.headers['content-disposition']).not.toContain('Ana');
        }
        const anaReceipt = await f.tx.tipPoolReceipt.findUniqueOrThrow({
          where: { poolId_userId: { poolId: f.paid.id, userId: f.ana.id } },
          select: { id: true },
        });
        const audits = await f.tx.auditLog.findMany({
          where: {
            action: AUDIT_ACTION.TIP_POOL_RECEIPT_DOWNLOADED,
            entityId: anaReceipt.id,
          },
          select: { entityType: true, storeId: true, userId: true },
        });
        expect(audits).toHaveLength(2);
        expect(audits.map((audit) => audit.userId).sort()).toEqual(
          [f.accountant.id, f.admin.id].sort(),
        );
        expect(audits[0]).toMatchObject({
          entityType: 'tip_pool_receipts',
          storeId: f.storeId,
        });

        // DRAFT y CONFIRMED nunca se pagaron: no tienen constancias.
        for (const poolId of [f.draft.id, f.confirmed.id]) {
          await get(`/tip-pools/${poolId}/receipts`, f.accountant).expect(409);
          await get(
            `/tip-pools/${poolId}/receipts/${f.beto.id}/download`,
            f.accountant,
          ).expect(409);
        }
        await get(
          `/tip-pools/${f.paid.id}/receipts/${f.supervisor.id}/download`,
          f.accountant,
        ).expect(404);
      });
    });

    it('solo contador y administrador consultan; supervisor y trabajador reciben 403 y sin JWT 401', async () => {
      await withinRollback(async (f) => {
        const paths = [
          '/tip-pools',
          `/tip-pools/${f.paid.id}`,
          `/tip-pools/${f.paid.id}/receipts`,
          `/tip-pools/${f.paid.id}/receipts/${f.ana.id}/download`,
        ];
        for (const path of paths) {
          for (const user of [f.supervisor, f.ana]) {
            await get(path, user).expect(403);
          }
          await get(path, null).expect(401);
        }
      });
    });

    it('calcular, observar, confirmar y pagar responden 410 a cualquier rol y no cambian nada', async () => {
      await withinRollback(async (f) => {
        const before = await poolsSnapshot(f);
        const poolCount = await f.tx.tipPool.count();
        const attempts: { path: string; body: object }[] = [
          {
            path: '/tip-pools/preview',
            body: {
              storeId: f.storeId,
              periodStart: '2026-09-01',
              periodEnd: '2026-09-30',
            },
          },
          { path: '/tip-pools/preview', body: {} },
          {
            path: `/tip-pools/${f.draft.id}/observations`,
            body: { expectedVersion: 1, notes: 'Revisar' },
          },
          {
            path: `/tip-pools/${f.draft.id}/confirm`,
            body: { expectedVersion: 1 },
          },
          {
            path: `/tip-pools/${f.confirmed.id}/pay`,
            body: { expectedVersion: 2, paymentDate: '2026-09-20' },
          },
          { path: '/tip-pools/no-es-uuid/pay', body: { campo: 'extra' } },
        ];
        for (const { path, body } of attempts) {
          for (const user of [f.accountant, f.admin, f.supervisor, f.ana]) {
            const response = await post(path, user, body).expect(410);
            expect(response.body).toEqual(RETIRED_BODY);
          }
          await post(path, null, body).expect(401);
        }
        expect(await poolsSnapshot(f)).toBe(before);
        expect(await f.tx.tipPool.count()).toBe(poolCount);
        expect(
          await f.tx.auditLog.count({
            where: {
              action: {
                in: [
                  AUDIT_ACTION.TIP_POOL_CALCULATED,
                  AUDIT_ACTION.TIP_POOL_RECALCULATED,
                  AUDIT_ACTION.TIP_POOL_OBSERVED,
                  AUDIT_ACTION.TIP_POOL_CONFIRMED,
                  AUDIT_ACTION.TIP_POOL_PAID,
                ],
              },
              user: { email: { endsWith: EMAIL_DOMAIN } },
            },
          }),
        ).toBe(0);
      });
    });

    it('un borrador o un confirmado antiguo no bloquean el flujo diario y el pago va solo por lote', async () => {
      await withinRollback(async (f) => {
        const draftPool = await f.tx.tipPool.findUniqueOrThrow({
          where: { id: f.draft.id },
        });

        // La operación de un borrador antiguo se corrige y su reparto diario
        // se recalcula; la foto del borrador queda como histórico sin efecto.
        await request(app.getHttpServer())
          .patch(`/daily-operations/${f.operations.draft}`)
          .set('Authorization', `Bearer ${token(f.supervisor)}`)
          .field('cashTipAmount', '4001')
          .expect(200);
        const allocations = await f.tx.dailyTipAllocation.findMany({
          where: { operationId: f.operations.draft },
          select: { amount: true, status: true },
        });
        expect(
          allocations.reduce((sum, row) => sum + Number(row.amount), 0),
        ).toBe(4001);
        expect(
          await f.tx.tipPool.findUniqueOrThrow({ where: { id: f.draft.id } }),
        ).toEqual(draftPool);

        // El pago por lote cubre las propinas de los días de los repartos
        // DRAFT y CONFIRMED antiguos; el pago del reparto sigue en 410.
        const batch = (
          await post('/daily-tips/payment-batches', f.accountant, {
            storeId: f.storeId,
            from: CONFIRMED_PERIOD.start,
            to: DRAFT_PERIOD.end,
          }).expect(201)
        ).body as TipPaymentBatchResponse;
        expect(batch).toMatchObject({ totalAmount: 6000 + 4001 });
        expect(
          await f.tx.dailyTipAllocation.count({
            where: {
              operationId: {
                in: [f.operations.confirmed, f.operations.draft],
              },
              status: 'UNPAID',
            },
          }),
        ).toBe(0);
        await post(`/tip-pools/${f.confirmed.id}/pay`, f.accountant, {
          expectedVersion: 2,
        }).expect(410);
        expect(
          await f.tx.tipPool.findUniqueOrThrow({
            where: { id: f.confirmed.id },
            select: { status: true, _count: { select: { receipts: true } } },
          }),
        ).toEqual({ status: 'CONFIRMED', _count: { receipts: 0 } });
      });
    });

    it('la transacción revertida no deja datos en la base', async () => {
      expect(
        await prisma.store.count({
          where: { name: { startsWith: 'Subway Historico Repartos' } },
        }),
      ).toBe(0);
      expect(
        await prisma.user.count({
          where: { email: { endsWith: EMAIL_DOMAIN } },
        }),
      ).toBe(0);
    });
  },
);
