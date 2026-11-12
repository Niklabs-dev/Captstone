// =============================================================
// Carga de la estructura de la plantilla de inventario (SPRINT-5-T02).
//
// Cada fila de la hoja Excel (desde la 2; la 1 es el encabezado) se guarda
// en `inventory_template_rows` con su posición fija, su tipo, su texto
// impreso y su sección. La carga NO crea productos: el administrador los
// crea a mano con el SKU del proveedor y los ubica en su fila (SPRINT-5-T03 y
// T04). Decisión del Product Owner del 11/11/2026.
//
// Reglas de la carga (corre en cada despliegue y no es destructiva):
// - Antes de escribir valida la estructura completa: cantidad de filas,
//   posiciones consecutivas, filas por tipo y posición de cada sección. Desde
//   SPRINT-5-T01 la base no permite borrar filas ni cambiar su posición o su
//   tipo, así que un error de carga no se podría corregir después.
// - Solo inserta las filas que faltan. Una fila que ya existe no se toca: no
//   se pisa el texto que editó el administrador ni se desasigna su producto.
// - Si el texto de una fila existente difiere del de la plantilla, no se
//   sobrescribe: se informa en `textDifferences` para que el administrador lo
//   corrija desde la aplicación. La plantilla cambia seguido y es temporal
//   (el cuadre pasará a la aplicación), así que el texto vigente lo mantiene
//   el administrador y no cada despliegue (decisión del PO del 12/11/2026).
// - Si la plantilla cambia el tipo de una fila existente, la carga se detiene
//   antes de escribir nada.
// - Toda la carga corre en una transacción.
//
// Los formatos que trae la caché de «BASE DE DATOS» quedan en
// INVENTORY_REFERENCE_FORMATS como referencia para el administrador y los
// tests; no se cargan.
// =============================================================
import {
  InventoryTemplateRowKind,
  Prisma,
  PrismaClient,
  UnitOfMeasure,
} from '../src/generated/prisma/client.js';

/** Texto de las filas de artículo libres de la plantilla. */
export const INVENTORY_EMPTY_ITEM_TEXT = '<Vacío>';

/** Primera fila de datos de la hoja (la 1 es el encabezado). */
export const INVENTORY_TEMPLATE_FIRST_POSITION = 2;

const MAX_TEXT_LENGTH = 120;
/**
 * Formato de referencia de un artículo, tomado de la caché de «BASE DE
 * DATOS» de la plantilla del 14-10-2026. Los contenidos van como texto
 * decimal ('2.5'). El contenido por caja y el del paquete son independientes
 * (Pepperoni: caja de 7,3 kg y paquetes de 0,93 kg).
 */
export interface InventoryReferenceFormat {
  position: number;
  text: string;
  unit: UnitOfMeasure;
  packageName?: string;
  boxContent?: string;
  packagesPerBox?: number;
  packageContent?: string;
  looseOnly?: boolean;
}

/** Fila de artículo con el nombre impreso. */
export interface InventoryArticleRowSeed {
  position: number;
  type: 'ARTICLE';
  text: string;
}

/** Fila de artículo libre, con el texto `<Vacío>`. */
export interface InventoryEmptyRowSeed {
  position: number;
  type: 'EMPTY';
}

/** Fila sin texto. */
export interface InventoryBlankRowSeed {
  position: number;
  type: 'BLANK';
}

/** Fila de sección: cierra el grupo de filas que la preceden. */
export interface InventorySectionRowSeed {
  position: number;
  type: 'SECTION';
  text: string;
}

export type InventoryTemplateRowSeed =
  | InventoryArticleRowSeed
  | InventoryEmptyRowSeed
  | InventoryBlankRowSeed
  | InventorySectionRowSeed;

/** Fila lista para guardar, con su tipo de la base y su sección resuelta. */
export interface ResolvedInventoryTemplateRow {
  seed: InventoryTemplateRowSeed;
  kind: InventoryTemplateRowKind;
  printedText: string | null;
  section: string;
}

