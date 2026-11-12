import { UnitOfMeasure } from '../../generated/prisma/client.js';
import {
  alternativeNamesError,
  comparableName,
  hasProductFormat,
  normalizeProductName,
  resolveProductFormat,
  suggestTemplateRow,
  type ProductFormatInput,
} from './product-format.util.js';

const base: ProductFormatInput = {
  unit: UnitOfMeasure.KG,
  packageName: null,
  packagesPerBox: null,
  packageContent: null,
  boxContent: null,
  looseOnly: false,
};

describe('formato de productos de inventario (SPRINT-5-T03)', () => {
  it('guarda la caja y el paquete por separado: Pepperoni 7,3 kg y 0,93 kg', () => {
    const result = resolveProductFormat({
      ...base,
      packageName: ' paquete ',
      packagesPerBox: 8,
      packageContent: '0.93',
      boxContent: '7.3',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.format.boxContent?.toFixed(3)).toBe('7.300');
    expect(result.format.packageContent?.toFixed(3)).toBe('0.930');
    expect(result.format.packagesPerBox).toBe(8);
    expect(result.format.packageName).toBe('paquete');
  });

  it('no calcula la caja desde los paquetes: sin caja queda sin caja', () => {
    const result = resolveProductFormat({
      ...base,
      packagesPerBox: 2,
      packageContent: '2.5',
    });
    expect(result.ok && result.format.boxContent).toBeNull();
  });

  it('acepta solo bolsa, paquete, botella o pack como nombre del paquete', () => {
    for (const packageName of ['bolsa', 'paquete', 'botella', 'pack']) {
      expect(resolveProductFormat({ ...base, packageName }).ok).toBe(true);
    }
    const result = resolveProductFormat({
      ...base,
      packageName: 'caja grande',
    });
    expect(result).toEqual({
      ok: false,
      errors: {
        packageName:
          'El nombre del paquete debe ser bolsa, paquete, botella, pack',
      },
    });
  });

  it('rechaza contenidos en 0, negativos o con más de 3 decimales', () => {
    for (const value of ['0', '-1', '1.2345', 'abc']) {
      const result = resolveProductFormat({ ...base, boxContent: value });
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.errors.boxContent).toMatch(/^El contenido por caja/);
    }
  });

  it('exige contenidos enteros en UNIT (un pack de 6 bebidas = 6)', () => {
    const result = resolveProductFormat({
      ...base,
      unit: UnitOfMeasure.UNIT,
      packageName: 'pack',
      packageContent: '6.5',
    });
    expect(result).toEqual({
      ok: false,
      errors: {
        packageContent:
          'El contenido por paquete debe ser un número entero cuando se cuenta por unidad',
      },
    });
    expect(
      resolveProductFormat({
        ...base,
        unit: UnitOfMeasure.UNIT,
        packageContent: '6',
        boxContent: '24',
      }).ok,
    ).toBe(true);
  });

  it('rechaza paquetes por caja menores que 1', () => {
    const result = resolveProductFormat({ ...base, packagesPerBox: 0 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.packagesPerBox).toMatch(/mayor o igual a 1/);
  });

  it('«solo cantidad suelta» no lleva caja ni paquete', () => {
    expect(resolveProductFormat({ ...base, looseOnly: true })).toMatchObject({
      ok: true,
      format: { looseOnly: true, boxContent: null },
    });
    const invalid = resolveProductFormat({
      ...base,
      looseOnly: true,
      boxContent: '5',
    });
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.errors.looseOnly).toMatch(/no lleva caja/);
  });

  it('indica si el producto tiene formato', () => {
    const result = resolveProductFormat({ ...base, boxContent: '5' });
    expect(result.ok && hasProductFormat(result.format)).toBe(true);
    const empty = resolveProductFormat(base);
    expect(empty.ok && hasProductFormat(empty.format)).toBe(false);
  });
});

describe('nombres de productos de inventario (SPRINT-5-T03)', () => {
  it('normaliza espacios y compara sin tildes ni mayúsculas', () => {
    expect(normalizeProductName('  Lata   Coca Cola ')).toBe('Lata Coca Cola');
    expect(comparableName(' ATÚN  (Preparado)')).toBe('atun (preparado)');
  });

  it('rechaza alternativos vacíos, repetidos o iguales al nombre', () => {
    const name = 'Carne Fajita (Beef Steak Saborizado)';
    expect(alternativeNamesError(name, ['Beef Steak', 'Carne Queso'])).toBe(
      null,
    );
    expect(alternativeNamesError(name, ['   '])).toBe(
      'Los nombres alternativos no pueden estar vacíos',
    );
    expect(alternativeNamesError(name, ['Dup', 'dup'])).toBe(
      '«dup» está repetido',
    );
    expect(
      alternativeNamesError(name, ['carne fajita (beef steak saborizado)']),
    ).toMatch(/es el mismo nombre del producto/);
  });

  it('sugiere la fila del artículo por nombre o alternativo, si no una <Vacío>', () => {
    const rows = [
      { id: 'a', printedText: 'Pepperoni', isEmptyRow: false },
      { id: 'b', printedText: '<Vacío>', isEmptyRow: true },
      {
        id: 'c',
        printedText: 'Carne Fajita (Beef Steak Saborizado)',
        isEmptyRow: false,
      },
    ];
    expect(
      suggestTemplateRow(rows, [
        'Beef Steak',
        'carne fajita (beef steak saborizado)',
      ]),
    ).toEqual({ row: rows[2], reason: 'MATCH' });
    expect(suggestTemplateRow(rows, ['Pepperoni Nuevo', 'PEPPERONI'])).toEqual({
      row: rows[0],
      reason: 'MATCH',
    });
    expect(suggestTemplateRow(rows, ['Lata Pepsi'])).toEqual({
      row: rows[1],
      reason: 'EMPTY',
    });
    expect(suggestTemplateRow([rows[0]], ['Lata Pepsi'])).toBeNull();
  });
});
