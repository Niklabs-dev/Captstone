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
  addDays,
  businessDateOf,
  formatDbDate,
  toDbDate,
} from '../src/documents/utils/document-dates.util.js';
import {
  InventoryTemplateRowKind,
  Prisma,
  PrismaClient,
  UnitOfMeasure,
} from '../src/generated/prisma/client.js';
import type {
  InventoryCountDetail,
  InventoryCountItem,
  InventoryCountSummary,
} from '../src/inventory/types/inventory-counts.types.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  createSwitchablePrisma,
  type SwitchablePrisma,
} from './helpers/switchable-prisma.js';

type App = Parameters<typeof request>[0];
type Tx = Prisma.TransactionClient;

// API de tomas de inventario (SPRINT-5-T05) por HTTP contra PostgreSQL real.
// Cada caso arma sus locales, usuarios, productos y filas de la plantilla (en
// posiciones altas) y corre dentro de withinRollback
// (helpers/switchable-prisma.ts): la base se revierte, también la auditoría.
// Requieren TEST_DATABASE_URL; sin él se omiten.
const databaseUrl = process.env.TEST_DATABASE_URL;
const DOMAIN = '@inventory-counts-test.moi-food.cl';
const BASE = 70_000;

class Rollback extends Error {}

interface Session {
  id: string;
  token: string;
}

interface Fixture {
  tx: Tx;
  suffix: string;
  storeA: string;
  storeB: string;
  supervisorA: Session;
  supervisorA2: Session;
  supervisorB: Session;
  admin: Session;
  accountant: Session;
  worker: Session;
  // Productos en el orden de la plantilla.
  fajita: string;
  descaler: string;
  tuna: string;
  drink: string;
  inactive: string;
}

const errorsOf = (body: unknown): Record<string, string> =>
  (body as { errors: Record<string, string> }).errors;

// Fecha de hace n días en hora de Chile (AAAA-MM-DD); 0 es hoy.
const daysAgo = (days: number): string =>
  formatDbDate(toDbDate(addDays(businessDateOf(new Date()), -days)));
const today = (): string => daysAgo(0);

