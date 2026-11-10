import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomInt, randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { AUDIT_ACTION } from '../src/audit/constants/audit-actions.constants.js';
import { ROLE, type RoleCode } from '../src/auth/constants/roles.constants.js';
import type { AuthUser, JwtPayload } from '../src/auth/types/auth.types.js';
import { Prisma, PrismaClient } from '../src/generated/prisma/client.js';
import type { PaymentMethodAliasResponse } from '../src/payment-methods/aliases/payment-method-aliases.types.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  createSwitchablePrisma,
  type SwitchablePrisma,
} from './helpers/switchable-prisma.js';

type App = Parameters<typeof request>[0];
type Tx = Prisma.TransactionClient;

// API de alias de medios de pago (SPRINT-4A-T20) contra PostgreSQL real:
// listar, crear con normalización y unicidad, eliminar, auditoría, permisos
// (solo ADMINISTRADOR) y que corregir un alias no reescribe importaciones ya
// confirmadas. Todo corre en withinRollback.
const databaseUrl = process.env.TEST_DATABASE_URL;

class Rollback extends Error {
  constructor() {
    super('rollback de prueba');
    this.name = 'Rollback';
  }
}

interface Fixture {
  tx: Tx;
  admin: AuthUser;
  accountant: AuthUser;
  methodId: string;
  otherMethodId: string;
  inactiveMethodId: string;
  // Etiqueta propia de la corrida, para no chocar con otras suites.
  label: string;
}

function letters(length: number): string {
  return Array.from({ length }, () =>
    String.fromCharCode(65 + randomInt(0, 26)),
  ).join('');
}

