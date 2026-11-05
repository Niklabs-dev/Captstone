import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { AUDIT_ACTION } from '../src/audit/constants/audit-actions.constants.js';
import { ROLE, type RoleCode } from '../src/auth/constants/roles.constants.js';
import type { JwtPayload } from '../src/auth/types/auth.types.js';
import { PrismaClient } from '../src/generated/prisma/client.js';
import type { PaymentMethodResponse } from '../src/payment-methods/types/payment-methods.types.js';
import { purgeTestAuditLogs } from './helpers/audit-cleanup.js';

type App = Parameters<typeof request>[0];

// Tests de integración HTTP del catálogo de medios de pago (SPRINT-4-T32).
// Requieren TEST_DATABASE_URL (PostgreSQL real); sin él se omiten.
const databaseUrl = process.env.TEST_DATABASE_URL;
const DOMAIN = '@payment-methods-test.moi-food.cl';
const STORE_NAME = 'Subway PaymentMethods Test';
const CODES = ['PM_CASH', 'PM_DEBIT', 'PM_JUNAEB'] as const;

interface ErrorResponse {
  message: string | string[];
}

describe.skipIf(!databaseUrl)(
  'Catálogo de medios de pago (SPRINT-4-T32)',
  () => {
    let app: INestApplication<App>;
    let prisma: PrismaClient;
    let jwt: JwtService;
    let adminToken: string;
    let adminId: string;
    let supervisorToken: string;
    let workerToken: string;

    async function cleanup(): Promise<void> {
      await purgeTestAuditLogs(prisma, {
        user: { email: { endsWith: DOMAIN } },
      });
      await prisma.user.deleteMany({ where: { email: { endsWith: DOMAIN } } });
      // Solo medios sin referencias: otros archivos crean líneas de cierre
      // comprometidas con todos los medios activos y esas filas (Restrict)
      // retienen el medio hasta que su propia limpieza las elimina.
      await prisma.paymentMethod.deleteMany({
        where: {
          code: { in: [...CODES] },
          cashClosingLines: { none: {} },
          sales: { none: {} },
          tipEntries: { none: {} },
        },
      });
      await prisma.store.deleteMany({
        where: { name: { contains: STORE_NAME, mode: 'insensitive' } },
      });
    }

    beforeAll(async () => {
      process.env.DATABASE_URL = databaseUrl;
      process.env.JWT_SECRET = 'secreto-de-pruebas';
      process.env.JWT_EXPIRES_IN = '1h';
      process.env.JWT_REFRESH_EXPIRES_IN = '7d';
      process.env.DOCUMENTS_STORAGE_PATH = './storage/test-documents';

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
      await cleanup();

      for (const code of Object.values(ROLE)) {
        await prisma.role.upsert({
          where: { code },
          update: {},
          create: { code, name: code },
        });
      }
      const adminRole = await prisma.role.findUniqueOrThrow({
        where: { code: ROLE.ADMINISTRADOR },
      });
      const supervisorRole = await prisma.role.findUniqueOrThrow({
        where: { code: ROLE.SUPERVISOR },
      });
      const workerRole = await prisma.role.findUniqueOrThrow({
        where: { code: ROLE.TRABAJADOR },
      });
      const store = await prisma.store.create({
        data: {
          name: STORE_NAME,
          city: 'Melipilla',
          address: 'Calle de prueba 123',
        },
      });

      const admin = await prisma.user.create({
        data: {
          email: `admin${DOMAIN}`,
          passwordHash: '$2b$04$hash-de-prueba',
          firstName: 'Admin',
          lastName: 'PaymentMethods',
          roleId: adminRole.id,
        },
      });
      adminId = admin.id;
      adminToken = await tokenFor(adminId, ROLE.ADMINISTRADOR, null);

      const supervisor = await prisma.user.create({
        data: {
          email: `supervisor${DOMAIN}`,
          passwordHash: '$2b$04$hash-de-prueba',
          firstName: 'Supervisor',
          lastName: 'PaymentMethods',
          roleId: supervisorRole.id,
          storeId: store.id,
        },
      });
      supervisorToken = await tokenFor(
        supervisor.id,
        ROLE.SUPERVISOR,
        store.id,
      );

      const worker = await prisma.user.create({
        data: {
          email: `worker${DOMAIN}`,
          passwordHash: '$2b$04$hash-de-prueba',
          firstName: 'Trabajador',
          lastName: 'PaymentMethods',
          roleId: workerRole.id,
          storeId: store.id,
        },
      });
      workerToken = await tokenFor(worker.id, ROLE.TRABAJADOR, store.id);
    }, 60_000);

    afterAll(async () => {
      await cleanup();
      await prisma.$disconnect();
      await app.close();
    });

    function tokenFor(
      sub: string,
      role: RoleCode,
      tokenStoreId: string | null,
    ): Promise<string> {
      const payload: JwtPayload = {
        sub,
        email: `token${DOMAIN}`,
        role,
        storeId: tokenStoreId,
      };
      return jwt.signAsync(payload);
    }

    function listPaymentMethods(query = '', token = adminToken) {
      return request(app.getHttpServer())
        .get(`/payment-methods${query}`)
        .set('Authorization', `Bearer ${token}`);
    }

    function createPaymentMethod(body: object, token = adminToken) {
      return request(app.getHttpServer())
        .post('/payment-methods')
        .set('Authorization', `Bearer ${token}`)
        .send(body);
    }

    function updatePaymentMethod(id: string, body: object, token = adminToken) {
      return request(app.getHttpServer())
        .patch(`/payment-methods/${id}`)
        .set('Authorization', `Bearer ${token}`)
        .send(body);
    }

    function changeState(
      id: string,
      action: 'deactivate' | 'reactivate',
      token = adminToken,
    ) {
      return request(app.getHttpServer())
        .patch(`/payment-methods/${id}/${action}`)
        .set('Authorization', `Bearer ${token}`);
    }

    it('crea, lista con filtros, edita y audita el ciclo completo', async () => {
      const created = await createPaymentMethod({
        code: ' pm_cash ',
        name: 'Efectivo test',
        sortOrder: 10,
        behavior: 'CASH',
        availableForTips: true,
      }).expect(201);
      const createdBody = created.body as PaymentMethodResponse;
      expect(createdBody).toMatchObject({
        code: 'PM_CASH',
        name: 'Efectivo test',
        isActive: true,
        behavior: 'CASH',
        availableForTips: true,
      });

      const audit = await prisma.auditLog.findMany({
        where: {
          action: AUDIT_ACTION.PAYMENT_METHOD_CREATED,
          user: { email: `admin${DOMAIN}` },
        },
      });
      expect(audit).toHaveLength(1);
      expect(audit[0].entityType).toBe('payment_methods');
      expect(audit[0].entityId).toBe(createdBody.id);
      expect(audit[0].detail).toMatchObject({ code: 'PM_CASH' });
      // Lista blanca: el detalle no trae campos ajenos al contrato.
      expect(Object.keys(audit[0].detail as object).sort()).toEqual([
        'availableForTips',
        'behavior',
        'code',
        'name',
        'sortOrder',
      ]);
    });

    it('rechaza la creación con código duplicado o datos inválidos', async () => {
      await createPaymentMethod({
        code: 'PM_DEBIT',
        name: 'Débito test',
        sortOrder: 20,
        behavior: 'RECONCILABLE_CARD',
        availableForTips: true,
      }).expect(201);

      const duplicated = await createPaymentMethod({
        code: 'PM_DEBIT',
        name: 'Otro débito',
        sortOrder: 21,
        behavior: 'RECONCILABLE_CARD',
        availableForTips: true,
      }).expect(409);
      expect((duplicated.body as ErrorResponse).message).toEqual(
        expect.any(String),
      );

      await createPaymentMethod({
        code: '1',
        name: 'Sin letras',
        sortOrder: 0,
        behavior: 'CASH',
        availableForTips: false,
      }).expect(400);

      await createPaymentMethod({
        code: 'PM_JUNAEB',
        name: 'Junaeb',
        sortOrder: 30,
        behavior: 'EXTERNAL_OTHER',
        availableForTips: 'no-boolean',
      }).expect(400);
    });

    it('restringe las mutaciones al ADMINISTRADOR', async () => {
      const body = {
        code: 'PM_JUNAEB',
        name: 'Junaeb test',
        sortOrder: 40,
        behavior: 'EXTERNAL_OTHER',
        availableForTips: false,
      };
      await createPaymentMethod(body, supervisorToken).expect(403);
      await createPaymentMethod(body, workerToken).expect(403);

      const listed = await listPaymentMethods().expect(200);
      const anyMethod = (listed.body as { id: string }[])[0];
      await updatePaymentMethod(
        anyMethod.id,
        { name: 'Otro' },
        supervisorToken,
      ).expect(403);
      await request(app.getHttpServer())
        .patch(`/payment-methods/${anyMethod.id}/deactivate`)
        .set('Authorization', `Bearer ${workerToken}`)
        .expect(403);

      await request(app.getHttpServer()).get('/payment-methods').expect(401);
    });

    it('lista activos, inactivos y elegibles para propinas con orden estable', async () => {
      const junaeb = await createPaymentMethod({
        code: 'PM_JUNAEB',
        name: 'Junaeb test',
        sortOrder: 5,
        behavior: 'EXTERNAL_OTHER',
        availableForTips: false,
      }).expect(201);
      const junaebBody = junaeb.body as PaymentMethodResponse;
      await changeState(junaebBody.id, 'deactivate').expect(200);

      const all = await listPaymentMethods().expect(200);
      const allCodes = (all.body as { code: string }[]).map((m) => m.code);
      expect(allCodes).toEqual(expect.arrayContaining([...CODES]));

      const inactive = await listPaymentMethods('?isActive=false').expect(200);
      expect(
        (inactive.body as { code: string; isActive: boolean }[]).map(
          (m) => m.code,
        ),
      ).toContain('PM_JUNAEB');

      const active = await listPaymentMethods('?isActive=true').expect(200);
      const activeCodes = (active.body as { code: string }[]).map(
        (m) => m.code,
      );
      expect(activeCodes).toContain('PM_CASH');
      expect(activeCodes).not.toContain('PM_JUNAEB');

      const eligible = await listPaymentMethods(
        '?availableForTips=true',
      ).expect(200);
      const eligibleCodes = (eligible.body as { code: string }[]).map(
        (m) => m.code,
      );
      expect(eligibleCodes).not.toContain('PM_JUNAEB');
    });

    it('edita nombre, orden y comportamiento y conserva el código', async () => {
      const listed = await listPaymentMethods('?isActive=true').expect(200);
      const cash = (listed.body as { id: string; code: string }[]).find(
        (m) => m.code === 'PM_CASH',
      );
      if (!cash) throw new Error('PM_CASH no fue creado en el test previo');

      const updated = await updatePaymentMethod(cash.id, {
        name: 'Efectivo principal',
        sortOrder: 1,
        behavior: 'CASH',
        availableForTips: false,
      }).expect(200);
      expect(updated.body).toMatchObject({
        code: 'PM_CASH',
        name: 'Efectivo principal',
        sortOrder: 1,
        availableForTips: false,
      });

      await updatePaymentMethod(cash.id, {}).expect(400);
      await updatePaymentMethod('00000000-0000-4000-8000-000000000000', {
        name: 'Nadie',
      }).expect(404);
    });

    it('desactiva y reactiva de forma idempotente auditando una sola vez', async () => {
      const listed = await listPaymentMethods('?isActive=true').expect(200);
      const debit = (listed.body as { id: string; code: string }[]).find(
        (m) => m.code === 'PM_DEBIT',
      );
      if (!debit) throw new Error('PM_DEBIT no fue creado en el test previo');

      await changeState(debit.id, 'deactivate').expect(200);
      const again = await changeState(debit.id, 'deactivate').expect(200);
      expect(again.body).toMatchObject({ isActive: false });

      const deactivations = await prisma.auditLog.findMany({
        where: {
          action: AUDIT_ACTION.PAYMENT_METHOD_DEACTIVATED,
          entityId: debit.id,
          user: { email: `admin${DOMAIN}` },
        },
      });
      expect(deactivations).toHaveLength(1);
      expect(deactivations[0].entityId).toBe(debit.id);

      const reactivated = await changeState(debit.id, 'reactivate').expect(200);
      expect(reactivated.body).toMatchObject({ isActive: true });
    });
  },
);
