import type { Cell, CellObject, Row } from 'write-excel-file/node';
import { Prisma, UnitOfMeasure } from '../../generated/prisma/client.js';
import type { InventoryTemplateSnapshotRow } from '../types/inventory-counts.types.js';
import {
  articleValues,
  buildInventoryCountWorkbook,
  buildInventoryFileName,
  countTotals,
  DECIMAL_QUANTITY_FORMAT,
  INVENTORY_HEADERS,
  INVENTORY_SHEET,
  InvalidTemplateSnapshotError,
  lineQuantities,
  MAX_SNAPSHOT_POSITION,
  parseTemplateSnapshot,
  UNPLACED_SECTION_LABEL,
  type InventoryCountExportLine,
  type InventoryCountWorkbookInput,
} from './inventory-count-workbook.js';

// Contenido del Excel de una toma finalizada (SPRINT-5-T08) con una plantilla
// ficticia corta: cada fila en su posición, columna A con el nombre del
// producto, B a G con lo contado (C + E + F = G) y C, E y G en 0 en las filas
// de artículo sin contar, como la plantilla en blanco. La comparación contra
// la plantilla real está en test/inventory-count-workbook-template.spec.ts.

const decimal = (value: string): Prisma.Decimal => new Prisma.Decimal(value);

function line(
  productId: string,
  productName: string,
  data: Partial<InventoryCountExportLine>,
): InventoryCountExportLine {
  return {
    productId,
    productName,
    unit: UnitOfMeasure.KG,
    looseOnly: false,
    boxes: null,
    packages: null,
    looseQuantity: null,
    countedQuantity: null,
    boxContent: null,
    packageContent: null,
    ...data,
  };
}

function snapshotRow(
  position: number,
  kind: InventoryTemplateSnapshotRow['kind'],
  printedText: string | null,
  productId: string | null = null,
  productName: string | null = null,
): InventoryTemplateSnapshotRow {
  return {
    position,
    kind,
    printedText,
    section: 'COSTO PROTEÍNAS',
    productId,
    productName,
  };
}

// Plantilla: fajita (fila 2), atún (3), <Vacío> (4), fila sin texto (5),
// sección (6), bebida sin contar (7) y cierre de la sección (8).
const SNAPSHOT: InventoryTemplateSnapshotRow[] = [
  snapshotRow(
    2,
    'ITEM',
    'Carne Fajita (Beef Steak Saborizado)',
    'p-fajita',
    'Carne Fajita',
  ),
  snapshotRow(3, 'ITEM', 'Atún (Preparado)', 'p-tuna', 'Atún'),
  snapshotRow(4, 'ITEM', '<Vacío>'),
  snapshotRow(5, 'BLANK', null),
  snapshotRow(6, 'SECTION', 'COSTO PROTEÍNAS'),
  snapshotRow(7, 'ITEM', 'Lata Fanta Zero', 'p-drink', 'Bebida Plantilla'),
  snapshotRow(8, 'SECTION', 'COSTO DE BEBIDAS'),
];

// Fajita: 2 cajas de 5 kg + 1 bolsa de 2,5 kg + 0,3 kg = 12,8 kg.
const FAJITA = line('p-fajita', 'Carne Fajita', {
  boxes: 2,
  packages: 1,
  looseQuantity: decimal('0.3'),
  countedQuantity: decimal('12.8'),
  boxContent: decimal('5'),
  packageContent: decimal('2.5'),
});
// Atún: contado en 0 con solo cantidad suelta.
const TUNA = line('p-tuna', 'Atún', {
  looseQuantity: decimal('0'),
  countedQuantity: decimal('0'),
});
// Bebida: no se contó (línea vacía de la finalización), en unidades.
const DRINK = line('p-drink', 'Bebida', {
  unit: UnitOfMeasure.UNIT,
  packageContent: decimal('6'),
});

const INPUT: InventoryCountWorkbookInput = {
  snapshot: SNAPSHOT,
  lines: [FAJITA, TUNA, DRINK],
};

function object(cell: Cell): CellObject {
  if (cell === null || cell === undefined || typeof cell !== 'object') {
    throw new Error('Se esperaba una celda con estilo');
  }
  return cell as CellObject;
}

const values = (row: Row): unknown[] => row.map((cell) => object(cell).value);

function inventorySheet(input: InventoryCountWorkbookInput = INPUT) {
  const sheets = buildInventoryCountWorkbook(input);
  expect(sheets).toHaveLength(1);
  return sheets[0];
}

