import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomInt, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { AUDIT_ACTION } from '../src/audit/constants/audit-actions.constants.js';
import { ROLE, type RoleCode } from '../src/auth/constants/roles.constants.js';
import type { AuthUser, JwtPayload } from '../src/auth/types/auth.types.js';
import {
  addDays,
  businessDateOf,
  formatDbDate,
  toDbDate,
} from '../src/documents/utils/document-dates.util.js';
import { Prisma, PrismaClient } from '../src/generated/prisma/client.js';
import { isoWeekdayOf } from '../src/operating-days/calculation/sales-day-status.js';
import { OperatingDaysService } from '../src/operating-days/operating-days.service.js';
import type {
  OperatingCalendarResponse,
  SalesDayItem,
  SalesDaysResponse,
  StoreClosureResponse,
} from '../src/operating-days/types/operating-days.types.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  createSwitchablePrisma,
  type SwitchablePrisma,
} from './helpers/switchable-prisma.js';

type App = Parameters<typeof request>[0];
type Tx = Prisma.TransactionClient;

// Tests de integración HTTP del calendario de operación y del estado diario
// de ventas (SPRINT-4R-T12) contra PostgreSQL real: configuración de días y
// cierres por excepción con auditoría, estados IMPORTADO / PENDIENTE /
// ATRASADO / CERRADO en hora de Chile, importación tardía, una sola fila por
// local y fecha, rangos y permisos (solo ADMINISTRADOR). Las fechas se
// calculan relativas al día de negocio actual, así el test no envejece. Todo
// corre dentro de withinRollback.
const databaseUrl = process.env.TEST_DATABASE_URL;
const MISSING_ID = '00000000-0000-4000-8000-000000000000';

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
  externalCode: string;
  cashMethodId: string;
  admin: AuthUser;
  supervisor: AuthUser;
  accountant: AuthUser;
  worker: AuthUser;
}

// Día de negocio de hoy en Chile y desplazamientos (YYYY-MM-DD).
function today(): string {
  return formatDbDate(toDbDate(businessDateOf(new Date())));
}

function daysAgo(days: number): string {
  return formatDbDate(toDbDate(addDays(businessDateOf(new Date()), -days)));
}

const ALL_WEEKDAYS = [1, 2, 3, 4, 5, 6, 7];

