import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
  ValidationPipe,
  type INestApplication,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import request from 'supertest';
import {
  seedDatabase,
  TIP_DEMO_IDS,
  TIP_DEMO_POOL,
  TIP_DEMO_STORE,
} from '../prisma/seed.js';
import { AppModule } from '../src/app.module.js';
import { AUDIT_ACTION } from '../src/audit/constants/audit-actions.constants.js';
import { ROLE, type RoleCode } from '../src/auth/constants/roles.constants.js';
import type { AuthUser, JwtPayload } from '../src/auth/types/auth.types.js';
import {
  businessDateOf,
  formatDbDate,
  toDbDate,
} from '../src/documents/utils/document-dates.util.js';
import {
  PaymentMethod,
  Prisma,
  PrismaClient,
} from '../src/generated/prisma/client.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { renderTipReceiptPdf } from '../src/tips/receipts/tip-receipt-pdf.js';
import { StoresService } from '../src/stores/stores.service.js';
import {
  TipPoolsService,
  VERSION_CONFLICT_MESSAGE,
} from '../src/tips/tip-pools.service.js';
import type {
  TipPoolConflictBody,
  TipPoolReceiptResponse,
  TipPoolResponse,
} from '../src/tips/types/tip-pools.types.js';
import { purgeTestAuditLogs } from './helpers/audit-cleanup.js';

type App = Parameters<typeof request>[0];

// Tests de integración de la confirmación, las observaciones y el pago del
// reparto de propinas (SPRINT-3-T13) contra PostgreSQL real. Se omiten si no
// se define TEST_DATABASE_URL.
//
// - Estados, constancias e inmutabilidad se prueban dentro de withinRollback:
//   TipPoolsService recibe la transacción del test en lugar de PrismaService.
//   Un intento rechazado por la base de datos aborta esa transacción, así que
//   cada uno va al final de su propio withinRollback.
// - Roles, auditoría, validación y concurrencia necesitan el pipeline HTTP
//   completo y dos conexiones reales: esos tests usan un local propio
//   ("Subway Tip Pools Actions Test") y correos
//   @tip-pools-actions-test.invalid, y se eliminan al finalizar.
const databaseUrl = process.env.TEST_DATABASE_URL;

class Rollback extends Error {
  constructor() {
    super('rollback de prueba');
    this.name = 'Rollback';
  }
}

const PERIOD = { start: '2026-10-01', end: '2026-10-15' } as const;

const CONFIRMED_IMMUTABLE = /No se pueden cambiar los montos/;
const NOT_DRAFT = /ya no está en DRAFT/;
const PAID_IMMUTABLE = /El reparto pagado .* es inmutable/;
const RECEIPTS_IMMUTABLE = /Las constancias de pago son inmutables/;

function day(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

// Día de hoy en hora de Chile: la fecha de pago por defecto.
function todayInChile(): string {
  return formatDbDate(toDbDate(businessDateOf(new Date())));
}

// Pausa breve entre acciones: así cada una deja un instante distinto aunque
// el reloj tenga resolución de milisegundos.
function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 5));
}

function sumAmounts(items: { amount: number }[]): number {
  return items.reduce((sum, item) => sum + item.amount, 0);
}

// PrismaService que ejecuta todo en la transacción del test: su $transaction
// reutiliza la misma transacción en vez de abrir otra.
function transactionAsPrismaService(
  tx: Prisma.TransactionClient,
): PrismaService {
  const proxy = new Proxy(tx, {
    get(target, property): unknown {
      if (property === '$transaction') {
        return <T>(
          callback: (client: Prisma.TransactionClient) => Promise<T>,
        ): Promise<T> => callback(tx);
      }
      return Reflect.get(target, property) as unknown;
    },
  });
  return proxy as unknown as PrismaService;
}

interface Fixture {
  tx: Prisma.TransactionClient;
  service: TipPoolsService;
  storeId: string;
  accountant: AuthUser;
  supervisor: AuthUser;
  workers: string[];
}

async function roleId(
  tx: Prisma.TransactionClient,
  code: RoleCode,
): Promise<string> {
  const role = await tx.role.upsert({
    where: { code },
    update: {},
    create: { code, name: code },
  });
  return role.id;
}

async function createStore(tx: Prisma.TransactionClient): Promise<string> {
  const store = await tx.store.create({
    data: {
      name: `Subway Pago Reparto ${randomUUID()}`,
      city: 'Melipilla',
      address: 'Calle 123',
    },
  });
  return store.id;
}

async function createUser(
  tx: Prisma.TransactionClient,
  role: RoleCode,
  storeId: string | null,
  firstName: string = role,
): Promise<AuthUser> {
  const email = `${randomUUID()}@tip-pools-actions-test.invalid`;
  const user = await tx.user.create({
    data: {
      email,
      passwordHash: '$2b$04$hash-de-prueba',
      firstName,
      lastName: 'Pago',
      roleId: await roleId(tx, role),
      storeId,
    },
  });
  return { id: user.id, email, role, storeId };
}

async function createFixture(tx: Prisma.TransactionClient): Promise<Fixture> {
  const prisma = transactionAsPrismaService(tx);
  const storeId = await createStore(tx);
  const accountant = await createUser(tx, ROLE.CONTADOR, null, 'Lucas');
  const supervisor = await createUser(tx, ROLE.SUPERVISOR, storeId);
  const workers: string[] = [];
  for (const name of ['Ana', 'Beto', 'Carla']) {
    workers.push((await createUser(tx, ROLE.TRABAJADOR, storeId, name)).id);
  }
  return {
    tx,
    service: new TipPoolsService(prisma, new StoresService(prisma)),
    storeId,
    accountant,
    supervisor,
    workers,
  };
}

// Pacto vigente, dos registros del período (12.000) y 10/20/30 horas: el
// reparto esperado es 2.000/4.000/6.000. Con zeroHoursForLast el tercer
// trabajador queda con 0 horas y monto 0.
async function seedPeriod(f: Fixture, zeroHoursForLast = false): Promise<void> {
  await f.tx.tipAgreement.create({
    data: {
      name: 'Pacto pago test',
      rule: 'PROPORTIONAL_TO_HOURS',
      validFrom: day('2026-01-01'),
      storeId: f.storeId,
      createdById: f.supervisor.id,
    },
  });
  const entries: [string, PaymentMethod, number][] = [
    ['2026-10-02', 'CASH', 8000],
    ['2026-10-15', 'DEBIT_CARD', 4000],
  ];
  for (const [businessDate, paymentMethod, amount] of entries) {
    await f.tx.tipEntry.create({
      data: {
        businessDate: day(businessDate),
        paymentMethod,
        amount,
        storeId: f.storeId,
        responsibleId: f.supervisor.id,
      },
    });
  }
  const hours = zeroHoursForLast ? [10, 20, 0] : [10, 20, 30];
  for (const [index, workerId] of f.workers.entries()) {
    await f.tx.workHoursRecord.create({
      data: {
        periodStart: day(PERIOD.start),
        periodEnd: day(PERIOD.end),
        hoursWorked: hours[index],
        storeId: f.storeId,
        workerId,
        recordedById: f.supervisor.id,
      },
    });
  }
}