/** Fila existente cuyo texto en la base no coincide con el de la plantilla. */
export interface InventoryTemplateTextDifference {
  position: number;
  /** Texto guardado en la base (el que se imprime hoy). */
  current: string | null;
  /** Texto que trae la plantilla del repositorio. */
  template: string | null;
}

export interface InventoryTemplateSeedResult {
  rowsCreated: number;
  /** Filas que ya existían y no se tocaron. */
  rowsKept: number;
  /** Filas existentes con un texto distinto al de la plantilla (no se pisan). */
  textDifferences: InventoryTemplateTextDifference[];
}

/** Estructura esperada de la plantilla, validada antes de escribir. */
export interface InventoryTemplateStructure {
  rows: number;
  articles: number;
  empty: number;
  blank: number;
  sectionPositions: readonly number[];
}

/** Estructura de docs/plantilla-inventario.xlsx (filas 2 a 183). */
export const INVENTORY_TEMPLATE_STRUCTURE: InventoryTemplateStructure = {
  rows: 182,
  articles: 140,
  empty: 34,
  blank: 3,
  sectionPositions: [45, 88, 141, 162, 183],
};

function article(position: number, text: string): InventoryArticleRowSeed {
  return { position, type: 'ARTICLE', text };
}

function empty(position: number): InventoryEmptyRowSeed {
  return { position, type: 'EMPTY' };
}

function blank(position: number): InventoryBlankRowSeed {
  return { position, type: 'BLANK' };
}

function section(position: number, text: string): InventorySectionRowSeed {
  return { position, type: 'SECTION', text };
}

