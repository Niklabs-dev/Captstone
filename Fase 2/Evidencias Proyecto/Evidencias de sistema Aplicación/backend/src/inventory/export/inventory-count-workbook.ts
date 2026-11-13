import type { Cell, Row } from 'write-excel-file/node';
import { BUSINESS_TIME_ZONE } from '../../audit/utils/business-day.util.js';
import {
  InventoryTemplateRowKind,
  type Prisma,
} from '../../generated/prisma/client.js';
import {
  storeSlug,
  type WorkbookSheet,
} from '../../tips/export/daily-tips-workbook.js';
import type { InventoryTemplateSnapshotRow } from '../types/inventory-counts.types.js';

// Contenido del Excel de una toma de inventario finalizada (SPRINT-5-T08).
// Funciones puras, sin NestJS, base de datos ni la librería de escritura.
//
// La hoja «Inventario» replica la plantilla impresa del 14-10-2026
// (docs/plantilla-inventario.xlsx): la fila 1 es el encabezado y cada fila de
// la copia de la plantilla (template_snapshot) va en su misma posición, así
// cada artículo queda en la fila que el local conoce. Las columnas son:
//   A ARTÍCULO: texto impreso de la fila.
//   B BULTO (CAJA): cajas contadas.
//   C BULTO RESTANTE: cajas × contenido por caja (kg, l o unidades).
//   D PAQUETE: paquetes contados.
//   E UNIDAD RESTANTES: paquetes × contenido por paquete.
//   F LINEA Y UNIDADES: cantidad suelta.
//   G RESTANTES: total contado (C + E + F, calculado al guardar la línea).
// Las cantidades son celdas numéricas. Un artículo sin contar, una fila
// <Vacío> o una fila sin texto quedan con las celdas vacías, para distinguir
// «no se contó» de «se contó 0». Las líneas de productos sin fila en la copia
// de la plantilla (su fila se liberó antes de finalizar) van al final, en un
// bloque propio, para no perder lo contado.
//
// La hoja «Datos» trae el local, la fecha de la toma, quién la inició y quién
// la finalizó, con la fecha-hora en hora de Chile.

export const INVENTORY_SHEET = 'Inventario';
export const DATA_SHEET = 'Datos';

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
  boxes: number | null;
  packages: number | null;
  looseQuantity: Prisma.Decimal | null;
  countedQuantity: Prisma.Decimal | null;
  boxContent: Prisma.Decimal | null;
  packageContent: Prisma.Decimal | null;
}

export interface InventoryCountWorkbookInput {
  storeName: string;
  // Fecha de la toma (YYYY-MM-DD).
  countDate: string;
  startedAt: Date;
  startedBy: string;
  finalizedAt: Date;
  finalizedBy: string;
  snapshot: readonly InventoryTemplateSnapshotRow[];
  lines: readonly InventoryCountExportLine[];
}

/** Productos contados y sin contar de la toma. */
export interface InventoryCountExportTotals {
  countedProducts: number;
  uncountedProducts: number;
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
  if (!Array.isArray(value) || !value.every(isSnapshotRow)) {
    throw new Error('La copia de la plantilla de la toma no es válida');
  }
  const rows = [...value].sort((left, right) => left.position - right.position);
  rows.forEach((row, index) => {
    if (index > 0 && rows[index - 1].position === row.position) {
      throw new Error(
        `La copia de la plantilla repite la posición ${row.position}`,
      );
    }
  });
  return rows;
}

// inventario_<local>_<fecha de la toma>.xlsx (fecha YYYY-MM-DD).
export function buildInventoryFileName(
  storeName: string,
  countDate: string,
): string {
  return `inventario_${storeSlug(storeName)}_${countDate}.xlsx`;
}

// Fecha-hora en hora de Chile como DD-MM-YYYY HH:mm.
export function formatChileDateTime(value: Date): string {
  const parts = new Intl.DateTimeFormat('es-CL', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((item) => item.type === type)?.value ?? '';
  return `${part('day')}-${part('month')}-${part('year')} ${part('hour')}:${part('minute')}`;
}

// YYYY-MM-DD → DD-MM-YYYY.
function displayDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-');
  return `${day}-${month}-${year}`;
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

function articleRow(
  text: string | null,
  quantities: LineQuantities | null,
  edges: RowEdges,
): Row {
  const values: (number | null)[] = quantities
    ? [
        quantities.boxes,
        quantities.boxesQuantity,
        quantities.packages,
        quantities.packagesQuantity,
        quantities.looseQuantity,
        quantities.countedQuantity,
      ]
    : [null, null, null, null, null, null];
  const first: Cell = {
    ...(text === null ? {} : { value: text, type: String }),
    ...FONT,
    ...borders(edges),
    height: ROW_HEIGHT,
    align: 'left',
    alignVertical: 'center',
  };
  return [
    first,
    ...values.map((value, index): Cell => ({
      ...(value === null ? {} : { value, type: Number }),
      ...FONT,
      ...borders(edges),
      height: ROW_HEIGHT,
      fontWeight: COLUMN_FILLS[index] === 'total' ? 'bold' : undefined,
      backgroundColor: FILL_COLOR[COLUMN_FILLS[index]],
      align: 'center',
      alignVertical: 'center',
    })),
  ];
}

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
  if (row.kind === InventoryTemplateRowKind.SECTION) {
    return sectionRow(row.text ?? '');
  }
  return articleRow(
    row.text,
    row.line === null ? null : lineQuantities(row.line),
    edges,
  );
}

// Filas 2 en adelante: cada fila de la copia en su posición (un hueco queda
// como fila vacía) y al final las líneas sin fila en la plantilla.
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
    rows.push({ kind: row.kind, text: row.printedText, line });
  }
  const unplaced = lines
    .filter((line) => !placed.has(line.productId))
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
          ? articleRow(null, null, edges)
          : toSheetRow(row, edges);
      }),
    ],
    columnWidths: COLUMN_WIDTHS,
    stickyRowsCount: 1,
    stickyColumnsCount: 1,
  };
}

// Hoja «Datos»: los datos de la toma, uno por fila (dato y valor).
export function buildDataSheet(
  input: InventoryCountWorkbookInput,
): WorkbookSheet {
  const totals = countTotals(input.lines);
  const label = (value: string): Cell => ({
    value,
    type: String,
    ...FONT,
    fontWeight: 'bold',
  });
  const text = (value: string): Cell => ({ value, type: String, ...FONT });
  const amount = (value: number): Cell => ({
    value,
    type: Number,
    ...FONT,
    align: 'left',
  });
  const rows: Row[] = [
    [label('Local'), text(input.storeName)],
    [label('Fecha de la toma'), text(displayDate(input.countDate))],
    [label('Estado'), text('Finalizada')],
    [label('Iniciada por'), text(input.startedBy)],
    [label('Iniciada el'), text(formatChileDateTime(input.startedAt))],
    [label('Finalizada por'), text(input.finalizedBy)],
    [label('Finalizada el'), text(formatChileDateTime(input.finalizedAt))],
    [label('Productos contados'), amount(totals.countedProducts)],
    [label('Productos sin contar'), amount(totals.uncountedProducts)],
  ];
  return {
    name: DATA_SHEET,
    rows,
    columnWidths: [24, 40],
    stickyRowsCount: 0,
    stickyColumnsCount: 0,
  };
}

export function buildInventoryCountWorkbook(
  input: InventoryCountWorkbookInput,
): WorkbookSheet[] {
  return [buildInventorySheet(input), buildDataSheet(input)];
}
