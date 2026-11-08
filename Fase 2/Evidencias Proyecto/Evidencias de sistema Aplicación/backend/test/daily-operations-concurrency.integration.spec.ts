import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { AUDIT_ACTION } from '../src/audit/constants/audit-actions.constants.js';
import { ROLE } from '../src/auth/constants/roles.constants.js';
import type { AuthUser, JwtPayload } from '../src/auth/types/auth.types.js';
import type { DailyOperationResponse } from '../src/daily-operations/types/daily-operations.types.js';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { purgeTestAuditLogs } from './helpers/audit-cleanup.js';

type App = Parameters<typeof request>[0];

// Tests de concurrencia HTTP de la operación diaria (SPRINT-4R-T01 y
// SPRINT-4R-T03) contra PostgreSQL real con transacciones reales (sin el
// harness withinRollback: cada solicitud abre su propia transacción y la
// carrera es genuina). Dos POST simultáneos idénticos —incluida la misma
// selección de participantes— no duplican (201 + 200 con el mismo ID, una
// sola fila, una sola selección, un solo voucher y un solo archivo); dos con
// contenido o selección distintos resuelven 201/409 con el ID consultable.
// Los datos van con un local propio por corrida y se eliminan al finalizar
// junto con su auditoría.
const databaseUrl = process.env.TEST_DATABASE_URL;

const BUSINESS_DATE = '2026-03-10';
const STORE_PREFIX = 'Subway Operación Concurrencia';
const DOMAIN = '@daily-concurrency-test.invalid';

// JPEG mínimo con firma real (mismo contenido = mismo hash en ambas cargas).
const JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0xff, 0xd9,
]);

