import { readFile } from 'node:fs/promises';
import readXlsxFile from 'read-excel-file/node';
import {
  INVENTORY_EMPTY_ITEM_TEXT,
  INVENTORY_TEMPLATE_FIRST_POSITION,
  INVENTORY_TEMPLATE_ROWS,
  resolveInventoryTemplate,
} from '../prisma/inventory-template.js';

// Compara el catálogo inicial del seed (SPRINT-5-T02) contra la plantilla en
// blanco del repositorio (docs/plantilla-inventario.xlsx): cantidad de
// artículos, orden, texto de cada fila y secciones. Si alguien edita la
// plantilla o el seed sin actualizar el otro, este test falla.
const TEMPLATE_PATH = new URL(
  '../docs/plantilla-inventario.xlsx',
  import.meta.url,
);

// Columnas de la hoja: A artículo, C bulto restante y E unidad restante.
const COLUMN_ARTICLE = 0;
const COLUMN_BOX_REMAINING = 2;
const COLUMN_UNIT_REMAINING = 4;

type Cell = string | number | boolean | Date | null;

async function readTemplateSheet(): Promise<Cell[][]> {
  const sheets = await readXlsxFile(await readFile(TEMPLATE_PATH), {
    trim: false,
  });
  expect(sheets).toHaveLength(1);
  return sheets[0].data as Cell[][];
}

describe('Catálogo inicial contra plantilla-inventario.xlsx (SPRINT-5-T02)', () => {
  let sheet: Cell[][];

  beforeAll(async () => {
    sheet = await readTemplateSheet();
  });

  it('la hoja tiene el encabezado y 182 filas de datos', () => {
    expect(sheet[0][COLUMN_ARTICLE]).toBe('ARTÍCULO');
    expect(sheet).toHaveLength(183);
  });

  it('el seed declara las 182 filas, de la 2 a la 183, sin errores', () => {
    const resolved = resolveInventoryTemplate(INVENTORY_TEMPLATE_ROWS);

    expect(resolved).toHaveLength(182);
    expect(resolved[0].seed.position).toBe(INVENTORY_TEMPLATE_FIRST_POSITION);
    expect(resolved.at(-1)?.seed.position).toBe(183);
  });

  it('140 artículos, 34 <Vacío>, 3 filas sin texto y 5 secciones', () => {
    const porTipo = INVENTORY_TEMPLATE_ROWS.reduce<Record<string, number>>(
      (acc, row) => ({ ...acc, [row.type]: (acc[row.type] ?? 0) + 1 }),
      {},
    );

    expect(porTipo).toEqual({ ARTICLE: 140, EMPTY: 34, BLANK: 3, SECTION: 5 });
  });

  it('cada fila tiene el texto exacto de la hoja en su misma posición', () => {
    const resolved = resolveInventoryTemplate(INVENTORY_TEMPLATE_ROWS);

    const diferencias = resolved
      .map((row) => ({
        position: row.seed.position,
        seed: row.printedText,
        hoja: sheet[row.seed.position - 1][COLUMN_ARTICLE],
      }))
      .filter((d) => d.seed !== d.hoja);
    expect(diferencias).toEqual([]);
  });

  it('las secciones cierran sus grupos en el orden de la hoja', () => {
    const resolved = resolveInventoryTemplate(INVENTORY_TEMPLATE_ROWS);
    const secciones = resolved
      .filter((r) => r.kind === 'SECTION')
      .map((r) => [r.seed.position, r.printedText]);

    expect(secciones).toEqual([
      [45, 'COSTO PROTEÍNAS, QUESO SALSAS (SUBTOTAL)'],
      [88, 'COSTO DE UNIDADES'],
      [141, 'COSTO DE BEBIDAS'],
      [162, 'COSTO DE VARIOS'],
      [183, 'ARTÍCULOS DE LIMPIEZA'],
    ]);
    // Cada fila pertenece a la sección que cierra su grupo.
    expect(resolved.find((r) => r.seed.position === 4)?.section).toBe(
      'COSTO PROTEÍNAS, QUESO SALSAS (SUBTOTAL)',
    );
    expect(resolved.find((r) => r.seed.position === 163)?.section).toBe(
      'ARTÍCULOS DE LIMPIEZA',
    );
  });

  it('«solo cantidad suelta» coincide con los artículos que en la hoja no admiten bultos ni unidades', () => {
    const sueltosEnHoja = INVENTORY_TEMPLATE_ROWS.filter(
      (row) => row.type === 'ARTICLE',
    )
      .filter((row) => {
        const fila = sheet[row.position - 1];
        return (
          fila[COLUMN_BOX_REMAINING] === null &&
          fila[COLUMN_UNIT_REMAINING] === null
        );
      })
      .map((row) => row.position);
    const sueltosEnSeed = INVENTORY_TEMPLATE_ROWS.filter(
      (row) => row.type === 'ARTICLE' && row.format?.looseOnly === true,
    ).map((row) => row.position);

    expect(sueltosEnSeed).toEqual([17, 18, 19]);
    expect(sueltosEnSeed).toEqual(sueltosEnHoja);
  });

  it('Carne Fajita (fila 4) trae caja de 5 kg con 2 bolsas de 2,5 kg y el resto queda sin formato', () => {
    const conFormato = INVENTORY_TEMPLATE_ROWS.filter(
      (row) =>
        row.type === 'ARTICLE' &&
        row.format !== undefined &&
        row.format.looseOnly !== true,
    );

    expect(conFormato).toEqual([
      {
        position: 4,
        type: 'ARTICLE',
        text: 'Carne Fajita (Beef Steak Saborizado)',
        unit: 'KG',
        format: {
          packageName: 'bolsa',
          boxContent: '5',
          packagesPerBox: 2,
          packageContent: '2.5',
        },
      },
    ]);
  });

  it('todos los artículos parten en kilos', () => {
    const unidades = new Set(
      INVENTORY_TEMPLATE_ROWS.flatMap((row) =>
        row.type === 'ARTICLE' ? [row.unit] : [],
      ),
    );

    expect([...unidades]).toEqual(['KG']);
  });

  it('carga las dos «Lata Fanta Zero» (filas 99 y 102) tal como vienen', () => {
    const fantaZero = INVENTORY_TEMPLATE_ROWS.filter(
      (row) => row.type === 'ARTICLE' && row.text === 'Lata Fanta Zero',
    ).map((row) => row.position);

    expect(fantaZero).toEqual([99, 102]);
  });

  it('la plantilla del repositorio está en blanco (sin cantidades reales)', () => {
    const conCantidades = sheet.slice(1).flatMap((fila, i) =>
      fila
        .slice(1)
        .filter((celda) => celda !== null && celda !== 0)
        .map(() => i + 2),
    );

    expect(conCantidades).toEqual([]);
    expect(INVENTORY_EMPTY_ITEM_TEXT).toBe('<Vacío>');
  });
});