async function draft(f: Fixture, zeroHoursForLast = false) {
  await seedPeriod(f, zeroHoursForLast);
  const result = await f.service.preview(
    { storeId: f.storeId, periodStart: PERIOD.start, periodEnd: PERIOD.end },
    f.accountant,
  );
  return result.pool;
}

async function confirmed(f: Fixture): Promise<TipPoolResponse> {
  const pool = await draft(f);
  return f.service.confirm(
    pool.id,
    { expectedVersion: pool.version },
    f.accountant,
  );
}

async function paid(
  f: Fixture,
  paymentDate = '2026-10-20',
): Promise<TipPoolResponse> {
  const pool = await confirmed(f);
  return f.service.pay(
    pool.id,
    { expectedVersion: pool.version, paymentDate },
    f.accountant,
  );
}

// Cuerpo de un 409 de las acciones.
async function conflictOf(
  promise: Promise<unknown>,
): Promise<TipPoolConflictBody> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ConflictException);
    return (error as ConflictException).getResponse() as TipPoolConflictBody;
  }
  throw new Error('Se esperaba una respuesta 409');
}

describe.skipIf(!databaseUrl)(
  'Confirmación y pago del reparto de propinas (SPRINT-3-T13)',
  () => {
    let prisma: PrismaClient;

    beforeAll(() => {
      prisma = new PrismaClient({
        adapter: new PrismaPg({ connectionString: databaseUrl }),
      });
    });

    afterAll(async () => {
      await prisma.$disconnect();
    });

    async function withinRollback(
      fn: (f: Fixture) => Promise<void>,
    ): Promise<void> {
      try {
        await prisma.$transaction(
          async (tx) => {
            await fn(await createFixture(tx));
            throw new Rollback();
          },
          { timeout: 30_000 },
        );
      } catch (error) {
        if (!(error instanceof Rollback)) throw error;
      }
    }

    describe('estados', () => {
      it('vista previa → observación → recálculo → confirmar → pagar', async () => {
        await withinRollback(async (f) => {
          const first = await draft(f);
          expect(first).toMatchObject({
            status: 'DRAFT',
            version: 1,
            notes: null,
            confirmedBy: null,
            paidBy: null,
            paymentDate: null,
            receiptsCount: 0,
          });

          const observed = await f.service.observe(
            first.id,
            { expectedVersion: 1, notes: 'Faltan horas de la semana 2' },
            f.accountant,
          );
          expect(observed).toMatchObject({
            status: 'DRAFT',
            version: 2,
            notes: 'Faltan horas de la semana 2',
          });

          // El recálculo atiende la observación: la limpia y sube la versión.
          const recalculated = (
            await f.service.preview(
              {
                storeId: f.storeId,
                periodStart: PERIOD.start,
                periodEnd: PERIOD.end,
              },
              f.accountant,
            )
          ).pool;
          expect(recalculated).toMatchObject({
            id: first.id,
            status: 'DRAFT',
            version: 3,
            notes: null,
          });

          const confirmedPool = await f.service.confirm(
            first.id,
            { expectedVersion: 3 },
            f.accountant,
          );
          expect(confirmedPool).toMatchObject({
            status: 'CONFIRMED',
            version: 4,
            confirmedBy: { id: f.accountant.id, name: 'Lucas Pago' },
            paidBy: null,
            receiptsCount: 0,
          });
          expect(confirmedPool.confirmedAt).toBeInstanceOf(Date);

          const paidPool = await f.service.pay(
            first.id,
            { expectedVersion: 4, paymentDate: '2026-10-20' },
            f.accountant,
          );
          expect(paidPool).toMatchObject({
            status: 'PAID',
            version: 5,
            totalAmount: 12000,
            confirmedBy: { id: f.accountant.id },
            paidBy: { id: f.accountant.id, name: 'Lucas Pago' },
            paymentDate: '2026-10-20',
            receiptsCount: 3,
          });
          expect(paidPool.paidAt).toBeInstanceOf(Date);
          // El pago conserva la foto del reparto.
          expect(paidPool.lines).toEqual(confirmedPool.lines);
          expect(paidPool.sources).toEqual(confirmedPool.sources);
        });
      });

      it('calculatedAt solo cambia al recalcular; updatedAt con cada acción', async () => {
        await withinRollback(async (f) => {
          const first = await draft(f);
          expect(first.calculatedAt).toBeInstanceOf(Date);
          expect(first.updatedAt).toBeInstanceOf(Date);

          // Recalcular un DRAFT avanza calculatedAt.
          await tick();
          const recalculated = (
            await f.service.preview(
              {
                storeId: f.storeId,
                periodStart: PERIOD.start,
                periodEnd: PERIOD.end,
              },
              f.accountant,
            )
          ).pool;
          expect(recalculated.calculatedAt.getTime()).toBeGreaterThan(
            first.calculatedAt.getTime(),
          );
          const calculatedAt = recalculated.calculatedAt;

          // Observar, confirmar y pagar cambian updatedAt, no calculatedAt.
          await tick();
          const observed = await f.service.observe(
            recalculated.id,
            { expectedVersion: recalculated.version, notes: 'Revisar' },
            f.accountant,
          );
          await tick();
          const confirmedPool = await f.service.confirm(
            observed.id,
            { expectedVersion: observed.version },
            f.accountant,
          );
          await tick();
          const paidPool = await f.service.pay(
            confirmedPool.id,
            {
              expectedVersion: confirmedPool.version,
              paymentDate: '2026-10-20',
            },
            f.accountant,
          );
          let lastUpdate = recalculated.updatedAt.getTime();
          for (const pool of [observed, confirmedPool, paidPool]) {
            expect(pool.calculatedAt).toEqual(calculatedAt);
            expect(pool.updatedAt.getTime()).toBeGreaterThan(lastUpdate);
            lastUpdate = pool.updatedAt.getTime();
          }
          const stored = await f.service.findOne(paidPool.id, f.accountant);
          expect(stored.calculatedAt).toEqual(calculatedAt);
          expect(stored.updatedAt).toEqual(paidPool.updatedAt);
        });
      });

      it.each(['CONFIRMED', 'PAID'] as const)(
        'confirmar un reparto %s responde 409 con el estado actual',
        async (status) => {
          await withinRollback(async (f) => {
            const pool = status === 'PAID' ? await paid(f) : await confirmed(f);
            const body = await conflictOf(
              f.service.confirm(
                pool.id,
                { expectedVersion: pool.version },
                f.accountant,
              ),
            );
            expect(body).toEqual({
              statusCode: 409,
              message: `Solo se puede confirmar un reparto en borrador; el reparto está ${status === 'PAID' ? 'pagado' : 'confirmado'}`,
              currentStatus: status,
              currentVersion: pool.version,
            });
          });
        },
      );

      it('pagar un DRAFT responde 409: solo se paga lo confirmado (criterio 1)', async () => {
        await withinRollback(async (f) => {
          const pool = await draft(f);
          const body = await conflictOf(
            f.service.pay(pool.id, { expectedVersion: 1 }, f.accountant),
          );
          expect(body.message).toBe(
            'Solo se puede marcar como pagado un reparto confirmado; el reparto está en borrador',
          );
          expect(body.currentStatus).toBe('DRAFT');
          const stored = await f.service.findOne(pool.id, f.accountant);
          expect(stored).toMatchObject({ status: 'DRAFT', receiptsCount: 0 });
        });
      });

      it('pagar dos veces responde 409 y no emite más constancias', async () => {
        await withinRollback(async (f) => {
          const pool = await paid(f);
          await conflictOf(
            f.service.pay(
              pool.id,
              { expectedVersion: pool.version },
              f.accountant,
            ),
          );
          expect(
            await f.tx.tipPoolReceipt.count({ where: { poolId: pool.id } }),
          ).toBe(3);
        });
      });

      it('observar un CONFIRMED responde 409', async () => {
        await withinRollback(async (f) => {
          const pool = await confirmed(f);
          const body = await conflictOf(
            f.service.observe(
              pool.id,
              { expectedVersion: pool.version, notes: 'Tarde' },
              f.accountant,
            ),
          );
          expect(body.currentStatus).toBe('CONFIRMED');
          expect(
            (await f.service.findOne(pool.id, f.accountant)).notes,
          ).toBeNull();
        });
      });

      it('recalcular (T12) un CONFIRMED sigue respondiendo 409', async () => {
        await withinRollback(async (f) => {
          await confirmed(f);
          await expect(
            f.service.preview(
              {
                storeId: f.storeId,
                periodStart: PERIOD.start,
                periodEnd: PERIOD.end,
              },
              f.accountant,
            ),
          ).rejects.toBeInstanceOf(ConflictException);
        });
      });

      it('confirmar un reparto no conciliado responde 422 y no confirma', async () => {
        await withinRollback(async (f) => {
          const pool = await draft(f);
          // Un DRAFT sí se puede modificar: se simula un total descuadrado.
          await f.tx.tipPool.update({
            where: { id: pool.id },
            data: { totalAmount: 12001 },
          });
          await expect(
            f.service.confirm(pool.id, { expectedVersion: 1 }, f.accountant),
          ).rejects.toBeInstanceOf(UnprocessableEntityException);
          const stored = await f.service.findOne(pool.id, f.accountant);
          expect(stored).toMatchObject({
            status: 'DRAFT',
            version: 1,
            reconciled: false,
          });
        });
      });
    });

    describe('concurrencia (versión)', () => {
      it('expectedVersion desactualizado responde 409 con currentVersion', async () => {
        await withinRollback(async (f) => {
          const pool = await draft(f);
          await f.service.observe(
            pool.id,
            { expectedVersion: 1, notes: 'Revisar' },
            f.accountant,
          );
          const body = await conflictOf(
            f.service.confirm(pool.id, { expectedVersion: 1 }, f.accountant),
          );
          expect(body).toEqual({
            statusCode: 409,
            message: VERSION_CONFLICT_MESSAGE,
            currentStatus: 'DRAFT',
            currentVersion: 2,
          });
          expect((await f.service.findOne(pool.id, f.accountant)).status).toBe(
            'DRAFT',
          );
        });
      });

      it('con estado y versión incorrectos informa primero el estado', async () => {
        await withinRollback(async (f) => {
          const pool = await draft(f);
          const body = await conflictOf(
            f.service.pay(pool.id, { expectedVersion: 99 }, f.accountant),
          );
          expect(body.message).toMatch(
            /^Solo se puede marcar como pagado un reparto confirmado/,
          );
          expect(body.currentVersion).toBe(1);
        });
      });
    });

    describe('fecha de pago', () => {
      it('sin paymentDate usa el día de hoy en hora de Chile', async () => {
        await withinRollback(async (f) => {
          const pool = await confirmed(f);
          const paidPool = await f.service.pay(
            pool.id,
            { expectedVersion: pool.version },
            f.accountant,
          );
          expect(paidPool.paymentDate).toBe(todayInChile());
        });
      });

      it.each([
        ['futura', '2099-01-01'],
        ['anterior al término del período', '2026-10-14'],
      ])('rechaza una fecha %s con 400 y no paga', async (_label, date) => {
        await withinRollback(async (f) => {
          const pool = await confirmed(f);
          await expect(
            f.service.pay(
              pool.id,
              { expectedVersion: pool.version, paymentDate: date },
              f.accountant,
            ),
          ).rejects.toBeInstanceOf(BadRequestException);
          expect(await f.service.findOne(pool.id, f.accountant)).toMatchObject({
            status: 'CONFIRMED',
            version: pool.version,
            receiptsCount: 0,
          });
        });
      });

      it('acepta pagar el mismo último día del período', async () => {
        await withinRollback(async (f) => {
          const pool = await paid(f, PERIOD.end);
          expect(pool.paymentDate).toBe(PERIOD.end);
        });
      });
    });

    describe('constancias', () => {
      it('emite una por trabajador con fecha, monto, local, período, responsable y la foto', async () => {
        await withinRollback(async (f) => {
          const pool = await paid(f);
          const receipts = await f.service.listReceipts(pool.id, f.accountant);
          const store = await f.tx.store.findUniqueOrThrow({
            where: { id: f.storeId },
          });

          expect(receipts).toHaveLength(3);
          expect(receipts.map((receipt) => receipt.userId)).toEqual(
            pool.lines.map((line) => line.userId),
          );
          for (const receipt of receipts) {
            const line = pool.lines.find(
              (item) => item.userId === receipt.userId,
            );
            expect(receipt).toMatchObject({
              poolId: pool.id,
              workerName: line?.workerName,
              store: { id: f.storeId, name: store.name },
              periodStart: PERIOD.start,
              periodEnd: PERIOD.end,
              hoursWorked: line?.hoursWorked,
              amount: line?.amount,
              paymentDate: '2026-10-20',
              paidBy: { id: f.accountant.id, name: 'Lucas Pago' },
            });
            // El detalle es la foto completa del reparto al pagar.
            expect(receipt.detail).toEqual({
              agreementSnapshot: pool.agreement,
              totalAmount: pool.totalAmount,
              totalHours: pool.totalHours,
              lines: pool.lines,
            });
          }
          expect(sumAmounts(receipts)).toBe(pool.totalAmount);
        });
      });

      it('la foto de la constancia no cambia si después cambian nombres o local', async () => {
        await withinRollback(async (f) => {
          const pool = await paid(f);
          const [before] = await f.service.listReceipts(pool.id, f.accountant);
          await f.tx.user.update({
            where: { id: before.userId },
            data: { firstName: 'Renombrado' },
          });
          await f.tx.store.update({
            where: { id: f.storeId },
            data: { name: `Local renombrado ${randomUUID()}` },
          });
          const [after] = await f.service.listReceipts(pool.id, f.accountant);
          expect(after).toEqual(before);
        });
      });

      it('una línea con monto 0 también tiene constancia', async () => {
        await withinRollback(async (f) => {
          const pool = await draft(f, true);
          const zeroLine = pool.lines.find((line) => line.amount === 0);
          expect(zeroLine).toBeDefined();
          const ready = await f.service.confirm(
            pool.id,
            { expectedVersion: pool.version },
            f.accountant,
          );
          const paidPool = await f.service.pay(
            pool.id,
            { expectedVersion: ready.version, paymentDate: '2026-10-20' },
            f.accountant,
          );
          expect(paidPool.receiptsCount).toBe(3);
          const receipts = await f.service.listReceipts(pool.id, f.accountant);
          expect(
            receipts.find((receipt) => receipt.userId === zeroLine?.userId),
          ).toMatchObject({ amount: 0, hoursWorked: '0.00' });
        });
      });

      it('con el seed demo emite dos constancias de 10.000 y 15.000', async () => {
        await withinRollback(async (f) => {
          await seedDatabase(f.tx, {
            adminEmail: 'admin-tip-pay@moi-food.invalid',
            adminPassword: 'clave-de-prueba-pago',
            adminFirstName: 'Admin',
            adminLastName: 'Pago',
            includeDemoData: true,
          });
          const demo = await f.service.findOne(TIP_DEMO_POOL.id, f.accountant);
          // Si el seed ya existía en la base, el reparto demo puede haberse
          // recalculado o confirmado antes: se exige solo que esté sin pagar.
          expect(demo.status).not.toBe('PAID');
          const ready =
            demo.status === 'DRAFT'
              ? await f.service.confirm(
                  demo.id,
                  { expectedVersion: demo.version },
                  f.accountant,
                )
              : demo;
          const paidPool = await f.service.pay(
            demo.id,
            { expectedVersion: ready.version, paymentDate: '2026-01-12' },
            f.accountant,
          );
          expect(paidPool).toMatchObject({
            status: 'PAID',
            totalAmount: 25000,
            receiptsCount: 2,
          });

          const receipts = await f.service.listReceipts(demo.id, f.accountant);
          expect(
            Object.fromEntries(
              receipts.map((receipt) => [receipt.userId, receipt.amount]),
            ),
          ).toEqual({
            [TIP_DEMO_IDS.workerOne]: 10000,
            [TIP_DEMO_IDS.workerTwo]: 15000,
          });
          expect(
            receipts.every(
              (receipt) =>
                receipt.store.id === TIP_DEMO_STORE.id &&
                receipt.store.name === TIP_DEMO_STORE.name,
            ),
          ).toBe(true);

          // Repetir el seed con el reparto demo pagado no falla ni lo cambia.
          await seedDatabase(f.tx, {
            adminEmail: 'admin-tip-pay@moi-food.invalid',
            adminPassword: 'clave-de-prueba-pago',
            adminFirstName: 'Admin',
            adminLastName: 'Pago',
            includeDemoData: true,
          });
          expect(await f.service.findOne(demo.id, f.accountant)).toEqual(
            paidPool,
          );
        });
        // El seed hashea contraseñas (bcrypt) y sus filas de UUID fijo pueden
        // estar bloqueadas por otros tests del seed que corren en paralelo.
      }, 30_000);

      it('el PDF sale de la foto guardada, sin datos personales en el nombre', async () => {
        await withinRollback(async (f) => {
          const pool = await paid(f);
          const [receipt] = await f.service.listReceipts(pool.id, f.accountant);
          const file = await f.service.downloadReceipt(
            pool.id,
            receipt.userId,
            f.accountant,
          );

          expect(file.receiptId).toBe(receipt.id);
          expect(file.storeId).toBe(f.storeId);
          expect(file.content.subarray(0, 4).toString('latin1')).toBe('%PDF');
          expect(file.fileName).toBe(
            `constancia-propinas_${PERIOD.start}_${PERIOD.end}_${receipt.id.replace(/-/g, '').slice(0, 8)}.pdf`,
          );
          expect(file.fileName).not.toContain(receipt.workerName.split(' ')[0]);
        });
      });

      it('dos descargas de la misma constancia son idénticas byte a byte', async () => {
        await withinRollback(async (f) => {
          const pool = await paid(f);
          const [receipt] = await f.service.listReceipts(pool.id, f.accountant);
          const first = await f.service.downloadReceipt(
            pool.id,
            receipt.userId,
            f.accountant,
          );
          await tick();
          const second = await f.service.downloadReceipt(
            pool.id,
            receipt.userId,
            f.accountant,
          );
          expect(first.content.equals(second.content)).toBe(true);

          // La fecha de emisión (texto y metadatos) es el created_at guardado:
          // el archivo es el mismo que se obtiene al renderizar con esa fecha.
          const stored = await f.tx.tipPoolReceipt.findUniqueOrThrow({
            where: { id: receipt.id },
            select: { createdAt: true },
          });
          expect(receipt.createdAt).toEqual(stored.createdAt);
          const expected = await renderTipReceiptPdf(receipt, stored.createdAt);
          expect(first.content.equals(Buffer.from(expected))).toBe(true);
          // Las fechas del PDF tienen precisión de segundos.
          const storedSeconds = Math.floor(stored.createdAt.getTime() / 1000);
          const pdf = await PDFDocument.load(first.content, {
            updateMetadata: false,
          });
          for (const date of [
            pdf.getCreationDate(),
            pdf.getModificationDate(),
          ]) {
            expect(Math.floor((date?.getTime() ?? 0) / 1000)).toBe(
              storedSeconds,
            );
          }
        });
      });

      it('sin pagar responde 409 y un trabajador sin constancia responde 404', async () => {
        await withinRollback(async (f) => {
          const pool = await confirmed(f);
          await expect(
            f.service.listReceipts(pool.id, f.accountant),
          ).rejects.toBeInstanceOf(ConflictException);
          await expect(
            f.service.downloadReceipt(pool.id, f.workers[0], f.accountant),
          ).rejects.toBeInstanceOf(ConflictException);

          const paidPool = await f.service.pay(
            pool.id,
            { expectedVersion: pool.version, paymentDate: '2026-10-20' },
            f.accountant,
          );
          await expect(
            f.service.downloadReceipt(
              paidPool.id,
              f.supervisor.id,
              f.accountant,
            ),
          ).rejects.toBeInstanceOf(NotFoundException);
        });
      });
    });

    describe('acceso por local', () => {
      it('responde 404 si no existe o el usuario no accede al local', async () => {
        await withinRollback(async (f) => {
          const pool = await paid(f);
          const otherStore = await createStore(f.tx);
          const foreign: AuthUser = { ...f.supervisor, storeId: otherStore };
          // Una a la vez: la transacción del test usa una sola conexión.
          const attempts: (() => Promise<unknown>)[] = [
            () =>
              f.service.observe(
                pool.id,
                { expectedVersion: pool.version, notes: 'x' },
                foreign,
              ),
            () =>
              f.service.confirm(
                pool.id,
                { expectedVersion: pool.version },
                foreign,
              ),
            () =>
              f.service.pay(
                pool.id,
                { expectedVersion: pool.version },
                foreign,
              ),
            () => f.service.listReceipts(pool.id, foreign),
            () => f.service.downloadReceipt(pool.id, f.workers[0], foreign),
            () =>
              f.service.confirm(
                randomUUID(),
                { expectedVersion: 1 },
                f.accountant,
              ),
            () => f.service.listReceipts(randomUUID(), f.accountant),
          ];
          for (const attempt of attempts) {
            await expect(attempt()).rejects.toBeInstanceOf(NotFoundException);
          }
        });
      });
    });

    describe('inmutabilidad en la base de datos', () => {
      it('no se puede cambiar el total de un reparto CONFIRMED', async () => {
        await withinRollback(async (f) => {
          const pool = await confirmed(f);
          await expect(
            f.tx
              .$executeRaw`UPDATE tip_pools SET total_amount = 1 WHERE id = ${pool.id}::uuid`,
          ).rejects.toThrow(CONFIRMED_IMMUTABLE);
        });
      });

      it('no se puede cambiar la fecha de cálculo de un reparto CONFIRMED', async () => {
        await withinRollback(async (f) => {
          const pool = await confirmed(f);
          await expect(
            f.tx
              .$executeRaw`UPDATE tip_pools SET calculated_at = now() - interval '1 day' WHERE id = ${pool.id}::uuid`,
          ).rejects.toThrow(CONFIRMED_IMMUTABLE);
        });
      });

      it('no se pueden cambiar las observaciones de un reparto CONFIRMED', async () => {
        await withinRollback(async (f) => {
          const pool = await confirmed(f);
          await expect(
            f.tx
              .$executeRaw`UPDATE tip_pools SET notes = 'cambio' WHERE id = ${pool.id}::uuid`,
          ).rejects.toThrow(CONFIRMED_IMMUTABLE);
        });
      });

      it('no se puede cambiar una línea de un reparto CONFIRMED', async () => {
        await withinRollback(async (f) => {
          const pool = await confirmed(f);
          await expect(
            f.tx
              .$executeRaw`UPDATE tip_pool_lines SET amount = 1 WHERE pool_id = ${pool.id}::uuid`,
          ).rejects.toThrow(NOT_DRAFT);
        });
      });

      it('no se pueden agregar ni quitar fuentes de un reparto CONFIRMED', async () => {
        await withinRollback(async (f) => {
          const pool = await confirmed(f);
          await expect(
            f.tx
              .$executeRaw`DELETE FROM tip_pool_sources WHERE pool_id = ${pool.id}::uuid`,
          ).rejects.toThrow(NOT_DRAFT);
        });
      });

      it('un CONFIRMED no vuelve a DRAFT', async () => {
        await withinRollback(async (f) => {
          const pool = await confirmed(f);
          await expect(
            f.tx.$executeRaw`
              UPDATE tip_pools
              SET status = 'DRAFT', confirmed_at = NULL, confirmed_by_id = NULL,
                  version = version + 1
              WHERE id = ${pool.id}::uuid`,
          ).rejects.toThrow(/no puede volver a DRAFT/);
        });
      });

      it('un CONFIRMED solo cambia para pasar a PAID', async () => {
        await withinRollback(async (f) => {
          const pool = await confirmed(f);
          await expect(
            f.tx
              .$executeRaw`UPDATE tip_pools SET version = version + 1 WHERE id = ${pool.id}::uuid`,
          ).rejects.toThrow(/solo puede pasar a PAID/);
        });
      });

      it('un DRAFT no pasa directo a PAID', async () => {
        await withinRollback(async (f) => {
          const pool = await draft(f);
          await expect(
            f.tx.$executeRaw`
              UPDATE tip_pools
              SET status = 'PAID', confirmed_at = now(),
                  confirmed_by_id = ${f.accountant.id}::uuid, paid_at = now(),
                  paid_by_id = ${f.accountant.id}::uuid,
                  payment_date = '2026-10-20'
              WHERE id = ${pool.id}::uuid`,
          ).rejects.toThrow(/debe confirmarse antes/);
        });
      });

      it('se rechaza cualquier UPDATE sobre un reparto PAID', async () => {
        await withinRollback(async (f) => {
          const pool = await paid(f);
          await expect(
            f.tx
              .$executeRaw`UPDATE tip_pools SET version = version WHERE id = ${pool.id}::uuid`,
          ).rejects.toThrow(PAID_IMMUTABLE);
        });
      });

      it.each(['CONFIRMED', 'PAID'] as const)(
        'no se puede eliminar un reparto %s',
        async (status) => {
          await withinRollback(async (f) => {
            const pool = status === 'PAID' ? await paid(f) : await confirmed(f);
            // En PAID las constancias (FK Restrict) se eliminan primero en
            // la cascada; el trigger del reparto rechaza antes de llegar ahí.
            await expect(
              f.tx
                .$executeRaw`DELETE FROM tip_pools WHERE id = ${pool.id}::uuid`,
            ).rejects.toThrow(/no se puede eliminar/);
          });
        },
      );

      it('un DRAFT sí se puede eliminar con sus líneas y fuentes', async () => {
        await withinRollback(async (f) => {
          const pool = await draft(f);
          await f.tx
            .$executeRaw`DELETE FROM tip_pools WHERE id = ${pool.id}::uuid`;
          expect(
            await f.tx.tipPoolLine.count({ where: { poolId: pool.id } }),
          ).toBe(0);
        });
      });

      it('no se puede modificar una constancia', async () => {
        await withinRollback(async (f) => {
          const pool = await paid(f);
          await expect(
            f.tx
              .$executeRaw`UPDATE tip_pool_receipts SET amount = 1 WHERE pool_id = ${pool.id}::uuid`,
          ).rejects.toThrow(RECEIPTS_IMMUTABLE);
        });
      });

      it('no se puede eliminar una constancia', async () => {
        await withinRollback(async (f) => {
          const pool = await paid(f);
          await expect(
            f.tx
              .$executeRaw`DELETE FROM tip_pool_receipts WHERE pool_id = ${pool.id}::uuid`,
          ).rejects.toThrow(RECEIPTS_IMMUTABLE);
        });
      });

      it('no se puede vaciar la tabla de constancias', async () => {
        await withinRollback(async (f) => {
          await expect(
            f.tx.$executeRaw`TRUNCATE tip_pool_receipts`,
          ).rejects.toThrow(RECEIPTS_IMMUTABLE);
        });
      });

      it('no se puede insertar una constancia de un reparto que no está PAID', async () => {
        await withinRollback(async (f) => {
          const pool = await confirmed(f);
          const line = pool.lines[0];
          await expect(
            f.tx.tipPoolReceipt.create({
              data: {
                poolId: pool.id,
                userId: line.userId,
                workerName: line.workerName,
                storeId: f.storeId,
                storeName: pool.store.name,
                periodStart: day(PERIOD.start),
                periodEnd: day(PERIOD.end),
                hoursWorked: line.hoursWorked,
                amount: line.amount,
                paymentDate: day('2026-10-20'),
                paidById: f.accountant.id,
                paidByName: 'Lucas Pago',
                detail: {},
              },
            }),
          ).rejects.toThrow(/Solo se emiten constancias de un reparto pagado/);
        });
      });

      it('no se puede insertar una constancia que no coincide con su línea', async () => {
        await withinRollback(async (f) => {
          const pool = await paid(f);
          // Una segunda constancia del mismo reparto para alguien sin línea.
          await expect(
            f.tx.tipPoolReceipt.create({
              data: {
                poolId: pool.id,
                userId: f.supervisor.id,
                workerName: 'Intruso',
                storeId: f.storeId,
                storeName: pool.store.name,
                periodStart: day(PERIOD.start),
                periodEnd: day(PERIOD.end),
                hoursWorked: 1,
                amount: 1,
                paymentDate: day('2026-10-20'),
                paidById: f.accountant.id,
                paidByName: 'Lucas Pago',
                detail: {},
              },
            }),
          ).rejects.toThrow(/no coincide con el reparto/);
        });
      });

      it('el CHECK exige fecha de pago desde el término del período', async () => {
        await withinRollback(async (f) => {
          const pool = await confirmed(f);
          await expect(
            f.tx.$executeRaw`
              UPDATE tip_pools
              SET status = 'PAID', paid_at = now(),
                  paid_by_id = ${f.accountant.id}::uuid,
                  payment_date = '2026-10-14', version = version + 1
              WHERE id = ${pool.id}::uuid`,
          ).rejects.toThrow(/tip_pools_status_consistency/);
        });
      });
    });
  },
);

