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
import type {
  PlacementSuggestion,
  ProductResponse,
  TemplateRowResponse,
} from '../src/inventory/types/products.types.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  createSwitchablePrisma,
  type SwitchablePrisma,
} from './helpers/switchable-prisma.js';

type App = Parameters<typeof request>[0];
type Tx = Prisma.TransactionClient;

// API de productos de inventario y de la estructura de la plantilla
// (SPRINT-5-T03) por HTTP contra PostgreSQL real. Cada caso arma su propia
// plantilla en posiciones altas y corre dentro de withinRollback
// (helpers/switchable-prisma.ts): la base se revierte.
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
  suffix: string;
  admin: string;
  supervisor: string;
  accountant: string;
  worker: string;
  adminId: string;
  sectionA: string;
  sectionB: string;
  printedProductId: string;
  rowId: (offset: number) => Promise<string>;
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

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

    // Sección A (filas BASE+1 a BASE+4):
    //   +1 artículo «Pepperoni <sufijo>» sin producto (pendiente de crear)
    //   +2 artículo «Artículo impreso <sufijo>» con producto
    //   +3 «<Vacío>» libre
    //   +4 cierre de la sección A
    // Sección B (BASE+5): solo su cierre, sin filas libres.
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
          printedText: `Pepperoni ${suffix}`,
          section: sectionA,
        },
        {
          position: BASE + 2,
          kind: InventoryTemplateRowKind.ITEM,
          printedText: `Artículo impreso ${suffix}`,
          section: sectionA,
          productId: printed.id,
        },
        {
          position: BASE + 3,
          kind: InventoryTemplateRowKind.ITEM,
          printedText: '<Vacío>',
          section: sectionA,
        },
        {
          position: BASE + 4,
          kind: InventoryTemplateRowKind.SECTION,
          printedText: sectionA,
          section: sectionA,
        },
        {
          position: BASE + 5,
          kind: InventoryTemplateRowKind.SECTION,
          printedText: sectionB,
          section: sectionB,
        },
      ];
      await tx.inventoryTemplateRow.createMany({ data: rows });
      const admin = await user(tx, ROLE.ADMINISTRADOR);
      return {
        tx,
        suffix,
        admin: admin.token,
        adminId: admin.id,
        supervisor: (await user(tx, ROLE.SUPERVISOR)).token,
        accountant: (await user(tx, ROLE.CONTADOR)).token,
        worker: (await user(tx, ROLE.TRABAJADOR)).token,
        sectionA,
        sectionB,
        printedProductId: printed.id,
        rowId: async (offset: number) =>
          (
            await tx.inventoryTemplateRow.findUniqueOrThrow({
              where: { position: BASE + offset },
              select: { id: true },
            })
          ).id,
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

    async function waitForAudit(
      f: Fixture,
      action: string,
      entityId: string,
    ): Promise<Record<string, unknown>> {
      let detail: Record<string, unknown> = {};
      await vi.waitFor(
        async () => {
          const log = await f.tx.auditLog.findFirst({
            where: { action, entityId },
          });
          expect(log).not.toBeNull();
          detail = log?.detail as Record<string, unknown>;
        },
        { timeout: 5_000, interval: 50 },
      );
      return detail;
    }

    async function auditCount(
      f: Fixture,
      action: string,
      entityId: string,
    ): Promise<number> {
      await sleep(300);
      return f.tx.auditLog.count({ where: { action, entityId } });
    }

    it('ubica en la fila del artículo que coincide, luego en <Vacío> y sin filas responde 409 sin insertar', async () => {
      await withinRollback(async (f) => {
        const before = await f.tx.inventoryTemplateRow.count({
          where: { position: { gte: BASE } },
        });
        const matched = await create(f.admin, {
          name: 'Pepperoni Nuevo',
          alternativeNames: [`PEPPERONI ${f.suffix}`],
          section: f.sectionA,
          unit: 'KG',
        });
        expect(matched.status).toBe(201);
        expect(matched.body).toMatchObject({
          section: f.sectionA,
          templatePosition: BASE + 1,
          templateRowId: await f.rowId(1),
        });

        const empty = await create(f.admin, {
          name: 'Lata Pepsi T03',
          section: f.sectionA,
          unit: 'UNIT',
        });
        expect(empty.status).toBe(201);
        expect(empty.body).toMatchObject({ templatePosition: BASE + 3 });

        const full = await create(f.admin, {
          name: 'Sin Fila T03',
          section: f.sectionA,
          unit: 'KG',
        });
        expect(full.status).toBe(409);
        expect(errorsOf(full.body).templateRowId).toMatch(
          /No quedan filas libres.*Reutiliza la fila/,
        );
        await create(f.admin, {
          name: 'Sin Fila B T03',
          section: f.sectionB,
          unit: 'KG',
        }).expect(409);
        expect(
          await f.tx.inventoryTemplateRow.count({
            where: { position: { gte: BASE } },
          }),
        ).toBe(before);
        expect(
          await f.tx.product.count({
            where: { name: { startsWith: 'Sin Fila' } },
          }),
        ).toBe(0);
      });
    }, 60_000);

    it('sugiere la fila y permite elegirla; rechaza filas de otra sección, ocupadas o que no son de artículo', async () => {
      await withinRollback(async (f) => {
        const suggest = (name: string, alternative?: string) =>
          http()
            .get('/products/template/suggestion')
            .query({
              section: f.sectionA,
              name,
              ...(alternative ? { alternativeNames: alternative } : {}),
            })
            .set(auth(f.admin));
        const match = (await suggest('Otro', `pepperoni ${f.suffix}`))
          .body as PlacementSuggestion;
        expect(match).toMatchObject({
          reason: 'MATCH',
          row: { position: BASE + 1, isEmptyRow: false },
        });
        expect(
          (await suggest('Lata Pepsi')).body as PlacementSuggestion,
        ).toMatchObject({ reason: 'EMPTY', row: { position: BASE + 3 } });
        expect(
          (
            await http()
              .get('/products/template/suggestion')
              .query({ section: f.sectionB, name: 'X' })
              .set(auth(f.admin))
          ).body,
        ).toEqual({ row: null, reason: null });

        // Elegida a mano: la fila del artículo pendiente, aunque no coincida.
        const chosen = await create(f.admin, {
          name: 'Reemplazo de Pepperoni T03',
          section: f.sectionA,
          unit: 'KG',
          templateRowId: await f.rowId(1),
        });
        expect(chosen.status).toBe(201);
        expect(chosen.body).toMatchObject({ templatePosition: BASE + 1 });

        const occupied = await create(f.admin, {
          name: 'Ocupada T03',
          section: f.sectionA,
          unit: 'KG',
          templateRowId: await f.rowId(2),
        });
        expect(occupied.status).toBe(409);
        expect(errorsOf(occupied.body).templateRowId).toMatch(/ya tiene/);
        const otherSection = await create(f.admin, {
          name: 'Otra Sección T03',
          section: f.sectionB,
          unit: 'KG',
          templateRowId: await f.rowId(3),
        });
        expect(otherSection.status).toBe(400);
        expect(errorsOf(otherSection.body).templateRowId).toMatch(
          /no es de la sección/,
        );
        const sectionRow = await create(f.admin, {
          name: 'Fila Sección T03',
          section: f.sectionA,
          unit: 'KG',
          templateRowId: await f.rowId(4),
        });
        expect(sectionRow.status).toBe(400);
      });
    }, 60_000);

    it('guarda caja y paquete por separado (Pepperoni 7,3 kg y 0,93 kg) y valida el formato por campo', async () => {
      await withinRollback(async (f) => {
        const pepperoni = await create(f.admin, {
          name: 'Pepperoni Formato T03',
          section: f.sectionA,
          unit: 'KG',
          packageName: 'paquete',
          packagesPerBox: 8,
          packageContent: '0.93',
          boxContent: '7.3',
        });
        expect(pepperoni.status).toBe(201);
        expect(pepperoni.body).toMatchObject({
          packageName: 'paquete',
          packagesPerBox: 8,
          packageContent: '0.930',
          boxContent: '7.300',
          hasFormat: true,
        });
        const id = (pepperoni.body as ProductResponse).id;
        // Cambiar los paquetes por caja (informativo) no toca la caja.
        const informative = await update(f.admin, id, { packagesPerBox: 9 });
        expect(informative.body).toMatchObject({
          packagesPerBox: 9,
          boxContent: '7.300',
        });

        const badPackage = await create(f.admin, {
          name: 'Caja Grande T03',
          section: f.sectionA,
          unit: 'KG',
          packageName: 'caja grande',
        });
        expect(badPackage.status).toBe(400);
        const unit = await update(f.admin, id, {
          unit: 'UNIT',
          packageContent: '6.5',
          boxContent: '24',
        });
        expect(unit.status).toBe(400);
        expect(errorsOf(unit.body).packageContent).toMatch(
          /entero cuando se cuenta por unidad/,
        );
        const loose = await update(f.admin, id, { looseOnly: true });
        expect(loose.status).toBe(400);
        expect(errorsOf(loose.body).looseOnly).toMatch(/no lleva caja/);
        await create(f.admin, {
          name: 'Sección Falsa T03',
          section: 'NO EXISTE',
          unit: 'KG',
        }).expect(400);
      });
    }, 60_000);

    it('nombres y nombres alternativos no se repiten entre productos, sin mayúsculas ni tildes', async () => {
      await withinRollback(async (f) => {
        await create(f.admin, {
          name: 'Carne Fajita T03',
          alternativeNames: ['Beef Steak T03', 'Carne Queso T03'],
          section: f.sectionA,
          unit: 'KG',
        }).expect(201);

        const sameName = await create(f.admin, {
          name: 'CARNE FAJITÁ t03',
          section: f.sectionA,
          unit: 'KG',
        });
        expect(sameName.status).toBe(409);
        expect(errorsOf(sameName.body).name).toMatch(/Ya existe un producto/);
        const nameIsAlternative = await create(f.admin, {
          name: 'carne queso t03',
          section: f.sectionA,
          unit: 'KG',
        });
        expect(nameIsAlternative.status).toBe(409);
        expect(errorsOf(nameIsAlternative.body).name).toMatch(
          /ya es un nombre alternativo de «Carne Fajita T03»/,
        );
        const alternativeTaken = await update(f.admin, f.printedProductId, {
          alternativeNames: ['BEEF STEAK T03'],
        });
        expect(alternativeTaken.status).toBe(409);
        expect(errorsOf(alternativeTaken.body).alternativeNames).toMatch(
          /ya es un nombre de «Carne Fajita T03»/,
        );

        const blank = await update(f.admin, f.printedProductId, {
          alternativeNames: ['   '],
        });
        expect(blank.status).toBe(400);
        expect(errorsOf(blank.body).alternativeNames).toMatch(/vacíos/);
        const repeated = await update(f.admin, f.printedProductId, {
          alternativeNames: ['Dup T03', 'dup t03'],
        });
        expect(repeated.status).toBe(400);
        expect(errorsOf(repeated.body).alternativeNames).toMatch(/repetido/);
      });
    }, 60_000);

    it('el SKU es opcional y único (409), se busca por SKU y se filtra sin SKU', async () => {
      await withinRollback(async (f) => {
        const withSku = await create(f.admin, {
          name: 'Con SKU T03',
          sku: `SKU-${f.suffix}`,
          section: f.sectionA,
          unit: 'KG',
        });
        expect(withSku.status).toBe(201);
        const repeated = await update(f.admin, f.printedProductId, {
          sku: `sku-${f.suffix}`,
        });
        expect(repeated.status).toBe(409);
        expect(errorsOf(repeated.body).sku).toMatch(/Otro producto ya usa/);

        const found = (
          await http()
            .get(`/products?search=${encodeURIComponent(`sku-${f.suffix}`)}`)
            .set(auth(f.admin))
        ).body as ProductResponse[];
        expect(found.map((p) => p.name)).toEqual(['Con SKU T03']);
        const withoutSku = (
          await http()
            .get(
              `/products?missingSku=true&section=${encodeURIComponent(f.sectionA)}`,
            )
            .set(auth(f.admin))
        ).body as ProductResponse[];
        expect(withoutSku.map((p) => p.id)).toEqual([f.printedProductId]);
      });
    }, 60_000);

    it('renombrar conserva la fila, no altera tomas y audita alternativos; null da 400 y sin cambios no se audita', async () => {
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
          alternativeNames: ['Pepsi lata T03'],
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
        expect(
          await waitForAudit(f, AUDIT_ACTION.PRODUCT_UPDATED, created.id),
        ).toMatchObject({
          before: { name: 'Lata Coca Cola T03', alternativeNames: [] },
          after: {
            name: 'Lata Pepsi T03',
            alternativeNames: ['Pepsi lata T03'],
          },
        });

        for (const field of ['name', 'unit', 'looseOnly', 'alternativeNames']) {
          const response = await update(f.admin, created.id, { [field]: null });
          expect(response.status).toBe(400);
          expect(errorsOf(response.body)[field]).toBeDefined();
        }
        await update(f.admin, created.id, { section: f.sectionB }).expect(400);
        await update(f.admin, created.id, {}).expect(200);
        await update(f.admin, created.id, { name: 'Lata Pepsi T03' }).expect(
          200,
        );
        expect(
          await auditCount(f, AUDIT_ACTION.PRODUCT_UPDATED, created.id),
        ).toBe(1);
      });
    }, 60_000);

    it('mueve un producto a otra fila libre de cualquier sección y lo audita', async () => {
      await withinRollback(async (f) => {
        const pending = await f.rowId(1);
        const moved = await http()
          .patch(`/products/${f.printedProductId}/move`)
          .set(auth(f.admin))
          .send({ templateRowId: pending });
        expect(moved.status).toBe(200);
        expect(moved.body).toMatchObject({
          templateRowId: pending,
          templatePosition: BASE + 1,
        });
        const old = await f.tx.inventoryTemplateRow.findUniqueOrThrow({
          where: { position: BASE + 2 },
        });
        expect(old.productId).toBeNull();
        expect(
          await waitForAudit(f, AUDIT_ACTION.PRODUCT_MOVED, f.printedProductId),
        ).toMatchObject({
          before: { templatePosition: BASE + 2 },
          after: { templatePosition: BASE + 1 },
        });

        const move = (templateRowId: string) =>
          http()
            .patch(`/products/${f.printedProductId}/move`)
            .set(auth(f.admin))
            .send({ templateRowId });
        await move(pending).expect(200);
        const other = (
          await create(f.admin, {
            name: 'Ocupa Vacío T03',
            section: f.sectionA,
            unit: 'KG',
          })
        ).body as ProductResponse;
        await move(other.templateRowId ?? '').expect(409);
        await move(await f.rowId(5)).expect(400);
        expect(
          await auditCount(f, AUDIT_ACTION.PRODUCT_MOVED, f.printedProductId),
        ).toBe(1);
      });
    }, 60_000);

    it('expone la plantilla en orden con su producto; el supervisor no ve los inactivos', async () => {
      await withinRollback(async (f) => {
        const ours = (rows: TemplateRowResponse[]) =>
          rows.filter((row) => row.position > BASE);
        const admin = ours(
          (await http().get('/products/template').set(auth(f.admin)))
            .body as TemplateRowResponse[],
        );
        expect(
          admin.map((row) => [
            row.position - BASE,
            row.kind,
            row.isEmptyRow,
            row.product?.id ?? null,
          ]),
        ).toEqual([
          [1, 'ITEM', false, null],
          [2, 'ITEM', false, f.printedProductId],
          [3, 'ITEM', true, null],
          [4, 'SECTION', false, null],
          [5, 'SECTION', false, null],
        ]);

        await http()
          .patch(`/products/${f.printedProductId}/deactivate`)
          .set(auth(f.admin))
          .expect(200);
        const supervisor = ours(
          (await http().get('/products/template').set(auth(f.supervisor)))
            .body as TemplateRowResponse[],
        );
        expect(supervisor[1].product).toBeNull();
        const sections = (
          await http().get('/products/sections').set(auth(f.supervisor))
        ).body as { name: string; freeRows: number }[];
        expect(sections.find((s) => s.name === f.sectionA)?.freeRows).toBe(2);
        expect(sections.find((s) => s.name === f.sectionB)?.freeRows).toBe(0);
      });
    }, 60_000);

    it('corrige el texto de una fila de artículo sin producto sin cambiar su posición', async () => {
      await withinRollback(async (f) => {
        const pending = await f.rowId(1);
        const edit = (id: string, printedText: string) =>
          http()
            .patch(`/products/template/rows/${id}`)
            .set(auth(f.admin))
            .send({ printedText });
        const edited = await edit(pending, '  Pepperoni   Laminado ');
        expect(edited.status).toBe(200);
        expect(edited.body).toMatchObject({
          position: BASE + 1,
          printedText: 'Pepperoni Laminado',
        });
        expect(
          await waitForAudit(
            f,
            AUDIT_ACTION.INVENTORY_TEMPLATE_ROW_UPDATED,
            pending,
          ),
        ).toMatchObject({
          before: { position: BASE + 1, printedText: `Pepperoni ${f.suffix}` },
          after: { position: BASE + 1, printedText: 'Pepperoni Laminado' },
        });

        const withProduct = await edit(await f.rowId(2), 'Otro');
        expect(withProduct.status).toBe(409);
        expect(errorsOf(withProduct.body).printedText).toMatch(
          /tiene un producto/,
        );
        await edit(await f.rowId(4), 'Otra sección').expect(409);
        await edit(pending, ' ').expect(400);
      });
    }, 60_000);

    it('libera la fila de un producto desactivado para asignarla a otro', async () => {
      await withinRollback(async (f) => {
        const row = await f.rowId(2);
        const release = () =>
          http()
            .patch(`/products/template/rows/${row}/release`)
            .set(auth(f.admin));
        const active = await release();
        expect(active.status).toBe(409);
        expect(errorsOf(active.body).templateRowId).toMatch(/Desactiva/);

        await http()
          .patch(`/products/${f.printedProductId}/deactivate`)
          .set(auth(f.admin))
          .expect(200);
        const released = await release();
        expect(released.status).toBe(200);
        expect(released.body).toMatchObject({
          position: BASE + 2,
          product: null,
        });
        expect(
          await waitForAudit(
            f,
            AUDIT_ACTION.INVENTORY_TEMPLATE_ROW_RELEASED,
            row,
          ),
        ).toMatchObject({
          before: { productId: f.printedProductId },
          after: { productId: null },
        });
        const product = await f.tx.product.findUniqueOrThrow({
          where: { id: f.printedProductId },
          include: { templateRow: true },
        });
        expect(product.templateRow).toBeNull();

        const reused = await create(f.admin, {
          name: 'Reutiliza Fila T03',
          section: f.sectionA,
          unit: 'KG',
          templateRowId: row,
        });
        expect(reused.status).toBe(201);
        await release().expect(409);
      });
    }, 60_000);

    it('desactivar oculta el producto al supervisor, conserva su fila y no repite la auditoría', async () => {
      await withinRollback(async (f) => {
        const off = () =>
          http()
            .patch(`/products/${f.printedProductId}/deactivate`)
            .set(auth(f.admin));
        const first = await off();
        expect(first.status).toBe(200);
        expect(first.body).toMatchObject({
          isActive: false,
          templatePosition: BASE + 2,
        });
        await off().expect(200);
        const forSupervisor = (
          await http()
            .get(`/products?section=${encodeURIComponent(f.sectionA)}`)
            .set(auth(f.supervisor))
        ).body as ProductResponse[];
        expect(forSupervisor).toEqual([]);
        expect(
          await auditCount(
            f,
            AUDIT_ACTION.PRODUCT_DEACTIVATED,
            f.printedProductId,
          ),
        ).toBe(1);
        await http()
          .patch(`/products/${f.printedProductId}/reactivate`)
          .set(auth(f.admin))
          .expect(200);
      });
    }, 60_000);

    it('permisos: solo el administrador modifica; supervisor lee; contador y trabajador reciben 403', async () => {
      await withinRollback(async (f) => {
        const row = await f.rowId(1);
        for (const token of [f.supervisor, f.accountant, f.worker]) {
          await create(token, {
            name: 'Sin permiso T03',
            section: f.sectionA,
            unit: 'KG',
          }).expect(403);
          await update(token, f.printedProductId, { name: 'X' }).expect(403);
          await http()
            .patch(`/products/${f.printedProductId}/move`)
            .set(auth(token))
            .send({ templateRowId: row })
            .expect(403);
          await http()
            .patch(`/products/${f.printedProductId}/deactivate`)
            .set(auth(token))
            .expect(403);
          await http()
            .patch(`/products/template/rows/${row}`)
            .set(auth(token))
            .send({ printedText: 'X' })
            .expect(403);
          await http()
            .patch(`/products/template/rows/${row}/release`)
            .set(auth(token))
            .expect(403);
          await http()
            .get('/products/template/suggestion')
            .query({ section: f.sectionA, name: 'X' })
            .set(auth(token))
            .expect(403);
        }
        for (const token of [f.accountant, f.worker]) {
          for (const path of [
            '/products',
            '/products/sections',
            '/products/template',
          ]) {
            await http().get(path).set(auth(token)).expect(403);
          }
        }
        for (const path of [
          '/products',
          '/products/sections',
          '/products/template',
        ]) {
          await http().get(path).set(auth(f.supervisor)).expect(200);
        }
      });
    }, 60_000);
  },
);