describe.skipIf(!databaseUrl)(
  'Concurrencia de la operación diaria (SPRINT-4R-T01 y SPRINT-4R-T03)',
  { timeout: 60_000 },
  () => {
    let app: INestApplication<App>;
    let jwt: JwtService;
    let prisma: PrismaClient;
    let voucherRoot: string;
    let storeId: string;
    let supervisor: AuthUser;
    let worker: AuthUser;
    let worker2: AuthUser;

    function token(user: AuthUser): string {
      const payload: JwtPayload = {
        sub: user.id,
        email: user.email,
        role: user.role,
        storeId: user.storeId,
      };
      return jwt.sign(payload);
    }

    function post(
      fields: {
        businessDate: string;
        cardTipAmount: number;
        cashTipAmount: number;
        cashDifference: number;
        differenceReason?: string;
      },
      participantIds: string[] = [worker.id, worker2.id],
    ): request.Test {
      let req = request(app.getHttpServer())
        .post('/daily-operations')
        .set('Authorization', `Bearer ${token(supervisor)}`)
        .field('storeId', storeId)
        .field('businessDate', fields.businessDate)
        .field('cardTipAmount', String(fields.cardTipAmount))
        .field('cashTipAmount', String(fields.cashTipAmount))
        .field('cashDifference', String(fields.cashDifference));
      if (fields.differenceReason !== undefined) {
        req = req.field('differenceReason', fields.differenceReason);
      }
      for (const participantId of participantIds) {
        req = req.field('participantIds', participantId);
      }
      return req.attach('voucher', JPEG, 'voucher-terminal-1.jpg');
    }

    async function countStoredFiles(): Promise<number> {
      const vouchersDir = path.join(voucherRoot, 'vouchers');
      try {
        const entries = await fs.readdir(vouchersDir, {
          recursive: true,
          withFileTypes: true,
        });
        return entries.filter((entry) => entry.isFile()).length;
      } catch (error) {
        if (
          error instanceof Error &&
          'code' in error &&
          error.code === 'ENOENT'
        ) {
          return 0;
        }
        throw error;
      }
    }

    beforeAll(async () => {
      process.env.DATABASE_URL = databaseUrl;
      process.env.JWT_SECRET = 'secreto-de-pruebas';
      process.env.JWT_EXPIRES_IN = '1h';
      process.env.JWT_REFRESH_EXPIRES_IN = '7d';
      voucherRoot = await fs.mkdtemp(
        path.join(os.tmpdir(), 'moifood-daily-race-'),
      );
      process.env.DOCUMENTS_STORAGE_PATH = voucherRoot;
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

      const roleRecord = await prisma.role.upsert({
        where: { code: ROLE.SUPERVISOR },
        update: {},
        create: { code: ROLE.SUPERVISOR, name: ROLE.SUPERVISOR },
      });
      const store = await prisma.store.create({
        data: {
          name: `${STORE_PREFIX} ${randomUUID()}`,
          city: 'Melipilla',
          address: 'Calle sintética 123',
        },
      });
      storeId = store.id;
      const id = randomUUID();
      await prisma.user.create({
        data: {
          id,
          email: `${id}${DOMAIN}`,
          passwordHash: '$2b$04$hash-de-prueba',
          firstName: 'Supervisor',
          lastName: 'Concurrencia',
          roleId: roleRecord.id,
          storeId: store.id,
        },
      });
      supervisor = {
        id,
        email: `${id}${DOMAIN}`,
        role: ROLE.SUPERVISOR,
        storeId,
      };

      const workerRole = await prisma.role.upsert({
        where: { code: ROLE.TRABAJADOR },
        update: {},
        create: { code: ROLE.TRABAJADOR, name: ROLE.TRABAJADOR },
      });
      const created: AuthUser[] = [];
      for (const firstName of ['Ana', 'Beto']) {
        const workerId = randomUUID();
        await prisma.user.create({
          data: {
            id: workerId,
            email: `${workerId}${DOMAIN}`,
            passwordHash: '$2b$04$hash-de-prueba',
            firstName,
            lastName: 'Concurrencia',
            roleId: workerRole.id,
            storeId: store.id,
          },
        });
        created.push({
          id: workerId,
          email: `${workerId}${DOMAIN}`,
          role: ROLE.TRABAJADOR,
          storeId,
        });
      }
      [worker, worker2] = created;
    }, 60_000);

    afterAll(async () => {
      // La auditoría es inmutable (Restrict): se purga como mantenimiento con
      // session_replication_role = replica (superusuario de TEST_DATABASE_URL).
      await purgeTestAuditLogs(prisma, {
        OR: [
          { user: { email: { endsWith: DOMAIN } } },
          { store: { name: { startsWith: STORE_PREFIX } } },
        ],
      });
      await prisma.dailyOperation.deleteMany({ where: { storeId } });
      await prisma.dailyOperationVoucher.deleteMany({
        where: { operation: { storeId } },
      });
      await prisma.user.deleteMany({ where: { email: { endsWith: DOMAIN } } });
      await prisma.store.deleteMany({
        where: { name: { startsWith: STORE_PREFIX } },
      });
      await prisma.$disconnect();
      await app.close();
      await fs.rm(voucherRoot, { recursive: true, force: true });
    });

    it('dos POST idénticos simultáneos devuelven el mismo ID sin duplicar', async () => {
      const fields = {
        businessDate: BUSINESS_DATE,
        cardTipAmount: 31602,
        cashTipAmount: 4500,
        cashDifference: -1000,
        differenceReason: 'Faltante por vuelto no registrado',
      };
      // Mismo contenido y mismo archivo: el hash del voucher también coincide.
      const [first, second] = await Promise.all([post(fields), post(fields)]);

      // Uno crea (201) y el reintento idéntico resuelve 200: jamás 500 ni
      // doble 201.
      const statuses = [first.status, second.status].sort();
      expect(statuses).toEqual([200, 201]);
      const created = (
        first.status === 201 ? first.body : second.body
      ) as DailyOperationResponse;
      const retried = (
        first.status === 200 ? first.body : second.body
      ) as DailyOperationResponse;
      expect(created.id).toEqual(expect.any(String));
      expect(retried.id).toBe(created.id);
      // La misma selección (como conjunto) responde en ambas cargas.
      expect(retried.participants).toEqual(created.participants);
      expect(
        created.participants.map((participant) => participant.id).sort(),
      ).toEqual([worker.id, worker2.id].sort());

      // Una sola operación, una sola selección, un solo voucher y una sola
      // auditoría.
      expect(await prisma.dailyOperation.count({ where: { storeId } })).toBe(1);
      const operation = await prisma.dailyOperation.findFirstOrThrow({
        where: { storeId },
      });
      expect(
        await prisma.dailyOperationParticipant.count({
          where: { operationId: operation.id },
        }),
      ).toBe(2);
      expect(
        await prisma.dailyOperationVoucher.count({
          where: { operation: { storeId } },
        }),
      ).toBe(1);
      expect(
        await prisma.auditLog.count({
          where: {
            action: AUDIT_ACTION.DAILY_OPERATION_CREATED,
            storeId,
          },
        }),
      ).toBe(1);

      // Un solo archivo físico: el voucher del perdedor (reintento o carrera
      // P2002) se elimina como mejor esfuerzo.
      expect(await countStoredFiles()).toBe(1);
    });

    it('carrera con contenido distinto: 201 y 409 con existingOperationId', async () => {
      // Otro día de negocio: el test anterior ya registró su operación en
      // BUSINESS_DATE y este escenario necesita una clave natural libre.
      const winnerFields = {
        businessDate: '2026-03-11',
        cardTipAmount: 31602,
        cashTipAmount: 4500,
        cashDifference: -1000,
        differenceReason: 'Faltante por vuelto no registrado',
      };
      const [first, second] = await Promise.all([
        post(winnerFields),
        post({ ...winnerFields, cashTipAmount: 999 }),
      ]);

      const statuses = [first.status, second.status].sort();
      expect(statuses).toEqual([201, 409]);
      const created = (
        first.status === 201 ? first.body : second.body
      ) as DailyOperationResponse;
      const conflict = (first.status === 409 ? first.body : second.body) as {
        statusCode: number;
        error: string;
        existingOperationId: string;
      };
      expect(conflict.statusCode).toBe(409);
      expect(conflict.error).toBe('Conflict');
      expect(conflict.existingOperationId).toBe(created.id);

      // La carrera no deja operación duplicada ni archivo huérfano.
      const raceWhere = {
        storeId,
        businessDate: new Date('2026-03-11T00:00:00.000Z'),
      };
      expect(await prisma.dailyOperation.count({ where: raceWhere })).toBe(1);
      expect(
        await prisma.dailyOperationVoucher.count({
          where: { operation: raceWhere },
        }),
      ).toBe(1);
      // Un archivo por operación creada (10-03 del primer test y 11-03 de
      // este): ningún perdedor deja archivo huérfano.
      expect(await countStoredFiles()).toBe(2);
    });

    it('carrera con selección distinta: 201 y 409 con existingOperationId', async () => {
      // Otro día de negocio: las claves naturales de los tests anteriores ya
      // están registradas. Mismos montos y voucher, pero una selección
      // distinta: no es un reintento idéntico y no sobrescribe la selección.
      const winnerFields = {
        businessDate: '2026-03-12',
        cardTipAmount: 31602,
        cashTipAmount: 4500,
        cashDifference: -1000,
        differenceReason: 'Faltante por vuelto no registrado',
      };
      const [first, second] = await Promise.all([
        post(winnerFields, [worker.id, worker2.id]),
        post(winnerFields, [worker.id]),
      ]);

      const statuses = [first.status, second.status].sort();
      expect(statuses).toEqual([201, 409]);
      const created = (
        first.status === 201 ? first.body : second.body
      ) as DailyOperationResponse;
      const conflict = (first.status === 409 ? first.body : second.body) as {
        statusCode: number;
        error: string;
        existingOperationId: string;
      };
      expect(conflict.statusCode).toBe(409);
      expect(conflict.error).toBe('Conflict');
      expect(conflict.existingOperationId).toBe(created.id);

      // La selección ganadora queda exactamente como se creó: el perdedor no
      // la modificó ni duplicó filas.
      expect(
        created.participants.map((participant) => participant.id).sort(),
      ).toEqual([worker.id, worker2.id].sort());
      const raceWhere = {
        storeId,
        businessDate: new Date('2026-03-12T00:00:00.000Z'),
      };
      expect(await prisma.dailyOperation.count({ where: raceWhere })).toBe(1);
      const operation = await prisma.dailyOperation.findFirstOrThrow({
        where: raceWhere,
      });
      expect(
        await prisma.dailyOperationParticipant.count({
          where: { operationId: operation.id },
        }),
      ).toBe(2);
      // Tres archivos: uno por operación creada (10-03, 11-03 y 12-03).
      expect(await countStoredFiles()).toBe(3);
    });

    it('dos PATCH simultáneos se serializan: nunca 500 ni voucher huérfano', async () => {
      // Sobre la operación del 12-03 (con voucher): una corrección reemplaza
      // la foto y otra deja la tarjeta en 0. El bloqueo de la fila obliga a
      // la segunda a decidir sobre el estado que dejó la primera.
      const operation = await prisma.dailyOperation.findFirstOrThrow({
        where: { storeId, businessDate: new Date('2026-03-12T00:00:00.000Z') },
      });
      const patch = (): request.Test =>
        request(app.getHttpServer())
          .patch(`/daily-operations/${operation.id}`)
          .set('Authorization', `Bearer ${token(supervisor)}`);
      const [replace, clear] = await Promise.all([
        patch().attach('voucher', JPEG, 'voucher-corregido.jpg'),
        patch().field('cardTipAmount', '0'),
      ]);

      // Reemplazo y luego retiro: 200/200. Retiro y luego reemplazo: el
      // reemplazo se rechaza con 400 (tarjeta 0). Jamás un 500.
      expect(clear.status).toBe(200);
      expect([200, 400]).toContain(replace.status);
      const final = await prisma.dailyOperation.findUniqueOrThrow({
        where: { id: operation.id },
      });
      expect(final.cardTipAmount).toBe(BigInt(0));
      expect(final.voucherId).toBeNull();
      expect(
        await prisma.dailyOperationVoucher.count({
          where: { operation: { id: operation.id } },
        }),
      ).toBe(0);
      // Solo quedan los archivos de 10-03 y 11-03: ni el voucher retirado ni
      // el de reemplazo quedan huérfanos en el volumen.
      expect(await countStoredFiles()).toBe(2);
    });
  },
);
