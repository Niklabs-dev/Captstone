import type { Cell, Row } from 'write-excel-file/node';
import {
  InventoryTemplateRowKind,
  type Prisma,
  UnitOfMeasure,
} from '../../generated/prisma/client.js';
import {
  storeSlug,
  type WorkbookSheet,
} from '../../tips/export/daily-tips-workbook.js';
import type { InventoryTemplateSnapshotRow } from '../types/inventory-counts.types.js';

// Contenido del Excel de una toma de inventario finalizada (SPRINT-5-T08).
// Funciones puras, sin NestJS, base de datos ni la librería de escritura.
//
// Una sola hoja, «Inventario», que replica la plantilla impresa del
// 14-10-2026 (docs/plantilla-inventario.xlsx): la fila 1 es el encabezado y
// cada fila de la copia de la plantilla (template_snapshot) va en su misma
// posición, así cada artículo queda en la fila que el local conoce y el PO
// puede copiar y pegar el Excel en su cuadre. Las columnas son:
//   A ARTÍCULO: nombre del producto al contarse, o el texto de la fila si no
//     tiene producto.
//   B BULTO (CAJA): cajas contadas.
//   C BULTO RESTANTE: cajas × contenido por caja (kg, l o unidades).
//   D PAQUETE: paquetes contados.
//   E UNIDAD RESTANTES: paquetes × contenido por paquete.
//   F LINEA Y UNIDADES: cantidad suelta.
//   G RESTANTES: total contado (C + E + F, calculado al guardar la línea).
// Las cantidades son celdas numéricas. Igual que la plantilla en blanco, en
// las filas de artículo (también las <Vacío>) C, E y G llevan 0 aunque no se
// haya contado nada, y B, D y F quedan vacías si no se informaron. Los
// productos «solo cantidad suelta» (los «(Preparado)») no tienen cajas ni
// paquetes: como en la plantilla, C y E quedan vacías. Las filas
// sin texto y las de sección no llevan números. Los productos contados sin
// fila en la copia de la plantilla (su fila se liberó antes de finalizar) van
// al final, en un bloque propio, para no perder lo contado.

export const INVENTORY_SHEET = 'Inventario';

/** Encabezados de la plantilla impresa (columnas A a G). */
export const INVENTORY_HEADERS = [
  'ARTÍCULO',
  'BULTO (CAJA)',
  'BULTO RESTANTE\n(KG-LTRS)',
  'PAQUETE (BOLSA-PAQUETES-BOTELLAS-OTROS)',
  'UNIDAD RESTANTES (KG-LTRS)',
  'LINEA Y UNIDADES (PESOS)',
  'RESTANTES\n(WISR CHILE)',
] as const;

/** Cierre del bloque de productos sin fila en la plantilla. */
export const UNPLACED_SECTION_LABEL = 'PRODUCTOS SIN FILA EN LA PLANTILLA';

/**
 * Posición máxima aceptada en la copia de la plantilla. La plantilla real
 * ocupa las filas 2 a 183; el tope evita que una copia corrupta con una
 * posición enorme arme un archivo gigante en memoria (la base solo exige
 * posición >= 2).
 */
export const MAX_SNAPSHOT_POSITION = 1_000;

/** Formato de las cantidades en kg y l (tres decimales, como la toma). */
export const DECIMAL_QUANTITY_FORMAT = '0.000';

// Anchos de las columnas A a G y alto de las filas, tomados de la plantilla.
const COLUMN_WIDTHS = [41.63, 13.26, 16.37, 20.13, 19.25, 17.75, 12.37];
const HEADER_HEIGHT = 50;
const ROW_HEIGHT = 17.25;

const FONT = { fontFamily: 'Arial', fontSize: 12 } as const;
const COLOR = {
  black: '#000000',
  white: '#FFFFFF',
  // Gris de las columnas calculadas (blanco con 15 % de sombra).
  computed: '#D9D9D9',
  // Gris del encabezado de las columnas calculadas (negro con 50 % de luz).
  computedHeader: '#7F7F7F',
  total: '#FFE285',
  totalHeader: '#FFC000',
} as const;

/** Línea de la toma con lo contado y la copia del formato del producto. */
export interface InventoryCountExportLine {
  productId: string;
  productName: string;
  unit: UnitOfMeasure;
  looseOnly: boolean;
  boxes: number | null;
  packages: number | null;
  looseQuantity: Prisma.Decimal | null;
  countedQuantity: Prisma.Decimal | null;
  boxContent: Prisma.Decimal | null;
  packageContent: Prisma.Decimal | null;
}

