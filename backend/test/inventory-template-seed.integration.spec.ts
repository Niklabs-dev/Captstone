import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '../src/generated/prisma/client.js';
import {
  INVENTORY_EMPTY_ITEM_TEXT,
  INVENTORY_TEMPLATE_ROWS,
  type InventoryTemplateRowSeed,
  type InventoryTemplateStructure,
  seedInventoryTemplate,
} from '../prisma/inventory-template.js';

// Tests de integración de la carga de la estructura de la plantilla de
// inventario (SPRINT-5-T02) contra PostgreSQL real. Usan una plantilla sintética en
// posiciones altas (desde la 20000) para no chocar con las filas reales que
// carga el seed, y cada caso corre en withinRollback (la base se revierte).
const databaseUrl = process.env.TEST_DATABASE_URL;

const P = 20_000;

class Rollback extends Error {
  constructor() {
    super('rollback de prueba');
    this.name = 'Rollback';
  }
}

type Tx = Prisma.TransactionClient;

const TEMPLATE: InventoryTemplateRowSeed[] = [
  {
    position: P,
    type: 'ARTICLE',
    text: 'Carne Fajita (Beef Steak Saborizado)',
  },
  { position: P + 1, type: 'ARTICLE', text: 'Atún (Preparado)' },
  { position: P + 2, type: 'EMPTY' },
  { position: P + 3, type: 'BLANK' },
  { position: P + 4, type: 'SECTION', text: 'COSTO PROTEÍNAS' },
  { position: P + 5, type: 'ARTICLE', text: 'Lata Fanta Zero' },
  { position: P + 6, type: 'ARTICLE', text: 'Lata Fanta Zero' },
  { position: P + 7, type: 'SECTION', text: 'COSTO DE BEBIDAS' },
];

const STRUCTURE: InventoryTemplateStructure = {
  rows: 8,
  articles: 4,
  empty: 1,
  blank: 1,
  sectionPositions: [P + 4, P + 7],
};

