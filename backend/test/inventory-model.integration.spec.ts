import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  InventoryTemplateRowKind,
  Prisma,
  PrismaClient,
  UnitOfMeasure,
} from '../src/generated/prisma/client.js';

// Tests de integración del modelo de inventario ampliado (SPRINT-5-T01)
// contra PostgreSQL real: SKU opcional y único, formato de caja y paquete
// independiente, unidad KG/L/UNIT, filas fijas de la plantilla, una toma OPEN
// por local, ciclo OPEN → CONFIRMED, total verificado sobre la copia del
// formato y líneas inmutables con la toma finalizada. Cada caso corre en
// withinRollback (la base se revierte); cada rechazo esperado es la última
// sentencia del caso, porque un error aborta la transacción.
const databaseUrl = process.env.TEST_DATABASE_URL;

const COUNT_DATE = new Date('2026-11-11T00:00:00.000Z');

class Rollback extends Error {
  constructor() {
    super('rollback de prueba');
    this.name = 'Rollback';
  }
}

type Tx = Prisma.TransactionClient;

interface Base {
  storeId: string;
  supervisorId: string;
  adminId: string;
}

interface ProductFormat {
  name: string;
  unit: UnitOfMeasure;
  sku?: string | null;
  packageName?: string | null;
  boxContent?: string | null;
  packagesPerBox?: number | null;
  packageContent?: string | null;
  looseOnly?: boolean;
}

interface LineCounts {
  boxes?: number | null;
  packages?: number | null;
  looseQuantity?: string | null;
  countedQuantity?: string | null;
}

