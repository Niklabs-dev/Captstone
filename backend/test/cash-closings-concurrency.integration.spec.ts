import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { AUDIT_ACTION } from '../src/audit/constants/audit-actions.constants.js';
import { ROLE } from '../src/auth/constants/roles.constants.js';
import type { AuthUser, JwtPayload } from '../src/auth/types/auth.types.js';
import { PrismaClient } from '../src/generated/prisma/client.js';
import type { CashClosingResponse } from '../src/cash-closings/types/cash-closings.types.js';
import { purgeTestAuditLogs } from './helpers/audit-cleanup.js';

type App = Parameters<typeof request>[0];

const databaseUrl = process.env.TEST_DATABASE_URL;
const DOMAIN = '@cash-closings-concurrency-test.invalid';
const STORE_PREFIX = 'Subway Cierre Concurrencia Test';
const START = '2026-03-10T08:00:00-03:00';
const END = '2026-03-10T16:00:00-03:00';

interface Fixture {
  storeId: string;
  otherStoreId: string;
  supervisor: AuthUser;
  supervisorTwo: AuthUser;
  otherSupervisor: AuthUser;
}

interface ConflictBody {
  statusCode: number;
  message: string;
  error: string;
  existingClosingId?: string;
}

function payload(storeId: string, shift = 1): Record<string, unknown> {
  return {
    storeId,
    businessDate: '2026-03-10',
    shift,
    openingCash: 0,
    lines: [
      { paymentMethod: 'CASH', countedAmount: 0 },
      { paymentMethod: 'DEBIT_CARD', countedAmount: 0 },
      { paymentMethod: 'CREDIT_CARD', countedAmount: 0 },
      { paymentMethod: 'TRANSFER', countedAmount: 0 },
    ],
    vouchers: [
      {
        source: 'MRCOMANDA',
        periodStart: START,
        periodEnd: END,
        amount: 0,
      },
      {
        source: 'MERCADO_PAGO',
        periodStart: START,
        periodEnd: END,
        amount: 0,
      },
    ],
  };
}