describe('Excel de la toma de inventario (SPRINT-5-T08)', () => {
  it('arma una sola hoja «Inventario» con el encabezado de la plantilla, vertical y a una hoja de ancho', () => {
    const inventory = inventorySheet();
    expect(inventory.name).toBe(INVENTORY_SHEET);
    expect(values(inventory.rows[0])).toEqual([...INVENTORY_HEADERS]);
    expect(inventory.columnWidths).toEqual([
      41.63, 13.26, 16.37, 20.13, 19.25, 17.75, 12.37,
    ]);
    expect(inventory.stickyRowsCount).toBe(1);
    expect(inventory.fitToPageWidth).toBe(true);
  });

  it('deja cada fila en su posición, con el nombre del producto o el texto de la fila', () => {
    const inventory = inventorySheet();
    // La fila n de Excel es rows[n - 1].
    expect(inventory.rows).toHaveLength(8);
    expect(inventory.rows.map((row) => object(row[0]).value)).toEqual([
      'ARTÍCULO',
      // Con producto: el nombre de la copia de la línea, no el impreso.
      'Carne Fajita',
      'Atún',
      // Sin producto: el texto de la fila.
      '<Vacío>',
      undefined,
      'COSTO PROTEÍNAS',
      'Bebida',
      'COSTO DE BEBIDAS',
    ]);
  });

  it('usa el nombre guardado en la copia de la plantilla si el producto no tiene línea', () => {
    const inventory = inventorySheet({ ...INPUT, lines: [FAJITA, TUNA] });
    expect(object(inventory.rows[6][0]).value).toBe('Bebida Plantilla');
  });

  it('llena B a G con lo contado, como números, y C + E + F = G', () => {
    const inventory = inventorySheet();
    expect(values(inventory.rows[1])).toEqual([
      'Carne Fajita',
      2,
      10,
      1,
      2.5,
      0.3,
      12.8,
    ]);
    for (const cell of inventory.rows[1].slice(1)) {
      expect(object(cell).type).toBe(Number);
    }
  });

  it('pone C, E y G en 0 en lo no contado y en las <Vacío>, y deja B, D y F vacías', () => {
    const inventory = inventorySheet();
    // Atún contado en 0: sin cajas ni paquetes, C y E en 0 como la plantilla.
    expect(values(inventory.rows[2])).toEqual([
      'Atún',
      undefined,
      0,
      undefined,
      0,
      0,
      0,
    ]);
    // <Vacío> y bebida sin contar: C, E y G en 0.
    for (const index of [3, 6]) {
      expect(values(inventory.rows[index]).slice(1)).toEqual([
        undefined,
        0,
        undefined,
        0,
        undefined,
        0,
      ]);
    }
  });

  it('no pone números en las filas sin texto ni en las secciones', () => {
    const inventory = inventorySheet();
    for (const index of [4, 5, 7]) {
      expect(values(inventory.rows[index]).slice(1)).toEqual(
        Array(6).fill(undefined),
      );
    }
  });

  it('usa el formato 0,000 en las cantidades en kg y l, y no en cajas, paquetes ni unidades', () => {
    const inventory = inventorySheet();
    const formats = (index: number) =>
      inventory.rows[index].slice(1).map((cell) => object(cell).format);
    const kg = DECIMAL_QUANTITY_FORMAT;
    expect(formats(1)).toEqual([undefined, kg, undefined, kg, kg, kg]);
    // Bebida en unidades: sin formato decimal.
    expect(formats(6)).toEqual(Array(6).fill(undefined));
    // <Vacío> (sin producto): formato general.
    expect(formats(3)).toEqual(Array(6).fill(undefined));
  });

  it('pinta las secciones, las columnas calculadas y el total como la plantilla', () => {
    const inventory = inventorySheet();
    const section = inventory.rows[5].map(object);
    expect(section).toHaveLength(7);
    for (const cell of section) {
      expect(cell).toMatchObject({
        backgroundColor: '#000000',
        textColor: '#FFFFFF',
        fontWeight: 'bold',
      });
    }
    const article = inventory.rows[1].map(object);
    expect(article[2].backgroundColor).toBe('#D9D9D9');
    expect(article[4].backgroundColor).toBe('#D9D9D9');
    expect(article[6]).toMatchObject({
      backgroundColor: '#FFE285',
      fontWeight: 'bold',
    });
    expect(article[1].backgroundColor).toBeUndefined();
    for (const cell of article) {
      expect(cell).toMatchObject({ fontFamily: 'Arial', height: 17.25 });
    }
  });

  it('cierra cada bloque con borde continuo y separa las filas con borde punteado', () => {
    const inventory = inventorySheet();
    const borders = (index: number) => {
      const cell = object(inventory.rows[index][0]);
      return [cell.topBorderStyle, cell.bottomBorderStyle];
    };
    expect(borders(1)).toEqual(['thin', 'dashed']);
    expect(borders(2)).toEqual(['dashed', 'dashed']);
    expect(borders(4)).toEqual(['dashed', 'thin']);
    expect(borders(6)).toEqual(['thin', 'thin']);
  });

  it('deja como fila vacía un hueco en las posiciones de la copia', () => {
    const inventory = inventorySheet({
      snapshot: [SNAPSHOT[0], snapshotRow(4, 'SECTION', 'COSTO PROTEÍNAS')],
      lines: [FAJITA],
    });
    expect(inventory.rows).toHaveLength(4);
    expect(values(inventory.rows[2])).toEqual(Array(7).fill(undefined));
    expect(object(inventory.rows[3][0]).value).toBe('COSTO PROTEÍNAS');
  });

  it('agrega al final solo los productos contados que ya no tenían fila en la plantilla', () => {
    const unplaced = line('p-old', 'Queso Viejo', {
      looseQuantity: decimal('1.5'),
      countedQuantity: decimal('1.5'),
    });
    const uncounted = line('p-new', 'Queso Nuevo', {});
    const inventory = inventorySheet({
      ...INPUT,
      lines: [FAJITA, TUNA, DRINK, unplaced, uncounted],
    });
    expect(inventory.rows).toHaveLength(10);
    expect(values(inventory.rows[8])).toEqual([
      'Queso Viejo',
      undefined,
      0,
      undefined,
      0,
      1.5,
      1.5,
    ]);
    expect(object(inventory.rows[9][0]).value).toBe(UNPLACED_SECTION_LABEL);
  });

  it('no agrega el bloque si no hay productos contados sin fila', () => {
    const inventory = inventorySheet({
      ...INPUT,
      lines: [FAJITA, TUNA, DRINK, line('p-new', 'Queso Nuevo', {})],
    });
    expect(inventory.rows).toHaveLength(8);
  });
});

