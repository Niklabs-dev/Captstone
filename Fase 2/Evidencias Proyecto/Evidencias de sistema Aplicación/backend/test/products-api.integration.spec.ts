import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { AUDIT_ACTION } from '../src/audit/constants/audit-actions.constants.js';
import { ROLE, type RoleCode } from '../src/auth/constants/roles.constants.js';
import type { JwtPayload } from '../src/auth/types/auth.types.js';
import {
  InventoryTemplateRowKind,
  Prisma,
  PrismaClient,
} from '../src/generated/prisma/client.js';
import type { ProductResponse } from '../src/inventory/types/products.types.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  createSwitchablePrisma,
  type SwitchablePrisma,
} from './helpers/switchable-prisma.js';

type App = Parameters<typeof request>[0];
type Tx = Prisma.TransactionClient;

// API de productos de inventario (SPRINT-5-T03) por HTTP contra PostgreSQL
// real. Cada caso arma su propia plantilla en posiciones altas y corre dentro
// de withinRollback (helpers/switchable-prisma.ts): la base se revierte.
// Requieren TEST_DATABASE_URL; sin él se omiten.
const databaseUrl = process.env.TEST_DATABASE_URL;
const DOMAIN = '@products-test.moi-food.cl';
const BASE = 60_000;

class Rollback extends Error {}

interface FieldErrorsBody {
  errors: Record<string, string>;
}
const errorsOf = (body: unknown): Record<string, string> =>
  (body as FieldErrorsBody).errors;

interface Fixture {
  tx: Tx;
  admin: string;
  supervisor: string;
  worker: string;
  adminId: string;
  sectionA: string;
  sectionB: string;
  printedProductId: string;
}

