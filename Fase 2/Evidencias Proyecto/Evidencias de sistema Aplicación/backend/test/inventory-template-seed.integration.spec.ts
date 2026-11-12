import { PrismaPg } from '@prisma/adapter-pg';
import {
  Prisma,
  PrismaClient,
  UnitOfMeasure,
} from '../src/generated/prisma/client.js';
import {
  INVENTORY_EMPTY_ITEM_TEXT,
  INVENTORY_TEMPLATE_ROWS,
  type InventoryTemplateRowSeed,
  seedInventoryTemplate,
} from '../prisma/inventory-template.js';

// Tests de integración de la carga de la plantilla de inventario
// (SPRINT-5-T02) contra PostgreSQL real. Usan una plantilla sintética en
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
    unit: UnitOfMeasure.KG,
    format: {
      packageName: 'bolsa',
      boxContent: '5',
      packagesPerBox: 2,
      packageContent: '2.5',
    },
  },
  {
    position: P + 1,
    type: 'ARTICLE',
    text: 'Atún (Preparado)',
    unit: UnitOfMeasure.KG,
    format: { looseOnly: true },
  },
  { position: P + 2, type: 'EMPTY' },
  { position: P + 3, type: 'BLANK' },
  { position: P + 4, type: 'SECTION', text: 'COSTO PROTEÍNAS' },
  {
    position: P + 5,
    type: 'ARTICLE',
    text: 'Lata Fanta Zero',
    unit: UnitOfMeasure.UNIT,
  },
  {
    position: P + 6,
    type: 'ARTICLE',
    text: 'Lata Fanta Zero',
    unit: UnitOfMeasure.UNIT,
  },
  { position: P + 7, type: 'SECTION', text: 'COSTO DE BEBIDAS' },
];

function replaceRow(
  template: InventoryTemplateRowSeed[],
  row: InventoryTemplateRowSeed,
): InventoryTemplateRowSeed[] {
  return template.map((r) => (r.position === row.position ? row : r));
}

