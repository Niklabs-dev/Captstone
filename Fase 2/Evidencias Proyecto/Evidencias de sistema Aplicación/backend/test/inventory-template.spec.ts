import { UnitOfMeasure } from '../src/generated/prisma/client.js';
import {
  INVENTORY_EMPTY_ITEM_TEXT,
  INVENTORY_TEMPLATE_ROWS,
  type InventoryTemplateRowSeed,
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
    unit: UnitOfMeasure.KG,
    format: {
      packageName: 'bolsa',
      boxContent: '5',
      packagesPerBox: 2,
      packageContent: '2.5',
    },
  },
  { position: 3, type: 'EMPTY' },
  { position: 4, type: 'BLANK' },
  { position: 5, type: 'SECTION', text: 'COSTO PROTEÍNAS' },
  {
    position: 6,
    type: 'ARTICLE',
    text: 'Lata Fanta Zero',
    unit: UnitOfMeasure.UNIT,
  },
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
        { position: 2, type: 'ARTICLE', text: 'Lata Fanta Zero', unit: 'UNIT' },
        { position: 3, type: 'ARTICLE', text: 'Lata Fanta Zero', unit: 'UNIT' },
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
          withRow(4, { position: 6, type: 'ARTICLE', text: ' ', unit: 'UNIT' }),
        ),
      ).toThrow(/Fila 6: nombre vacío/);
      expect(() =>
        resolveInventoryTemplate(
          withRow(4, {
            position: 6,
            type: 'ARTICLE',
            text: 'Lata Fanta Zero ',
            unit: 'UNIT',
          }),
        ),
      ).toThrow(/Fila 6: nombre con espacios/);
      expect(() =>
        resolveInventoryTemplate(
          withRow(4, {
            position: 6,
            type: 'ARTICLE',
            text: INVENTORY_EMPTY_ITEM_TEXT,
            unit: 'UNIT',
          }),
        ),
      ).toThrow(/se declara como EMPTY/);
    });

    it('rechaza un nombre de más de 120 caracteres', () => {
      const rows = withRow(4, {
        position: 6,
        type: 'ARTICLE',
        text: 'x'.repeat(121),
        unit: 'UNIT',
      });

      expect(() => resolveInventoryTemplate(rows)).toThrow(
        /más de 120 caracteres/,
      );
    });

    it('rechaza contenidos en 0, negativos o con más de 3 decimales', () => {
      for (const boxContent of ['0', '-1', '1.2345', 'cinco']) {
        const rows = withRow(0, {
          position: 2,
          type: 'ARTICLE',
          text: 'Carne Fajita',
          unit: 'KG',
          format: { boxContent },
        });
        expect(() => resolveInventoryTemplate(rows)).toThrow(
          /contenido por caja .* debe ser mayor que 0/,
        );
      }
    });

    it('exige contenidos enteros en UNIT', () => {
      const rows = withRow(4, {
        position: 6,
        type: 'ARTICLE',
        text: 'Lata Fanta Zero',
        unit: 'UNIT',
        format: { packageContent: '6.5' },
      });

      expect(() => resolveInventoryTemplate(rows)).toThrow(
        /contenido por paquete «6.5» debe ser entero en UNIT/,
      );
    });

    it('rechaza paquetes por caja menores que 1 o no enteros', () => {
      for (const packagesPerBox of [0, 1.5]) {
        const rows = withRow(0, {
          position: 2,
          type: 'ARTICLE',
          text: 'Carne Fajita',
          unit: 'KG',
          format: { packagesPerBox },
        });
        expect(() => resolveInventoryTemplate(rows)).toThrow(
          /paquetes por caja debe ser un entero >= 1/,
        );
      }
    });

    it('rechaza caja o paquete en un producto de solo cantidad suelta', () => {
      const rows = withRow(0, {
        position: 2,
        type: 'ARTICLE',
        text: 'Atún (Preparado)',
        unit: 'KG',
        format: { looseOnly: true, boxContent: '5' },
      });

      expect(() => resolveInventoryTemplate(rows)).toThrow(
        /solo cantidad suelta» no lleva caja ni paquete/,
      );
    });

    it('informa todos los errores de una vez', () => {
      const rows: InventoryTemplateRowSeed[] = [
        { position: 2, type: 'ARTICLE', text: '', unit: 'KG' },
        { position: 4, type: 'BLANK' },
      ];

      expect(() => resolveInventoryTemplate(rows)).toThrow(
        /Fila 2: nombre vacío[\s\S]*Fila 4: las posiciones[\s\S]*sin una sección/,
      );
    });
  });

  describe('INVENTORY_TEMPLATE_ROWS', () => {
    it('es una plantilla válida', () => {
      expect(() =>
        resolveInventoryTemplate(INVENTORY_TEMPLATE_ROWS),
      ).not.toThrow();
    });
  });
});