// Filas 2 a 183 de backend/docs/plantilla-inventario.xlsx (plantilla del
// 04/11/2026 entregada por el PO): 140 artículos, 34 `<Vacío>`, 3 sin texto y
// 5 secciones, en el orden de la hoja. El test
// inventory-template-xlsx.spec.ts las compara contra el archivo. «Lata Fanta
// Zero» aparece dos veces (filas 99 y 102) y se carga tal cual.
export const INVENTORY_TEMPLATE_ROWS: readonly InventoryTemplateRowSeed[] = [
  article(2, 'Atún'),
  article(3, 'Carne Mechada'),
  article(4, 'Carne Fajita (Beef Steak Saborizado)'),
  article(5, 'Costilla BBQ (BBQ Ribs)'),
  article(6, 'Jamón de Cerdo (Jamón Praga)'),
  article(7, 'Pollo Apanado'),
  article(8, 'Pechuga de Pollo (Chicken Patty)'),
  article(9, 'Pepperoni'),
  article(10, 'Pollo Asado (Chicken Rotisserie)'),
  article(11, 'Salame'),
  article(12, 'Tocino (Bacon Asado)'),
  article(13, 'Tiras de pollo'),
  article(14, 'Mechada de cerdo'),
  empty(15),
  empty(16),
  article(17, 'Atún (Preparado)'),
  article(18, 'Pollo Teriyaki (Preparado)'),
  article(19, 'Meat Lover (Preparado)'),
  empty(20),
  article(21, 'Queso Mozzarella Laminado'),
  article(22, 'Queso Cheddar Laminado'),
  blank(23),
  blank(24),
  empty(25),
  article(26, 'Salsa Ajo'),
  article(27, 'Salsa Ajo (Hellmanns)'),
  article(28, 'Salsa BBQ'),
  article(29, 'Salsa Cebolla Dulce'),
  article(30, 'Salsa Chipotle'),
  article(31, 'Salsa Kétchup'),
  article(32, 'Salsa Marinara (Malloa)'),
  article(33, 'Salsa Mayonesa Hellmanns'),
  article(34, 'Salsa Mostaza (JB)'),
  article(35, 'Salsa Mostaza Dulce'),
  article(36, 'Salsa Teriyaki'),
  empty(37),
  empty(38),
  empty(39),
  article(40, 'Cebollita Crispy (Cebolla Frita)'),
  empty(41),
  empty(42),
  empty(43),
  empty(44),
  section(45, 'COSTO PROTEÍNAS, QUESO SALSAS (SUBTOTAL)'),
  article(46, 'Pan Blanco'),
  article(47, 'Pan Integral'),
  article(48, 'Plato de Ensalada'),
  article(49, 'Tapa para Plato de Ensalada'),
  article(50, 'Wrap'),
  article(51, 'Topping Avena Miel'),
  article(52, 'Topping Orégano Parmesano'),
  article(53, 'Topping Mantequilla Ajo'),
  empty(54),
  article(55, 'Aceite Oliva'),
  article(56, 'Limón'),
  article(57, 'Orégano Entero'),
  article(58, 'Sal'),
  article(59, 'Sal en Sachet'),
  article(60, 'Vinagre'),
  article(61, 'Aceitunas'),
  article(62, 'Pepinillo nuevo'),
  article(63, 'Palta Puré'),
  article(64, 'Jalapeño'),
  blank(65),
  article(66, 'Cebolla Morada'),
  article(67, 'Lechuga'),
  article(68, 'Pepino'),
  article(69, 'Pimentón Verde'),
  article(70, 'Tomate'),
  article(71, 'Bolsa Kraft (Delivery)'),
  article(72, 'Bolsa para Sándwich Subway'),
  article(73, 'Envoltura con Impresión p/15cm'),
  article(74, 'Envoltura con Impresión p/Footlong'),
  article(75, 'Etiquetas Sub'),
  article(76, 'Guante Polietileno'),
  article(77, 'Papel Deli'),
  article(78, 'Servilletas SW'),
  article(79, 'Cuchara'),
  article(80, 'Cuchillo'),
  article(81, 'Tenedor'),
  empty(82),
  empty(83),
  empty(84),
  empty(85),
  empty(86),
  empty(87),
  section(88, 'COSTO DE UNIDADES'),
  article(89, 'Jarabe de Jugo'),
  article(90, 'Jarabe Coca Cola'),
  article(91, 'Jarabe Coca Cola Zero'),
  article(92, 'Jarabe Fanta Zero'),
  article(93, 'Jarabe Sprite Zero'),
  article(94, 'CO2'),
  article(95, 'Lata Coca Cola'),
  article(96, 'Lata Coca Cola Light'),
  article(97, 'Lata Coca Cola Zero'),
  article(98, 'Lata Fanta'),
  article(99, 'Lata Fanta Zero'),
  article(100, 'Lata Sprite'),
  article(101, 'Lata Sprite Zero'),
  article(102, 'Lata Fanta Zero'),
  article(103, 'Lata Schweppes Zero'),
  article(104, 'Lata bebida (Otros sabores)'),
  article(105, 'Agua Mineral con gas'),
  article(106, 'Agua Mineral sin gas'),
  article(107, 'Agua Saborizada Aquarius'),
  article(108, 'Jugo Boca Ancha'),
  article(109, 'Jugo Boca Ancha Durazno Light'),
  article(110, 'Jugo Boca Ancha Naranja'),
  article(111, 'Jugo Boca Ancha Naranja Light'),
  article(112, 'Jugo Boca Ancha Piña'),
  article(113, 'Jugo Boca Ancha Piña Light'),
  article(114, 'Otros Jugos'),
  article(115, 'Te Frio Berries'),
  article(116, 'Te Frio Limonada'),
  article(117, 'Azúcar Sachet'),
  article(118, 'Cubrevaso 8/10 oz.'),
  article(119, 'Revolvedor de Café'),
  article(120, 'Sucralosa Sachet'),
  article(121, 'Tapa Vaso p/Café Sub 6 oz.'),
  article(122, 'Tapa Vaso Sub 14/16/21 oz.'),
  article(123, 'Tapa Vaso Sub 9/12 oz.'),
  article(124, 'Vaso p/Café Sub 6 oz.'),
  article(125, 'Vaso Cafe 12 oz. (350cc)'),
  article(126, 'Vaso Cafe 16 oz. (0,3 L)'),
  article(127, 'Vaso Sub 18 oz. (0,4 L)'),
  empty(128),
  empty(129),
  empty(130),
  article(131, 'Café en Grano'),
  article(132, 'Cappuccino Vainilla'),
  article(133, 'Chocolate'),
  article(134, 'Leche en Polvo Descremada'),
  article(135, 'Té Chai Latte'),
  article(136, 'Moccacciono'),
  article(137, 'Cappuccino'),
  article(138, 'Milo'),
  empty(139),
  empty(140),
  section(141, 'COSTO DE BEBIDAS'),
  article(142, 'Papas Fritas Americanas'),
  article(143, 'Papas Rejillas'),
  empty(144),
  article(145, 'GalletaDoble choco/Chip'),
  article(146, 'Galleta Chocolate c/Chip'),
  article(147, 'Galleta Frambuesa c/Chip'),
  article(148, 'Galleta Macadamia'),
  empty(149),
  article(150, 'Bolsa Galleta'),
  article(151, 'Caja Papas Rejilla'),
  article(152, 'Pack Footlong Cookie'),
  empty(153),
  empty(154),
  empty(155),
  empty(156),
  empty(157),
  empty(158),
  empty(159),
  empty(160),
  empty(161),
  section(162, 'COSTO DE VARIOS'),
  article(163, 'Botella: Desengrasante'),
  article(164, 'Botella: Limpiador Baños'),
  article(165, 'Botella: Limpiador Blanqueador de Tabla'),
  article(166, 'Botella: Limpiador Horno'),
  article(167, 'Botella: Limpiador Parrilla y Tostador'),
  article(168, 'Botella: Pulidor de Acero'),
  article(169, 'Otros: Alcohol Gel'),
  article(170, 'Otros: Almohadilla Parrilla'),
  article(171, 'Otros: Bolsa de Basura'),
  article(172, 'Otros: Gorro Negro Redecilla 1X100'),
  article(173, 'Otros: Jabón de manos'),
  article(174, 'Otros: Papel Higiénico'),
  article(175, 'Otros: Tiras PH'),
  article(176, 'Otros: Toalla Absorbente'),
  article(177, 'Sobre: Detergente Multifregadero'),
  article(178, 'Sobre: Eliminador de Sarro'),
  article(179, 'Sobre: Lavado de Vegetales'),
  article(180, 'Sobre: Limpiador Multisuperficie'),
  article(181, 'Sobre: Limpiador Piso'),
  article(182, 'Sobre: Sanitizante de Utensilios'),
  section(183, 'ARTÍCULOS DE LIMPIEZA'),
];

