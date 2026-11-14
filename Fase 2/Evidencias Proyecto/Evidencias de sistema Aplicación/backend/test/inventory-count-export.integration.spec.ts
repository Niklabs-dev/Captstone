import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'node:crypto';
import readXlsxFile from 'read-excel-file/node';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { AUDIT_ACTION } from '../src/audit/constants/audit-actions.constants.js';
import { ROLE, type RoleCode } from '../src/auth/constants/roles.constants.js';
import type { JwtPayload } from '../src/auth/types/auth.types.js';
import {
  INVENTORY_TEMPLATE_ROWS,
  INVENTORY_TEMPLATE_STRUCTURE,
  seedInventoryTemplate,
} from '../prisma/inventory-template.js';
import {
  Prisma,
  PrismaClient,
  UnitOfMeasure,
} from '../src/generated/prisma/client.js';
import {
  INVENTORY_HEADERS,
  INVENTORY_SHEET,
} from '../src/inventory/export/inventory-count-workbook.js';
import type { InventoryCountSummary } from '../src/inventory/types/inventory-counts.types.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { XLSX_MIME_TYPE } from '../src/tips/export/daily-tips-workbook.js';
import {
  createSwitchablePrisma,
  type SwitchablePrisma,
} from './helpers/switchable-prisma.js';

type App = Parameters<typeof request>[0];
type Tx = Prisma.TransactionClient;

// Descarga en Excel de una toma de inventario finalizada (SPRINT-5-T08) por
// HTTP contra PostgreSQL real: la toma se inicia, se cuenta y se finaliza con
// la API (SPRINT-5-T05/T06) y el archivo descargado se vuelve a leer.
// Cada caso arma sus locales, usuarios, productos y filas de la plantilla y
// corre dentro de withinRollback (helpers/switchable-prisma.ts): la base se
// revierte, también la auditoría. Requieren TEST_DATABASE_URL.
//
// Usa la plantilla real (filas 2 a 183; el seed de SPRINT-5-T02 la carga
// dentro de la transacción si la base de pruebas no la tiene) y ubica los
// productos de prueba en sus filas: la fila n del Excel es la posición n.
const databaseUrl = process.env.TEST_DATABASE_URL;
const DOMAIN = '@inventory-export-test.moi-food.cl';

// Filas de la plantilla real usadas por la prueba.
const ROW = {
  fajita: 4, // Carne Fajita (Beef Steak Saborizado)
  empty: 15, // <Vacío>
  tuna: 17, // Atún (Preparado)
  drink: 95, // Lata Coca Cola
  proteinsSection: 45,
} as const;

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
  supervisorB: Session;
  admin: Session;
  accountant: Session;
  worker: Session;
  fajita: string;
  tuna: string;
  drink: string;
}

type SheetRow = (string | number | boolean | Date | null)[];

function binary(
  res: request.Response,
  callback: (error: Error | null, body: Buffer) => void,
): void {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(chunk));
  res.on('end', () => callback(null, Buffer.concat(chunks)));
}