describe.skipIf(!databaseUrl)(
  'API del calendario de operación y estado de ventas (SPRINT-4R-T12)',
  { timeout: 60_000 },
  () => {
    let app: INestApplication<App>;
    let jwt: JwtService;
    let prisma: PrismaClient;
    let switchable: SwitchablePrisma;
    let storageRoot: string;

    function token(user: AuthUser): string {
      const payload: JwtPayload = {
        sub: user.id,
        email: user.email,
        role: user.role,
        storeId: user.storeId,
      };
      return jwt.sign(payload);
    }

    function call(
      method: 'get' | 'put' | 'post' | 'delete',
      url: string,
      user: AuthUser | null,
    ): request.Test {
      const req = request(app.getHttpServer())[method](url);
      return user ? req.set('Authorization', `Bearer ${token(user)}`) : req;
    }

    function putCalendar(
      f: Fixture,
      body: { weekdays: unknown; trackingStartDate: unknown },
      storeId = f.storeId,
    ): request.Test {
      return call('put', `/stores/${storeId}/operating-calendar`, f.admin).send(
        body,
      );
    }

    async function salesDays(
      f: Fixture,
      query: Record<string, string> = {},
    ): Promise<SalesDaysResponse> {
      const params = new URLSearchParams({ storeId: f.storeId, ...query });
      const response = await call(
        'get',
        `/sales-days?${params.toString()}`,
        f.admin,
      ).expect(200);
      return response.body as SalesDaysResponse;
    }

    function statusOn(
      result: SalesDaysResponse,
      date: string,
    ): SalesDayItem | undefined {
      return result.items.find((item) => item.businessDate === date);
    }

    async function createUser(
      tx: Tx,
      role: RoleCode,
      storeId: string | null,
    ): Promise<AuthUser> {
      const roleRecord = await tx.role.upsert({
        where: { code: role },
        update: {},
        create: { code: role, name: role },
      });
      const id = randomUUID();
      const email = `${id}@operating-days-test.invalid`;
      await tx.user.create({
        data: {
          id,
          email,
          passwordHash: '$2b$04$hash-de-prueba',
          firstName: role,
          lastName: 'Calendario',
          roleId: roleRecord.id,
          storeId,
        },
      });
      return { id, email, role, storeId };
    }

    async function createFixture(tx: Tx): Promise<Fixture> {
      const store = await tx.store.create({
        data: {
          name: `Subway Calendario ${randomUUID()}`,
          city: 'Melipilla',
          address: 'Calle sintética 123',
        },
      });
      const otherStore = await tx.store.create({
        data: {
          name: `Subway Calendario Otro ${randomUUID()}`,
          city: 'Calera',
          address: 'Calle sintética 456',
        },
      });
      const externalCode = `7${randomInt(10, 99)} - ${randomInt(10_000, 99_999)}`;
      await tx.storeExternalCode.create({
        data: { system: 'MRCOMANDA', externalCode, storeId: store.id },
      });
      const cash = await tx.paymentMethod.upsert({
        where: { code: 'CASH' },
        update: {},
        create: {
          code: 'CASH',
          name: 'Efectivo',
          sortOrder: 10,
          behavior: 'CASH',
        },
      });
      await tx.paymentMethodAlias.upsert({
        where: {
          system_normalizedLabel: {
            system: 'MRCOMANDA',
            normalizedLabel: 'EFECTIVO',
          },
        },
        update: { paymentMethodId: cash.id },
        create: {
          system: 'MRCOMANDA',
          label: 'EFECTIVO',
          normalizedLabel: 'EFECTIVO',
          paymentMethodId: cash.id,
        },
      });
      return {
        tx,
        storeId: store.id,
        otherStoreId: otherStore.id,
        externalCode,
        cashMethodId: cash.id,
        admin: await createUser(tx, ROLE.ADMINISTRADOR, null),
        supervisor: await createUser(tx, ROLE.SUPERVISOR, store.id),
        accountant: await createUser(tx, ROLE.CONTADOR, null),
        worker: await createUser(tx, ROLE.TRABAJADOR, store.id),
      };
    }

    // Importación del día (PENDING o ACTIVE) creada directo en la base: el
    // flujo de carga ya está cubierto por las pruebas de SPRINT-4R-T10.
    async function createImport(
      f: Fixture,
      date: string,
      status: 'PENDING' | 'ACTIVE',
    ): Promise<string> {
      const start = new Date(`${date}T12:00:00.000Z`);
      const header = await f.tx.salesImport.create({
        data: {
          storeId: f.storeId,
          businessDate: new Date(`${date}T00:00:00.000Z`),
          periodStart: start,
          periodEnd: new Date(start.getTime() + 8 * 3_600_000),
          externalStoreCode: f.externalCode,
          version:
            (await f.tx.salesImport.count({
              where: {
                storeId: f.storeId,
                businessDate: new Date(`${date}T00:00:00.000Z`),
              },
            })) + 1,
          totalAmount: BigInt(1000),
          fileName: 'ventas.xlsx',
          filePath: `sales-imports/test/${randomUUID()}.xlsx`,
          mimeType: 'application/octet-stream',
          sizeBytes: BigInt(10),
          sha256Hash: randomUUID().replace(/-/g, '').padEnd(64, 'a'),
          uploadedById: f.admin.id,
        },
      });
      await f.tx.salesImportLine.create({
        data: {
          importId: header.id,
          lineNumber: 1,
          originalLabel: 'EFECTIVO',
          normalizedLabel: 'EFECTIVO',
          amount: BigInt(1000),
          paymentMethodId: f.cashMethodId,
        },
      });
      if (status === 'ACTIVE') {
        await f.tx.salesImport.update({
          where: { id: header.id },
          data: {
            status: 'ACTIVE',
            isCurrent: true,
            confirmedAt: new Date(),
            confirmedById: f.admin.id,
          },
        });
      }
      return header.id;
    }

    async function withinRollback(
      run: (fixture: Fixture) => Promise<void>,
    ): Promise<void> {
      try {
        await prisma.$transaction(
          async (tx) => {
            switchable.use(tx);
            await run(await createFixture(tx));
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
      storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'moifood-cal-'));
      process.env.DOCUMENTS_STORAGE_PATH = storageRoot;
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
      await fs.rm(storageRoot, { recursive: true, force: true });
    });

    describe('calendario', () => {
      it('sin calendario el local no genera alertas, pero lo importado se ve', async () => {
        await withinRollback(async (f) => {
          const calendar = (
            await call(
              'get',
              `/stores/${f.storeId}/operating-calendar`,
              f.admin,
            ).expect(200)
          ).body as OperatingCalendarResponse;
          expect(calendar).toMatchObject({
            configured: false,
            weekdays: [],
            trackingStartDate: null,
            closures: [],
          });

          const activeId = await createImport(f, daysAgo(2), 'ACTIVE');
          const result = await salesDays(f);
          expect(result.items).toEqual([
            expect.objectContaining({
              businessDate: daysAgo(2),
              status: 'IMPORTADO',
              activeImportId: activeId,
            }),
          ]);
        });
      });

      it('configura los días y la fecha de inicio y audita el cambio con el anterior', async () => {
        await withinRollback(async (f) => {
          const first = await putCalendar(f, {
            weekdays: [6, 1, 2, 3, 4, 5],
            trackingStartDate: daysAgo(10),
          }).expect(200);
          expect(first.body as OperatingCalendarResponse).toMatchObject({
            configured: true,
            weekdays: [1, 2, 3, 4, 5, 6],
            trackingStartDate: daysAgo(10),
            updatedBy: { id: f.admin.id },
          });

          await putCalendar(f, {
            weekdays: ALL_WEEKDAYS,
            trackingStartDate: daysAgo(5),
          }).expect(200);

          const audits = await f.tx.auditLog.findMany({
            where: {
              action: AUDIT_ACTION.STORE_OPERATING_CALENDAR_UPDATED,
              entityId: f.storeId,
            },
            orderBy: { id: 'asc' },
          });
          expect(audits).toHaveLength(2);
          expect(audits[0].userId).toBe(f.admin.id);
          expect(audits[0].storeId).toBe(f.storeId);
          expect(audits[0].detail).toEqual({
            weekdays: [1, 2, 3, 4, 5, 6],
            trackingStartDate: daysAgo(10),
            previousWeekdays: null,
            previousTrackingStartDate: null,
          });
          expect(audits[1].detail).toEqual({
            weekdays: ALL_WEEKDAYS,
            trackingStartDate: daysAgo(5),
            previousWeekdays: [1, 2, 3, 4, 5, 6],
            previousTrackingStartDate: daysAgo(10),
          });
        });
      });

      it('valida los días, la fecha y el local', async () => {
        await withinRollback(async (f) => {
          for (const weekdays of [[], [0], [8], [1, 1], ['lunes'], 3]) {
            await putCalendar(f, {
              weekdays,
              trackingStartDate: daysAgo(1),
            }).expect(400);
          }
          await putCalendar(f, {
            weekdays: [1],
            trackingStartDate: '2026-02-30',
          }).expect(400);
          await putCalendar(
            f,
            { weekdays: [1], trackingStartDate: daysAgo(1) },
            MISSING_ID,
          ).expect(404);
          await f.tx.store.update({
            where: { id: f.otherStoreId },
            data: { isActive: false },
          });
          await putCalendar(
            f,
            { weekdays: [1], trackingStartDate: daysAgo(1) },
            f.otherStoreId,
          ).expect(400);
        });
      });
    });

    describe('cierres por excepción', () => {
      it('registra, rechaza duplicados y quita un cierre con auditoría', async () => {
        await withinRollback(async (f) => {
          const created = await call(
            'post',
            `/stores/${f.storeId}/closures`,
            f.admin,
          )
            .send({ date: daysAgo(3), reason: '  Corte de luz  ' })
            .expect(201);
          const closure = created.body as StoreClosureResponse;
          expect(closure).toMatchObject({
            date: daysAgo(3),
            reason: 'Corte de luz',
            createdBy: { id: f.admin.id },
          });
          const createdAudit = await f.tx.auditLog.findFirstOrThrow({
            where: {
              action: AUDIT_ACTION.STORE_CLOSURE_CREATED,
              entityId: closure.id,
            },
          });
          expect(createdAudit.storeId).toBe(f.storeId);
          expect(createdAudit.detail).toEqual({
            date: daysAgo(3),
            reason: 'Corte de luz',
          });

          const duplicate = await call(
            'post',
            `/stores/${f.storeId}/closures`,
            f.admin,
          )
            .send({ date: daysAgo(3), reason: 'Otro motivo' })
            .expect(409);
          expect(duplicate.body).toMatchObject({
            existingClosureId: closure.id,
          });

          for (const body of [
            { date: daysAgo(4), reason: '   ' },
            { date: daysAgo(4) },
            { date: 'ayer', reason: 'Motivo' },
            { date: daysAgo(4), reason: 'x'.repeat(301) },
          ]) {
            await call('post', `/stores/${f.storeId}/closures`, f.admin)
              .send(body)
              .expect(400);
          }

          // Quitarlo desde otro local no corresponde.
          await call(
            'delete',
            `/stores/${f.otherStoreId}/closures/${closure.id}`,
            f.admin,
          ).expect(404);
          const removed = await call(
            'delete',
            `/stores/${f.storeId}/closures/${closure.id}`,
            f.admin,
          ).expect(200);
          expect((removed.body as StoreClosureResponse).id).toBe(closure.id);
          const deletedAudit = await f.tx.auditLog.findFirstOrThrow({
            where: {
              action: AUDIT_ACTION.STORE_CLOSURE_DELETED,
              entityId: closure.id,
            },
          });
          expect(deletedAudit.detail).toEqual({
            date: daysAgo(3),
            reason: 'Corte de luz',
          });
          await call(
            'delete',
            `/stores/${f.storeId}/closures/${closure.id}`,
            f.admin,
          ).expect(404);
        });
      });
    });

    describe('estado diario de ventas', () => {
      it('distingue IMPORTADO, PENDIENTE, ATRASADO y CERRADO', async () => {
        await withinRollback(async (f) => {
          // Abre todos los días salvo el día de la semana de hace 6 días.
          const weeklyClosed = isoWeekdayOf(daysAgo(6));
          await putCalendar(f, {
            weekdays: ALL_WEEKDAYS.filter((day) => day !== weeklyClosed),
            trackingStartDate: daysAgo(6),
          }).expect(200);
          await call('post', `/stores/${f.storeId}/closures`, f.admin)
            .send({ date: daysAgo(2), reason: 'Mantención' })
            .expect(201);
          const imported = await createImport(f, daysAgo(3), 'ACTIVE');
          const pending = await createImport(f, daysAgo(4), 'PENDING');

          const result = await salesDays(f, { from: daysAgo(10) });
          expect(result.today).toBe(today());
          expect(result.to).toBe(today());

          expect(statusOn(result, today())?.status).toBe('PENDIENTE');
          expect(statusOn(result, daysAgo(1))?.status).toBe('ATRASADO');
          expect(statusOn(result, daysAgo(2))).toMatchObject({
            status: 'CERRADO',
            closure: { reason: 'Mantención' },
          });
          expect(statusOn(result, daysAgo(3))).toMatchObject({
            status: 'IMPORTADO',
            activeImportId: imported,
          });
          // Una importación sin confirmar no resuelve el día.
          expect(statusOn(result, daysAgo(4))).toMatchObject({
            status: 'ATRASADO',
            pendingImportId: pending,
          });
          expect(statusOn(result, daysAgo(6))).toMatchObject({
            status: 'CERRADO',
            closure: null,
          });
          // Antes de la fecha de inicio no se informa nada.
          expect(statusOn(result, daysAgo(7))).toBeUndefined();
          expect(statusOn(result, daysAgo(10))).toBeUndefined();

          // Una sola fila por local y fecha, del día más reciente al más
          // antiguo, y el resumen coincide con las filas.
          const dates = result.items.map((item) => item.businessDate);
          expect(new Set(dates).size).toBe(dates.length);
          expect([...dates].sort().reverse()).toEqual(dates);
          const counted = {
            IMPORTADO: 0,
            PENDIENTE: 0,
            ATRASADO: 0,
            CERRADO: 0,
          };
          for (const item of result.items) counted[item.status] += 1;
          expect(result.summary).toEqual(counted);
        });
      });

      it('una importación tardía resuelve el atraso sin pasos manuales', async () => {
        await withinRollback(async (f) => {
          await putCalendar(f, {
            weekdays: ALL_WEEKDAYS,
            trackingStartDate: daysAgo(3),
          }).expect(200);
          expect(statusOn(await salesDays(f), daysAgo(1))?.status).toBe(
            'ATRASADO',
          );
          await createImport(f, daysAgo(1), 'ACTIVE');
          expect(statusOn(await salesDays(f), daysAgo(1))?.status).toBe(
            'IMPORTADO',
          );
          // Hoy también: al importarse deja de estar pendiente.
          await createImport(f, today(), 'ACTIVE');
          expect(statusOn(await salesDays(f), today())?.status).toBe(
            'IMPORTADO',
          );
        });
      });

      it('quitar un cierre vuelve a evaluar el día', async () => {
        await withinRollback(async (f) => {
          await putCalendar(f, {
            weekdays: ALL_WEEKDAYS,
            trackingStartDate: daysAgo(5),
          }).expect(200);
          const closure = (
            await call('post', `/stores/${f.storeId}/closures`, f.admin)
              .send({ date: daysAgo(1), reason: 'Registrado por error' })
              .expect(201)
          ).body as StoreClosureResponse;
          expect(statusOn(await salesDays(f), daysAgo(1))?.status).toBe(
            'CERRADO',
          );
          await call(
            'delete',
            `/stores/${f.storeId}/closures/${closure.id}`,
            f.admin,
          ).expect(200);
          expect(statusOn(await salesDays(f), daysAgo(1))?.status).toBe(
            'ATRASADO',
          );
        });
      });

      it('filtra por estado y por defecto cubre los últimos 30 días hasta hoy', async () => {
        await withinRollback(async (f) => {
          await putCalendar(f, {
            weekdays: ALL_WEEKDAYS,
            trackingStartDate: daysAgo(60),
          }).expect(200);
          await createImport(f, daysAgo(1), 'ACTIVE');

          const all = await salesDays(f);
          expect(all.from).toBe(daysAgo(30));
          expect(all.to).toBe(today());
          expect(all.items).toHaveLength(31);

          const late = await salesDays(f, { status: 'ATRASADO' });
          expect(late.items.every((item) => item.status === 'ATRASADO')).toBe(
            true,
          );
          expect(late.items).toHaveLength(29);
          expect(late.summary).toEqual({
            IMPORTADO: 0,
            PENDIENTE: 0,
            ATRASADO: 29,
            CERRADO: 0,
          });
        });
      });

      it('valida y acota el rango, y no informa días futuros ni locales inactivos', async () => {
        await withinRollback(async (f) => {
          await putCalendar(f, {
            weekdays: ALL_WEEKDAYS,
            trackingStartDate: daysAgo(3),
          }).expect(200);
          const future = formatDbDate(
            toDbDate(addDays(businessDateOf(new Date()), 5)),
          );
          const clamped = await salesDays(f, { from: daysAgo(1), to: future });
          expect(clamped.to).toBe(today());
          expect(clamped.items.map((item) => item.businessDate)).toEqual([
            today(),
            daysAgo(1),
          ]);

          const base = `/sales-days?storeId=${f.storeId}`;
          await call(
            'get',
            `${base}&from=${today()}&to=${daysAgo(1)}`,
            f.admin,
          ).expect(400);
          await call('get', `${base}&from=${daysAgo(400)}`, f.admin).expect(
            400,
          );
          await call('get', `${base}&from=2026-02-30`, f.admin).expect(400);
          await call('get', `${base}&status=OTRO`, f.admin).expect(400);
          await call(
            'get',
            `/sales-days?storeId=${MISSING_ID}`,
            f.admin,
          ).expect(404);

          await f.tx.store.update({
            where: { id: f.storeId },
            data: { isActive: false },
          });
          expect((await salesDays(f)).items).toEqual([]);
        });
      });
    });

    describe('cambio de día en hora de Chile', () => {
      // El servicio recibe el instante «ahora»: se fija justo antes y justo
      // después de la medianoche chilena, con los datos en PostgreSQL.
      function service(): OperatingDaysService {
        return app.get(OperatingDaysService);
      }

      it('en horario de verano (UTC-3) el día cambia a las 00:00 de Chile, no de UTC', async () => {
        await withinRollback(async (f) => {
          await f.tx.storeOperatingSchedule.create({
            data: {
              storeId: f.storeId,
              opensMonday: true,
              opensTuesday: true,
              opensWednesday: true,
              opensThursday: true,
              opensFriday: true,
              opensSaturday: true,
              opensSunday: true,
              trackingStartDate: new Date('2026-11-01T00:00:00.000Z'),
              updatedById: f.admin.id,
            },
          });
          const query = { storeId: f.storeId, from: '2026-11-05' };

          // 06/11 23:59 en Chile = 07/11 02:59 UTC: sigue siendo el día 6.
          const before = await service().listSalesDays(
            query,
            new Date('2026-11-07T02:59:00.000Z'),
          );
          expect(before.today).toBe('2026-11-06');
          expect(statusOn(before, '2026-11-06')?.status).toBe('PENDIENTE');
          expect(statusOn(before, '2026-11-07')).toBeUndefined();

          // 07/11 00:00 en Chile: el 6 pasa a ATRASADO y el 7 queda pendiente.
          const after = await service().listSalesDays(
            query,
            new Date('2026-11-07T03:00:00.000Z'),
          );
          expect(after.today).toBe('2026-11-07');
          expect(statusOn(after, '2026-11-06')?.status).toBe('ATRASADO');
          expect(statusOn(after, '2026-11-07')?.status).toBe('PENDIENTE');
        });
      });

      it('en horario de invierno (UTC-4) también usa la medianoche chilena', async () => {
        await withinRollback(async (f) => {
          await f.tx.storeOperatingSchedule.create({
            data: {
              storeId: f.storeId,
              opensMonday: true,
              opensTuesday: true,
              opensWednesday: true,
              opensThursday: true,
              opensFriday: true,
              opensSaturday: true,
              opensSunday: true,
              trackingStartDate: new Date('2026-07-01T00:00:00.000Z'),
              updatedById: f.admin.id,
            },
          });
          const query = { storeId: f.storeId, from: '2026-07-04' };

          // 05/07 23:30 en Chile = 06/07 03:30 UTC.
          const before = await service().listSalesDays(
            query,
            new Date('2026-07-06T03:30:00.000Z'),
          );
          expect(before.today).toBe('2026-07-05');
          expect(statusOn(before, '2026-07-05')?.status).toBe('PENDIENTE');

          // 06/07 00:00 en Chile = 06/07 04:00 UTC.
          const after = await service().listSalesDays(
            query,
            new Date('2026-07-06T04:00:00.000Z'),
          );
          expect(after.today).toBe('2026-07-06');
          expect(statusOn(after, '2026-07-05')?.status).toBe('ATRASADO');
        });
      });
    });

    describe('permisos', () => {
      it('solo el ADMINISTRADOR usa el calendario y el estado de ventas', async () => {
        await withinRollback(async (f) => {
          await call('get', '/sales-days', null).expect(401);
          for (const user of [f.supervisor, f.accountant, f.worker]) {
            await call('get', '/sales-days', user).expect(403);
            await call(
              'get',
              `/stores/${f.storeId}/operating-calendar`,
              user,
            ).expect(403);
            await call('put', `/stores/${f.storeId}/operating-calendar`, user)
              .send({ weekdays: [1], trackingStartDate: daysAgo(1) })
              .expect(403);
            await call('post', `/stores/${f.storeId}/closures`, user)
              .send({ date: daysAgo(1), reason: 'Intento' })
              .expect(403);
          }
          expect(
            await f.tx.storeOperatingSchedule.count({
              where: { storeId: f.storeId },
            }),
          ).toBe(0);
          expect(
            await f.tx.storeClosure.count({ where: { storeId: f.storeId } }),
          ).toBe(0);
        });
      });
    });
  },
);