describe.skipIf(!databaseUrl)(
  'API de tomas de inventario (SPRINT-5-T05)',
  () => {
    let app: INestApplication<App>;
    let prisma: PrismaClient;
    let jwt: JwtService;
    let switchable: SwitchablePrisma;

    async function user(
      tx: Tx,
      role: RoleCode,
      storeId: string | null,
    ): Promise<Session> {
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
          lastName: 'Toma',
          roleId: roleRow.id,
          storeId,
        },
      });
      const payload: JwtPayload = {
        sub: created.id,
        email: created.email,
        role,
        storeId,
      };
      return { id: created.id, token: await jwt.signAsync(payload) };
    }

    async function product(
      tx: Tx,
      position: number,
      section: string,
      data: Prisma.ProductUncheckedCreateInput,
    ): Promise<string> {
      const created = await tx.product.create({ data, select: { id: true } });
      await tx.inventoryTemplateRow.create({
        data: {
          position,
          kind: InventoryTemplateRowKind.ITEM,
          printedText: data.name,
          section,
          productId: created.id,
        },
      });
      return created.id;
    }

    // Plantilla (filas BASE+1 a BASE+6), en este orden:
    //   +1 Carne Fajita: caja de 5 kg con 2 bolsas de 2,5 kg
    //   +2 Sobre Eliminador de Sarro: caja de 48 unidades
    //   +3 Atún Preparado: solo cantidad suelta (kg)
    //   +4 Bebida: botellas de 6 unidades, sin caja
    //   +5 producto desactivado
    //   +6 cierre de la sección
    async function fixture(tx: Tx): Promise<Fixture> {
      const suffix = randomUUID().slice(0, 8);
      const section = `SECCIÓN TOMA ${suffix}`;
      const store = (name: string) =>
        tx.store.create({
          data: {
            name: `${name} ${suffix}`,
            city: 'Melipilla',
            address: 'Calle ficticia 1',
          },
          select: { id: true },
        });
      const storeA = (await store('Local Toma A')).id;
      const storeB = (await store('Local Toma B')).id;
      const fajita = await product(tx, BASE + 1, section, {
        name: `Carne Fajita ${suffix}`,
        sku: `FAJ-${suffix}`,
        alternativeNames: [`Beef Steak ${suffix}`],
        unit: UnitOfMeasure.KG,
        packageName: 'bolsa',
        packagesPerBox: 2,
        packageContent: '2.5',
        boxContent: '5',
      });
      const descaler = await product(tx, BASE + 2, section, {
        name: `Sobre Eliminador de Sarro ${suffix}`,
        sku: `SAR-${suffix}`,
        unit: UnitOfMeasure.UNIT,
        boxContent: '48',
      });
      const tuna = await product(tx, BASE + 3, section, {
        name: `Atún Preparado ${suffix}`,
        unit: UnitOfMeasure.KG,
        looseOnly: true,
      });
      const drink = await product(tx, BASE + 4, section, {
        name: `Bebida ${suffix}`,
        unit: UnitOfMeasure.UNIT,
        packageName: 'pack',
        packageContent: '6',
      });
      const inactive = await product(tx, BASE + 5, section, {
        name: `Desactivado ${suffix}`,
        unit: UnitOfMeasure.KG,
        looseOnly: true,
        isActive: false,
      });
      await tx.inventoryTemplateRow.create({
        data: {
          position: BASE + 6,
          kind: InventoryTemplateRowKind.SECTION,
          printedText: section,
          section,
        },
      });
      return {
        tx,
        suffix,
        storeA,
        storeB,
        supervisorA: await user(tx, ROLE.SUPERVISOR, storeA),
        supervisorA2: await user(tx, ROLE.SUPERVISOR, storeA),
        supervisorB: await user(tx, ROLE.SUPERVISOR, storeB),
        admin: await user(tx, ROLE.ADMINISTRADOR, null),
        accountant: await user(tx, ROLE.CONTADOR, null),
        worker: await user(tx, ROLE.TRABAJADOR, storeA),
        fajita,
        descaler,
        tuna,
        drink,
        inactive,
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
    const auth = (session: Session) => ({
      Authorization: `Bearer ${session.token}`,
    });
    const start = (session: Session, body: object = {}) =>
      http().post('/inventory-counts').set(auth(session)).send(body);
    const save = (
      session: Session,
      countId: string,
      productId: string,
      body: object,
    ) =>
      http()
        .put(`/inventory-counts/${countId}/lines/${productId}`)
        .set(auth(session))
        .send(body);
    const detail = (session: Session, countId: string, search?: string) =>
      http()
        .get(`/inventory-counts/${countId}`)
        .query(search === undefined ? {} : { search })
        .set(auth(session));

    async function startedCount(f: Fixture): Promise<string> {
      const response = await start(f.supervisorA).expect(201);
      return (response.body as InventoryCountSummary).id;
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

    it('inicia la toma del local de la sesión, la audita y responde 409 con la toma en curso', async () => {
      await withinRollback(async (f) => {
        // El local nunca viaja en el cuerpo.
        await start(f.supervisorA, { storeId: f.storeB }).expect(400);

        const first = await start(f.supervisorA).expect(201);
        const count = first.body as InventoryCountSummary;
        expect(count).toMatchObject({
          status: 'OPEN',
          countDate: today(),
          storeId: f.storeA,
          store: { id: f.storeA },
          startedBy: { id: f.supervisorA.id },
          finalizedAt: null,
          finalizedBy: null,
          countedProducts: 0,
        });

        const log = await f.tx.auditLog.findFirst({
          where: {
            action: AUDIT_ACTION.INVENTORY_COUNT_STARTED,
            entityId: count.id,
          },
        });
        expect(log).toMatchObject({
          entityType: 'inventory_counts',
          userId: f.supervisorA.id,
          storeId: f.storeA,
          detail: { countDate: today() },
        });

        // Otro supervisor del mismo local: 409 con la toma para retomarla.
        const again = await start(f.supervisorA2).expect(409);
        expect(again.body).toMatchObject({
          existingCountId: count.id,
          existingCountDate: today(),
        });
        expect(errorsOf(again.body).store).toMatch(/Retoma la toma en curso/);
        expect(
          await f.tx.inventoryCount.count({ where: { storeId: f.storeA } }),
        ).toBe(1);

        // Otro local inicia la suya sin problemas, con la fecha indicada.
        const other = await start(f.supervisorB, {
          countDate: daysAgo(3),
        }).expect(201);
        expect(other.body).toMatchObject({
          storeId: f.storeB,
          countDate: daysAgo(3),
        });
      });
    }, 60_000);

    it('valida la fecha de la toma y solo deja iniciar al SUPERVISOR con local', async () => {
      await withinRollback(async (f) => {
        const future = await start(f.supervisorA, {
          countDate: '2999-01-01',
        }).expect(400);
        expect(errorsOf(future.body).countDate).toMatch(/posterior a hoy/);
        // La toma es semanal: hasta 7 días atrás (el límite se prueba en el
        // listado); 8 días o un error de tipeo responden 400.
        for (const countDate of [daysAgo(8), '2001-01-01']) {
          const old = await start(f.supervisorA, { countDate }).expect(400);
          expect(errorsOf(old.body).countDate).toBe(
            `La fecha de la toma puede ser de hoy o de hasta 7 días atrás (desde el ${daysAgo(7)})`,
          );
        }
        const invalid = await start(f.supervisorA, {
          countDate: '2026-02-30',
        }).expect(400);
        expect(errorsOf(invalid.body)).toHaveProperty('countDate');
        await start(f.supervisorA, { countDate: '10-11-2026' }).expect(400);

        await start(f.admin).expect(403);
        await start(f.accountant).expect(403);
        await start(f.worker).expect(403);
        const homeless = await user(f.tx, ROLE.SUPERVISOR, null);
        await start(homeless).expect(403);
        expect(
          await f.tx.inventoryCount.count({
            where: { storeId: { in: [f.storeA, f.storeB] } },
          }),
        ).toBe(0);
      });
    }, 60_000);

    it('calcula los totales exactos de los tres ejemplos y guarda la copia del producto', async () => {
      await withinRollback(async (f) => {
        const countId = await startedCount(f);

        const fajita = await save(f.supervisorA, countId, f.fajita, {
          boxes: 1,
          packages: 2,
          looseQuantity: '0.300',
        }).expect(200);
        const fajitaItem = fajita.body as InventoryCountItem;
        expect(fajitaItem.counted).toBe(true);
        expect(fajitaItem.line).toMatchObject({
          boxes: 1,
          packages: 2,
          looseQuantity: '0.300',
          countedQuantity: '10.300',
          productSku: `FAJ-${f.suffix}`,
          productName: `Carne Fajita ${f.suffix}`,
          unit: 'KG',
          packageName: 'bolsa',
          boxContent: '5.000',
          packagesPerBox: 2,
          packageContent: '2.500',
          looseOnly: false,
          savedBy: { id: f.supervisorA.id },
        });

        // Guardar de nuevo reemplaza la línea: 3 bolsas (más que las 2 de
        // una caja) y otro supervisor del local, que queda como autor.
        const replaced = await save(f.supervisorA2, countId, f.fajita, {
          boxes: 1,
          packages: 3,
          looseQuantity: 2.45,
        }).expect(200);
        expect((replaced.body as InventoryCountItem).line).toMatchObject({
          id: fajitaItem.line?.id,
          packages: 3,
          looseQuantity: '2.450',
          countedQuantity: '14.950',
          savedBy: { id: f.supervisorA2.id },
        });

        const descaler = await save(f.supervisorA, countId, f.descaler, {
          boxes: 1,
          looseQuantity: '6',
        }).expect(200);
        expect((descaler.body as InventoryCountItem).line).toMatchObject({
          boxes: 1,
          packages: null,
          looseQuantity: '6',
          countedQuantity: '54',
          unit: 'UNIT',
        });

        await save(f.supervisorA, countId, f.tuna, {
          looseQuantity: '0.200',
        }).expect(200);

        const lines = await f.tx.inventoryCountLine.findMany({
          where: { countId },
          orderBy: { productName: 'asc' },
        });
        expect(lines).toHaveLength(3);
        const byProduct = new Map(lines.map((line) => [line.productId, line]));
        const stored = byProduct.get(f.fajita);
        expect(stored?.countedQuantity?.toFixed(3)).toBe('14.950');
        expect(stored?.savedById).toBe(f.supervisorA2.id);
        expect(stored?.savedAt).toBeInstanceOf(Date);
        expect(byProduct.get(f.descaler)?.countedQuantity?.toFixed(0)).toBe(
          '54',
        );
        expect(byProduct.get(f.tuna)?.countedQuantity?.toFixed(3)).toBe(
          '0.200',
        );

        // Editar después el producto no cambia la copia de la línea.
        await f.tx.product.update({
          where: { id: f.fajita },
          data: { name: `Carne Fajita Editada ${f.suffix}`, boxContent: '6' },
        });
        const after = await detail(f.supervisorA, countId).expect(200);
        const item = (after.body as InventoryCountDetail).items.find(
          (entry) => entry.product.id === f.fajita,
        );
        expect(item?.product.boxContent).toBe('6.000');
        expect(item?.line).toMatchObject({
          productName: `Carne Fajita ${f.suffix}`,
          boxContent: '5.000',
          countedQuantity: '14.950',
        });
      });
    }, 60_000);

    it('rechaza con 400 y errores por campo lo que no calza con el formato', async () => {
      await withinRollback(async (f) => {
        const countId = await startedCount(f);
        const rejected = async (
          productId: string,
          body: object,
        ): Promise<string[]> => {
          const response = await save(
            f.supervisorA,
            countId,
            productId,
            body,
          ).expect(400);
          return Object.keys(errorsOf(response.body));
        };

        expect(await rejected(f.drink, { boxes: 1 })).toEqual(['boxes']);
        expect(await rejected(f.descaler, { packages: 2 })).toEqual([
          'packages',
        ]);
        expect(
          await rejected(f.tuna, { boxes: 1, packages: 1, looseQuantity: 1 }),
        ).toEqual(['boxes', 'packages']);
        expect(await rejected(f.fajita, { boxes: -1 })).toEqual(['boxes']);
        expect(await rejected(f.fajita, { packages: 'dos' })).toEqual([
          'packages',
        ]);
        expect(await rejected(f.fajita, { packages: 1.5 })).toEqual([
          'packages',
        ]);
        expect(await rejected(f.fajita, { looseQuantity: '-0.300' })).toEqual([
          'looseQuantity',
        ]);
        expect(await rejected(f.fajita, { looseQuantity: 'abc' })).toEqual([
          'looseQuantity',
        ]);
        expect(await rejected(f.fajita, { looseQuantity: '1.2345' })).toEqual([
          'looseQuantity',
        ]);
        expect(await rejected(f.descaler, { looseQuantity: '6.5' })).toEqual([
          'looseQuantity',
        ]);
        expect(await rejected(f.fajita, {})).toEqual(['looseQuantity']);
        // Un campo desconocido lo rechaza el ValidationPipe.
        await save(f.supervisorA, countId, f.fajita, {
          boxes: 1,
          total: '99',
        }).expect(400);
        await save(f.supervisorA, countId, 'no-es-uuid', {
          boxes: 1,
        }).expect(400);
        await save(f.supervisorA, countId, randomUUID(), {
          boxes: 1,
        }).expect(404);
        const inactive = await save(f.supervisorA, countId, f.inactive, {
          looseQuantity: '1',
        }).expect(409);
        expect(errorsOf(inactive.body)).toHaveProperty('productId');
        expect(
          await f.tx.inventoryCountLine.count({ where: { countId } }),
        ).toBe(0);
      });
    }, 60_000);

    it('retoma la toma: productos activos en el orden de la plantilla, contado, pendiente y búsqueda', async () => {
      await withinRollback(async (f) => {
        const countId = await startedCount(f);
        await save(f.supervisorA, countId, f.descaler, { boxes: 2 }).expect(
          200,
        );

        const response = await detail(f.supervisorA, countId).expect(200);
        const body = response.body as InventoryCountDetail;
        const mine = body.items.filter((item) =>
          item.product.name.endsWith(f.suffix),
        );
        expect(mine.map((item) => item.product.id)).toEqual([
          f.fajita,
          f.descaler,
          f.tuna,
          f.drink,
        ]);
        expect(mine.map((item) => item.counted)).toEqual([
          false,
          true,
          false,
          false,
        ]);
        expect(mine[0]).toMatchObject({
          line: null,
          product: {
            boxContent: '5.000',
            packageContent: '2.500',
            packageName: 'bolsa',
            templatePosition: BASE + 1,
          },
        });
        expect(mine[1].line?.countedQuantity).toBe('96');
        const activeProducts = await f.tx.product.count({
          where: { isActive: true },
        });
        expect(body).toMatchObject({
          id: countId,
          status: 'OPEN',
          totalProducts: activeProducts,
          countedProducts: 1,
          pendingProducts: activeProducts - 1,
        });

        const search = async (text: string): Promise<string[]> =>
          (
            (await detail(f.supervisorA, countId, text).expect(200))
              .body as InventoryCountDetail
          ).items.map((item) => item.product.id);
        expect(await search(`beef steak ${f.suffix}`)).toEqual([f.fajita]);
        expect(await search(`atun preparado ${f.suffix}`)).toEqual([f.tuna]);
        expect(await search(`sar-${f.suffix}`)).toEqual([f.descaler]);
        const searched = await detail(
          f.supervisorA,
          countId,
          `bebida ${f.suffix}`,
        ).expect(200);
        expect(searched.body).toMatchObject({
          totalProducts: activeProducts,
          countedProducts: 1,
        });

        // Un producto contado y desactivado después sigue en la toma.
        await f.tx.product.update({
          where: { id: f.descaler },
          data: { isActive: false },
        });
        expect(await search(`sar-${f.suffix}`)).toEqual([f.descaler]);
        // Finalizada (simulada en la base: la finalización es de T06), solo
        // muestra sus líneas y no admite cambios.
        await f.tx.inventoryCount.update({
          where: { id: countId },
          data: {
            status: 'CONFIRMED',
            finalizedAt: new Date(),
            finalizedById: f.supervisorA.id,
            templateSnapshot: [],
          },
        });
        const confirmed = (await detail(f.admin, countId).expect(200))
          .body as InventoryCountDetail;
        expect(confirmed.items.map((item) => item.product.id)).toEqual([
          f.descaler,
        ]);
        expect(confirmed).toMatchObject({
          status: 'CONFIRMED',
          finalizedBy: { id: f.supervisorA.id },
          totalProducts: 1,
        });
        await save(f.supervisorA, countId, f.fajita, { boxes: 1 }).expect(409);
      });
    }, 60_000);

    it('aplica los permisos por rol y local y filtra el listado', async () => {
      await withinRollback(async (f) => {
        const countA = await startedCount(f);
        const countB = (
          (await start(f.supervisorB, { countDate: daysAgo(7) }).expect(201))
            .body as InventoryCountSummary
        ).id;

        // Otro local: 403 al consultar y al guardar.
        await detail(f.supervisorB, countA).expect(403);
        await save(f.supervisorB, countA, f.fajita, { boxes: 1 }).expect(403);
        // Administrador: solo lectura.
        await detail(f.admin, countA).expect(200);
        await save(f.admin, countA, f.fajita, { boxes: 1 }).expect(403);
        // CONTADOR y TRABAJADOR: 403.
        for (const session of [f.accountant, f.worker]) {
          await detail(session, countA).expect(403);
          await save(session, countA, f.fajita, { boxes: 1 }).expect(403);
          await http().get('/inventory-counts').set(auth(session)).expect(403);
        }
        await detail(f.supervisorA, randomUUID()).expect(404);
        // El filtro global registra cada 403 sin esperar la respuesta.
        await vi.waitFor(
          async () =>
            expect(
              await f.tx.auditLog.count({
                where: {
                  action: AUDIT_ACTION.ACCESS_DENIED,
                  userId: f.worker.id,
                },
              }),
            ).toBe(3),
          { timeout: 5_000, interval: 50 },
        );

        const list = async (
          session: Session,
          query: Record<string, string>,
        ): Promise<string[]> =>
          (
            (
              await http()
                .get('/inventory-counts')
                .query(query)
                .set(auth(session))
                .expect(200)
            ).body as InventoryCountSummary[]
          ).map((count) => count.id);

        // El supervisor solo ve su local, aunque no indique storeId.
        expect(await list(f.supervisorA, {})).toEqual([countA]);
        expect(await list(f.supervisorA, { storeId: f.storeA })).toEqual([
          countA,
        ]);
        await http()
          .get('/inventory-counts')
          .query({ storeId: f.storeB })
          .set(auth(f.supervisorA))
          .expect(403);

        // El administrador ve todos los locales, ordenados por fecha.
        const all = await list(f.admin, {});
        expect(all.indexOf(countA)).toBeLessThan(all.indexOf(countB));
        expect(await list(f.admin, { storeId: f.storeB })).toEqual([countB]);
        expect(
          await list(f.admin, { storeId: f.storeA, status: 'CONFIRMED' }),
        ).toEqual([]);
        expect(
          await list(f.admin, { storeId: f.storeA, status: 'OPEN' }),
        ).toEqual([countA]);
        expect(
          await list(f.admin, {
            storeId: f.storeB,
            from: daysAgo(7),
            to: daysAgo(7),
          }),
        ).toEqual([countB]);
        expect(
          await list(f.admin, { storeId: f.storeB, from: daysAgo(6) }),
        ).toEqual([]);
        expect(
          await list(f.admin, { storeId: f.storeB, to: daysAgo(8) }),
        ).toEqual([]);
        const inverted = await http()
          .get('/inventory-counts')
          .query({ from: '2026-11-05', to: '2026-11-01' })
          .set(auth(f.admin))
          .expect(400);
        expect(errorsOf(inverted.body)).toHaveProperty('to');
        await http()
          .get('/inventory-counts')
          .query({ status: 'CERRADA' })
          .set(auth(f.admin))
          .expect(400);
      });
    }, 60_000);
  },
);