describe('Cantidades de una línea (SPRINT-5-T08)', () => {
  it('multiplica cajas y paquetes con aritmética decimal exacta', () => {
    const quantities = lineQuantities(
      line('p', 'Pan', {
        boxes: 3,
        packages: 7,
        boxContent: decimal('0.1'),
        packageContent: decimal('0.7'),
        countedQuantity: decimal('5.2'),
      }),
    );
    // En coma flotante 3 × 0.1 = 0.30000000000000004.
    expect(quantities).toEqual({
      boxes: 3,
      boxesQuantity: 0.3,
      packages: 7,
      packagesQuantity: 4.9,
      looseQuantity: null,
      countedQuantity: 5.2,
    });
  });

  it('devuelve null si el producto no se contó', () => {
    expect(lineQuantities(DRINK)).toBeNull();
  });

  it('arma B a G con 0 en C, E y G cuando no hay nada contado', () => {
    expect(articleValues(null)).toEqual([null, 0, null, 0, null, 0]);
  });

  it('deja C y E vacías en un producto «solo cantidad suelta», como la plantilla', () => {
    expect(articleValues(null, true)).toEqual([
      null,
      null,
      null,
      null,
      null,
      0,
    ]);
    const prepared = line('p-prep', 'Pollo Teriyaki (Preparado)', {
      looseOnly: true,
      looseQuantity: decimal('1.25'),
      countedQuantity: decimal('1.25'),
    });
    const quantities = lineQuantities(prepared);
    expect(articleValues(quantities, true)).toEqual([
      null,
      null,
      null,
      null,
      1.25,
      1.25,
    ]);
  });

  it('cuenta los productos contados y sin contar', () => {
    expect(countTotals([FAJITA, TUNA, DRINK])).toEqual({
      countedProducts: 2,
      uncountedProducts: 1,
    });
  });
});

describe('Copia de la plantilla guardada al finalizar (SPRINT-5-T08)', () => {
  it('acepta la copia válida y la ordena por posición', () => {
    const parsed = parseTemplateSnapshot([SNAPSHOT[2], SNAPSHOT[0]]);
    expect(parsed.map((row) => row.position)).toEqual([2, 4]);
  });

  it.each([
    ['no es una lista', { rows: [] }],
    ['sin posición', [{ ...SNAPSHOT[0], position: undefined }]],
    ['posición del encabezado', [{ ...SNAPSHOT[0], position: 1 }]],
    [
      'posición sobre el tope',
      [{ ...SNAPSHOT[0], position: MAX_SNAPSHOT_POSITION + 1 }],
    ],
    ['tipo desconocido', [{ ...SNAPSHOT[0], kind: 'OTHER' }]],
    ['texto no textual', [{ ...SNAPSHOT[0], printedText: 7 }]],
    ['posición repetida', [SNAPSHOT[0], SNAPSHOT[0]]],
  ])('rechaza una copia inválida: %s', (_case, value) => {
    expect(() => parseTemplateSnapshot(value)).toThrow(
      InvalidTemplateSnapshotError,
    );
    expect(() => parseTemplateSnapshot(value)).toThrow(/copia de la plantilla/);
  });

  it('acepta la posición del tope', () => {
    const parsed = parseTemplateSnapshot([
      { ...SNAPSHOT[0], position: MAX_SNAPSHOT_POSITION },
    ]);
    expect(parsed).toHaveLength(1);
  });
});

describe('Nombre del archivo (SPRINT-5-T08)', () => {
  it('nombra el archivo inventario-LOCAL-DD-MM-AAAA.xlsx con el local en slug', () => {
    expect(buildInventoryFileName('Subway Calera Ñuñoa', '2026-11-11')).toBe(
      'inventario-subway-calera-nunoa-11-11-2026.xlsx',
    );
  });

  it('limpia del local los caracteres que romperían Content-Disposition', () => {
    expect(
      buildInventoryFileName('Local "raro"\r\n; filename=x.exe', '2026-01-05'),
    ).toBe('inventario-local-raro-filename-x-exe-05-01-2026.xlsx');
  });
});