describe.skipIf(!databaseUrl)(
  'Concurrencia de cierres de caja (SPRINT-4-T10)',
  { timeout: 60_000 },
  () => {
    let app: INestApplication<App>;
    let jwt: JwtService;
    let prisma: PrismaClient;
    let fixture: Fixture;

    function token(user: AuthUser): string {
      const payload: JwtPayload = {
        sub: user.id,
        email: user.email,
        role: user.role,
        storeId: user.storeId,
      };
      return jwt.sign(payload);
    }

    function post(body: object, user: AuthUser) {
      return request(app.getHttpServer())
        .post('/cash-closings')
        .set('Authorization', `Bearer ${token(user)}`)
        .send(body);
    }

    function get(id: string, user: AuthUser) {
      return request(app.getHttpServer())
        .get(`/cash-closings/${id}`)
        .set('Authorization', `Bearer ${token(user)}`);
    }

    async function createUser(storeId: string | null): Promise<AuthUser> {
      const role = await prisma.role.upsert({
        where: { code: ROLE.SUPERVISOR },
        update: {},
        create: { code: ROLE.SUPERVISOR, name: ROLE.SUPERVISOR },
      });
      const id = randomUUID();
      const email = `${id}${DOMAIN}`;
      await prisma.user.create({
        data: {
          id,
          email,
          passwordHash: '$2b$04$hash-de-prueba',
          firstName: 'Supervisor',
          lastName: 'Concurrencia',
          roleId: role.id,
          storeId,
        },
      });
      return { id, email, role: ROLE.SUPERVISOR, storeId };
    }

    async function cleanup(): Promise<void> {
      const storeWhere = { name: { startsWith: STORE_PREFIX } };
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
        await tx.sale.deleteMany({ where: { store: storeWhere } });
        await tx.cashClosing.deleteMany({ where: { store: storeWhere } });
        await tx.tipEntry.deleteMany({ where: { store: storeWhere } });
      });
      await purgeTestAuditLogs(prisma, {
        OR: [{ user: { email: { endsWith: DOMAIN } } }, { store: storeWhere }],
      });
      await prisma.user.deleteMany({
        where: { email: { endsWith: DOMAIN } },
      });
      await prisma.store.deleteMany({ where: storeWhere });
    }

    function closingCount(storeId: string): Promise<number> {
      return prisma.cashClosing.count({ where: { storeId } });
    }

    function closingAudits(id: string) {
      return prisma.auditLog.findMany({
        where: { entityType: 'cash_closings', entityId: id },
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

    beforeEach(async () => {
      await cleanup();
      const store = await prisma.store.create({
        data: {
          name: `${STORE_PREFIX} ${randomUUID()}`,
          city: 'Melipilla',
          address: 'Calle sintética 123',
        },
      });
      const otherStore = await prisma.store.create({
        data: {
          name: `${STORE_PREFIX} Otro ${randomUUID()}`,
          city: 'Calera',
          address: 'Calle sintética 456',
        },
      });
      fixture = {
        storeId: store.id,
        otherStoreId: otherStore.id,
        supervisor: await createUser(store.id),
        supervisorTwo: await createUser(store.id),
        otherSupervisor: await createUser(otherStore.id),
      };
    });

    afterEach(async () => {
      await cleanup();
    });

    afterAll(async () => {
      await cleanup();
      await prisma.$disconnect();
      await app.close();
    });

    it('un reintento idéntico devuelve el existente y un cambio ofrece consultarlo', async () => {
      const body = payload(fixture.storeId);
      const first = (await post(body, fixture.supervisor).expect(201))
        .body as CashClosingResponse;
      const retry = (await post(body, fixture.supervisor).expect(200))
        .body as CashClosingResponse;
      expect(retry.id).toBe(first.id);
      expect(retry.closedAt).toBe(first.closedAt);

      const conflict = await post(
        { ...body, notes: 'Solicitud distinta' },
        fixture.supervisor,
      ).expect(409);
      const conflictBody = conflict.body as ConflictBody;
      expect(conflictBody).toMatchObject({
        statusCode: 409,
        error: 'Conflict',
        existingClosingId: first.id,
      });
      expect(conflictBody.message).toContain('local, fecha y turno');
      const found = (
        await get(
          conflictBody.existingClosingId as string,
          fixture.supervisor,
        ).expect(200)
      ).body as CashClosingResponse;
      expect(found.id).toBe(first.id);
      expect(found.notes).toBeNull();

      const otherResponsible = await post(body, fixture.supervisorTwo).expect(
        409,
      );
      expect((otherResponsible.body as ConflictBody).existingClosingId).toBe(
        first.id,
      );
      expect(await closingCount(fixture.storeId)).toBe(1);
      const audits = await closingAudits(first.id);
      expect(audits).toHaveLength(1);
      expect(audits[0].action).toBe(AUDIT_ACTION.CASH_CLOSING_CREATED);
    });

    it('dos reintentos idénticos concurrentes crean una sola fila y una auditoría', async () => {
      const body = payload(fixture.storeId, 2);
      const responses = await Promise.all([
        post(body, fixture.supervisor),
        post(body, fixture.supervisor),
      ]);
      expect(responses.map((response) => response.status).sort()).toEqual([
        200, 201,
      ]);
      const bodies = responses.map(
        (response) => response.body as CashClosingResponse,
      );
      expect(bodies[0].id).toBe(bodies[1].id);
      expect(await closingCount(fixture.storeId)).toBe(1);
      expect(await closingAudits(bodies[0].id)).toHaveLength(1);
    });

    it('dos cierres distintos concurrentes dejan uno y el otro recibe su ID', async () => {
      const firstBody = payload(fixture.storeId, 3);
      const secondBody = { ...firstBody, notes: 'Cierre concurrente distinto' };
      const responses = await Promise.all([
        post(firstBody, fixture.supervisor),
        post(secondBody, fixture.supervisor),
      ]);
      expect(responses.map((response) => response.status).sort()).toEqual([
        201, 409,
      ]);
      const createdResponse = responses.find(
        (response) => response.status === 201,
      );
      const conflictResponse = responses.find(
        (response) => response.status === 409,
      );
      if (!createdResponse || !conflictResponse) {
        throw new Error('Faltan las respuestas de concurrencia esperadas');
      }
      const created = createdResponse.body as CashClosingResponse;
      const conflict = conflictResponse.body as ConflictBody;
      expect(conflict.existingClosingId).toBe(created.id);
      expect(await closingCount(fixture.storeId)).toBe(1);
      expect(await closingAudits(created.id)).toHaveLength(1);
      await get(created.id, fixture.supervisor).expect(200);
    });

    it('la misma fecha y turno sí están permitidos en otro local', async () => {
      const responses = await Promise.all([
        post(payload(fixture.storeId, 4), fixture.supervisor),
        post(payload(fixture.otherStoreId, 4), fixture.otherSupervisor),
      ]);
      for (const response of responses) {
        expect(response.status).toBe(201);
      }
      const bodies = responses.map(
        (response) => response.body as CashClosingResponse,
      );
      expect(bodies[0].id).not.toBe(bodies[1].id);
      expect(await closingCount(fixture.storeId)).toBe(1);
      expect(await closingCount(fixture.otherStoreId)).toBe(1);
    });
  },
);