// -------------------------------------------------------------
// Pipeline HTTP: roles, auditoría, validación y concurrencia.
// -------------------------------------------------------------
const DOMAIN = '@tip-pools-actions-test.invalid';
const STORE_NAME = 'Subway Tip Pools Actions Test';
const FLOW_PERIOD = { start: '2026-03-01', end: '2026-03-15' } as const;
const CONFIRM_RACE_PERIOD = { start: '2026-04-01', end: '2026-04-15' } as const;
const PAY_RACE_PERIOD = { start: '2026-05-01', end: '2026-05-15' } as const;
const VALIDATION_PERIOD = { start: '2026-06-01', end: '2026-06-15' } as const;
const STALE_PERIOD = { start: '2026-07-01', end: '2026-07-15' } as const;

describe.skipIf(!databaseUrl)(
  'API de confirmación y pago del reparto (SPRINT-3-T13)',
  () => {
    let app: INestApplication<App>;
    let prisma: PrismaClient;
    let jwt: JwtService;
    let storeId: string;
    const ids: Record<string, string> = {};
    const tokens: Record<string, string> = {};

    async function cleanup(): Promise<void> {
      await prisma.$transaction(async (tx) => {
        // Mantenimiento de pruebas: replica omite los triggers de
        // inmutabilidad, igual que purgeTestAuditLogs.
        await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
        const storeWhere = { name: { startsWith: STORE_NAME } };
        await tx.tipPoolReceipt.deleteMany({
          where: { pool: { store: storeWhere } },
        });
        await tx.tipPoolSource.deleteMany({
          where: { pool: { store: storeWhere } },
        });
        await tx.tipPoolLine.deleteMany({
          where: { pool: { store: storeWhere } },
        });
        await tx.tipPool.deleteMany({ where: { store: storeWhere } });
        await tx.tipAgreement.deleteMany({ where: { store: storeWhere } });
        await tx.workHoursRecord.deleteMany({ where: { store: storeWhere } });
        await tx.tipEntry.deleteMany({ where: { store: storeWhere } });
      });
      await purgeTestAuditLogs(prisma, {
        OR: [
          { user: { email: { endsWith: DOMAIN } } },
          { store: { name: { startsWith: STORE_NAME } } },
        ],
      });
      await prisma.user.deleteMany({ where: { email: { endsWith: DOMAIN } } });
      await prisma.store.deleteMany({
        where: { name: { startsWith: STORE_NAME } },
      });
    }

    async function createApiUser(
      name: string,
      roleCode: RoleCode,
      userStoreId: string | null,
    ): Promise<void> {
      const role = await prisma.role.findUniqueOrThrow({
        where: { code: roleCode },
      });
      const user = await prisma.user.create({
        data: {
          email: `${name}${DOMAIN}`,
          passwordHash: '$2b$04$hash-de-prueba',
          firstName: name,
          lastName: 'Pago',
          roleId: role.id,
          storeId: userStoreId,
        },
      });
      ids[name] = user.id;
      const payload: JwtPayload = {
        sub: user.id,
        email: user.email,
        role: roleCode,
        storeId: userStoreId,
      };
      tokens[name] = await jwt.signAsync(payload);
    }

    // 7.000 + 3.001 = 10.001 con 12,5 y 37,5 horas: 2.500 y 7.501.
    async function seedPeriod(period: {
      start: string;
      end: string;
    }): Promise<void> {
      await prisma.tipEntry.createMany({
        data: [
          {
            businessDate: day(period.start),
            paymentMethod: 'CASH',
            amount: 7000,
            storeId,
            responsibleId: ids.supervisor,
          },
          {
            businessDate: day(period.end),
            paymentMethod: 'CREDIT_CARD',
            amount: 3001,
            storeId,
            responsibleId: ids.supervisor,
          },
        ],
      });
      await prisma.workHoursRecord.createMany({
        data: [
          { worker: 'workerOne', hours: 12.5 },
          { worker: 'workerTwo', hours: 37.5 },
        ].map(({ worker, hours }) => ({
          periodStart: day(period.start),
          periodEnd: day(period.end),
          hoursWorked: hours,
          storeId,
          workerId: ids[worker],
          recordedById: ids.supervisor,
        })),
      });
    }

    function server() {
      return request(app.getHttpServer());
    }

    async function createDraft(period: {
      start: string;
      end: string;
    }): Promise<TipPoolResponse> {
      await seedPeriod(period);
      const response = await server()
        .post('/tip-pools/preview')
        .set('Authorization', `Bearer ${tokens.accountant}`)
        .send({ storeId, periodStart: period.start, periodEnd: period.end })
        .expect(201);
      return response.body as TipPoolResponse;
    }

    function action(
      poolId: string,
      name: 'observations' | 'confirm' | 'pay',
      body: Record<string, unknown>,
      token: string | null = tokens.accountant,
    ) {
      const req = server().post(`/tip-pools/${poolId}/${name}`);
      if (token) req.set('Authorization', `Bearer ${token}`);
      return req.send(body);
    }

    function get(path: string, token: string | null = tokens.accountant) {
      const req = server().get(path);
      if (token) req.set('Authorization', `Bearer ${token}`);
      return req;
    }

    async function auditsOf(
      entityId: string,
      entityType = 'tip_pools',
    ): Promise<{ action: string; detail: unknown; storeId: string | null }[]> {
      return prisma.auditLog.findMany({
        where: { entityType, entityId },
        orderBy: { id: 'asc' },
        select: { action: true, detail: true, storeId: true },
      });
    }

    beforeAll(async () => {
      process.env.DATABASE_URL = databaseUrl;
      process.env.JWT_SECRET = 'secreto-de-pruebas';
      process.env.JWT_EXPIRES_IN = '1h';
      process.env.JWT_REFRESH_EXPIRES_IN = '7d';
      process.env.DOCUMENTS_STORAGE_PATH = './storage/test-documents';
      process.env.DOCUMENTS_MAX_SIZE_MB = '1';

      const moduleFixture: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();
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
      await cleanup();

      for (const code of Object.values(ROLE)) {
        await prisma.role.upsert({
          where: { code },
          update: {},
          create: { code, name: code },
        });
      }
      const store = await prisma.store.create({
        data: { name: STORE_NAME, city: 'Melipilla', address: 'Calle 123' },
      });
      storeId = store.id;

      await createApiUser('accountant', ROLE.CONTADOR, null);
      await createApiUser('admin', ROLE.ADMINISTRADOR, null);
      await createApiUser('supervisor', ROLE.SUPERVISOR, storeId);
      await createApiUser('workerOne', ROLE.TRABAJADOR, storeId);
      await createApiUser('workerTwo', ROLE.TRABAJADOR, storeId);

      await prisma.tipAgreement.create({
        data: {
          name: 'Pacto API Pago Test',
          rule: 'PROPORTIONAL_TO_HOURS',
          validFrom: day('2026-01-01'),
          storeId,
          createdById: ids.supervisor,
        },
      });
    }, 60_000);

    afterAll(async () => {
      await cleanup();
      await prisma.$disconnect();
      await app.close();
    });

    it('flujo completo por HTTP con su auditoría', async () => {
      const created = await createDraft(FLOW_PERIOD);

      const observed = (
        await action(created.id, 'observations', {
          expectedVersion: 1,
          notes: '  Revisar las horas de workerTwo  ',
        }).expect(200)
      ).body as TipPoolResponse;
      expect(observed).toMatchObject({
        version: 2,
        notes: 'Revisar las horas de workerTwo',
      });

      const recalculated = (
        await server()
          .post('/tip-pools/preview')
          .set('Authorization', `Bearer ${tokens.accountant}`)
          .send({
            storeId,
            periodStart: FLOW_PERIOD.start,
            periodEnd: FLOW_PERIOD.end,
          })
          .expect(200)
      ).body as TipPoolResponse;
      expect(recalculated).toMatchObject({ version: 3, notes: null });

      const confirmedPool = (
        await action(created.id, 'confirm', { expectedVersion: 3 }).expect(200)
      ).body as TipPoolResponse;
      expect(confirmedPool).toMatchObject({
        status: 'CONFIRMED',
        version: 4,
        confirmedBy: { id: ids.accountant, name: 'accountant Pago' },
      });

      const paidPool = (
        await action(created.id, 'pay', { expectedVersion: 4 }).expect(200)
      ).body as TipPoolResponse;
      expect(paidPool).toMatchObject({
        status: 'PAID',
        version: 5,
        paidBy: { id: ids.accountant, name: 'accountant Pago' },
        paymentDate: todayInChile(),
        receiptsCount: 2,
      });

      // El contador y el administrador listan y descargan.
      for (const name of ['accountant', 'admin']) {
        const receipts = (
          await get(`/tip-pools/${created.id}/receipts`, tokens[name]).expect(
            200,
          )
        ).body as TipPoolReceiptResponse[];
        expect(
          Object.fromEntries(
            receipts.map((receipt) => [receipt.userId, receipt.amount]),
          ),
        ).toEqual({ [ids.workerOne]: 2500, [ids.workerTwo]: 7501 });
      }
      const receipt = await prisma.tipPoolReceipt.findUniqueOrThrow({
        where: { poolId_userId: { poolId: created.id, userId: ids.workerOne } },
      });
      const download = await get(
        `/tip-pools/${created.id}/receipts/${ids.workerOne}/download`,
        tokens.admin,
      )
        // Entrega el cuerpo binario como Buffer.
        .responseType('blob')
        .expect(200);
      const shortId = receipt.id.replace(/-/g, '').slice(0, 8);
      const fileName = `constancia-propinas_${FLOW_PERIOD.start}_${FLOW_PERIOD.end}_${shortId}.pdf`;
      expect(download.headers['content-type']).toBe('application/pdf');
      expect(download.headers['x-content-type-options']).toBe('nosniff');
      expect(download.headers['content-disposition']).toBe(
        `attachment; filename="${fileName}"; filename*=UTF-8''${fileName}`,
      );
      expect(download.headers['content-disposition']).not.toContain(
        'workerOne',
      );
      expect((download.body as Buffer).subarray(0, 4).toString('latin1')).toBe(
        '%PDF',
      );

      // Auditoría de cada acción, con su detalle.
      const audits = await auditsOf(created.id);
      expect(audits.map((audit) => audit.action)).toEqual([
        AUDIT_ACTION.TIP_POOL_CALCULATED,
        AUDIT_ACTION.TIP_POOL_OBSERVED,
        AUDIT_ACTION.TIP_POOL_RECALCULATED,
        AUDIT_ACTION.TIP_POOL_CONFIRMED,
        AUDIT_ACTION.TIP_POOL_PAID,
      ]);
      expect(audits.every((audit) => audit.storeId === storeId)).toBe(true);
      // El texto de la observación queda en la auditoría (ya recortado) y el
      // recálculo registra cuál descartó; el reparto ya no la tiene.
      const notes = 'Revisar las horas de workerTwo';
      expect(audits[1].detail).toEqual({
        version: 2,
        notes,
        notesLength: notes.length,
      });
      expect(audits[2].detail).toMatchObject({
        recalculated: true,
        previousNotes: notes,
      });
      expect(
        (
          await prisma.tipPool.findUniqueOrThrow({
            where: { id: created.id },
            select: { notes: true },
          })
        ).notes,
      ).toBeNull();
      expect(audits[3].detail).toEqual({ totalAmount: 10001, version: 4 });
      expect(audits[4].detail).toEqual({
        paymentDate: todayInChile(),
        receiptsCount: 2,
        totalAmount: 10001,
      });
      expect(await auditsOf(receipt.id, 'tip_pool_receipts')).toEqual([
        {
          action: AUDIT_ACTION.TIP_POOL_RECEIPT_DOWNLOADED,
          storeId,
          detail: { poolId: created.id, userId: ids.workerOne },
        },
      ]);

      // Una acción rechazada (409) no deja registro de éxito.
      const rejected = await action(created.id, 'observations', {
        expectedVersion: 5,
        notes: 'Tarde',
      }).expect(409);
      expect(rejected.body).toMatchObject({
        statusCode: 409,
        currentStatus: 'PAID',
        currentVersion: 5,
      });
      await action(created.id, 'confirm', { expectedVersion: 5 }).expect(409);
      await action(created.id, 'pay', { expectedVersion: 5 }).expect(409);
      expect(await auditsOf(created.id)).toHaveLength(5);
    });

    it('autorización: solo el contador actúa; contador y administrador consultan', async () => {
      const pool = await prisma.tipPool.findFirstOrThrow({
        where: { storeId, periodStart: day(FLOW_PERIOD.start) },
      });
      for (const name of ['admin', 'supervisor', 'workerOne']) {
        await action(
          pool.id,
          'observations',
          { expectedVersion: 5, notes: 'x' },
          tokens[name],
        ).expect(403);
        await action(
          pool.id,
          'confirm',
          { expectedVersion: 5 },
          tokens[name],
        ).expect(403);
        await action(
          pool.id,
          'pay',
          { expectedVersion: 5 },
          tokens[name],
        ).expect(403);
      }
      for (const name of ['supervisor', 'workerOne']) {
        await get(`/tip-pools/${pool.id}/receipts`, tokens[name]).expect(403);
        await get(
          `/tip-pools/${pool.id}/receipts/${ids.workerOne}/download`,
          tokens[name],
        ).expect(403);
      }
      await action(
        pool.id,
        'observations',
        { expectedVersion: 5 },
        null,
      ).expect(401);
      await action(pool.id, 'confirm', { expectedVersion: 5 }, null).expect(
        401,
      );
      await action(pool.id, 'pay', { expectedVersion: 5 }, null).expect(401);
      await get(`/tip-pools/${pool.id}/receipts`, null).expect(401);
      await get(
        `/tip-pools/${pool.id}/receipts/${ids.workerOne}/download`,
        null,
      ).expect(401);
      // Ninguna descarga rechazada quedó como exitosa.
      const receipt = await prisma.tipPoolReceipt.findUniqueOrThrow({
        where: { poolId_userId: { poolId: pool.id, userId: ids.workerOne } },
      });
      expect(await auditsOf(receipt.id, 'tip_pool_receipts')).toHaveLength(1);
    });

    it('responde 404 si el reparto o la constancia no existen', async () => {
      const missing = randomUUID();
      await action(missing, 'confirm', { expectedVersion: 1 }).expect(404);
      await action(missing, 'pay', { expectedVersion: 1 }).expect(404);
      await action(missing, 'observations', {
        expectedVersion: 1,
        notes: 'x',
      }).expect(404);
      await get(`/tip-pools/${missing}/receipts`).expect(404);
      const pool = await prisma.tipPool.findFirstOrThrow({
        where: { storeId, periodStart: day(FLOW_PERIOD.start) },
      });
      await get(
        `/tip-pools/${pool.id}/receipts/${ids.supervisor}/download`,
      ).expect(404);
    });

    it('dos confirmaciones simultáneas con la misma versión: una gana', async () => {
      const pool = await createDraft(CONFIRM_RACE_PERIOD);
      const responses = await Promise.all([
        action(pool.id, 'confirm', { expectedVersion: 1 }),
        action(pool.id, 'confirm', { expectedVersion: 1 }),
      ]);
      expect(responses.map((response) => response.status).sort()).toEqual([
        200, 409,
      ]);
      const loser = responses.find((response) => response.status === 409);
      expect(loser?.body).toMatchObject({
        currentStatus: 'CONFIRMED',
        currentVersion: 2,
      });
      const audits = await auditsOf(pool.id);
      expect(
        audits.filter(
          (audit) => audit.action === AUDIT_ACTION.TIP_POOL_CONFIRMED,
        ),
      ).toHaveLength(1);
    });

    it('dos pagos simultáneos dejan un solo juego de constancias', async () => {
      const pool = await createDraft(PAY_RACE_PERIOD);
      await action(pool.id, 'confirm', { expectedVersion: 1 }).expect(200);
      const responses = await Promise.all([
        action(pool.id, 'pay', { expectedVersion: 2 }),
        action(pool.id, 'pay', { expectedVersion: 2 }),
      ]);
      expect(responses.map((response) => response.status).sort()).toEqual([
        200, 409,
      ]);
      expect(
        await prisma.tipPoolReceipt.count({ where: { poolId: pool.id } }),
      ).toBe(2);
      const stored = await prisma.tipPool.findUniqueOrThrow({
        where: { id: pool.id },
      });
      expect(stored).toMatchObject({ status: 'PAID', version: 3 });
    });

    it('expectedVersion desactualizado responde 409 con currentVersion', async () => {
      const pool = await createDraft(STALE_PERIOD);
      await action(pool.id, 'observations', {
        expectedVersion: 1,
        notes: 'Primera revisión',
      }).expect(200);
      const response = await action(pool.id, 'confirm', {
        expectedVersion: 1,
      }).expect(409);
      expect(response.body).toEqual({
        statusCode: 409,
        message: VERSION_CONFLICT_MESSAGE,
        currentStatus: 'DRAFT',
        currentVersion: 2,
      });
    });

    it('valida el cuerpo, los IDs y la fecha de pago con 400', async () => {
      const pool = await createDraft(VALIDATION_PERIOD);
      const invalidObservations: Record<string, unknown>[] = [
        { expectedVersion: 1, notes: '' },
        { expectedVersion: 1, notes: '   ' },
        { expectedVersion: 1, notes: 'x'.repeat(256) },
        { expectedVersion: 1 },
        { notes: 'Sin versión' },
        { expectedVersion: '1', notes: 'Texto' },
        { expectedVersion: 1.5, notes: 'Decimal' },
        { expectedVersion: 0, notes: 'Cero' },
      ];
      for (const body of invalidObservations) {
        await action(pool.id, 'observations', body).expect(400);
      }
      await action(pool.id, 'confirm', {}).expect(400);
      await action(pool.id, 'confirm', { expectedVersion: 'uno' }).expect(400);
      await action('no-es-uuid', 'confirm', { expectedVersion: 1 }).expect(400);
      await action('no-es-uuid', 'pay', { expectedVersion: 1 }).expect(400);
      await action('no-es-uuid', 'observations', {
        expectedVersion: 1,
        notes: 'x',
      }).expect(400);
      await get('/tip-pools/no-es-uuid/receipts').expect(400);
      await get(`/tip-pools/${pool.id}/receipts/no-es-uuid/download`).expect(
        400,
      );
      // El máximo de 255 caracteres sí se acepta.
      await action(pool.id, 'observations', {
        expectedVersion: 1,
        notes: 'x'.repeat(255),
      }).expect(200);

      await action(pool.id, 'confirm', { expectedVersion: 2 }).expect(200);
      for (const paymentDate of [
        '2099-01-01',
        VALIDATION_PERIOD.start,
        '2026-13-01',
        '15-06-2026',
      ]) {
        await action(pool.id, 'pay', {
          expectedVersion: 3,
          paymentDate,
        }).expect(400);
      }
      const stored = await prisma.tipPool.findUniqueOrThrow({
        where: { id: pool.id },
      });
      expect(stored).toMatchObject({ status: 'CONFIRMED', version: 3 });
      // Las constancias de un reparto sin pagar responden 409.
      await get(`/tip-pools/${pool.id}/receipts`).expect(409);
    });
  },
);