describe.skipIf(!databaseUrl)(
  'Modelo de inventario: catálogo y toma (SPRINT-5-T01)',
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

    async function createUser(
      tx: Tx,
      role: string,
      storeId: string | null,
    ): Promise<string> {
      const roleRecord = await tx.role.upsert({
        where: { code: role },
        update: {},
        create: { code: role, name: role },
      });
      const user = await tx.user.create({
        data: {
          email: `${randomUUID()}@inventory-model.invalid`,
          passwordHash: '$2b$04$hash-de-prueba',
          firstName: role,
          lastName: 'Inventario',
          roleId: roleRecord.id,
          storeId,
        },
      });
      return user.id;
    }

    async function createBase(tx: Tx): Promise<Base> {
      const store = await tx.store.create({
        data: {
          name: `Subway Inventario ${randomUUID()}`,
          city: 'Melipilla',
          address: 'Calle 123',
        },
      });
      return {
        storeId: store.id,
        supervisorId: await createUser(tx, 'SUPERVISOR', store.id),
        adminId: await createUser(tx, 'ADMINISTRADOR', null),
      };
    }

    // Carne Fajita: caja de 5 kg con 2 bolsas de 2,5 kg.
    const FAJITA: ProductFormat = {
      name: 'Carne Fajita (Beef Steak Saborizado)',
      unit: UnitOfMeasure.KG,
      packageName: 'bolsa',
      boxContent: '5',
      packagesPerBox: 2,
      packageContent: '2.5',
    };

    function createProduct(tx: Tx, format: ProductFormat) {
      return tx.product.create({
        data: { ...format, sku: format.sku ?? null },
      });
    }

    function openCount(tx: Tx, base: Base, countDate: Date = COUNT_DATE) {
      return tx.inventoryCount.create({
        data: {
          storeId: base.storeId,
          createdById: base.supervisorId,
          countDate,
        },
      });
    }

    // Línea con la copia del formato del producto, como la guardará la API.
    async function saveLine(
      tx: Tx,
      base: Base,
      countId: string,
      productId: string,
      counts: LineCounts,
    ) {
      const product = await tx.product.findUniqueOrThrow({
        where: { id: productId },
      });
      return tx.inventoryCountLine.create({
        data: {
          countId,
          productId,
          ...counts,
          productSku: product.sku,
          productName: product.name,
          unit: product.unit,
          packageName: product.packageName,
          boxContent: product.boxContent,
          packagesPerBox: product.packagesPerBox,
          packageContent: product.packageContent,
          looseOnly: product.looseOnly,
          savedById: base.supervisorId,
        },
      });
    }

    function finalize(tx: Tx, base: Base, countId: string) {
      return tx.inventoryCount.update({
        where: { id: countId },
        data: {
          status: 'CONFIRMED',
          finalizedAt: new Date(),
          finalizedById: base.supervisorId,
          templateSnapshot: [
            { position: 4, kind: 'ITEM', printedText: 'Carne Fajita' },
          ],
        },
      });
    }

    describe('productos', () => {
      it('guarda el formato con nombres alternativos y caja independiente del paquete', async () => {
        await withinRollback(async (tx) => {
          const fajita = await createProduct(tx, {
            ...FAJITA,
            sku: 'SKU-FAJITA',
          });
          await tx.product.update({
            where: { id: fajita.id },
            data: { alternativeNames: ['Beef Steak', 'Carne Queso'] },
          });
          // Pepperoni: caja de 7,3 kg con 8 paquetes de 0,93 kg (7,44 kg):
          // la base no exige caja = paquetes × paquete.
          const pepperoni = await createProduct(tx, {
            name: 'Pepperoni',
            unit: UnitOfMeasure.KG,
            packageName: 'paquete',
            boxContent: '7.3',
            packagesPerBox: 8,
            packageContent: '0.93',
          });
          expect(pepperoni.boxContent?.toString()).toBe('7.3');
          expect(pepperoni.packageContent?.toString()).toBe('0.93');
          expect(pepperoni.sku).toBeNull();
          expect(pepperoni.alternativeNames).toEqual([]);
          expect(pepperoni.looseOnly).toBe(false);

          const found = await tx.product.findMany({
            where: { alternativeNames: { has: 'Carne Queso' } },
          });
          expect(found.map((product) => product.id)).toEqual([fajita.id]);
        });
      });

      it('admite varios productos sin SKU mientras se recopila', async () => {
        await withinRollback(async (tx) => {
          // Se cuentan por id: una base sembrada con la versión anterior del
          // seed (SPRINT-5-T02) puede traer productos sin SKU con estos nombres.
          const lechuga = await createProduct(tx, {
            name: 'Lechuga',
            unit: UnitOfMeasure.KG,
          });
          const tomate = await createProduct(tx, {
            name: 'Tomate',
            unit: UnitOfMeasure.KG,
          });
          const count = await tx.product.count({
            where: { sku: null, id: { in: [lechuga.id, tomate.id] } },
          });
          expect(count).toBe(2);
        });
      });

      it('rechaza un SKU repetido', async () => {
        await withinRollback(async (tx) => {
          await createProduct(tx, { ...FAJITA, sku: 'SKU-REPETIDO' });
          await expect(
            createProduct(tx, {
              name: 'Beef Steak',
              unit: UnitOfMeasure.KG,
              sku: 'SKU-REPETIDO',
            }),
          ).rejects.toMatchObject({ code: 'P2002' });
        });
      });

      it('rechaza un SKU vacío (CHECK)', async () => {
        await withinRollback(async (tx) => {
          await expect(
            createProduct(tx, { ...FAJITA, sku: '   ' }),
          ).rejects.toThrow(/products_sku_not_blank/);
        });
      });

      it('rechaza nombres alternativos vacíos (CHECK)', async () => {
        await withinRollback(async (tx) => {
          await expect(
            tx.product.create({
              data: {
                name: 'Carne Fajita',
                unit: UnitOfMeasure.KG,
                alternativeNames: ['Beef Steak', ' '],
              },
            }),
          ).rejects.toThrow(/products_alternative_names_valid/);
        });
      });

      it('rechaza un contenido por caja igual a 0 (CHECK)', async () => {
        await withinRollback(async (tx) => {
          await expect(
            createProduct(tx, { ...FAJITA, boxContent: '0' }),
          ).rejects.toThrow(/products_box_content_positive/);
        });
      });

      it('rechaza un contenido por paquete negativo (CHECK)', async () => {
        await withinRollback(async (tx) => {
          await expect(
            createProduct(tx, { ...FAJITA, packageContent: '-2.5' }),
          ).rejects.toThrow(/products_package_content_positive/);
        });
      });

      it('rechaza 0 paquetes por caja (CHECK)', async () => {
        await withinRollback(async (tx) => {
          await expect(
            createProduct(tx, { ...FAJITA, packagesPerBox: 0 }),
          ).rejects.toThrow(/products_packages_per_box_positive/);
        });
      });

      it('exige contenidos enteros en UNIT (CHECK)', async () => {
        await withinRollback(async (tx) => {
          await expect(
            createProduct(tx, {
              name: 'Bolsa para Sándwich Subway',
              unit: UnitOfMeasure.UNIT,
              boxContent: '1000.5',
            }),
          ).rejects.toThrow(/products_unit_contents_integer/);
        });
      });

      it('solo admite las unidades KG, L y UNIT', async () => {
        await withinRollback(async (tx) => {
          const labels = await tx.$queryRaw<Array<{ label: string }>>`
            SELECT e.enumlabel AS label
            FROM pg_enum AS e
            JOIN pg_type AS t ON t.oid = e.enumtypid
            WHERE t.typname = 'UnitOfMeasure'
            ORDER BY e.enumsortorder`;
          expect(labels.map((row) => row.label)).toEqual(['UNIT', 'KG', 'L']);
          await expect(
            tx.$executeRaw`
              INSERT INTO "products" ("name", "unit", "updated_at")
              VALUES ('Queso', 'G', now())`,
          ).rejects.toThrow(/invalid input value for enum/);
        });
      });

      it('no borra un producto con líneas de toma (FK Restrict)', async () => {
        await withinRollback(async (tx) => {
          const base = await createBase(tx);
          const fajita = await createProduct(tx, FAJITA);
          const count = await openCount(tx, base);
          await saveLine(tx, base, count.id, fajita.id, {
            looseQuantity: '1',
            countedQuantity: '1',
          });
          await expect(
            tx.product.delete({ where: { id: fajita.id } }),
          ).rejects.toMatchObject({ code: 'P2003' });
        });
      });
    });

    describe('filas de la plantilla', () => {
      function createRow(
        tx: Tx,
        position: number,
        kind: InventoryTemplateRowKind,
        printedText: string | null,
        productId: string | null = null,
      ) {
        return tx.inventoryTemplateRow.create({
          data: {
            position,
            kind,
            printedText,
            section: 'COSTO PROTEÍNAS, QUESO SALSAS (SUBTOTAL)',
            productId,
          },
        });
      }

      // Posiciones altas para no chocar con la plantilla sembrada (T02).
      const ROW = 10_004;

      it('cambia el texto y el producto de una fila en su misma posición', async () => {
        await withinRollback(async (tx) => {
          const fajita = await createProduct(tx, FAJITA);
          const row = await createRow(
            tx,
            ROW,
            InventoryTemplateRowKind.ITEM,
            '<Vacío>',
          );
          const updated = await tx.inventoryTemplateRow.update({
            where: { id: row.id },
            data: { printedText: fajita.name, productId: fajita.id },
          });
          expect(updated.position).toBe(ROW);
          expect(updated.productId).toBe(fajita.id);
        });
      });

      it('impide actualizar la posición (trigger)', async () => {
        await withinRollback(async (tx) => {
          const row = await createRow(
            tx,
            ROW,
            InventoryTemplateRowKind.ITEM,
            'Carne Fajita',
          );
          await expect(
            tx.inventoryTemplateRow.update({
              where: { id: row.id },
              data: { position: ROW + 1 },
            }),
          ).rejects.toThrow(/no puede cambiar de posición/);
        });
      });

      it('impide reordenar filas intercambiando posiciones con SQL directo (trigger)', async () => {
        await withinRollback(async (tx) => {
          await createRow(tx, ROW, InventoryTemplateRowKind.ITEM, 'Atún');
          await createRow(tx, ROW + 1, InventoryTemplateRowKind.ITEM, 'Salame');
          await expect(
            tx.$executeRaw`
              UPDATE "inventory_template_rows"
              SET "position" = CASE "position"
                WHEN ${ROW}::int THEN ${ROW + 1}::int
                ELSE ${ROW}::int
              END
              WHERE "position" IN (${ROW}::int, ${ROW + 1}::int)`,
          ).rejects.toThrow(/no puede cambiar de posición/);
        });
      });

      it('impide cambiar el tipo de una fila (trigger)', async () => {
        await withinRollback(async (tx) => {
          const row = await createRow(
            tx,
            ROW,
            InventoryTemplateRowKind.ITEM,
            '<Vacío>',
          );
          await expect(
            tx.inventoryTemplateRow.update({
              where: { id: row.id },
              data: { kind: InventoryTemplateRowKind.SECTION },
            }),
          ).rejects.toThrow(/ni de tipo/);
        });
      });

      it('impide eliminar una fila (trigger)', async () => {
        await withinRollback(async (tx) => {
          const row = await createRow(
            tx,
            ROW,
            InventoryTemplateRowKind.BLANK,
            null,
          );
          await expect(
            tx.inventoryTemplateRow.delete({ where: { id: row.id } }),
          ).rejects.toThrow(/es fija: no se puede eliminar/);
        });
      });

      it('rechaza dos filas en la misma posición', async () => {
        await withinRollback(async (tx) => {
          await createRow(tx, ROW, InventoryTemplateRowKind.ITEM, '<Vacío>');
          await expect(
            createRow(tx, ROW, InventoryTemplateRowKind.ITEM, '<Vacío>'),
          ).rejects.toMatchObject({ code: 'P2002' });
        });
      });

      it('un producto ocupa como máximo una fila', async () => {
        await withinRollback(async (tx) => {
          const fajita = await createProduct(tx, FAJITA);
          await createRow(
            tx,
            ROW,
            InventoryTemplateRowKind.ITEM,
            'Carne Fajita',
            fajita.id,
          );
          await expect(
            createRow(
              tx,
              ROW + 1,
              InventoryTemplateRowKind.ITEM,
              'Beef Steak',
              fajita.id,
            ),
          ).rejects.toMatchObject({ code: 'P2002' });
        });
      });

      it('rechaza la fila 1, que es el encabezado (CHECK)', async () => {
        await withinRollback(async (tx) => {
          await expect(
            createRow(tx, 1, InventoryTemplateRowKind.ITEM, 'ARTÍCULO'),
          ).rejects.toThrow(/inventory_template_rows_position_after_header/);
        });
      });

      it('rechaza texto en una fila sin texto (CHECK)', async () => {
        await withinRollback(async (tx) => {
          await expect(
            createRow(tx, ROW, InventoryTemplateRowKind.BLANK, 'Atún'),
          ).rejects.toThrow(/inventory_template_rows_text_by_kind/);
        });
      });

      it('rechaza un producto en una fila de sección (CHECK)', async () => {
        await withinRollback(async (tx) => {
          const fajita = await createProduct(tx, FAJITA);
          await expect(
            createRow(
              tx,
              ROW,
              InventoryTemplateRowKind.SECTION,
              'COSTO DE UNIDADES',
              fajita.id,
            ),
          ).rejects.toThrow(/inventory_template_rows_product_only_item/);
        });
      });
    });

    describe('tomas de inventario', () => {
      it('admite como máximo una toma OPEN por local', async () => {
        await withinRollback(async (tx) => {
          const base = await createBase(tx);
          await openCount(tx, base);
          await expect(
            openCount(tx, base, new Date('2026-11-18T00:00:00.000Z')),
          ).rejects.toMatchObject({ code: 'P2002' });
        });
      });

      it('abre una toma nueva cuando la anterior está finalizada', async () => {
        await withinRollback(async (tx) => {
          const base = await createBase(tx);
          const first = await openCount(tx, base);
          const finalized = await finalize(tx, base, first.id);
          expect(finalized.status).toBe('CONFIRMED');
          expect(finalized.finalizedById).toBe(base.supervisorId);
          const second = await openCount(
            tx,
            base,
            new Date('2026-11-18T00:00:00.000Z'),
          );
          expect(second.status).toBe('OPEN');
        });
      });

      it('la toma nace En curso (trigger)', async () => {
        await withinRollback(async (tx) => {
          const base = await createBase(tx);
          await expect(
            tx.inventoryCount.create({
              data: {
                storeId: base.storeId,
                createdById: base.supervisorId,
                countDate: COUNT_DATE,
                status: 'CONFIRMED',
                finalizedAt: new Date(),
                finalizedById: base.supervisorId,
                templateSnapshot: [],
              },
            }),
          ).rejects.toThrow(/nace En curso/);
        });
      });

      it('finalizar exige usuario, fecha-hora y copia de la plantilla (CHECK)', async () => {
        await withinRollback(async (tx) => {
          const base = await createBase(tx);
          const count = await openCount(tx, base);
          await expect(
            tx.inventoryCount.update({
              where: { id: count.id },
              data: {
                status: 'CONFIRMED',
                finalizedAt: new Date(),
                finalizedById: base.supervisorId,
              },
            }),
          ).rejects.toThrow(/inventory_counts_status_consistency/);
        });
      });

      it('una toma finalizada es inmutable (trigger)', async () => {
        await withinRollback(async (tx) => {
          const base = await createBase(tx);
          const count = await openCount(tx, base);
          await finalize(tx, base, count.id);
          await expect(
            tx.inventoryCount.update({
              where: { id: count.id },
              data: { notes: 'corrección' },
            }),
          ).rejects.toThrow(/está finalizada: es inmutable/);
        });
      });

      it('no se elimina una toma finalizada (trigger)', async () => {
        await withinRollback(async (tx) => {
          const base = await createBase(tx);
          const count = await openCount(tx, base);
          await finalize(tx, base, count.id);
          await expect(
            tx.inventoryCount.delete({ where: { id: count.id } }),
          ).rejects.toThrow(/está finalizada: no se puede eliminar/);
        });
      });

      it('una toma En curso se puede descartar con sus líneas', async () => {
        await withinRollback(async (tx) => {
          const base = await createBase(tx);
          const fajita = await createProduct(tx, FAJITA);
          const count = await openCount(tx, base);
          await saveLine(tx, base, count.id, fajita.id, {
            boxes: 1,
            countedQuantity: '5',
          });
          await tx.inventoryCount.delete({ where: { id: count.id } });
          expect(
            await tx.inventoryCountLine.count({ where: { countId: count.id } }),
          ).toBe(0);
        });
      });
    });

    describe('líneas de la toma', () => {
      it('guarda cajas, paquetes y suelta con el total exacto (1 + 2 bolsas + 0,300 = 10,300 kg)', async () => {
        await withinRollback(async (tx) => {
          const base = await createBase(tx);
          const fajita = await createProduct(tx, FAJITA);
          const count = await openCount(tx, base);
          const line = await saveLine(tx, base, count.id, fajita.id, {
            boxes: 1,
            packages: 2,
            looseQuantity: '0.3',
            countedQuantity: '10.3',
          });
          expect(line.countedQuantity?.toFixed(3)).toBe('10.300');
          expect(line.systemQuantity).toBeNull();
          expect(line.difference).toBeNull();
          expect(line.savedById).toBe(base.supervisorId);

          // Las bolsas sueltas pueden superar las de una caja: 1 caja +
          // 3 bolsas + 2,450 kg = 14,950 kg.
          const updated = await tx.inventoryCountLine.update({
            where: { id: line.id },
            data: {
              packages: 3,
              looseQuantity: '2.45',
              countedQuantity: '14.95',
            },
          });
          expect(updated.countedQuantity?.toFixed(3)).toBe('14.950');
        });
      });

      it('la base asigna saved_at en cada INSERT y UPDATE (trigger)', async () => {
        await withinRollback(async (tx) => {
          const base = await createBase(tx);
          const fajita = await createProduct(tx, FAJITA);
          const count = await openCount(tx, base);
          // now() es la hora de inicio de la transacción: es la que debe
          // quedar, aunque la aplicación envíe otra.
          const [{ now }] = await tx.$queryRaw<Array<{ now: Date }>>`
            SELECT now() AS now`;
          const stale = new Date('2020-01-01T00:00:00.000Z');
          const product = await tx.product.findUniqueOrThrow({
            where: { id: fajita.id },
          });
          const line = await tx.inventoryCountLine.create({
            data: {
              countId: count.id,
              productId: product.id,
              productName: product.name,
              unit: product.unit,
              savedAt: stale,
              savedById: base.supervisorId,
            },
          });
          expect(line.savedAt).toEqual(now);

          const updated = await tx.inventoryCountLine.update({
            where: { id: line.id },
            data: {
              boxes: 1,
              countedQuantity: '5',
              boxContent: product.boxContent,
              savedAt: stale,
            },
          });
          expect(updated.savedAt).toEqual(now);
        });
      });

      it('conserva la copia del formato aunque después cambie el producto', async () => {
        await withinRollback(async (tx) => {
          const base = await createBase(tx);
          const fajita = await createProduct(tx, FAJITA);
          const count = await openCount(tx, base);
          await saveLine(tx, base, count.id, fajita.id, {
            boxes: 1,
            countedQuantity: '5',
          });
          await tx.product.update({
            where: { id: fajita.id },
            data: { name: 'Beef Steak', boxContent: '6' },
          });
          const line = await tx.inventoryCountLine.findFirstOrThrow({
            where: { countId: count.id, productId: fajita.id },
          });
          expect(line.productName).toBe(FAJITA.name);
          expect(line.boxContent?.toString()).toBe('5');
        });
      });

      it('rechaza un total que no cuadra con el formato copiado (CHECK)', async () => {
        await withinRollback(async (tx) => {
          const base = await createBase(tx);
          const fajita = await createProduct(tx, FAJITA);
          const count = await openCount(tx, base);
          await expect(
            saveLine(tx, base, count.id, fajita.id, {
              boxes: 1,
              packages: 2,
              looseQuantity: '0.3',
              countedQuantity: '10.2',
            }),
          ).rejects.toThrow(
            /inventory_count_lines_counted_quantity_consistent/,
          );
        });
      });

      it('rechaza cajas negativas (CHECK)', async () => {
        await withinRollback(async (tx) => {
          const base = await createBase(tx);
          const fajita = await createProduct(tx, FAJITA);
          const count = await openCount(tx, base);
          await expect(
            saveLine(tx, base, count.id, fajita.id, {
              boxes: -1,
              countedQuantity: '-5',
            }),
          ).rejects.toThrow(/inventory_count_lines_boxes_nonnegative/);
        });
      });

      it('rechaza paquetes negativos (CHECK)', async () => {
        await withinRollback(async (tx) => {
          const base = await createBase(tx);
          const fajita = await createProduct(tx, FAJITA);
          const count = await openCount(tx, base);
          await expect(
            saveLine(tx, base, count.id, fajita.id, {
              boxes: 1,
              packages: -1,
              countedQuantity: '2.5',
            }),
          ).rejects.toThrow(/inventory_count_lines_packages_nonnegative/);
        });
      });

      it('rechaza una cantidad suelta negativa (CHECK)', async () => {
        await withinRollback(async (tx) => {
          const base = await createBase(tx);
          const fajita = await createProduct(tx, FAJITA);
          const count = await openCount(tx, base);
          await expect(
            saveLine(tx, base, count.id, fajita.id, {
              boxes: 1,
              looseQuantity: '-0.5',
              countedQuantity: '4.5',
            }),
          ).rejects.toThrow(/inventory_count_lines_loose_quantity_nonnegative/);
        });
      });

      it('rechaza cajas de un producto sin contenido por caja (CHECK)', async () => {
        await withinRollback(async (tx) => {
          const base = await createBase(tx);
          const lechuga = await createProduct(tx, {
            name: 'Lechuga',
            unit: UnitOfMeasure.KG,
          });
          const count = await openCount(tx, base);
          await expect(
            saveLine(tx, base, count.id, lechuga.id, {
              boxes: 1,
              countedQuantity: '0',
            }),
          ).rejects.toThrow(/inventory_count_lines_boxes_require_content/);
        });
      });

      it('rechaza cajas o paquetes en un producto de solo cantidad suelta (CHECK)', async () => {
        await withinRollback(async (tx) => {
          const base = await createBase(tx);
          const limon = await createProduct(tx, {
            ...FAJITA,
            name: 'Limón',
            looseOnly: true,
          });
          const count = await openCount(tx, base);
          await expect(
            saveLine(tx, base, count.id, limon.id, {
              packages: 1,
              countedQuantity: '2.5',
            }),
          ).rejects.toThrow(/inventory_count_lines_loose_only/);
        });
      });

      it('exige cantidad suelta entera en UNIT (CHECK)', async () => {
        await withinRollback(async (tx) => {
          const base = await createBase(tx);
          const bolsa = await createProduct(tx, {
            name: 'Bolsa para Sándwich Subway',
            unit: UnitOfMeasure.UNIT,
            boxContent: '1000',
          });
          const count = await openCount(tx, base);
          await expect(
            saveLine(tx, base, count.id, bolsa.id, {
              looseQuantity: '0.5',
              countedQuantity: '0.5',
            }),
          ).rejects.toThrow(/inventory_count_lines_unit_integer/);
        });
      });

      it('una línea vacía no tiene cantidades; una con cantidades exige el total (CHECK)', async () => {
        await withinRollback(async (tx) => {
          const base = await createBase(tx);
          const fajita = await createProduct(tx, FAJITA);
          const tomate = await createProduct(tx, {
            name: 'Tomate',
            unit: UnitOfMeasure.KG,
          });
          const count = await openCount(tx, base);
          const empty = await saveLine(tx, base, count.id, fajita.id, {});
          expect(empty.countedQuantity).toBeNull();
          await expect(
            saveLine(tx, base, count.id, tomate.id, { looseQuantity: '1' }),
          ).rejects.toThrow(/inventory_count_lines_counted_state/);
        });
      });

      it('una línea por toma y producto', async () => {
        await withinRollback(async (tx) => {
          const base = await createBase(tx);
          const fajita = await createProduct(tx, FAJITA);
          const count = await openCount(tx, base);
          await saveLine(tx, base, count.id, fajita.id, {});
          await expect(
            saveLine(tx, base, count.id, fajita.id, {}),
          ).rejects.toMatchObject({ code: 'P2002' });
        });
      });

      it('la finalización inserta las líneas vacías antes de confirmar, en la misma transacción', async () => {
        await withinRollback(async (tx) => {
          const base = await createBase(tx);
          const fajita = await createProduct(tx, FAJITA);
          const tomate = await createProduct(tx, {
            name: 'Tomate',
            unit: UnitOfMeasure.KG,
          });
          const count = await openCount(tx, base);
          await saveLine(tx, base, count.id, fajita.id, {
            boxes: 1,
            countedQuantity: '5',
          });
          // Producto no contado: queda vacío, igual que en la hoja impresa.
          await saveLine(tx, base, count.id, tomate.id, {});
          await finalize(tx, base, count.id);
          const lines = await tx.inventoryCountLine.findMany({
            where: { countId: count.id },
          });
          expect(lines).toHaveLength(2);
        });
      });

      it('impide insertar líneas en una toma finalizada (trigger)', async () => {
        await withinRollback(async (tx) => {
          const base = await createBase(tx);
          const fajita = await createProduct(tx, FAJITA);
          const count = await openCount(tx, base);
          await finalize(tx, base, count.id);
          await expect(
            saveLine(tx, base, count.id, fajita.id, {}),
          ).rejects.toThrow(/está finalizada: no se permite INSERT/);
        });
      });

      it('impide modificar líneas de una toma finalizada (trigger)', async () => {
        await withinRollback(async (tx) => {
          const base = await createBase(tx);
          const fajita = await createProduct(tx, FAJITA);
          const count = await openCount(tx, base);
          const line = await saveLine(tx, base, count.id, fajita.id, {
            boxes: 1,
            countedQuantity: '5',
          });
          await finalize(tx, base, count.id);
          await expect(
            tx.inventoryCountLine.update({
              where: { id: line.id },
              data: { boxes: 2, countedQuantity: '10' },
            }),
          ).rejects.toThrow(/está finalizada: no se permite UPDATE/);
        });
      });

      it('impide borrar líneas de una toma finalizada (trigger)', async () => {
        await withinRollback(async (tx) => {
          const base = await createBase(tx);
          const fajita = await createProduct(tx, FAJITA);
          const count = await openCount(tx, base);
          const line = await saveLine(tx, base, count.id, fajita.id, {});
          await finalize(tx, base, count.id);
          await expect(
            tx.inventoryCountLine.delete({ where: { id: line.id } }),
          ).rejects.toThrow(/está finalizada: no se permite DELETE/);
        });
      });

      it('una línea no cambia de toma ni de producto (trigger)', async () => {
        await withinRollback(async (tx) => {
          const base = await createBase(tx);
          const fajita = await createProduct(tx, FAJITA);
          const tomate = await createProduct(tx, {
            name: 'Tomate',
            unit: UnitOfMeasure.KG,
          });
          const count = await openCount(tx, base);
          const line = await saveLine(tx, base, count.id, fajita.id, {});
          await expect(
            tx.inventoryCountLine.update({
              where: { id: line.id },
              data: { productId: tomate.id },
            }),
          ).rejects.toThrow(/no puede cambiar de toma ni de producto/);
        });
      });
    });
  },
);