describe.skipIf(!databaseUrl)(
  'API de productos de inventario (SPRINT-5-T03)',
  () => {
    let app: INestApplication<App>;
    let prisma: PrismaClient;
    let jwt: JwtService;
    let switchable: SwitchablePrisma;

    async function user(tx: Tx, role: RoleCode) {
      const roleRow = await tx.role.upsert({
        where: { code: role },
        update: {},
        create: { code: role, name: role },
      });
      const created = await tx.user.create({
        data: {
          email: `${role.toLowerCase()}-${randomUUID()}${DOMAIN}`,
          passwordHash: '$2b$04$hash-de-prueba',
          firstName: role,
          lastName: 'Productos',
          roleId: roleRow.id,
        },
      });
      const payload: JwtPayload = {
        sub: created.id,
        email: created.email,
        role,
        storeId: null,
      };
      return { id: created.id, token: await jwt.signAsync(payload) };
    }

    // Sección A: un artículo impreso y una fila «<Vacío>» libre.
    // Sección B: sin filas libres.
    async function fixture(tx: Tx): Promise<Fixture> {
      const suffix = randomUUID().slice(0, 8);
      const sectionA = `SECCIÓN A ${suffix}`;
      const sectionB = `SECCIÓN B ${suffix}`;
      const printed = await tx.product.create({
        data: { name: `Artículo impreso ${suffix}`, unit: 'KG' },
        select: { id: true },
      });
      const rows: Prisma.InventoryTemplateRowCreateManyInput[] = [
        {
          position: BASE + 1,
          kind: InventoryTemplateRowKind.ITEM,
          printedText: `Artículo impreso ${suffix}`,
          section: sectionA,
          productId: printed.id,
        },
        {
          position: BASE + 2,
          kind: InventoryTemplateRowKind.ITEM,
          printedText: '<Vacío>',
          section: sectionA,
        },
        {
          position: BASE + 3,
          kind: InventoryTemplateRowKind.SECTION,
          printedText: sectionA,
          section: sectionA,
        },
        {
          position: BASE + 4,
          kind: InventoryTemplateRowKind.SECTION,
          printedText: sectionB,
          section: sectionB,
        },
      ];
      await tx.inventoryTemplateRow.createMany({ data: rows });
      const admin = await user(tx, ROLE.ADMINISTRADOR);
      return {
        tx,
        admin: admin.token,
        adminId: admin.id,
        supervisor: (await user(tx, ROLE.SUPERVISOR)).token,
        worker: (await user(tx, ROLE.TRABAJADOR)).token,
        sectionA,
        sectionB,
        printedProductId: printed.id,
      };
    }

    async function withinRollback(
      fn: (f: Fixture) => Promise<void>,
    ): Promise<void> {
      try {
        await prisma.$transaction(
          async (tx) => {
            switchable.use(tx);
            await fn(await fixture(tx));
            throw new Rollback();
          },
          { maxWait: 30_000, timeout: 60_000 },
        );
      } catch (error) {
        if (!(error instanceof Rollback)) throw error;
      } finally {
        switchable.use(null);
      }
    }

    const http = () => request(app.getHttpServer());
    const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
    function create(token: string, body: object) {
      return http().post('/products').set(auth(token)).send(body);
    }
    function update(token: string, id: string, body: object) {
      return http().patch(`/products/${id}`).set(auth(token)).send(body);
    }

    beforeAll(async () => {
      process.env.DATABASE_URL = databaseUrl;
      process.env.JWT_SECRET = 'secreto-de-pruebas';
      process.env.JWT_EXPIRES_IN = '1h';
      process.env.JWT_REFRESH_EXPIRES_IN = '7d';
      process.env.DOCUMENTS_STORAGE_PATH = './storage/test-documents';
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
    }, 60_000);

    afterAll(async () => {
      await prisma.$disconnect();
      await app.close();
    });

    it('crea en la fila <Vacío> libre y, sin filas libres, al final de la sección', async () => {
      await withinRollback(async (f) => {
        const first = await create(f.admin, {
          name: 'Carne Fajita T03',
          section: f.sectionA,
          unit: 'KG',
          packageName: 'bolsa',
          packagesPerBox: 2,
          packageContent: '2.5',
        });
        expect(first.status).toBe(201);
        const product = first.body as ProductResponse;
        expect(product).toMatchObject({
          section: f.sectionA,
          templatePosition: BASE + 2,
          boxContent: '5.000',
          packageContent: '2.500',
          hasFormat: true,
          sku: null,
        });
        const row = await f.tx.inventoryTemplateRow.findUniqueOrThrow({
          where: { position: BASE + 2 },
        });
        expect(row.printedText).toBe('<Vacío>');

        const second = await create(f.admin, {
          name: 'Bebida extra T03',
          section: f.sectionB,
          unit: 'UNIT',
        });
        expect(second.status).toBe(201);
        const extra = second.body as ProductResponse;
        expect(extra.section).toBe(f.sectionB);
        expect(extra.templatePosition).toBeGreaterThanOrEqual(1000);
        expect(extra.hasFormat).toBe(false);
      });
    }, 60_000);

    it('rechaza formato inconsistente, sección inexistente y nombre repetido con errores por campo', async () => {
      await withinRollback(async (f) => {
        const wrong = await create(f.admin, {
          name: 'Formato malo T03',
          section: f.sectionA,
          unit: 'KG',
          packagesPerBox: 2,
          packageContent: '2.5',
          boxContent: '6',
        });
        expect(wrong.status).toBe(400);
        expect(errorsOf(wrong.body)).toHaveProperty('boxContent');

        const section = await create(f.admin, {
          name: 'Sin sección T03',
          section: 'NO EXISTE',
          unit: 'KG',
        });
        expect(section.status).toBe(400);
        expect(errorsOf(section.body)).toHaveProperty('section');

        await create(f.admin, {
          name: 'Lata Coca Cola T03',
          section: f.sectionB,
          unit: 'UNIT',
        }).expect(201);
        const duplicate = await create(f.admin, {
          name: '  lata  coca cola t03 ',
          section: f.sectionB,
          unit: 'UNIT',
        });
        expect(duplicate.status).toBe(409);
        expect(errorsOf(duplicate.body)).toHaveProperty('name');
      });
    }, 60_000);

    it('renombrar conserva la posición, no altera tomas y queda auditado con el antes y el después', async () => {
      await withinRollback(async (f) => {
        const created = (
          await create(f.admin, {
            name: 'Lata Coca Cola T03',
            section: f.sectionA,
            unit: 'UNIT',
          })
        ).body as ProductResponse;
        const store = await f.tx.store.create({
          data: { name: `Local T03 ${randomUUID()}`, city: 'M', address: 'X' },
        });
        const count = await f.tx.inventoryCount.create({
          data: {
            storeId: store.id,
            countDate: new Date('2026-11-12T00:00:00.000Z'),
            createdById: f.adminId,
          },
        });
        await f.tx.inventoryCountLine.create({
          data: {
            countId: count.id,
            productId: created.id,
            productName: created.name,
            unit: 'UNIT',
            looseQuantity: new Prisma.Decimal(3),
            countedQuantity: new Prisma.Decimal(3),
            savedById: f.adminId,
          },
        });

        const renamed = await update(f.admin, created.id, {
          name: 'Lata Pepsi T03',
        });
        expect(renamed.status).toBe(200);
        expect(renamed.body).toMatchObject({
          name: 'Lata Pepsi T03',
          templatePosition: created.templatePosition,
        });
        const line = await f.tx.inventoryCountLine.findFirstOrThrow({
          where: { countId: count.id },
        });
        expect(line.productName).toBe('Lata Coca Cola T03');

        await vi.waitFor(
          async () => {
            const log = await f.tx.auditLog.findFirst({
              where: {
                action: AUDIT_ACTION.PRODUCT_UPDATED,
                entityId: created.id,
              },
            });
            expect(log?.detail).toMatchObject({
              before: { name: 'Lata Coca Cola T03' },
              after: { name: 'Lata Pepsi T03' },
            });
          },
          { timeout: 5_000, interval: 50 },
        );
      });
    }, 60_000);

    it('un artículo impreso no se mueve de sección; uno agregado sí', async () => {
      await withinRollback(async (f) => {
        const blocked = await update(f.admin, f.printedProductId, {
          section: f.sectionB,
        });
        expect(blocked.status).toBe(409);
        expect(errorsOf(blocked.body)).toHaveProperty('section');

        const added = (
          await create(f.admin, {
            name: 'Movible T03',
            section: f.sectionA,
            unit: 'KG',
          })
        ).body as ProductResponse;
        const moved = await update(f.admin, added.id, { section: f.sectionB });
        expect(moved.status).toBe(200);
        expect((moved.body as ProductResponse).section).toBe(f.sectionB);
        const released = await f.tx.inventoryTemplateRow.findUniqueOrThrow({
          where: { position: BASE + 2 },
        });
        expect(released.productId).toBeNull();
      });
    }, 60_000);

    it('desactivar oculta el producto al supervisor y conserva su fila', async () => {
      await withinRollback(async (f) => {
        const created = (
          await create(f.admin, {
            name: 'Desactivable T03',
            section: f.sectionA,
            unit: 'KG',
          })
        ).body as ProductResponse;
        const off = await http()
          .patch(`/products/${created.id}/deactivate`)
          .set(auth(f.admin));
        expect(off.status).toBe(200);
        expect(off.body).toMatchObject({
          isActive: false,
          templatePosition: created.templatePosition,
        });

        const forSupervisor = (
          await http()
            .get(`/products?section=${encodeURIComponent(f.sectionA)}`)
            .set(auth(f.supervisor))
        ).body as ProductResponse[];
        expect(forSupervisor.map((p) => p.id)).not.toContain(created.id);
        const forAdmin = (
          await http()
            .get(`/products?section=${encodeURIComponent(f.sectionA)}`)
            .set(auth(f.admin))
        ).body as ProductResponse[];
        expect(forAdmin.map((p) => p.id)).toContain(created.id);

        await http()
          .patch(`/products/${created.id}/reactivate`)
          .set(auth(f.admin))
          .expect(200);
      });
    }, 60_000);

    it('busca sin tildes, filtra sin formato y lista secciones con filas libres', async () => {
      await withinRollback(async (f) => {
        await create(f.admin, {
          name: 'Atún Preparado T03',
          section: f.sectionB,
          unit: 'KG',
          alternativeNames: ['Tuna T03'],
        }).expect(201);
        const found = (
          await http()
            .get('/products?search=atun%20preparado')
            .set(auth(f.admin))
        ).body as ProductResponse[];
        expect(found.map((p) => p.name)).toContain('Atún Preparado T03');
        const byAlias = (
          await http().get('/products?search=tuna%20t03').set(auth(f.admin))
        ).body as ProductResponse[];
        expect(byAlias).toHaveLength(1);
        const missing = (
          await http()
            .get(
              `/products?missingFormat=true&section=${encodeURIComponent(f.sectionB)}`,
            )
            .set(auth(f.admin))
        ).body as ProductResponse[];
        expect(missing.every((p) => !p.hasFormat)).toBe(true);

        const sections = (
          await http().get('/products/sections').set(auth(f.supervisor))
        ).body as { name: string; freeRows: number }[];
        expect(sections.find((s) => s.name === f.sectionA)?.freeRows).toBe(1);
        expect(sections.find((s) => s.name === f.sectionB)?.freeRows).toBe(0);
      });
    }, 60_000);

    it('solo el administrador modifica; el trabajador no consulta', async () => {
      await withinRollback(async (f) => {
        await create(f.supervisor, {
          name: 'Supervisor T03',
          section: f.sectionA,
          unit: 'KG',
        }).expect(403);
        await update(f.supervisor, f.printedProductId, { name: 'X' }).expect(
          403,
        );
        await http()
          .patch(`/products/${f.printedProductId}/deactivate`)
          .set(auth(f.supervisor))
          .expect(403);
        await http().get('/products').set(auth(f.worker)).expect(403);
        await http().get('/products').set(auth(f.supervisor)).expect(200);
      });
    }, 60_000);
  },
);
