import {
  InventoryTemplateRowKind,
  Prisma,
  UnitOfMeasure,
} from '../../generated/prisma/client.js';
import {
  emptyLinesFor,
  finalizationTotals,
  toTemplateSnapshot,
  type EmptyLineProduct,
} from './count-finalization.util.js';

// Copias que guarda la finalización de la toma (SPRINT-5-T06).

const decimal = (value: string): Prisma.Decimal => new Prisma.Decimal(value);

const fajita: EmptyLineProduct = {
  id: 'p-fajita',
  sku: 'FAJ-1',
  name: 'Carne Fajita',
  unit: UnitOfMeasure.KG,
  packageName: 'bolsa',
  boxContent: decimal('5'),
  packagesPerBox: 2,
  packageContent: decimal('2.5'),
  looseOnly: false,
};

const tuna: EmptyLineProduct = {
  id: 'p-tuna',
  sku: null,
  name: 'Atún Preparado',
  unit: UnitOfMeasure.KG,
  packageName: null,
  boxContent: null,
  packagesPerBox: null,
  packageContent: null,
  looseOnly: true,
};

const descaler: EmptyLineProduct = {
  id: 'p-descaler',
  sku: 'SAR-1',
  name: 'Sobre Eliminador de Sarro',
  unit: UnitOfMeasure.UNIT,
  packageName: null,
  boxContent: decimal('48'),
  packagesPerBox: null,
  packageContent: null,
  looseOnly: false,
};

describe('toTemplateSnapshot', () => {
  it('copia cada fila en el orden de la hoja, con el nombre de su producto', () => {
    const snapshot = toTemplateSnapshot([
      {
        position: 45,
        kind: InventoryTemplateRowKind.SECTION,
        printedText: 'CARNES',
        section: 'CARNES',
        productId: null,
        product: null,
      },
      {
        position: 4,
        kind: InventoryTemplateRowKind.ITEM,
        printedText: 'Carne Fajita',
        section: 'CARNES',
        productId: 'p-fajita',
        product: { name: 'Carne Fajita (Beef Steak)' },
      },
      {
        position: 5,
        kind: InventoryTemplateRowKind.BLANK,
        printedText: null,
        section: 'CARNES',
        productId: null,
        product: null,
      },
    ]);

    expect(snapshot).toEqual([
      {
        position: 4,
        kind: 'ITEM',
        printedText: 'Carne Fajita',
        section: 'CARNES',
        productId: 'p-fajita',
        productName: 'Carne Fajita (Beef Steak)',
      },
      {
        position: 5,
        kind: 'BLANK',
        printedText: null,
        section: 'CARNES',
        productId: null,
        productName: null,
      },
      {
        position: 45,
        kind: 'SECTION',
        printedText: 'CARNES',
        section: 'CARNES',
        productId: null,
        productName: null,
      },
    ]);
  });

  it('la copia es JSON plano: no cambia si después se edita el origen', () => {
    const row = {
      position: 4,
      kind: InventoryTemplateRowKind.ITEM,
      printedText: 'Carne Fajita',
      section: 'CARNES',
      productId: 'p-fajita',
      product: { name: 'Carne Fajita' },
    };
    const snapshot = toTemplateSnapshot([row]);
    row.product.name = 'Carne Editada';
    row.printedText = 'Otro texto';

    expect(JSON.parse(JSON.stringify(snapshot))).toEqual([
      {
        position: 4,
        kind: 'ITEM',
        printedText: 'Carne Fajita',
        section: 'CARNES',
        productId: 'p-fajita',
        productName: 'Carne Fajita',
      },
    ]);
  });
});

describe('emptyLinesFor', () => {
  it('agrega una línea sin cantidades por producto activo sin línea, con la copia de su formato', () => {
    const lines = emptyLinesFor([fajita, tuna, descaler], new Set(['p-tuna']));

    // Orden estable por nombre.
    expect(lines.map((line) => line.productId)).toEqual([
      'p-fajita',
      'p-descaler',
    ]);
    expect(lines[0]).toEqual({
      productId: 'p-fajita',
      productSku: 'FAJ-1',
      productName: 'Carne Fajita',
      unit: 'KG',
      packageName: 'bolsa',
      boxContent: decimal('5'),
      packagesPerBox: 2,
      packageContent: decimal('2.5'),
      looseOnly: false,
    });
    // Ninguna cantidad: la línea queda «no contada».
    for (const line of lines) {
      expect(line).not.toHaveProperty('boxes');
      expect(line).not.toHaveProperty('packages');
      expect(line).not.toHaveProperty('looseQuantity');
      expect(line).not.toHaveProperty('countedQuantity');
    }
  });

  it('no repite productos que ya tienen línea, contada o no', () => {
    expect(
      emptyLinesFor(
        [fajita, tuna, descaler],
        new Set(['p-fajita', 'p-tuna', 'p-descaler']),
      ),
    ).toEqual([]);
    expect(emptyLinesFor([], new Set())).toEqual([]);
  });
});

describe('finalizationTotals', () => {
  it('cuenta lo contado y lo no contado, incluidas las líneas vacías agregadas', () => {
    expect(
      finalizationTotals(
        [
          { countedQuantity: decimal('10.3') },
          { countedQuantity: decimal('0') },
          { countedQuantity: null },
        ],
        5,
      ),
    ).toEqual({ totalProducts: 8, countedProducts: 2, uncountedProducts: 6 });
  });

  it('sin líneas vacías nuevas, todo lo contado', () => {
    expect(finalizationTotals([{ countedQuantity: decimal('54') }], 0)).toEqual(
      { totalProducts: 1, countedProducts: 1, uncountedProducts: 0 },
    );
  });
});
