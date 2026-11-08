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
import { PrismaClient } from '../src/generated/prisma/client.js';
import type { OperatingCalendarResponse } from '../src/operating-days/types/operating-days.types.js';
import { purgeTestAuditLogs } from './helpers/audit-cleanup.js';

type App = Parameters<typeof request>[0];

// Tests de concurrencia HTTP del calendario de operación (SPRINT-4R-T12)
// contra PostgreSQL real con transacciones reales (sin el harness
// withinRollback: cada solicitud abre su propia transacción y la carrera es
// genuina). Dos PUT simultáneos al mismo local sin calendario se serializan
// con el bloqueo de la fila del local: ambos responden 200 (nunca P2002 →
// 500), queda una sola fila y el `previous` auditado del segundo es
// exactamente lo que guardó el primero. Los datos van con locales propios
// por corrida y se eliminan al finalizar junto con su auditoría.
const databaseUrl = process.env.TEST_DATABASE_URL;
const STORE_PREFIX = 'Subway Calendario Concurrencia';
const DOMAIN = '@calendar-concurrency-test.invalid';
const ROUNDS = 3;

interface CalendarBody {
  weekdays: number[];
  trackingStartDate: string;
}

const CONFIG_A: CalendarBody = {
  weekdays: [1, 2, 3, 4, 5],
  trackingStartDate: '2026-01-05',
};
const CONFIG_B: CalendarBody = {
  weekdays: [6, 7],
  trackingStartDate: '2026-02-07',
};

interface AuditDetail {
  weekdays: number[];
  trackingStartDate: string;
  previousWeekdays: number[] | null;
  previousTrackingStartDate: string | null;
}

describe.skipIf(!databaseUrl)(
  'Concurrencia del calendario de operación (SPRINT-4R-T12)',
  { timeout: 60_000 },
  () => {
    let app: INestApplication<App>;
    let jwt: JwtService;
    let prisma: PrismaClient;
    let admin: AuthUser;
    let storageRoot: string | undefined;

    function token(user: AuthUser): string {
      const payload: JwtPayload = {
        sub: user.id,
        email: user.email,
        role: user.role,
        storeId: user.storeId,
      };
      return jwt.sign(payload);
    }

    function put(storeId: string, body: CalendarBody): request.Test {
      return request(app.getHttpServer())
        .put(`/stores/${storeId}/operating-calendar`)
        .set('Authorization', `Bearer ${token(admin)}`)
        .send(body);
    }

    async function createStore(): Promise<string> {
      const store = await prisma.store.create({
        data: {
          name: `${STORE_PREFIX} ${randomUUID()}`,
          city: 'Melipilla',
          address: 'Calle sintética 123',
        },
      });
      return store.id;
    }

    beforeAll(async () => {
      process.env.DATABASE_URL = databaseUrl;
      process.env.JWT_SECRET = 'secreto-de-pruebas';
      process.env.JWT_EXPIRES_IN = '1h';
      process.env.JWT_REFRESH_EXPIRES_IN = '7d';
      // AppModule exige la carpeta del gestor documental: se usa una temporal
      // para no depender del .env local.
      storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'moifood-cal-cc-'));
      process.env.DOCUMENTS_STORAGE_PATH = storageRoot;

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
        where: { code: ROLE.ADMINISTRADOR },
        update: {},
        create: { code: ROLE.ADMINISTRADOR, name: ROLE.ADMINISTRADOR },
      });
      const id = randomUUID();
      await prisma.user.create({
        data: {
          id,
          email: `${id}${DOMAIN}`,
          passwordHash: '$2b$04$hash-de-prueba',
          firstName: 'Admin',
          lastName: 'Concurrencia',
          roleId: roleRecord.id,
        },
      });
      admin = {
        id,
        email: `${id}${DOMAIN}`,
        role: ROLE.ADMINISTRADOR,
        storeId: null,
      };
    }, 60_000);

    afterAll(async () => {
      if (storageRoot) {
        await fs.rm(storageRoot, { recursive: true, force: true });
      }
      // Si beforeAll falló antes de crear el cliente o la app, no hay nada
      // que limpiar y se deja visible el error original.
      if (!prisma) {
        await app?.close();
        return;
      }
      // La auditoría es inmutable (Restrict): se purga como mantenimiento con
      // session_replication_role = replica (superusuario de TEST_DATABASE_URL).
      await purgeTestAuditLogs(prisma, {
        OR: [
          { user: { email: { endsWith: DOMAIN } } },
          { store: { name: { startsWith: STORE_PREFIX } } },
        ],
      });
      await prisma.storeOperatingSchedule.deleteMany({
        where: { store: { name: { startsWith: STORE_PREFIX } } },
      });
      await prisma.user.deleteMany({ where: { email: { endsWith: DOMAIN } } });
      await prisma.store.deleteMany({
        where: { name: { startsWith: STORE_PREFIX } },
      });
      await prisma.$disconnect();
      await app.close();
    });

    it('dos PUT simultáneos sin calendario previo se serializan: 200 + 200 y previous exacto', async () => {
      for (let round = 0; round < ROUNDS; round += 1) {
        const storeId = await createStore();

        const [first, second] = await Promise.all([
          put(storeId, CONFIG_A),
          put(storeId, CONFIG_B),
        ]);

        // Ninguno choca con el índice único (P2002 → 500).
        expect([first.status, second.status]).toEqual([200, 200]);
        // Cada PUT responde lo que él mismo guardó, no lo del otro.
        expect(first.body).toMatchObject(CONFIG_A);
        expect(second.body).toMatchObject(CONFIG_B);

        // Una sola fila, con la configuración del que terminó último.
        const schedules = await prisma.storeOperatingSchedule.findMany({
          where: { storeId },
        });
        expect(schedules).toHaveLength(1);
        const saved = (
          await request(app.getHttpServer())
            .get(`/stores/${storeId}/operating-calendar`)
            .set('Authorization', `Bearer ${token(admin)}`)
            .expect(200)
        ).body as OperatingCalendarResponse;
        const last = saved.weekdays.includes(6) ? CONFIG_B : CONFIG_A;
        const firstApplied = last === CONFIG_B ? CONFIG_A : CONFIG_B;
        expect(saved).toMatchObject(last);

        // La auditoría se registra al responder: dos entradas, la primera
        // sin configuración anterior y la segunda con exactamente lo que
        // guardó la primera (sin `previous` desfasado).
        await expect
          .poll(() =>
            prisma.auditLog.count({
              where: {
                storeId,
                action: AUDIT_ACTION.STORE_OPERATING_CALENDAR_UPDATED,
              },
            }),
          )
          .toBe(2);
        const details = (
          await prisma.auditLog.findMany({
            where: {
              storeId,
              action: AUDIT_ACTION.STORE_OPERATING_CALENDAR_UPDATED,
            },
            select: { detail: true },
          })
        ).map((log) => log.detail as unknown as AuditDetail);
        const initial = details.find(
          (detail) => detail.previousWeekdays === null,
        );
        const replacement = details.find(
          (detail) => detail.previousWeekdays !== null,
        );
        expect(initial).toMatchObject({
          weekdays: firstApplied.weekdays,
          trackingStartDate: firstApplied.trackingStartDate,
          previousTrackingStartDate: null,
        });
        expect(replacement).toMatchObject({
          weekdays: last.weekdays,
          trackingStartDate: last.trackingStartDate,
          previousWeekdays: firstApplied.weekdays,
          previousTrackingStartDate: firstApplied.trackingStartDate,
        });
      }
    });
  },
);
