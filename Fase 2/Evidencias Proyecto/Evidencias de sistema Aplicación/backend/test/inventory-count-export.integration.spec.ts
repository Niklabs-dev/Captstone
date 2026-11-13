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
  InventoryTemplateRowKind,
  Prisma,
  PrismaClient,
  UnitOfMeasure,
} from '../src/generated/prisma/client.js';
import {
  DATA_SHEET,
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
// Las filas de la plantilla van desde la posición 1001: la finalización copia
// todas las filas de la plantilla y la fila n del Excel es la posición n, así
// el archivo tiene ~1000 filas (posiciones altas lo harían enorme). Ninguna
// otra suite usa ese rango (la plantilla real ocupa 2 a 183).
const databaseUrl = process.env.TEST_DATABASE_URL;
const DOMAIN = '@inventory-export-test.moi-food.cl';
const BASE = 1_000;

class Rollback extends Error {}

interface Session {
  id: string;
  token: string;
}

interface Fixture {
  tx: Tx;
  suffix: string;
  section: string;
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
          printedText: `Impreso ${data.name}`,
          section,
          productId: created.id,
        },
      });
      return created.id;
    }

    // Plantilla (filas BASE+1 a BASE+5), en este orden:
    //   +1 Carne Fajita: caja de 5 kg con bolsas de 2,5 kg
    //   +2 Atún Preparado: solo cantidad suelta (kg)
    //   +3 <Vacío> (fila de artículo sin producto)
    //   +4 Bebida: packs de 6 unidades (queda sin contar)
    //   +5 cierre de la sección
    async function fixture(tx: Tx): Promise<Fixture> {
      const suffix = randomUUID().slice(0, 8);
      const section = `SECCIÓN EXCEL ${suffix}`;
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
      const fajita = await product(tx, BASE + 1, section, {
        name: `Carne Fajita ${suffix}`,
        unit: UnitOfMeasure.KG,
        packageName: 'bolsa',
        packagesPerBox: 2,
        packageContent: '2.5',
        boxContent: '5',
      });
      const tuna = await product(tx, BASE + 2, section, {
        name: `Atún Preparado ${suffix}`,
        unit: UnitOfMeasure.KG,
        looseOnly: true,
      });
      await tx.inventoryTemplateRow.create({
        data: {
          position: BASE + 3,
          kind: InventoryTemplateRowKind.ITEM,
          printedText: '<Vacío>',
          section,
        },
      });
      const drink = await product(tx, BASE + 4, section, {
        name: `Bebida ${suffix}`,
        unit: UnitOfMeasure.UNIT,
        packageName: 'pack',
        packageContent: '6',
      });
      await tx.inventoryTemplateRow.create({
        data: {
          position: BASE + 5,
          kind: InventoryTemplateRowKind.SECTION,
          printedText: section,
          section,
        },
      });
      return {
        tx,
        suffix,
        section,
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

    async function readSheets(
      content: Buffer,
    ): Promise<Map<string, SheetRow[]>> {
      const sheets = await readXlsxFile(content);
      return new Map(
        sheets.map((sheet) => [sheet.sheet, sheet.data as SheetRow[]]),
      );
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

    it('descarga la toma finalizada con la plantilla, lo contado en su fila y la hoja «Datos»', async () => {
      await withinRollback(async (f) => {
        const countId = await countedCount(f);

        const response = await download(f.admin, countId).expect(200);
        expect(response.headers['content-type']).toContain(XLSX_MIME_TYPE);
        expect(response.headers['content-disposition']).toMatch(
          new RegExp(
            `^attachment; filename="inventario_local-excel-a-${f.suffix}_\\d{4}-\\d{2}-\\d{2}\\.xlsx"$`,
          ),
        );
        expect(response.headers['cache-control']).toBe('private, no-store');
        expect(response.headers['x-content-type-options']).toBe('nosniff');

        const sheets = await readSheets(response.body as Buffer);
        expect([...sheets.keys()]).toEqual([INVENTORY_SHEET, DATA_SHEET]);
        const rows = sheets.get(INVENTORY_SHEET) ?? [];
        expect(rows[0]).toEqual([...INVENTORY_HEADERS]);
        // Fajita: B cajas, C 1 × 5, D bolsas, E 2 × 2,5, F suelta, G total.
        expect(excelRow(rows, BASE + 1)).toEqual([
          `Impreso Carne Fajita ${f.suffix}`,
          1,
          5,
          2,
          5,
          0.3,
          10.3,
        ]);
        // Atún contado en 0: solo cantidad suelta y total.
        expect(excelRow(rows, BASE + 2)).toEqual([
          `Impreso Atún Preparado ${f.suffix}`,
          null,
          null,
          null,
          null,
          0,
          0,
        ]);
        // <Vacío> y la bebida sin contar: solo el texto.
        expect(excelRow(rows, BASE + 3)).toEqual([
          '<Vacío>',
          ...Array<null>(6).fill(null),
        ]);
        expect(excelRow(rows, BASE + 4)).toEqual([
          `Impreso Bebida ${f.suffix}`,
          ...Array<null>(6).fill(null),
        ]);
        expect(excelRow(rows, BASE + 5)[0]).toBe(f.section);

        const data = new Map(
          (sheets.get(DATA_SHEET) ?? []).map((row) => [row[0], row[1]]),
        );
        expect(data.get('Local')).toBe(`Local Excel A ${f.suffix}`);
        expect(data.get('Estado')).toBe('Finalizada');
        expect(data.get('Iniciada por')).toBe('Ana Excel');
        expect(data.get('Finalizada por')).toBe('Ana Excel');
        expect(data.get('Finalizada el')).toMatch(
          /^\d{2}-\d{2}-\d{4} \d{2}:\d{2}$/,
        );
        expect(data.get('Productos contados')).toBe(2);
        // La bebida y los productos activos de otras pruebas o del seed
        // quedan sin contar: al menos uno.
        expect(Number(data.get('Productos sin contar'))).toBeGreaterThanOrEqual(
          1,
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
        const before = await readSheets(
          (await download(f.admin, countId).expect(200)).body as Buffer,
        );

        await f.tx.inventoryTemplateRow.update({
          where: { position: BASE + 1 },
          data: { printedText: 'Texto corregido después' },
        });
        await f.tx.product.update({
          where: { id: f.fajita },
          data: { name: `Otro nombre ${f.suffix}`, boxContent: '10' },
        });

        const after = await readSheets(
          (await download(f.admin, countId).expect(200)).body as Buffer,
        );
        expect(excelRow(after.get(INVENTORY_SHEET) ?? [], BASE + 1)).toEqual(
          excelRow(before.get(INVENTORY_SHEET) ?? [], BASE + 1),
        );
      });
    });

    it('aplica los permisos por rol y local', async () => {
      await withinRollback(async (f) => {
        const countId = await countedCount(f);

        await download(f.supervisorA, countId).expect(200);
        await download(f.admin, countId).expect(200);
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
