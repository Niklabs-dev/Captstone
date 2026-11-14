import { readFile } from 'node:fs/promises';
import readXlsxFile from 'read-excel-file/node';
import {
  INVENTORY_TEMPLATE_ROWS,
  INVENTORY_TEMPLATE_STRUCTURE,
  resolveInventoryTemplate,
} from '../prisma/inventory-template.js';
import { Prisma, UnitOfMeasure } from '../src/generated/prisma/client.js';
import {
  buildInventoryCountWorkbook,
  DECIMAL_QUANTITY_FORMAT,
  INVENTORY_SHEET,
  type InventoryCountExportLine,
} from '../src/inventory/export/inventory-count-workbook.js';
import type { InventoryTemplateSnapshotRow } from '../src/inventory/types/inventory-counts.types.js';
import { writeWorkbook } from '../src/tips/export/daily-tips-xlsx.writer.js';
import {
  cellReference,
  readCellFormats,
  readCellStyles,
  readColumnWidths,
  readRowHeights,
  readSheetXml,
} from './helpers/xlsx-entries.js';

// Excel de una toma finalizada (SPRINT-5-T08) armado con la plantilla real
// (las 182 filas del seed, SPRINT-5-T02) y comparado contra la plantilla en
// blanco del repositorio (docs/plantilla-inventario.xlsx): mismas filas en el
// mismo orden, mismos encabezados, mismos valores en lo no contado, mismos
// rellenos, negritas, altos y anchos. El PO copia el Excel y lo pega en su
// cuadre, así que un desplazamiento de una sola fila lo rompe.
const TEMPLATE_PATH = new URL(
  '../docs/plantilla-inventario.xlsx',
  import.meta.url,
);

const FAJITA_POSITION = 4;
const SARRO_POSITION = 178;

type SheetRow = (string | number | boolean | Date | null)[];

const decimal = (value: string): Prisma.Decimal => new Prisma.Decimal(value);

// Carne Fajita: caja de 5 kg con bolsas de 2,5 kg; 1 caja, 3 bolsas y
// 2,450 kg = 14,95 kg.
const FAJITA: InventoryCountExportLine = {
  productId: 'p-fajita',
  productName: 'Carne Fajita',
  unit: UnitOfMeasure.KG,
  looseOnly: false,
  boxes: 1,
  packages: 3,
  looseQuantity: decimal('2.45'),
  countedQuantity: decimal('14.95'),
  boxContent: decimal('5'),
  packageContent: decimal('2.5'),
};

// Sobre Eliminador de Sarro: caja de 48 unidades; 1 caja y 6 sueltos = 54.
const SARRO: InventoryCountExportLine = {
  productId: 'p-sarro',
  productName: 'Sobre Eliminador de Sarro',
  unit: UnitOfMeasure.UNIT,
  looseOnly: false,
  boxes: 1,
  packages: null,
  looseQuantity: decimal('6'),
  countedQuantity: decimal('54'),
  boxContent: decimal('48'),
  packageContent: null,
};

// Los «(Preparado)» de las filas 17 a 19 son «solo cantidad suelta» y
// quedan sin contar (la finalización crea su línea vacía).
const PREPARED_POSITIONS = [17, 18, 19];
const PREPARED: InventoryCountExportLine[] = PREPARED_POSITIONS.map(
  (position) => ({
    productId: `p-prepared-${position}`,
    productName: `Preparado ${position}`,
    unit: UnitOfMeasure.KG,
    looseOnly: true,
    boxes: null,
    packages: null,
    looseQuantity: null,
    countedQuantity: null,
    boxContent: null,
    packageContent: null,
  }),
);

const PRODUCT_BY_POSITION = new Map<number, InventoryCountExportLine>([
  [FAJITA_POSITION, FAJITA],
  [SARRO_POSITION, SARRO],
  ...PREPARED_POSITIONS.map(
    (position, index): [number, InventoryCountExportLine] => [
      position,
      PREPARED[index],
    ],
  ),
]);

