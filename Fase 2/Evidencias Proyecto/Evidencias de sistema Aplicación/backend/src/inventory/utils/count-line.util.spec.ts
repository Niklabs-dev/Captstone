import { Prisma, UnitOfMeasure } from '../../generated/prisma/client.js';
import {
  computeCountedQuantity,
  formatQuantity,
  resolveCountLine,
  type CountLineFormat,
  type CountLineInput,
} from './count-line.util.js';

const decimal = (value: string): Prisma.Decimal => new Prisma.Decimal(value);

// Carne Fajita: caja de 5 kg con bolsas de 2,5 kg.
const fajita: CountLineFormat = {
  unit: UnitOfMeasure.KG,
  boxContent: decimal('5'),
  packageContent: decimal('2.5'),
  looseOnly: false,
};

// Sobre Eliminador de Sarro: caja de 48 unidades, sin paquete.
const descaler: CountLineFormat = {
  unit: UnitOfMeasure.UNIT,
  boxContent: decimal('48'),
  packageContent: null,
  looseOnly: false,
};

// Atún Preparado: solo cantidad suelta.
const tuna: CountLineFormat = {
  unit: UnitOfMeasure.KG,
  boxContent: null,
  packageContent: null,
  looseOnly: true,
};

function total(format: CountLineFormat, input: CountLineInput): string | null {
  const result = resolveCountLine(format, input);
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return formatQuantity(result.line.countedQuantity, format.unit);
}

function errors(
  format: CountLineFormat,
  input: CountLineInput,
): Record<string, string> {
  const result = resolveCountLine(format, input);
  if (result.ok) throw new Error('se esperaba un error');
  return result.errors;
}

describe('cálculo de la línea de una toma de inventario (SPRINT-5-T05)', () => {
  it('Carne Fajita: 1 caja + 2 bolsas + 0,300 kg = 10,300 kg exactos', () => {
    expect(
      total(fajita, { boxes: 1, packages: 2, looseQuantity: '0.300' }),
    ).toBe('10.300');
  });

  it('1 caja + 3 bolsas + 2,450 kg = 14,950 kg: los paquetes pueden superar los de una caja', () => {
    expect(
      total(fajita, { boxes: 1, packages: 3, looseQuantity: '2.450' }),
    ).toBe('14.950');
    // Como número JSON también es exacto: se lee por su texto, no como float.
    expect(total(fajita, { boxes: 1, packages: 3, looseQuantity: 2.45 })).toBe(
      '14.950',
    );
  });

  it('Sobre Eliminador de Sarro: 1 caja de 48 + 6 sueltos = 54', () => {
    expect(total(descaler, { boxes: 1, looseQuantity: 6 })).toBe('54');
  });

  it('cantidades sueltas de 0,200 y 4,200 sin errores de redondeo', () => {
    expect(total(tuna, { looseQuantity: '0.200' })).toBe('0.200');
    expect(total(tuna, { looseQuantity: '4.2' })).toBe('4.200');
    // 0,1 + 0,1 + ... con float daría 0,30000000000000004.
    const tenths: CountLineFormat = {
      ...fajita,
      packageContent: decimal('0.1'),
    };
    expect(total(tenths, { packages: 3, looseQuantity: '0.200' })).toBe(
      '0.500',
    );
    expect(total(fajita, { packages: 1, looseQuantity: '1.700' })).toBe(
      '4.200',
    );
  });

  it('acepta 0 como conteo válido y deja como null lo no informado', () => {
    const result = resolveCountLine(fajita, { boxes: 0, looseQuantity: null });
    expect(result).toEqual({
      ok: true,
      line: {
        boxes: 0,
        packages: null,
        looseQuantity: null,
        countedQuantity: decimal('0'),
      },
    });
    expect(total(fajita, { boxes: '2' })).toBe('10.000');
  });

  it('exige informar al menos un campo', () => {
    expect(errors(fajita, {})).toHaveProperty('looseQuantity');
    expect(
      errors(fajita, { boxes: null, packages: null, looseQuantity: null }),
    ).toHaveProperty('looseQuantity');
  });

  it('rechaza cajas sin contenido por caja y paquetes sin contenido por paquete', () => {
    const onlyPackages: CountLineFormat = { ...fajita, boxContent: null };
    expect(errors(onlyPackages, { boxes: 1 })).toEqual({
      boxes: 'El producto no tiene contenido por caja: no se cuentan cajas',
    });
    expect(errors(descaler, { packages: 0 })).toEqual({
      packages:
        'El producto no tiene contenido por paquete: no se cuentan paquetes',
    });
  });

  it('rechaza cajas o paquetes en un producto «solo cantidad suelta»', () => {
    expect(
      Object.keys(errors(tuna, { boxes: 1, packages: 1, looseQuantity: 1 })),
    ).toEqual(['boxes', 'packages']);
  });

  it('rechaza negativos, decimales en cajas y paquetes y valores no numéricos', () => {
    expect(Object.keys(errors(fajita, { boxes: -1 }))).toEqual(['boxes']);
    expect(Object.keys(errors(fajita, { packages: 1.5 }))).toEqual([
      'packages',
    ]);
    expect(Object.keys(errors(fajita, { boxes: 'dos' }))).toEqual(['boxes']);
    expect(Object.keys(errors(fajita, { packages: '-2' }))).toEqual([
      'packages',
    ]);
    expect(Object.keys(errors(fajita, { boxes: true }))).toEqual(['boxes']);
    for (const looseQuantity of [
      '-0.300',
      -1,
      'abc',
      '0,300',
      '1.2345',
      '1e3',
      Number.NaN,
      Number.POSITIVE_INFINITY,
      {},
    ]) {
      expect(Object.keys(errors(fajita, { looseQuantity }))).toEqual([
        'looseQuantity',
      ]);
    }
  });

  it('en UNIT la cantidad suelta es entera', () => {
    expect(errors(descaler, { looseQuantity: '6.5' })).toEqual({
      looseQuantity:
        'La cantidad suelta debe ser un número entero mayor o igual a 0 cuando se cuenta por unidad',
    });
    expect(total(descaler, { looseQuantity: '6.000' })).toBe('6');
  });

  it('rechaza más cajas que el máximo y un total que no cabe en DECIMAL(12,3)', () => {
    expect(Object.keys(errors(fajita, { boxes: 100_001 }))).toEqual(['boxes']);
    const huge: CountLineFormat = {
      ...fajita,
      boxContent: decimal('999999999'),
    };
    expect(errors(huge, { boxes: 2 })).toEqual({
      looseQuantity: 'El total supera el máximo permitido',
    });
  });

  it('computeCountedQuantity usa la copia del formato y trata null como 0', () => {
    expect(
      computeCountedQuantity(fajita, {
        boxes: null,
        packages: 2,
        looseQuantity: null,
      }).toFixed(3),
    ).toBe('5.000');
    expect(formatQuantity(null, UnitOfMeasure.KG)).toBeNull();
  });
});