describe.skipIf(!databaseUrl)(
  'Descarga en Excel de la toma de inventario (SPRINT-5-T08)',
  { timeout: 60_000 },
  () => {
    let app: INestApplication<App>;
    let prisma: PrismaClient;
    let jwt: JwtService;
    let switchable: SwitchablePrisma;

    async function user(
      tx: Tx,
      role: RoleCode,
      storeId: string | null,
      firstName: string = role,
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
          firstName,
          lastName: 'Excel',
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

    // Crea el producto y lo ubica en su fila de la plantilla real.
    async function product(
      tx: Tx,
      position: number,
      data: Prisma.ProductUncheckedCreateInput,
    ): Promise<string> {
      const created = await tx.product.create({ data, select: { id: true } });
      await tx.inventoryTemplateRow.update({
        where: { position },
        data: { productId: created.id },
      });
      return created.id;
    }

    // Plantilla real con:
    //   fila 4  Carne Fajita: caja de 5 kg con bolsas de 2,5 kg
    //   fila 15 <Vacío> (fila de artículo sin producto)
    //   fila 17 Atún Preparado: solo cantidad suelta (kg)
    //   fila 95 Bebida: packs de 6 unidades (queda sin contar)
    async function fixture(tx: Tx): Promise<Fixture> {
      await seedInventoryTemplate(tx, INVENTORY_TEMPLATE_ROWS);
      // Los productos que ya estuvieran en esas filas salen de ellas.
      await tx.inventoryTemplateRow.updateMany({
        where: {
          position: { in: [ROW.fajita, ROW.empty, ROW.tuna, ROW.drink] },
        },
        data: { productId: null },
      });
      const suffix = randomUUID().slice(0, 8);
      const store = (name: string) =>
        tx.store.create({
          data: {
            name: `${name} ${suffix}`,
            city: 'Melipilla',
            address: 'Calle ficticia 1',
          },
          select: { id: true },
        });
      const storeA = (await store('Local Excel A')).id;
      const storeB = (await store('Local Excel B')).id;
      const fajita = await product(tx, ROW.fajita, {
        name: `Carne Fajita ${suffix}`,
        unit: UnitOfMeasure.KG,
        packageName: 'bolsa',
        packagesPerBox: 2,
        packageContent: '2.5',
        boxContent: '5',
      });
      const tuna = await product(tx, ROW.tuna, {
        name: `Atún Preparado ${suffix}`,
        unit: UnitOfMeasure.KG,
        looseOnly: true,
      });
      const drink = await product(tx, ROW.drink, {
        name: `Bebida ${suffix}`,
        unit: UnitOfMeasure.UNIT,
        packageName: 'pack',
        packageContent: '6',
      });
      return {
        tx,
        suffix,
        storeA,
        storeB,
        supervisorA: await user(tx, ROLE.SUPERVISOR, storeA, 'Ana'),
        supervisorB: await user(tx, ROLE.SUPERVISOR, storeB),
        admin: await user(tx, ROLE.ADMINISTRADOR, null),
        accountant: await user(tx, ROLE.CONTADOR, null),
        worker: await user(tx, ROLE.TRABAJADOR, storeA),
        fajita,
        tuna,
        drink,
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
    const download = (session: Session, countId: string) =>
      http()
        .get(`/inventory-counts/${countId}/export`)
        .set(auth(session))
        .buffer(true)
        .parse(binary);

    // Toma del local A con fajita (1 caja, 2 bolsas y 0,3 kg = 10,3 kg) y
    // atún contado en 0; la bebida queda sin contar. Si finalize, se cierra.
    async function countedCount(f: Fixture, finalize = true): Promise<string> {
      const started = await http()
        .post('/inventory-counts')
        .set(auth(f.supervisorA))
        .send({})
        .expect(201);
      const countId = (started.body as InventoryCountSummary).id;
      const save = (productId: string, body: object) =>
        http()
          .put(`/inventory-counts/${countId}/lines/${productId}`)
          .set(auth(f.supervisorA))
          .send(body)
          .expect(200);
      await save(f.fajita, { boxes: 1, packages: 2, looseQuantity: '0.300' });
      await save(f.tuna, { looseQuantity: '0' });
      if (finalize) {
        await http()
          .post(`/inventory-counts/${countId}/finalize`)
          .set(auth(f.supervisorA))
          .expect(200);
      }
      return countId;
    }

    // Lee el archivo y verifica que tenga una sola hoja, «Inventario».
    async function readInventory(content: Buffer): Promise<SheetRow[]> {
      const sheets = await readXlsxFile(content);
      expect(sheets.map((sheet) => sheet.sheet)).toEqual([INVENTORY_SHEET]);
      return sheets[0].data as SheetRow[];
    }

    // Fila n de la hoja (1 es el encabezado).
    const excelRow = (rows: SheetRow[], position: number): SheetRow =>
      rows[position - 1];

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

    it('descarga la toma finalizada en una hoja con la plantilla y lo contado en su fila', async () => {
      await withinRollback(async (f) => {
        const countId = await countedCount(f);

        const response = await download(f.admin, countId).expect(200);
        expect(response.headers['content-type']).toContain(XLSX_MIME_TYPE);
        expect(response.headers['content-disposition']).toMatch(
          new RegExp(
            `^attachment; filename="inventario-local-excel-a-${f.suffix}-\\d{2}-\\d{2}-\\d{4}\\.xlsx"$`,
          ),
        );
        expect(response.headers['cache-control']).toBe('private, no-store');
        expect(response.headers['x-content-type-options']).toBe('nosniff');

        const rows = await readInventory(response.body as Buffer);
        // Encabezado y las 182 filas de la plantilla real.
        expect(rows).toHaveLength(INVENTORY_TEMPLATE_STRUCTURE.rows + 1);
        expect(rows[0]).toEqual([...INVENTORY_HEADERS]);
        // Fajita: nombre del producto, B cajas, C 1 × 5, D bolsas, E 2 × 2,5,
        // F suelta y G total.
        expect(excelRow(rows, ROW.fajita)).toEqual([
          `Carne Fajita ${f.suffix}`,
          1,
          5,
          2,
          5,
          0.3,
          10.3,
        ]);
        // Atún «solo cantidad suelta» contado en 0: C y E vacías.
        expect(excelRow(rows, ROW.tuna)).toEqual([
          `Atún Preparado ${f.suffix}`,
          null,
          null,
          null,
          null,
          0,
          0,
        ]);
        // <Vacío> y la bebida sin contar: C, E y G en 0, como la plantilla.
        expect(excelRow(rows, ROW.empty)).toEqual([
          '<Vacío>',
          null,
          0,
          null,
          0,
          null,
          0,
        ]);
        expect(excelRow(rows, ROW.drink)).toEqual([
          `Bebida ${f.suffix}`,
          null,
          0,
          null,
          0,
          null,
          0,
        ]);
        expect(excelRow(rows, ROW.proteinsSection)[0]).toBe(
          'COSTO PROTEÍNAS, QUESO SALSAS (SUBTOTAL)',
        );
      });
    });

    it('audita la descarga sin cantidades', async () => {
      await withinRollback(async (f) => {
        const countId = await countedCount(f);
        await download(f.admin, countId).expect(200);

        const log = await f.tx.auditLog.findFirst({
          where: {
            action: AUDIT_ACTION.INVENTORY_COUNT_EXPORTED,
            entityId: countId,
          },
        });
        expect(log).toMatchObject({
          entityType: 'inventory_counts',
          userId: f.admin.id,
          storeId: f.storeA,
        });
        const detail = log?.detail as Record<string, unknown>;
        expect(detail).toMatchObject({ countedProducts: 2 });
        expect(detail.countDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(JSON.stringify(detail)).not.toContain('10.3');
      });
    });

    it('el Excel no cambia si después se edita la plantilla o el producto', async () => {
      await withinRollback(async (f) => {
        const countId = await countedCount(f);
        const before = await readInventory(
          (await download(f.admin, countId).expect(200)).body as Buffer,
        );

        await f.tx.inventoryTemplateRow.update({
          where: { position: ROW.fajita },
          data: { printedText: 'Texto corregido después' },
        });
        await f.tx.product.update({
          where: { id: f.fajita },
          data: { name: `Otro nombre ${f.suffix}`, boxContent: '10' },
        });

        const after = await readInventory(
          (await download(f.admin, countId).expect(200)).body as Buffer,
        );
        expect(excelRow(after, ROW.fajita)).toEqual(
          excelRow(before, ROW.fajita),
        );
        expect(excelRow(after, ROW.fajita)[0]).toBe(`Carne Fajita ${f.suffix}`);
      });
    });

    it('solo descarga el ADMINISTRADOR: el supervisor del local recibe 403', async () => {
      await withinRollback(async (f) => {
        const countId = await countedCount(f);

        await download(f.admin, countId).expect(200);
        await download(f.supervisorA, countId).expect(403);
        await download(f.supervisorB, countId).expect(403);
        await download(f.accountant, countId).expect(403);
        await download(f.worker, countId).expect(403);
        await http().get(`/inventory-counts/${countId}/export`).expect(401);
      });
    });

    it('responde 409 si la toma sigue en curso, 404 si no existe y 400 con un ID inválido', async () => {
      await withinRollback(async (f) => {
        const countId = await countedCount(f, false);

        const open = await http()
          .get(`/inventory-counts/${countId}/export`)
          .set(auth(f.admin))
          .expect(409);
        expect(
          (open.body as { errors: Record<string, string> }).errors,
        ).toEqual({ countId: 'Solo se descarga en Excel una toma finalizada' });
        await http()
          .get(`/inventory-counts/${randomUUID()}/export`)
          .set(auth(f.admin))
          .expect(404);
        await http()
          .get('/inventory-counts/no-es-uuid/export')
          .set(auth(f.admin))
          .expect(400);
      });
    });
  },
);
