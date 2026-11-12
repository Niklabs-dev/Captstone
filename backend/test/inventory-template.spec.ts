import {
  INVENTORY_EMPTY_ITEM_TEXT,
  INVENTORY_TEMPLATE_ROWS,
  INVENTORY_TEMPLATE_STRUCTURE,
  type InventoryTemplateRowSeed,
  inventoryTemplateStructureErrors,
  resolveInventoryTemplate,
} from '../prisma/inventory-template.js';

// Tests unitarios de la validación de la plantilla de inventario
// (SPRINT-5-T02): tipos, texto impreso, sección resuelta y errores de datos.
// No usan base de datos.

const VALID: InventoryTemplateRowSeed[] = [
  {
    position: 2,
    type: 'ARTICLE',
    text: 'Carne Fajita (Beef Steak Saborizado)',
  },
  { position: 3, type: 'EMPTY' },
  { position: 4, type: 'BLANK' },
  { position: 5, type: 'SECTION', text: 'COSTO PROTEÍNAS' },
  { position: 6, type: 'ARTICLE', text: 'Lata Fanta Zero' },
  { position: 7, type: 'SECTION', text: 'COSTO DE BEBIDAS' },
];

function withRow(
  index: number,
  row: InventoryTemplateRowSeed,
): InventoryTemplateRowSeed[] {
  return VALID.map((r, i) => (i === index ? row : r));
}

describe('Plantilla de inventario (SPRINT-5-T02)', () => {
  describe('resolveInventoryTemplate', () => {
    it('resuelve el tipo, el texto impreso y la sección que cierra cada grupo', () => {
      const resolved = resolveInventoryTemplate(VALID);

      expect(
        resolved.map((r) => [
          r.seed.position,
          r.kind,
          r.printedText,
          r.section,
        ]),
      ).toEqual([
        [2, 'ITEM', 'Carne Fajita (Beef Steak Saborizado)', 'COSTO PROTEÍNAS'],
        [3, 'ITEM', INVENTORY_EMPTY_ITEM_TEXT, 'COSTO PROTEÍNAS'],
        [4, 'BLANK', null, 'COSTO PROTEÍNAS'],
        [5, 'SECTION', 'COSTO PROTEÍNAS', 'COSTO PROTEÍNAS'],
        [6, 'ITEM', 'Lata Fanta Zero', 'COSTO DE BEBIDAS'],
        [7, 'SECTION', 'COSTO DE BEBIDAS', 'COSTO DE BEBIDAS'],
      ]);
    });

    it('acepta una plantilla vacía', () => {
      expect(resolveInventoryTemplate([])).toEqual([]);
    });

    it('acepta dos artículos con el mismo nombre en filas distintas', () => {
      const rows: InventoryTemplateRowSeed[] = [
        { position: 2, type: 'ARTICLE', text: 'Lata Fanta Zero' },
        { position: 3, type: 'ARTICLE', text: 'Lata Fanta Zero' },
        { position: 4, type: 'SECTION', text: 'COSTO DE BEBIDAS' },
      ];

      expect(resolveInventoryTemplate(rows)).toHaveLength(3);
    });

    it('rechaza la fila 1, que es el encabezado', () => {
      const rows: InventoryTemplateRowSeed[] = [
        { position: 1, type: 'SECTION', text: 'ARTÍCULO' },
      ];

      expect(() => resolveInventoryTemplate(rows)).toThrow(
        /la fila 1 es el encabezado/,
      );
    });

    it('rechaza posiciones no consecutivas', () => {
      const rows = withRow(1, { position: 9, type: 'EMPTY' });

      expect(() => resolveInventoryTemplate(rows)).toThrow(
        /Fila 9: las posiciones deben ser consecutivas/,
      );
    });

    it('rechaza filas sin una sección que las cierre', () => {
      const rows: InventoryTemplateRowSeed[] = [
        ...VALID,
        { position: 8, type: 'BLANK' },
      ];

      expect(() => resolveInventoryTemplate(rows)).toThrow(
        /Filas sin una sección que las cierre: 8/,
      );
    });

    it('rechaza un nombre vacío, con espacios sobrantes o declarado como <Vacío>', () => {
      expect(() =>
        resolveInventoryTemplate(
          withRow(4, { position: 6, type: 'ARTICLE', text: ' ' }),
        ),
      ).toThrow(/Fila 6: nombre vacío/);
      expect(() =>
        resolveInventoryTemplate(
          withRow(4, {
            position: 6,
            type: 'ARTICLE',
            text: 'Lata Fanta Zero ',
          }),
        ),
      ).toThrow(/Fila 6: nombre con espacios/);
      expect(() =>
        resolveInventoryTemplate(
          withRow(4, {
            position: 6,
            type: 'ARTICLE',
            text: INVENTORY_EMPTY_ITEM_TEXT,
          }),
        ),
      ).toThrow(/se declara como EMPTY/);
    });

    it('rechaza un nombre de más de 120 caracteres', () => {
      const rows = withRow(4, {
        position: 6,
        type: 'ARTICLE',
        text: 'x'.repeat(121),
      });

      expect(() => resolveInventoryTemplate(rows)).toThrow(
        /más de 120 caracteres/,
      );
    });

    it('informa todos los errores de una vez', () => {
      const rows: InventoryTemplateRowSeed[] = [
        { position: 2, type: 'ARTICLE', text: '' },
        { position: 4, type: 'BLANK' },
      ];

      expect(() => resolveInventoryTemplate(rows)).toThrow(
        /Fila 2: nombre vacío[\s\S]*Fila 4: las posiciones[\s\S]*sin una sección/,
      );
    });
  });

  describe('inventoryTemplateStructureErrors', () => {
    const structure = {
      rows: 6,
      articles: 2,
      empty: 1,
      blank: 1,
      sectionPositions: [5, 7],
    };

    it('acepta una plantilla con la estructura esperada', () => {
      expect(inventoryTemplateStructureErrors(VALID, structure)).toEqual([]);
    });

    it('informa filas por tipo y secciones que no calzan', () => {
      const rows = withRow(2, { position: 4, type: 'EMPTY' });

      expect(
        inventoryTemplateStructureErrors(rows, {
          ...structure,
          sectionPositions: [6, 7],
        }),
      ).toEqual([
        'Se esperaban 1 filas <Vacío> y hay 2.',
        'Se esperaban 1 filas sin texto y hay 0.',
        'Las secciones deben estar en las filas 6, 7 y están en 5, 7.',
      ]);
    });
  });

  describe('INVENTORY_TEMPLATE_ROWS', () => {
    it('es una plantilla válida con la estructura de la hoja', () => {
      expect(() =>
        resolveInventoryTemplate(INVENTORY_TEMPLATE_ROWS),
      ).not.toThrow();
      expect(
        inventoryTemplateStructureErrors(
          INVENTORY_TEMPLATE_ROWS,
          INVENTORY_TEMPLATE_STRUCTURE,
        ),
      ).toEqual([]);
    });
  });
});