describe.skipIf(!databaseUrl)(
  'Carga de la estructura de la plantilla de inventario (SPRINT-5-T02)',
  { timeout: 60_000 },
  () => {
    let prisma: PrismaClient;

    beforeAll(() => {
      prisma = new PrismaClient({
        adapter: new PrismaPg({ connectionString: databaseUrl }),
      });
    });

    afterAll(async () => {
      await prisma.$disconnect();
    });

    async function withinRollback(fn: (tx: Tx) => Promise<void>) {
      try {
        await prisma.$transaction(
          async (tx) => {
            await fn(tx);
            throw new Rollback();
          },
          { maxWait: 30_000, timeout: 60_000 },
        );
      } catch (error) {
        if (!(error instanceof Rollback)) throw error;
      }
    }

    function templateRows(tx: Tx) {
      return tx.inventoryTemplateRow.findMany({
        where: { position: { gte: P } },
        orderBy: { position: 'asc' },
      });
    }

    it('crea las filas en orden, con su tipo y su sección, sin crear productos', async () => {
      await withinRollback(async (tx) => {
        const products = await tx.product.count();

        const result = await seedInventoryTemplate(tx, TEMPLATE, STRUCTURE);

        expect(result).toEqual({
          rowsCreated: 8,
          rowsKept: 0,
          textDifferences: [],
        });
        const rows = await templateRows(tx);
        expect(
          rows.map((r) => [
            r.position - P,
            r.kind,
            r.printedText,
            r.section,
            r.productId,
          ]),
        ).toEqual([
          [
            0,
            'ITEM',
            'Carne Fajita (Beef Steak Saborizado)',
            'COSTO PROTEÍNAS',
            null,
          ],
          [1, 'ITEM', 'Atún (Preparado)', 'COSTO PROTEÍNAS', null],
          [2, 'ITEM', INVENTORY_EMPTY_ITEM_TEXT, 'COSTO PROTEÍNAS', null],
          [3, 'BLANK', null, 'COSTO PROTEÍNAS', null],
          [4, 'SECTION', 'COSTO PROTEÍNAS', 'COSTO PROTEÍNAS', null],
          [5, 'ITEM', 'Lata Fanta Zero', 'COSTO DE BEBIDAS', null],
          [6, 'ITEM', 'Lata Fanta Zero', 'COSTO DE BEBIDAS', null],
          [7, 'SECTION', 'COSTO DE BEBIDAS', 'COSTO DE BEBIDAS', null],
        ]);
        expect(await tx.product.count()).toBe(products);
      });
    });

    it('una segunda carga no crea ni cambia filas', async () => {
      await withinRollback(async (tx) => {
        await seedInventoryTemplate(tx, TEMPLATE, STRUCTURE);
        const before = await templateRows(tx);

        const second = await seedInventoryTemplate(tx, TEMPLATE, STRUCTURE);

        expect(second).toEqual({
          rowsCreated: 0,
          rowsKept: 8,
          textDifferences: [],
        });
        expect(await templateRows(tx)).toEqual(before);
      });
    });

    it('no pisa el texto que editó el administrador ni desasigna su producto', async () => {
      await withinRollback(async (tx) => {
        await seedInventoryTemplate(tx, TEMPLATE, STRUCTURE);
        const product = await tx.product.create({
          data: { name: 'Carne Fajita Proveedor', unit: 'KG' },
        });
        await tx.inventoryTemplateRow.update({
          where: { position: P },
          data: { productId: product.id },
        });
        await tx.inventoryTemplateRow.update({
          where: { position: P + 1 },
          data: { printedText: 'Atún Preparado (nuevo)' },
        });
        // La plantilla trae otro texto en la fila ocupada: tampoco se aplica.
        const changed = TEMPLATE.map((row) =>
          row.position === P
            ? { position: P, type: 'ARTICLE' as const, text: 'Otro texto' }
            : row,
        );

        const result = await seedInventoryTemplate(tx, changed, STRUCTURE);

        // Las diferencias se informan, pero no se aplican.
        expect(result).toEqual({
          rowsCreated: 0,
          rowsKept: 8,
          textDifferences: [
            {
              position: P,
              current: 'Carne Fajita (Beef Steak Saborizado)',
              template: 'Otro texto',
            },
            {
              position: P + 1,
              current: 'Atún Preparado (nuevo)',
              template: 'Atún (Preparado)',
            },
          ],
        });
        const rows = await templateRows(tx);
        expect(rows[0]).toMatchObject({
          printedText: 'Carne Fajita (Beef Steak Saborizado)',
          productId: product.id,
        });
        expect(rows[1].printedText).toBe('Atún Preparado (nuevo)');
        expect(
          await tx.product.findUnique({ where: { id: product.id } }),
        ).toMatchObject({ name: 'Carne Fajita Proveedor' });
      });
    });

    it('informa sin aplicar el texto que cambió en una plantilla actualizada', async () => {
      await withinRollback(async (tx) => {
        await seedInventoryTemplate(tx, TEMPLATE, STRUCTURE);
        // La plantilla nueva cambia el texto de una fila libre y de una sección.
        const updated = TEMPLATE.map((row) => {
          if (row.position === P + 5) {
            return { ...row, text: 'Lata Fanta Zero 350 ml' };
          }
          if (row.position === P + 7) {
            return { ...row, text: 'COSTO BEBIDAS' };
          }
          return row;
        });

        const result = await seedInventoryTemplate(tx, updated, STRUCTURE);

        expect(result.textDifferences).toEqual([
          {
            position: P + 5,
            current: 'Lata Fanta Zero',
            template: 'Lata Fanta Zero 350 ml',
          },
          {
            position: P + 7,
            current: 'COSTO DE BEBIDAS',
            template: 'COSTO BEBIDAS',
          },
        ]);
        const rows = await templateRows(tx);
        expect(rows[5].printedText).toBe('Lata Fanta Zero');
        expect(rows[7].printedText).toBe('COSTO DE BEBIDAS');
      });
    });

    it('inserta solo las filas que faltan', async () => {
      await withinRollback(async (tx) => {
        await seedInventoryTemplate(tx, TEMPLATE.slice(0, 5), {
          ...STRUCTURE,
          rows: 5,
          articles: 2,
          sectionPositions: [P + 4],
        });

        const result = await seedInventoryTemplate(tx, TEMPLATE, STRUCTURE);

        expect(result).toEqual({
          rowsCreated: 3,
          rowsKept: 5,
          textDifferences: [],
        });
        expect(await templateRows(tx)).toHaveLength(8);
      });
    });

    it('se detiene sin escribir nada si la plantilla cambia el tipo de una fila existente', async () => {
      await withinRollback(async (tx) => {
        await seedInventoryTemplate(tx, TEMPLATE, STRUCTURE);
        const withChange: InventoryTemplateRowSeed[] = [
          ...TEMPLATE.map((row) =>
            row.position === P + 3
              ? { position: P + 3, type: 'EMPTY' as const }
              : row,
          ),
          { position: P + 8, type: 'ARTICLE', text: 'Producto nuevo' },
          { position: P + 9, type: 'SECTION', text: 'COSTO DE VARIOS' },
        ];

        await expect(
          seedInventoryTemplate(tx, withChange, {
            rows: 10,
            articles: 5,
            empty: 2,
            blank: 0,
            sectionPositions: [P + 4, P + 7, P + 9],
          }),
        ).rejects.toThrow(
          /fila 20003: es BLANK y la plantilla la declara ITEM/,
        );
        expect(await templateRows(tx)).toHaveLength(8);
      });
    });

    it('se detiene sin escribir nada si la estructura no calza', async () => {
      await withinRollback(async (tx) => {
        await expect(seedInventoryTemplate(tx, TEMPLATE)).rejects.toThrow(
          /no tiene la estructura esperada[\s\S]*Se esperaban 182 filas y hay 8/,
        );
        expect(await templateRows(tx)).toHaveLength(0);
      });
    });

    it('carga la plantilla real: 182 filas sin productos nuevos y sin cambios en una segunda carga', async () => {
      await withinRollback(async (tx) => {
        const products = await tx.product.count();
        await seedInventoryTemplate(tx, INVENTORY_TEMPLATE_ROWS);

        const second = await seedInventoryTemplate(tx, INVENTORY_TEMPLATE_ROWS);

        expect(second).toEqual({
          rowsCreated: 0,
          rowsKept: 182,
          textDifferences: [],
        });
        const rows = await tx.inventoryTemplateRow.findMany({
          where: { position: { gte: 2, lte: 183 } },
          orderBy: { position: 'asc' },
        });
        expect(rows).toHaveLength(182);
        expect(
          rows.filter((r) => r.kind === 'SECTION').map((r) => r.position),
        ).toEqual([45, 88, 141, 162, 183]);
        expect(await tx.product.count()).toBe(products);
      });
    });
  },
);