describe.skipIf(!databaseUrl)(
  'Carga de la plantilla de inventario (SPRINT-5-T02)',
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
        include: { product: true },
      });
    }

    it('crea las filas en orden, con su sección, y un producto por artículo', async () => {
      await withinRollback(async (tx) => {
        const result = await seedInventoryTemplate(tx, TEMPLATE);

        expect(result).toEqual({
          rowsCreated: 8,
          rowsUpdated: 0,
          productsCreated: 4,
          productsRenamed: 0,
        });
        const rows = await templateRows(tx);
        expect(
          rows.map((r) => [
            r.position - P,
            r.kind,
            r.printedText,
            r.section,
            r.product?.name ?? null,
          ]),
        ).toEqual([
          [
            0,
            'ITEM',
            'Carne Fajita (Beef Steak Saborizado)',
            'COSTO PROTEÍNAS',
            'Carne Fajita (Beef Steak Saborizado)',
          ],
          [
            1,
            'ITEM',
            'Atún (Preparado)',
            'COSTO PROTEÍNAS',
            'Atún (Preparado)',
          ],
          [2, 'ITEM', INVENTORY_EMPTY_ITEM_TEXT, 'COSTO PROTEÍNAS', null],
          [3, 'BLANK', null, 'COSTO PROTEÍNAS', null],
          [4, 'SECTION', 'COSTO PROTEÍNAS', 'COSTO PROTEÍNAS', null],
          [5, 'ITEM', 'Lata Fanta Zero', 'COSTO DE BEBIDAS', 'Lata Fanta Zero'],
          [6, 'ITEM', 'Lata Fanta Zero', 'COSTO DE BEBIDAS', 'Lata Fanta Zero'],
          [7, 'SECTION', 'COSTO DE BEBIDAS', 'COSTO DE BEBIDAS', null],
        ]);
        // Las dos «Lata Fanta Zero» son productos distintos.
        expect(rows[5].productId).not.toBe(rows[6].productId);
      });
    });

    it('crea los productos sin SKU, con el formato definido o «Sin formato»', async () => {
      await withinRollback(async (tx) => {
        await seedInventoryTemplate(tx, TEMPLATE);

        const [fajita, atun, , , , fanta] = await templateRows(tx);
        expect(fajita.product).toMatchObject({
          sku: null,
          unit: 'KG',
          packageName: 'bolsa',
          packagesPerBox: 2,
          looseOnly: false,
          isActive: true,
        });
        expect(fajita.product?.boxContent?.toFixed(3)).toBe('5.000');
        expect(fajita.product?.packageContent?.toFixed(3)).toBe('2.500');
        expect(atun.product).toMatchObject({
          looseOnly: true,
          boxContent: null,
          packageContent: null,
        });
        expect(fanta.product).toMatchObject({
          sku: null,
          unit: 'UNIT',
          packageName: null,
          boxContent: null,
          packagesPerBox: null,
          packageContent: null,
          looseOnly: false,
        });
      });
    });

    it('es idempotente y no pisa el formato que editó el administrador', async () => {
      await withinRollback(async (tx) => {
        await seedInventoryTemplate(tx, TEMPLATE);
        const [, , , , , fanta] = await templateRows(tx);
        await tx.product.update({
          where: { id: fanta.productId ?? '' },
          data: {
            sku: 'SKU-FANTA-ZERO',
            packageName: 'pack',
            packageContent: new Prisma.Decimal(6),
          },
        });

        const second = await seedInventoryTemplate(tx, TEMPLATE);

        expect(second).toEqual({
          rowsCreated: 0,
          rowsUpdated: 0,
          productsCreated: 0,
          productsRenamed: 0,
        });
        const rows = await templateRows(tx);
        expect(rows).toHaveLength(8);
        expect(rows[5].product).toMatchObject({
          id: fanta.productId,
          sku: 'SKU-FANTA-ZERO',
          packageName: 'pack',
        });
        expect(rows[5].product?.packageContent?.toFixed(0)).toBe('6');
      });
    });

    it('no revierte un nombre editado si la plantilla no cambió', async () => {
      await withinRollback(async (tx) => {
        await seedInventoryTemplate(tx, TEMPLATE);
        const [, , , , , fanta] = await templateRows(tx);
        await tx.product.update({
          where: { id: fanta.productId ?? '' },
          data: { name: 'Lata Fanta Zero 350 ml' },
        });

        await seedInventoryTemplate(tx, TEMPLATE);

        const producto = await tx.product.findUniqueOrThrow({
          where: { id: fanta.productId ?? '' },
        });
        expect(producto.name).toBe('Lata Fanta Zero 350 ml');
      });
    });

    it('renombra el producto en la misma posición si cambia el texto de la plantilla, conservando su formato', async () => {
      await withinRollback(async (tx) => {
        await seedInventoryTemplate(tx, TEMPLATE);
        const [fajita] = await templateRows(tx);

        const result = await seedInventoryTemplate(
          tx,
          replaceRow(TEMPLATE, {
            position: P,
            type: 'ARTICLE',
            text: 'Carne Fajita',
            unit: UnitOfMeasure.KG,
          }),
        );

        expect(result).toMatchObject({
          rowsUpdated: 1,
          productsCreated: 0,
          productsRenamed: 1,
        });
        const [actualizada] = await templateRows(tx);
        expect(actualizada.id).toBe(fajita.id);
        expect(actualizada.printedText).toBe('Carne Fajita');
        expect(actualizada.product).toMatchObject({
          id: fajita.productId,
          name: 'Carne Fajita',
          packageName: 'bolsa',
          packagesPerBox: 2,
        });
      });
    });

    it('actualiza la sección si la plantilla la cambia', async () => {
      await withinRollback(async (tx) => {
        await seedInventoryTemplate(tx, TEMPLATE);

        const result = await seedInventoryTemplate(
          tx,
          replaceRow(TEMPLATE, {
            position: P + 7,
            type: 'SECTION',
            text: 'COSTO DE BEBIDAS (SUBTOTAL)',
          }),
        );

        expect(result).toMatchObject({ rowsUpdated: 3, productsRenamed: 0 });
        const rows = await templateRows(tx);
        expect(rows.slice(5).map((r) => r.section)).toEqual([
          'COSTO DE BEBIDAS (SUBTOTAL)',
          'COSTO DE BEBIDAS (SUBTOTAL)',
          'COSTO DE BEBIDAS (SUBTOTAL)',
        ]);
      });
    });

    it('una fila <Vacío> que pasa a ser artículo crea su producto', async () => {
      await withinRollback(async (tx) => {
        await seedInventoryTemplate(tx, TEMPLATE);

        const result = await seedInventoryTemplate(
          tx,
          replaceRow(TEMPLATE, {
            position: P + 2,
            type: 'ARTICLE',
            text: 'Pepperoni',
            unit: UnitOfMeasure.KG,
          }),
        );

        expect(result).toMatchObject({ rowsUpdated: 1, productsCreated: 1 });
        const rows = await templateRows(tx);
        expect(rows[2].printedText).toBe('Pepperoni');
        expect(rows[2].product).toMatchObject({ name: 'Pepperoni', sku: null });
      });
    });

    it('un artículo que pasa a <Vacío> se desvincula y su producto queda en el catálogo', async () => {
      await withinRollback(async (tx) => {
        await seedInventoryTemplate(tx, TEMPLATE);
        const [, atun] = await templateRows(tx);

        await seedInventoryTemplate(
          tx,
          replaceRow(TEMPLATE, { position: P + 1, type: 'EMPTY' }),
        );

        const rows = await templateRows(tx);
        expect(rows[1].printedText).toBe(INVENTORY_EMPTY_ITEM_TEXT);
        expect(rows[1].productId).toBeNull();
        const producto = await tx.product.findUnique({
          where: { id: atun.productId ?? '' },
        });
        expect(producto?.name).toBe('Atún (Preparado)');
      });
    });

    it('se detiene sin escribir nada si la plantilla cambia el tipo de una fila existente', async () => {
      await withinRollback(async (tx) => {
        await seedInventoryTemplate(tx, TEMPLATE);
        const conCambio = replaceRow(
          [
            ...TEMPLATE,
            {
              position: P + 8,
              type: 'ARTICLE',
              text: 'Producto nuevo',
              unit: 'UNIT',
            },
            { position: P + 9, type: 'SECTION', text: 'COSTO DE VARIOS' },
          ],
          { position: P + 3, type: 'EMPTY' },
        );

        await expect(seedInventoryTemplate(tx, conCambio)).rejects.toThrow(
          /fila 20003: es BLANK y la plantilla la declara ITEM/,
        );
        const rows = await templateRows(tx);
        expect(rows).toHaveLength(8);
      });
    });

    it('carga la plantilla real: 182 filas y 140 artículos con producto, sin cambios en una segunda carga', async () => {
      await withinRollback(async (tx) => {
        await seedInventoryTemplate(tx, INVENTORY_TEMPLATE_ROWS);

        const second = await seedInventoryTemplate(tx, INVENTORY_TEMPLATE_ROWS);

        expect(second).toEqual({
          rowsCreated: 0,
          rowsUpdated: 0,
          productsCreated: 0,
          productsRenamed: 0,
        });
        const rows = await tx.inventoryTemplateRow.findMany({
          where: { position: { gte: 2, lte: 183 } },
          orderBy: { position: 'asc' },
          include: { product: true },
        });
        expect(rows).toHaveLength(182);
        const conProducto = rows.filter((r) => r.product !== null);
        expect(conProducto).toHaveLength(140);
        expect(
          conProducto.every((r) => r.product?.name === r.printedText),
        ).toBe(true);
        expect(rows.find((r) => r.position === 4)?.product).toMatchObject({
          name: 'Carne Fajita (Beef Steak Saborizado)',
          unit: 'KG',
          packageName: 'bolsa',
          packagesPerBox: 2,
        });
      });
    });
  },
);