/**
 * Formatos de referencia de la caché de «BASE DE DATOS» (no se cargan). Los
 * artículos «(Preparado)» solo admiten la cantidad suelta en la hoja.
 */
export const INVENTORY_REFERENCE_FORMATS: readonly InventoryReferenceFormat[] =
  [
    {
      position: 4,
      text: 'Carne Fajita (Beef Steak Saborizado)',
      unit: UnitOfMeasure.KG,
      packageName: 'bolsa',
      boxContent: '5',
      packagesPerBox: 2,
      packageContent: '2.5',
    },
    {
      position: 9,
      text: 'Pepperoni',
      unit: UnitOfMeasure.KG,
      packageName: 'paquete',
      boxContent: '7.3',
      packageContent: '0.93',
    },
    {
      position: 17,
      text: 'Atún (Preparado)',
      unit: UnitOfMeasure.KG,
      looseOnly: true,
    },
    {
      position: 18,
      text: 'Pollo Teriyaki (Preparado)',
      unit: UnitOfMeasure.KG,
      looseOnly: true,
    },
    {
      position: 19,
      text: 'Meat Lover (Preparado)',
      unit: UnitOfMeasure.KG,
      looseOnly: true,
    },
    {
      position: 46,
      text: 'Pan Blanco',
      unit: UnitOfMeasure.UNIT,
      boxContent: '70',
    },
  ];

function kindOf(row: InventoryTemplateRowSeed): InventoryTemplateRowKind {
  switch (row.type) {
    case 'ARTICLE':
    case 'EMPTY':
      return InventoryTemplateRowKind.ITEM;
    case 'BLANK':
      return InventoryTemplateRowKind.BLANK;
    case 'SECTION':
      return InventoryTemplateRowKind.SECTION;
  }
}

