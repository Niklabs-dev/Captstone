import { UnitOfMeasure } from '../../generated/prisma/client.js';
import {
  hasProductFormat,
  normalizeProductName,
  resolveProductFormat,
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
  it('calcula el contenido por caja: 2 × 2,5 kg = 5 kg', () => {
    const result = resolveProductFormat({
      ...base,
      packageName: ' bolsa ',
      packagesPerBox: 2,
      packageContent: '2.5',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.format.boxContent?.toFixed(3)).toBe('5.000');
    expect(result.format.packageName).toBe('bolsa');
  });

  it('acepta un contenido por caja que coincide y rechaza uno que lo contradice', () => {
    const same = resolveProductFormat({
      ...base,
      packagesPerBox: 2,
      packageContent: '2.5',
      boxContent: '5.000',
    });
    expect(same.ok).toBe(true);
    const wrong = resolveProductFormat({
      ...base,
      packagesPerBox: 2,
      packageContent: '2.5',
      boxContent: '6',
    });
    expect(wrong.ok).toBe(false);
    if (wrong.ok) return;
    expect(wrong.errors.boxContent).toMatch(/2 × 2\.500 = 5\.000/);
  });

  it('admite solo contenido por caja, o ningún formato', () => {
    const onlyBox = resolveProductFormat({ ...base, boxContent: '10' });
    expect(onlyBox.ok && onlyBox.format.boxContent?.toFixed(3)).toBe('10.000');
    const none = resolveProductFormat(base);
    expect(none.ok && hasProductFormat(none.format)).toBe(false);
  });

  it('valida contenidos positivos con hasta 3 decimales y enteros en UNIT', () => {
    for (const value of ['0', '-1', '1.2345', 'abc', '1,5']) {
      const result = resolveProductFormat({ ...base, packageContent: value });
      expect(result.ok, value).toBe(false);
    }
    const unit = resolveProductFormat({
      ...base,
      unit: UnitOfMeasure.UNIT,
      packageContent: '1.5',
    });
    expect(unit.ok).toBe(false);
    if (unit.ok) return;
    expect(unit.errors.packageContent).toMatch(/entero/);
  });

  it('exige paquetes por caja enteros y mayores o iguales a 1', () => {
    for (const packagesPerBox of [0, -2, 1.5]) {
      const result = resolveProductFormat({
        ...base,
        packagesPerBox,
        packageContent: '1',
      });
      expect(result.ok, String(packagesPerBox)).toBe(false);
    }
  });

  it('un producto solo suelto no admite caja ni paquete', () => {
    expect(resolveProductFormat({ ...base, looseOnly: true }).ok).toBe(true);
    const mixed = resolveProductFormat({
      ...base,
      looseOnly: true,
      boxContent: '5',
    });
    expect(mixed.ok).toBe(false);
    const loose = resolveProductFormat({ ...base, looseOnly: true });
    expect(loose.ok && hasProductFormat(loose.format)).toBe(true);
  });

  it('normaliza el nombre sin cambiar mayúsculas', () => {
    expect(normalizeProductName('  Lata   Coca  Cola ')).toBe('Lata Coca Cola');
  });
});
