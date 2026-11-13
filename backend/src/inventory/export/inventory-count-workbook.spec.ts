import type { Cell, CellObject, Row } from 'write-excel-file/node';
import { Prisma } from '../../generated/prisma/client.js';
import type { InventoryTemplateSnapshotRow } from '../types/inventory-counts.types.js';
import {
  buildInventoryCountWorkbook,
  buildInventoryFileName,
  countTotals,
  DATA_SHEET,
  formatChileDateTime,
  INVENTORY_HEADERS,
  INVENTORY_SHEET,
  lineQuantities,
  parseTemplateSnapshot,
  UNPLACED_SECTION_LABEL,
  type InventoryCountExportLine,
  type InventoryCountWorkbookInput,
} from './inventory-count-workbook.js';

// Contenido del Excel de una toma finalizada (SPRINT-5-T08) con datos
// ficticios: cada fila de la plantilla en su posición, columnas B a G con lo
// contado (C + E + F = G), celdas vacías para lo no contado y hoja «Datos».

const decimal = (value: string): Prisma.Decimal => new Prisma.Decimal(value);

function line(
  productId: string,
  productName: string,
  data: Partial<InventoryCountExportLine>,
): InventoryCountExportLine {
  return {
    productId,
    productName,
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
): InventoryTemplateSnapshotRow {
  return {
    position,
    kind,
    printedText,
    section: 'COSTO PROTEÍNAS',
    productId,
    productName: printedText,
  };
}

// Plantilla: fajita (fila 2), atún (3), <Vacío> (4), fila sin texto (5),
// sección (6), bebida sin contar (7) y cierre de la sección (8).
const SNAPSHOT: InventoryTemplateSnapshotRow[] = [
  snapshotRow(2, 'ITEM', 'Carne Fajita (Beef Steak)', 'p-fajita'),
  snapshotRow(3, 'ITEM', 'Atún (Preparado)', 'p-tuna'),
  snapshotRow(4, 'ITEM', '<Vacío>'),
  snapshotRow(5, 'BLANK', null),
  snapshotRow(6, 'SECTION', 'COSTO PROTEÍNAS'),
  snapshotRow(7, 'ITEM', 'Lata Fanta Zero', 'p-drink'),
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
// Atún: solo cantidad suelta, contado en 0.
const TUNA = line('p-tuna', 'Atún', {
  looseQuantity: decimal('0'),
  countedQuantity: decimal('0'),
});
// Bebida: no se contó (línea vacía de la finalización).
const DRINK = line('p-drink', 'Bebida', { packageContent: decimal('6') });

const INPUT: InventoryCountWorkbookInput = {
  storeName: 'Subway Melipilla Centro',
  countDate: '2026-11-11',
  startedAt: new Date('2026-11-11T22:05:00.000Z'),
  startedBy: 'Ana Supervisora',
  finalizedAt: new Date('2026-11-12T01:40:00.000Z'),
  finalizedBy: 'Beto Supervisor',
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

function sheets(input: InventoryCountWorkbookInput = INPUT) {
  const [inventory, data] = buildInventoryCountWorkbook(input);
  return { inventory, data };
}

describe('Excel de la toma de inventario (SPRINT-5-T08)', () => {
  it('arma las hojas «Inventario» y «Datos» con el encabezado de la plantilla', () => {
    const { inventory, data } = sheets();
    expect(inventory.name).toBe(INVENTORY_SHEET);
    expect(data.name).toBe(DATA_SHEET);
    expect(values(inventory.rows[0])).toEqual([...INVENTORY_HEADERS]);
    expect(inventory.columnWidths).toHaveLength(7);
    expect(inventory.stickyRowsCount).toBe(1);
  });

  it('deja cada fila de la plantilla en su misma posición de la hoja', () => {
    const { inventory } = sheets();
    // La fila n de Excel es rows[n - 1].
    expect(inventory.rows).toHaveLength(8);
    expect(inventory.rows.map((row) => object(row[0]).value)).toEqual([
      'ARTÍCULO',
      'Carne Fajita (Beef Steak)',
      'Atún (Preparado)',
      '<Vacío>',
      undefined,
      'COSTO PROTEÍNAS',
      'Lata Fanta Zero',
      'COSTO DE BEBIDAS',
    ]);
  });

  it('llena B a G con lo contado, como números, y C + E + F = G', () => {
    const { inventory } = sheets();
    expect(values(inventory.rows[1])).toEqual([
      'Carne Fajita (Beef Steak)',
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

  it('muestra 0 en lo contado en cero y deja vacío lo no contado', () => {
    const { inventory } = sheets();
    // Atún contado en 0: cantidad suelta y total en 0, cajas y paquetes vacíos.
    expect(values(inventory.rows[2])).toEqual([
      'Atún (Preparado)',
      undefined,
      undefined,
      undefined,
      undefined,
      0,
      0,
    ]);
    // Bebida sin contar, <Vacío> y fila sin texto: B a G vacías.
    for (const index of [3, 4, 6]) {
      expect(values(inventory.rows[index]).slice(1)).toEqual(
        Array(6).fill(undefined),
      );
    }
  });

  it('pinta las secciones de negro y las columnas calculadas y el total como la plantilla', () => {
    const { inventory } = sheets();
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
  });

  it('cierra cada bloque con borde continuo y separa las filas con borde punteado', () => {
    const { inventory } = sheets();
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
    const { inventory } = sheets({
      ...INPUT,
      snapshot: [SNAPSHOT[0], snapshotRow(4, 'SECTION', 'COSTO PROTEÍNAS')],
      lines: [FAJITA],
    });
    expect(inventory.rows).toHaveLength(4);
    expect(values(inventory.rows[2])).toEqual(Array(7).fill(undefined));
    expect(object(inventory.rows[3][0]).value).toBe('COSTO PROTEÍNAS');
  });

  it('agrega al final los productos contados que ya no tenían fila en la plantilla', () => {
    const unplaced = line('p-old', 'Queso Viejo', {
      looseQuantity: decimal('1.5'),
      countedQuantity: decimal('1.5'),
    });
    const { inventory } = sheets({
      ...INPUT,
      lines: [FAJITA, TUNA, DRINK, unplaced],
    });
    expect(inventory.rows).toHaveLength(10);
    expect(values(inventory.rows[8])).toEqual([
      'Queso Viejo',
      undefined,
      undefined,
      undefined,
      undefined,
      1.5,
      1.5,
    ]);
    expect(object(inventory.rows[9][0]).value).toBe(UNPLACED_SECTION_LABEL);
  });

  it('trae en «Datos» el local, la fecha, quién inició y finalizó y los totales', () => {
    const { data } = sheets();
    expect(data.rows.map(values)).toEqual([
      ['Local', 'Subway Melipilla Centro'],
      ['Fecha de la toma', '11-11-2026'],
      ['Estado', 'Finalizada'],
      ['Iniciada por', 'Ana Supervisora'],
      ['Iniciada el', '11-11-2026 19:05'],
      ['Finalizada por', 'Beto Supervisor'],
      ['Finalizada el', '11-11-2026 22:40'],
      ['Productos contados', 2],
      ['Productos sin contar', 1],
    ]);
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
    ['tipo desconocido', [{ ...SNAPSHOT[0], kind: 'OTHER' }]],
    ['texto no textual', [{ ...SNAPSHOT[0], printedText: 7 }]],
    ['posición repetida', [SNAPSHOT[0], SNAPSHOT[0]]],
  ])('rechaza una copia inválida: %s', (_case, value) => {
    expect(() => parseTemplateSnapshot(value)).toThrow(/copia de la plantilla/);
  });
});

describe('Nombre del archivo y fechas (SPRINT-5-T08)', () => {
  it('nombra el archivo con el local en slug y la fecha de la toma', () => {
    expect(buildInventoryFileName('Subway Calera Ñuñoa', '2026-11-11')).toBe(
      'inventario_subway-calera-nunoa_2026-11-11.xlsx',
    );
  });

  it('muestra la fecha-hora en hora de Chile, también en horario de verano', () => {
    // 13-11-2026 03:30 UTC = 13-11-2026 00:30 en Chile (UTC-3).
    expect(formatChileDateTime(new Date('2026-11-13T03:30:00.000Z'))).toBe(
      '13-11-2026 00:30',
    );
    // 15-07-2026 16:00 UTC = 15-07-2026 12:00 en Chile (UTC-4).
    expect(formatChileDateTime(new Date('2026-07-15T16:00:00.000Z'))).toBe(
      '15-07-2026 12:00',
    );
  });
});