export interface InventoryCountWorkbookInput {
  snapshot: readonly InventoryTemplateSnapshotRow[];
  lines: readonly InventoryCountExportLine[];
}

/** Productos contados y sin contar de la toma. */
export interface InventoryCountExportTotals {
  countedProducts: number;
  uncountedProducts: number;
}

/** Copia de la plantilla de una toma que no se puede leer. */
export class InvalidTemplateSnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidTemplateSnapshotError';
  }
}

const ROW_KINDS: readonly string[] = Object.values(InventoryTemplateRowKind);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isSnapshotRow(value: unknown): value is InventoryTemplateSnapshotRow {
  return (
    isRecord(value) &&
    Number.isInteger(value.position) &&
    (value.position as number) >= 2 &&
    (value.position as number) <= MAX_SNAPSHOT_POSITION &&
    typeof value.kind === 'string' &&
    ROW_KINDS.includes(value.kind) &&
    isNullableString(value.printedText) &&
    typeof value.section === 'string' &&
    isNullableString(value.productId) &&
    isNullableString(value.productName)
  );
}

/**
 * Lee la copia de la plantilla guardada al finalizar (JSONB). Valida su forma
 * en vez de confiar en un cast: si no calza, la toma no se exporta.
 */
export function parseTemplateSnapshot(
  value: unknown,
): InventoryTemplateSnapshotRow[] {
  if (!Array.isArray(value)) {
    throw new InvalidTemplateSnapshotError(
      'La copia de la plantilla de la toma no es una lista',
    );
  }
  const invalid = value.findIndex((row) => !isSnapshotRow(row));
  if (invalid !== -1) {
    throw new InvalidTemplateSnapshotError(
      `La copia de la plantilla de la toma tiene una fila inválida (elemento ${invalid}; posición entre 2 y ${MAX_SNAPSHOT_POSITION})`,
    );
  }
  const rows = [...(value as InventoryTemplateSnapshotRow[])].sort(
    (left, right) => left.position - right.position,
  );
  rows.forEach((row, index) => {
    if (index > 0 && rows[index - 1].position === row.position) {
      throw new InvalidTemplateSnapshotError(
        `La copia de la plantilla de la toma repite la posición ${row.position}`,
      );
    }
  });
  return rows;
}

// YYYY-MM-DD → DD-MM-YYYY.
function displayDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-');
  return `${day}-${month}-${year}`;
}

// inventario-<local>-<DD-MM-AAAA>.xlsx, con el local en slug (sin tildes,
// espacios ni caracteres que rompan Content-Disposition) y la fecha de la
// toma.
export function buildInventoryFileName(
  storeName: string,
  countDate: string,
): string {
  return `inventario-${storeSlug(storeName)}-${displayDate(countDate)}.xlsx`;
}

export function countTotals(
  lines: readonly InventoryCountExportLine[],
): InventoryCountExportTotals {
  const countedProducts = lines.filter(
    (line) => line.countedQuantity !== null,
  ).length;
  return {
    countedProducts,
    uncountedProducts: lines.length - countedProducts,
  };
}

/** Cantidades de una línea contada, en el orden de las columnas B a G. */
export interface LineQuantities {
  boxes: number | null;
  boxesQuantity: number | null;
  packages: number | null;
  packagesQuantity: number | null;
  looseQuantity: number | null;
  countedQuantity: number;
}

// Cantidades de la línea; null si el producto no se contó. Las columnas C y E
// multiplican con aritmética decimal exacta (Prisma.Decimal) igual que el
// total de la línea (computeCountedQuantity), así C + E + F = G.
export function lineQuantities(
  line: InventoryCountExportLine,
): LineQuantities | null {
  if (line.countedQuantity === null) return null;
  const product = (
    count: number | null,
    content: Prisma.Decimal | null,
  ): number | null =>
    count === null || content === null ? null : content.times(count).toNumber();
  return {
    boxes: line.boxes,
    boxesQuantity: product(line.boxes, line.boxContent),
    packages: line.packages,
    packagesQuantity: product(line.packages, line.packageContent),
    looseQuantity:
      line.looseQuantity === null ? null : line.looseQuantity.toNumber(),
    countedQuantity: line.countedQuantity.toNumber(),
  };
}