describe.skipIf(!databaseUrl)(
  'API de alias de medios de pago (SPRINT-4A-T20)',
  { timeout: 60_000 },
  () => {
    let app: INestApplication<App>;
    let jwt: JwtService;
    let prisma: PrismaClient;
    let switchable: SwitchablePrisma;

    function as(user: AuthUser | null, req: request.Test): request.Test {
      if (!user) return req;
      const payload: JwtPayload = {
        sub: user.id,
        email: user.email,
        role: user.role,
        storeId: user.storeId,
      };
      return req.set('Authorization', `Bearer ${jwt.sign(payload)}`);
    }
    function list(user: AuthUser | null): request.Test {
      return as(
        user,
        request(app.getHttpServer()).get('/payment-method-aliases'),
      );
    }
    function create(user: AuthUser | null, body: object): request.Test {
      return as(
        user,
        request(app.getHttpServer()).post('/payment-method-aliases'),
      ).send(body);
    }
    function remove(user: AuthUser | null, id: string): request.Test {
      return as(
        user,
        request(app.getHttpServer()).delete(`/payment-method-aliases/${id}`),
      );
    }

    async function createUser(tx: Tx, role: RoleCode): Promise<AuthUser> {
      const roleRecord = await tx.role.upsert({
        where: { code: role },
        update: {},
        create: { code: role, name: role },
      });
      const id = randomUUID();
      const email = `${id}@aliases-test.invalid`;
      await tx.user.create({
        data: {
          id,
          email,
          passwordHash: '$2b$04$hash-de-prueba',
          firstName: role,
          lastName: 'Alias',
          roleId: roleRecord.id,
        },
      });
      return { id, email, role, storeId: null };
    }

    async function method(tx: Tx, isActive: boolean): Promise<{ id: string }> {
      return tx.paymentMethod.create({
        data: {
          code: `T20_${letters(8)}`,
          name: `Medio T20 ${letters(4)}`,
          sortOrder: 980,
          behavior: 'EXTERNAL_OTHER',
          isActive,
        },
        select: { id: true },
      });
    }

    async function withinRollback(
      run: (fixture: Fixture) => Promise<void>,
    ): Promise<void> {
      try {
        await prisma.$transaction(
          async (tx) => {
            switchable.use(tx);
            await run({
              tx,
              admin: await createUser(tx, ROLE.ADMINISTRADOR),
              accountant: await createUser(tx, ROLE.CONTADOR),
              methodId: (await method(tx, true)).id,
              otherMethodId: (await method(tx, true)).id,
              inactiveMethodId: (await method(tx, false)).id,
              label: `N.de Créd. ${letters(6)}`,
            });
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
      process.env.DOCUMENTS_STORAGE_PATH ??= './storage/test-documents';
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

    it('crea un alias con la etiqueta normalizada, lo lista y lo audita', async () => {
      await withinRollback(async (f) => {
        const created = await create(f.admin, {
          label: `  ${f.label}   `,
          paymentMethodId: f.methodId,
        })
          .expect(201)
          .then((response) => response.body as PaymentMethodAliasResponse);
        const suffix = f.label.slice(-6);
        expect(created).toMatchObject({
          system: 'MRCOMANDA',
          label: f.label,
          normalizedLabel: `N.DE CRED. ${suffix}`,
          paymentMethod: { id: f.methodId, isActive: true },
        });

        const all = await list(f.admin)
          .expect(200)
          .then((response) => response.body as PaymentMethodAliasResponse[]);
        expect(all.map((alias) => alias.id)).toContain(created.id);

        const audit = await f.tx.auditLog.findFirstOrThrow({
          where: {
            action: AUDIT_ACTION.PAYMENT_METHOD_ALIAS_CREATED,
            entityId: created.id,
          },
        });
        expect(audit.userId).toBe(f.admin.id);
        expect(audit.detail).toMatchObject({
          label: f.label,
          normalizedLabel: created.normalizedLabel,
          paymentMethodId: f.methodId,
          source: 'payment_methods',
        });
      });
    });

    it('una etiqueta resuelve un solo medio: la misma etiqueta normalizada responde 409', async () => {
      await withinRollback(async (f) => {
        await create(f.admin, {
          label: f.label,
          paymentMethodId: f.methodId,
        }).expect(201);
        const conflict = await create(f.admin, {
          label: f.label.toUpperCase().replace('É', 'E'),
          paymentMethodId: f.otherMethodId,
        }).expect(409);
        expect(conflict.body).toMatchObject({
          message: expect.stringContaining('ya está asociada') as string,
        });
      });
    });

    it('valida etiqueta, medio existente y activo', async () => {
      await withinRollback(async (f) => {
        await create(f.admin, {
          label: '   ',
          paymentMethodId: f.methodId,
        }).expect(400);
        await create(f.admin, {
          label: 'X'.repeat(101),
          paymentMethodId: f.methodId,
        }).expect(400);
        await create(f.admin, { label: f.label, paymentMethodId: 'x' }).expect(
          400,
        );
        await create(f.admin, {
          label: f.label,
          paymentMethodId: f.methodId,
          extra: true,
        }).expect(400);
        await create(f.admin, {
          label: f.label,
          paymentMethodId: f.inactiveMethodId,
        }).expect(400);
        await create(f.admin, {
          label: f.label,
          paymentMethodId: randomUUID(),
        }).expect(404);
        expect(
          await f.tx.paymentMethodAlias.count({
            where: { label: { contains: f.label.slice(-6) } },
          }),
        ).toBe(0);
      });
    });

    it('corregir un alias (quitar y asociar a otro medio) no cambia importaciones confirmadas', async () => {
      await withinRollback(async (f) => {
        const wrong = await create(f.admin, {
          label: f.label,
          paymentMethodId: f.methodId,
        })
          .expect(201)
          .then((response) => response.body as PaymentMethodAliasResponse);

        // Importación confirmada con el alias equivocado.
        const subwayStoreId = String(randomInt(1_000_000_000, 9_999_999_999));
        const store = await f.tx.store.create({
          data: {
            name: `Subway Alias ${randomUUID()}`,
            city: 'Melipilla',
            address: 'Calle sintética 1',
            subwayStoreId,
          },
        });
        const header = await f.tx.salesImport.create({
          data: {
            storeId: store.id,
            businessDate: new Date('2026-03-14T00:00:00.000Z'),
            periodStart: new Date('2026-03-14T03:00:00.000Z'),
            periodEnd: new Date('2026-03-15T02:59:59.000Z'),
            externalStoreCode: `208 - ${subwayStoreId}`,
            subwayStoreId,
            version: 1,
            totalAmount: 1000n,
            fileName: 'ventas.xlsx',
            filePath: `sales-imports/${randomUUID()}.xlsx`,
            mimeType: 'application/octet-stream',
            sizeBytes: 10n,
            sha256Hash: 'c'.repeat(64),
            uploadedById: f.admin.id,
          },
        });
        await f.tx.salesImportLine.create({
          data: {
            importId: header.id,
            lineNumber: 1,
            originalLabel: f.label,
            normalizedLabel: wrong.normalizedLabel,
            amount: 1000n,
            paymentMethodId: f.methodId,
          },
        });
        await f.tx.salesImport.update({
          where: { id: header.id },
          data: {
            status: 'ACTIVE',
            isCurrent: true,
            confirmedAt: new Date(),
            confirmedById: f.admin.id,
          },
        });

        const removed = await remove(f.admin, wrong.id)
          .expect(200)
          .then((response) => response.body as PaymentMethodAliasResponse);
        expect(removed.id).toBe(wrong.id);
        await create(f.admin, {
          label: f.label,
          paymentMethodId: f.otherMethodId,
        }).expect(201);

        const line = await f.tx.salesImportLine.findFirstOrThrow({
          where: { importId: header.id },
        });
        expect(line.paymentMethodId).toBe(f.methodId);
        const audit = await f.tx.auditLog.findFirstOrThrow({
          where: {
            action: AUDIT_ACTION.PAYMENT_METHOD_ALIAS_DELETED,
            entityId: wrong.id,
          },
        });
        expect(audit.detail).toMatchObject({
          label: f.label,
          paymentMethodId: f.methodId,
        });
        await remove(f.admin, wrong.id).expect(404);
        await remove(f.admin, 'x').expect(400);
      });
    });

    it('solo el ADMINISTRADOR consulta y modifica los alias', async () => {
      await withinRollback(async (f) => {
        await list(null).expect(401);
        await list(f.accountant).expect(403);
        await create(f.accountant, {
          label: f.label,
          paymentMethodId: f.methodId,
        }).expect(403);
        await remove(f.accountant, randomUUID()).expect(403);
      });
    });
  },
);