function printedTextOf(row: InventoryTemplateRowSeed): string | null {
  switch (row.type) {
    case 'ARTICLE':
    case 'SECTION':
      return row.text;
    case 'EMPTY':
      return INVENTORY_EMPTY_ITEM_TEXT;
    case 'BLANK':
      return null;
  }
}

function textErrors(position: number, text: string, label: string): string[] {
  const errors: string[] = [];
  if (text.trim() === '') {
    errors.push(`Fila ${position}: ${label} vacío.`);
  } else if (text !== text.trim()) {
    errors.push(
      `Fila ${position}: ${label} con espacios al inicio o al final.`,
    );
  }
  if (text.length > MAX_TEXT_LENGTH) {
    errors.push(
      `Fila ${position}: ${label} de más de ${MAX_TEXT_LENGTH} caracteres.`,
    );
  }
  return errors;
}

/**
 * Valida la plantilla y resuelve el tipo, el texto impreso y la sección de
 * cada fila. La sección de una fila es el rótulo de la primera fila SECTION
 * en o después de ella (la sección cierra su grupo). Lanza un Error con
 * todos los problemas encontrados.
 */
export function resolveInventoryTemplate(
  rows: readonly InventoryTemplateRowSeed[],
): ResolvedInventoryTemplateRow[] {
  const errors: string[] = [];

  rows.forEach((row, index) => {
    if (!Number.isInteger(row.position)) {
      errors.push(`Posición ${row.position} no es un entero.`);
    } else if (
      index === 0 &&
      row.position < INVENTORY_TEMPLATE_FIRST_POSITION
    ) {
      errors.push(
        `Fila ${row.position}: la fila 1 es el encabezado; los datos parten en la ${INVENTORY_TEMPLATE_FIRST_POSITION}.`,
      );
    } else if (index > 0 && row.position !== rows[index - 1].position + 1) {
      errors.push(
        `Fila ${row.position}: las posiciones deben ser consecutivas (la anterior es ${rows[index - 1].position}).`,
      );
    }

    if (row.type === 'ARTICLE') {
      errors.push(...textErrors(row.position, row.text, 'nombre'));
      if (row.text.trim() === INVENTORY_EMPTY_ITEM_TEXT) {
        errors.push(
          `Fila ${row.position}: «${INVENTORY_EMPTY_ITEM_TEXT}» se declara como EMPTY, no como artículo.`,
        );
      }
    } else if (row.type === 'SECTION') {
      errors.push(...textErrors(row.position, row.text, 'rótulo de sección'));
    }
  });

  // Sección de cada fila: la siguiente fila SECTION (inclusive).
  const sections: (string | null)[] = new Array<string | null>(rows.length);
  let next: string | null = null;
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i];
    if (row.type === 'SECTION') next = row.text;
    sections[i] = next;
  }
  const withoutSection = rows.filter((_, i) => sections[i] === null);
  if (withoutSection.length > 0) {
    errors.push(
      `Filas sin una sección que las cierre: ${withoutSection.map((r) => r.position).join(', ')}.`,
    );
  }

  if (errors.length > 0) {
    throw new Error(
      `Plantilla de inventario inválida:\n- ${errors.join('\n- ')}`,
    );
  }

  return rows.map((seed, i) => ({
    seed,
    kind: kindOf(seed),
    printedText: printedTextOf(seed),
    section: sections[i] ?? '',
  }));
}

/**
 * Compara la plantilla con su estructura esperada: cantidad de filas, filas
 * por tipo y posición de cada sección. Devuelve los problemas encontrados.
 */