// Valores de las columnas B a G de una fila de artículo. C, E y G son 0 si
// no hay nada contado, como la plantilla en blanco; B, D y F quedan vacías.
// En un producto «solo cantidad suelta» C y E quedan vacías.
export function articleValues(
  quantities: LineQuantities | null,
  looseOnly = false,
): (number | null)[] {
  if (looseOnly) {
    return [
      null,
      null,
      null,
      null,
      quantities?.looseQuantity ?? null,
      quantities?.countedQuantity ?? 0,
    ];
  }
  return [
    quantities?.boxes ?? null,
    quantities?.boxesQuantity ?? 0,
    quantities?.packages ?? null,
    quantities?.packagesQuantity ?? 0,
    quantities?.looseQuantity ?? null,
    quantities?.countedQuantity ?? 0,
  ];
}

type Fill = 'white' | 'computed' | 'total';

const FILL_COLOR: Record<Fill, string | undefined> = {
  white: undefined,
  computed: COLOR.computed,
  total: COLOR.total,
};

// Tipo de relleno de cada columna B a G en las filas de artículos.
const COLUMN_FILLS: readonly Fill[] = [
  'white',
  'computed',
  'white',
  'computed',
  'white',
  'total',
];

// En un producto «solo cantidad suelta» la plantilla pinta de gris también A,
// B y D: solo se llenan F y G.
const LOOSE_ONLY_FILLS: readonly Fill[] = [
  'computed',
  'computed',
  'computed',
  'computed',
  'white',
  'total',
];

// Columnas B a G que llevan cantidades en la unidad del producto (C, E, F y
// G); B y D son conteos enteros de cajas y paquetes.
const UNIT_COLUMNS: readonly boolean[] = [false, true, false, true, true, true];

interface RowEdges {
  // Primera fila del bloque (después del encabezado o de una sección).
  first: boolean;
  // Última fila del bloque (antes de una sección o al final).
  last: boolean;
}

function borders(edges: RowEdges) {
  return {
    leftBorderStyle: 'thin',
    rightBorderStyle: 'thin',
    topBorderStyle: edges.first ? 'thin' : 'dashed',
    bottomBorderStyle: edges.last ? 'thin' : 'dashed',
  } as const;
}

function headerCell(value: string, index: number): Cell {
  const computed = index === 2 || index === 4;
  const total = index === 6;
  return {
    value,
    type: String,
    ...FONT,
    height: HEADER_HEIGHT,
    fontWeight: computed ? undefined : 'bold',
    textColor: total ? COLOR.black : COLOR.white,
    backgroundColor: computed
      ? COLOR.computedHeader
      : total
        ? COLOR.totalHeader
        : COLOR.black,
    borderStyle: 'thin',
    align: index === 0 ? 'left' : 'center',
    alignVertical: 'center',
    wrap: true,
  };
}

// Fila de artículo (con números) o fila sin texto (values en null). line es
// la línea del producto de la fila, si la tiene.
function articleRow(
  text: string | null,
  values: readonly (number | null)[],
  line: InventoryCountExportLine | null,
  edges: RowEdges,
): Row {
  const decimal =
    line?.unit === UnitOfMeasure.KG || line?.unit === UnitOfMeasure.L;
  const fills = line?.looseOnly ? LOOSE_ONLY_FILLS : COLUMN_FILLS;
  const first: Cell = {
    ...(text === null ? {} : { value: text, type: String }),
    ...FONT,
    ...borders(edges),
    height: ROW_HEIGHT,
    backgroundColor: line?.looseOnly ? COLOR.computed : undefined,
    align: 'left',
    alignVertical: 'center',
  };
  return [
    first,
    ...values.map((value, index): Cell => ({
      ...(value === null ? {} : { value, type: Number }),
      ...(value !== null && decimal && UNIT_COLUMNS[index]
        ? { format: DECIMAL_QUANTITY_FORMAT }
        : {}),
      ...FONT,
      ...borders(edges),
      height: ROW_HEIGHT,
      fontWeight: fills[index] === 'total' ? 'bold' : undefined,
      backgroundColor: FILL_COLOR[fills[index]],
      align: 'center',
      alignVertical: 'center',
    })),
  ];
}

const NO_VALUES: readonly null[] = Array<null>(6).fill(null);