// Única diferencia conocida con la plantilla en blanco: la fila 20 es un
// <Vacío> que en la plantilla va en gris y solo trae G = 0, como los
// «(Preparado)» que tiene encima. Una fila sin producto no sabe si será
// «solo cantidad suelta», así que va como las demás <Vacío>: sin gris en A,
// B y D, y con C, E y G en 0.
const EMPTY_AFTER_PREPARED = 20;

// Copia de la plantilla real como la guarda la finalización, con los dos
// productos de prueba asignados a sus filas.
function realSnapshot(): InventoryTemplateSnapshotRow[] {
  return resolveInventoryTemplate(INVENTORY_TEMPLATE_ROWS).map((row) => {
    const product = PRODUCT_BY_POSITION.get(row.seed.position);
    return {
      position: row.seed.position,
      kind: row.kind,
      printedText: row.printedText,
      section: row.section,
      productId: product?.productId ?? null,
      productName: product?.productName ?? null,
    };
  });
}

async function readOnlySheet(content: Buffer): Promise<SheetRow[]> {
  const sheets = await readXlsxFile(content, { trim: false });
  expect(sheets).toHaveLength(1);
  return sheets[0].data as SheetRow[];
}

const COLUMNS = 7;

describe('Excel de la toma contra plantilla-inventario.xlsx (SPRINT-5-T08)', () => {
  let template: Buffer;
  let generated: Buffer;
  let templateRows: SheetRow[];
  let rows: SheetRow[];

  beforeAll(async () => {
    template = await readFile(TEMPLATE_PATH);
    const sheets = buildInventoryCountWorkbook({
      snapshot: realSnapshot(),
      lines: [FAJITA, SARRO, ...PREPARED],
    });
    expect(sheets.map((sheet) => sheet.name)).toEqual([INVENTORY_SHEET]);
    generated = await writeWorkbook(sheets);
    templateRows = await readOnlySheet(template);
    rows = await readOnlySheet(generated);
  });

  // Fila n de la hoja (1 es el encabezado).
  const excelRow = (sheet: SheetRow[], position: number): SheetRow =>
    sheet[position - 1];

  it('tiene una sola hoja con el encabezado y las 182 filas de la plantilla', () => {
    expect(rows).toHaveLength(INVENTORY_TEMPLATE_STRUCTURE.rows + 1);
    expect(rows).toHaveLength(templateRows.length);
    expect(rows[0]).toEqual(templateRows[0]);
  });

  it('deja Carne Fajita en la fila 4 y las secciones en las filas 45, 88, 141, 162 y 183', () => {
    expect(excelRow(rows, FAJITA_POSITION)[0]).toBe('Carne Fajita');
    for (const position of INVENTORY_TEMPLATE_STRUCTURE.sectionPositions) {
      expect(excelRow(rows, position)[0]).toBe(
        excelRow(templateRows, position)[0],
      );
    }
    expect(INVENTORY_TEMPLATE_STRUCTURE.sectionPositions).toEqual([
      45, 88, 141, 162, 183,
    ]);
  });

  it('Carne Fajita con 1 caja, 3 bolsas y 2,450 kg queda con G = 14,95', () => {
    expect(excelRow(rows, FAJITA_POSITION)).toEqual([
      'Carne Fajita',
      1,
      5,
      3,
      7.5,
      2.45,
      14.95,
    ]);
  });

  it('Sobre Eliminador de Sarro con 1 caja de 48 y 6 sueltos queda con G = 54', () => {
    expect(excelRow(rows, SARRO_POSITION)).toEqual([
      'Sobre Eliminador de Sarro',
      1,
      48,
      null,
      0,
      6,
      54,
    ]);
  });

  it('las demás filas quedan igual que la plantilla en blanco (texto, vacíos y ceros)', () => {
    for (let position = 2; position <= rows.length; position += 1) {
      if (position === FAJITA_POSITION || position === SARRO_POSITION) {
        continue;
      }
      const expected = [...excelRow(templateRows, position)];
      // Las filas con producto llevan su nombre, no el texto impreso.
      const product = PRODUCT_BY_POSITION.get(position);
      if (product !== undefined) expected[0] = product.productName;
      if (position === EMPTY_AFTER_PREPARED) {
        expect(expected).toEqual(['<Vacío>', null, null, null, null, null, 0]);
        expected[2] = 0;
        expected[4] = 0;
      }
      expect(excelRow(rows, position), `fila ${position}`).toEqual(expected);
    }
  });

  it('las cantidades son celdas numéricas, con formato 0,000 en kg', () => {
    const formats = readCellFormats(generated, 1);
    for (let column = 1; column < COLUMNS; column += 1) {
      const fajita = formats.get(cellReference(FAJITA_POSITION - 1, column));
      const sarro = formats.get(cellReference(SARRO_POSITION - 1, column));
      expect(fajita?.type).toBeUndefined();
      // Carne Fajita (kg): C, E, F y G con tres decimales.
      expect(fajita?.formatCode).toBe(
        [2, 4, 5, 6].includes(column) ? DECIMAL_QUANTITY_FORMAT : null,
      );
      // D vacía en el Sarro; el resto, número sin formato decimal.
      if (column !== 3) expect(sarro?.type).toBeUndefined();
      expect(sarro?.formatCode ?? null).toBeNull();
    }
  });

  it('copia los rellenos y las negritas de la plantilla en el encabezado y las filas de artículo', () => {
    const expected = readCellStyles(template, 1);
    const actual = readCellStyles(generated, 1);
    const sections = new Set<number>(
      INVENTORY_TEMPLATE_STRUCTURE.sectionPositions,
    );
    for (let position = 1; position <= rows.length; position += 1) {
      // El color de cada sección está pendiente de confirmar con el PO.
      if (sections.has(position)) continue;
      // La fila 20 (<Vacío> sin producto) va con el estilo de una fila de
      // artículo común; en la plantilla va en gris como los «(Preparado)».
      if (position === EMPTY_AFTER_PREPARED) continue;
      for (let column = 0; column < COLUMNS; column += 1) {
        const reference = cellReference(position - 1, column);
        expect(actual.get(reference), reference).toEqual(
          expected.get(reference),
        );
      }
    }
  });

  it('pinta las secciones de fondo oscuro con texto en negrita', () => {
    const styles = readCellStyles(generated, 1);
    for (const position of INVENTORY_TEMPLATE_STRUCTURE.sectionPositions) {
      expect(styles.get(cellReference(position - 1, 0))).toEqual({
        fill: '000000',
        bold: true,
      });
    }
  });

  it('usa el alto de filas y el ancho de columnas de la plantilla', () => {
    const expected = readRowHeights(template, 1);
    const actual = readRowHeights(generated, 1);
    for (let position = 1; position <= rows.length; position += 1) {
      expect(actual.get(position), `fila ${position}`).toBe(
        expected.get(position),
      );
    }
    const widths = readColumnWidths(generated, 1).slice(0, COLUMNS);
    readColumnWidths(template, 1)
      .slice(0, COLUMNS)
      .forEach((width, index) => {
        expect(widths[index]).toBeCloseTo(width, 1);
      });
  });

  it('se imprime vertical y ajustada a una hoja de ancho', () => {
    const xml = readSheetXml(generated, 1);
    expect(xml).toContain('<pageSetUpPr fitToPage="1"/>');
    expect(xml).toMatch(
      /<pageSetup orientation="portrait" fitToWidth="1" fitToHeight="0"\/>/,
    );
    // <sheetPr> es el primer hijo de <worksheet>, como exige el estándar.
    expect(xml).toMatch(/<worksheet[^>]*><sheetPr>/);
  });
});