export function inventoryTemplateStructureErrors(
  rows: readonly InventoryTemplateRowSeed[],
  structure: InventoryTemplateStructure,
): string[] {
  const errors: string[] = [];
  const count = (type: InventoryTemplateRowSeed['type']): number =>
    rows.filter((row) => row.type === type).length;
  const expected: [string, number, number][] = [
    ['filas', rows.length, structure.rows],
    ['artículos', count('ARTICLE'), structure.articles],
    ['filas <Vacío>', count('EMPTY'), structure.empty],
    ['filas sin texto', count('BLANK'), structure.blank],
    ['secciones', count('SECTION'), structure.sectionPositions.length],
  ];
  for (const [label, actual, wanted] of expected) {
    if (actual !== wanted) {
      errors.push(`Se esperaban ${wanted} ${label} y hay ${actual}.`);
    }
  }
  const sections = rows
    .filter((row) => row.type === 'SECTION')
    .map((row) => row.position);
  if (sections.join(',') !== structure.sectionPositions.join(',')) {
    errors.push(
      `Las secciones deben estar en las filas ${structure.sectionPositions.join(', ')} y están en ${sections.join(', ') || 'ninguna'}.`,
    );
  }
  return errors;
}

type SeedClient = PrismaClient | Prisma.TransactionClient;

/**
 * Carga la estructura de la plantilla (ver reglas al inicio del archivo).
 * Valida todo y compara los tipos contra las filas existentes antes de
 * escribir, para no dejar una carga a medias por un error de datos.
 */
export async function seedInventoryTemplate(
  db: SeedClient,
  rows: readonly InventoryTemplateRowSeed[],
  structure: InventoryTemplateStructure = INVENTORY_TEMPLATE_STRUCTURE,
): Promise<InventoryTemplateSeedResult> {
  const resolved = resolveInventoryTemplate(rows);
  const structural = inventoryTemplateStructureErrors(rows, structure);
  if (structural.length > 0) {
    throw new Error(
      `La plantilla de inventario no tiene la estructura esperada:\n- ${structural.join('\n- ')}`,
    );
  }
  // Un TransactionClient no expone $transaction: con un cliente completo
  // (incluido uno extendido) se abre la transacción aquí.
  if ('$transaction' in db && typeof db.$transaction === 'function') {
    return db.$transaction((tx) => syncInventoryTemplate(tx, resolved), {
      maxWait: 30_000,
      timeout: 120_000,
    });
  }
  return syncInventoryTemplate(db, resolved);
}

async function syncInventoryTemplate(
  db: Prisma.TransactionClient,
  resolved: readonly ResolvedInventoryTemplateRow[],
): Promise<InventoryTemplateSeedResult> {
  const result: InventoryTemplateSeedResult = {
    rowsCreated: 0,
    rowsKept: 0,
    textDifferences: [],
  };
  if (resolved.length === 0) return result;

  const existing = await db.inventoryTemplateRow.findMany({
    where: { position: { in: resolved.map((r) => r.seed.position) } },
    select: { position: true, kind: true, printedText: true },
  });
  const byPosition = new Map(existing.map((e) => [e.position, e.kind]));
  const textByPosition = new Map(
    existing.map((e) => [e.position, e.printedText]),
  );

  const conflicts = resolved
    .filter((r) => {
      const kind = byPosition.get(r.seed.position);
      return kind !== undefined && kind !== r.kind;
    })
    .map(
      (r) =>
        `fila ${r.seed.position}: es ${byPosition.get(r.seed.position)} y la plantilla la declara ${r.kind}`,
    );
  if (conflicts.length > 0) {
    throw new Error(
      `La plantilla cambia el tipo de filas existentes (son fijas): ${conflicts.join('; ')}.`,
    );
  }

  result.textDifferences = resolved
    .filter(
      (r) =>
        textByPosition.has(r.seed.position) &&
        textByPosition.get(r.seed.position) !== r.printedText,
    )
    .map((r) => ({
      position: r.seed.position,
      current: textByPosition.get(r.seed.position) ?? null,
      template: r.printedText,
    }));

  const missing = resolved.filter((r) => !byPosition.has(r.seed.position));
  if (missing.length > 0) {
    const created = await db.inventoryTemplateRow.createMany({
      data: missing.map((r) => ({
        position: r.seed.position,
        kind: r.kind,
        printedText: r.printedText,
        section: r.section,
      })),
    });
    result.rowsCreated = created.count;
  }
  result.rowsKept = resolved.length - missing.length;
  return result;
}