function sectionRow(text: string): Row {
  return INVENTORY_HEADERS.map((_header, index): Cell => ({
    ...(index === 0 ? { value: text, type: String } : {}),
    ...FONT,
    height: ROW_HEIGHT,
    fontWeight: 'bold',
    textColor: COLOR.white,
    backgroundColor: COLOR.black,
    borderStyle: 'thin',
    align: index === 0 ? 'left' : 'center',
    alignVertical: 'center',
  }));
}

// Fila de la hoja: artículo (con o sin producto), fila sin texto o sección.
interface SheetRow {
  kind: InventoryTemplateRowKind;
  text: string | null;
  line: InventoryCountExportLine | null;
}

function toSheetRow(row: SheetRow, edges: RowEdges): Row {
  switch (row.kind) {
    case InventoryTemplateRowKind.SECTION:
      return sectionRow(row.text ?? '');
    case InventoryTemplateRowKind.BLANK:
      return articleRow(row.text, NO_VALUES, null, edges);
    case InventoryTemplateRowKind.ITEM:
      return articleRow(
        row.text,
        articleValues(
          row.line === null ? null : lineQuantities(row.line),
          row.line?.looseOnly ?? false,
        ),
        row.line,
        edges,
      );
  }
}

// Texto de la columna A de una fila de la copia: el nombre del producto al
// contarse (copia de la línea, o la de la plantilla si no tiene línea) y el
// texto impreso solo si la fila no tiene producto.
function articleText(
  row: InventoryTemplateSnapshotRow,
  line: InventoryCountExportLine | null,
): string | null {
  if (row.kind !== InventoryTemplateRowKind.ITEM || row.productId === null) {
    return row.printedText;
  }
  return line?.productName ?? row.productName ?? row.printedText;
}

// Filas 2 en adelante: cada fila de la copia en su posición (un hueco queda
// como fila vacía) y al final los productos contados sin fila en la
// plantilla.
function sheetRows(
  snapshot: readonly InventoryTemplateSnapshotRow[],
  lines: readonly InventoryCountExportLine[],
): (SheetRow | null)[] {
  const lineByProduct = new Map(lines.map((line) => [line.productId, line]));
  const rows: (SheetRow | null)[] = [];
  const placed = new Set<string>();
  for (const row of snapshot) {
    while (rows.length < row.position - 2) rows.push(null);
    const line =
      row.productId === null
        ? null
        : (lineByProduct.get(row.productId) ?? null);
    if (line !== null) placed.add(line.productId);
    rows.push({ kind: row.kind, text: articleText(row, line), line });
  }
  const unplaced = lines
    .filter(
      (line) => line.countedQuantity !== null && !placed.has(line.productId),
    )
    .sort((left, right) => left.productName.localeCompare(right.productName));
  if (unplaced.length > 0) {
    for (const line of unplaced) {
      rows.push({
        kind: InventoryTemplateRowKind.ITEM,
        text: line.productName,
        line,
      });
    }
    rows.push({
      kind: InventoryTemplateRowKind.SECTION,
      text: UNPLACED_SECTION_LABEL,
      line: null,
    });
  }
  return rows;
}

// Hoja «Inventario»: encabezado de la plantilla y una fila por posición.
// Se imprime vertical y ajustada a una hoja de ancho, como la plantilla.
export function buildInventorySheet(
  input: InventoryCountWorkbookInput,
): WorkbookSheet {
  const rows = sheetRows(input.snapshot, input.lines);
  const isSection = (index: number): boolean =>
    rows[index]?.kind === InventoryTemplateRowKind.SECTION;
  return {
    name: INVENTORY_SHEET,
    rows: [
      INVENTORY_HEADERS.map(headerCell),
      ...rows.map((row, index): Row => {
        const edges: RowEdges = {
          first: index === 0 || isSection(index - 1),
          last: index === rows.length - 1 || isSection(index + 1),
        };
        return row === null
          ? articleRow(null, NO_VALUES, null, edges)
          : toSheetRow(row, edges);
      }),
    ],
    columnWidths: COLUMN_WIDTHS,
    stickyRowsCount: 1,
    stickyColumnsCount: 1,
    fitToPageWidth: true,
  };
}

export function buildInventoryCountWorkbook(
  input: InventoryCountWorkbookInput,
): WorkbookSheet[] {
  return [buildInventorySheet(input)];
}
